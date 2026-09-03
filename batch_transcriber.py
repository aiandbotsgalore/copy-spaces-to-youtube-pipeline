import os
import sys
import json
import time
import math
import argparse
import tempfile
import subprocess
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

import soundfile as sf
import imageio_ffmpeg
import requests
import shutil

# ---------------------------------------------------------------------------
# Constants & Defaults
# ---------------------------------------------------------------------------
DEFAULT_PROFILES_FILE = "voice_profiles.json"
DEFAULT_OUTPUT_DIR = "output_transcripts"
DEFAULT_MODEL = "large-v3-turbo"
DEFAULT_SIMILARITY_THRESHOLD = 0.60
SAMPLE_RATE = 16000
EMBEDDING_DIM = 192

PYTHON_EXE = sys.executable
FFMPEG_EXE = shutil.which("ffmpeg") or imageio_ffmpeg.get_ffmpeg_exe()


# ---------------------------------------------------------------------------
# Audio Processing Utilities
# ---------------------------------------------------------------------------
def extract_audio_to_wav(source: str, output_wav: str, github_token: Optional[str] = None) -> bool:
    """Converts local audio file or remote URL into 16kHz mono WAV."""
    headers = []
    if github_token and ("github.com" in source or "githubusercontent.com" in source):
        headers = ["-headers", f"Authorization: token {github_token}\r\nUser-Agent: SpacePipeTranscriber"]

    cmd = [FFMPEG_EXE, "-y"]
    if headers and source.startswith("http"):
        cmd.extend(headers)
    
    cmd.extend([
        "-i", source,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", str(SAMPLE_RATE),
        "-ac", "1",
        output_wav
    ])
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"[!] FFmpeg error converting audio from {source}:\n{result.stderr[-500:]}")
        return False
    return True


# ---------------------------------------------------------------------------
# Stage 1 Worker: GPU ASR (Faster-Whisper)
# ---------------------------------------------------------------------------
def _transcribe_single_wav(wav_path: str, model_size: str, device: str, compute_type: str, time_offset: float = 0.0) -> List[Dict[str, Any]]:
    """Transcribes a single WAV file on GPU with Faster-Whisper."""
    abs_wav = os.path.abspath(wav_path)
    json_out_path = os.path.abspath(f"{abs_wav}.tmp_segs.json")

    wav_json = json.dumps(abs_wav)
    json_out_json = json.dumps(json_out_path)

    code = f"""
import sys, os, json
from faster_whisper import WhisperModel

try:
    model = WhisperModel('{model_size}', device='{device}', compute_type='{compute_type}')
except Exception as e:
    model = WhisperModel('{model_size}', device='{device}', compute_type='int8_float16' if '{device}' == 'cuda' else 'int8')

segments, info = model.transcribe(
    {wav_json},
    beam_size=5,
    vad_filter=True,
    vad_parameters=dict(min_silence_duration_ms=500),
    word_timestamps=False
)

results = []
offset = {time_offset}
for s in segments:
    results.append({{'start': round(s.start + offset, 3), 'end': round(s.end + offset, 3), 'text': s.text.strip()}})

with open({json_out_json}, 'w', encoding='utf-8') as f:
    json.dump(results, f)
    f.flush()
    os.fsync(f.fileno())

sys.stdout.flush()
os._exit(0)
"""
    res = subprocess.run([PYTHON_EXE, "-c", code], capture_output=True, text=True, encoding="utf-8")

    if os.path.exists(json_out_path):
        try:
            with open(json_out_path, "r", encoding="utf-8") as f:
                return json.load(f)
        finally:
            try:
                os.remove(json_out_path)
            except Exception:
                pass

    if res.returncode != 0:
        raise RuntimeError(f"ASR worker failed (exit code {res.returncode}):\n{res.stderr}\n{res.stdout}")
    
    return []


def run_asr_worker(wav_path: str, model_size: str, device: str, compute_type: str) -> List[Dict[str, Any]]:
    """Runs Faster-Whisper ASR on GPU with intelligent chunking to support multi-hour audio files without RAM limits."""
    with sf.SoundFile(wav_path) as f:
        duration_sec = len(f) / f.samplerate

    CHUNK_SEC = 3600.0  # 1 hour per chunk to prevent excessive NumPy RAM allocation
    if duration_sec <= CHUNK_SEC:
        return _transcribe_single_wav(wav_path, model_size, device, compute_type, time_offset=0.0)

    num_chunks = math.ceil(duration_sec / CHUNK_SEC)
    print(f"[*] Audio is long ({duration_sec / 3600:.1f} hours). Splitting into {num_chunks} 1-hour chunks for GPU ASR...")
    
    base_name = os.path.splitext(wav_path)[0]
    all_segments = []
    for i in range(num_chunks):
        start_sec = i * CHUNK_SEC
        chunk_wav = f"{base_name}_chunk_{i}.wav"
        try:
            print(f"  [{i + 1}/{num_chunks}] Transcribing chunk {i + 1} (Offset +{int(start_sec // 60)}m)...")
            cmd = [FFMPEG_EXE, "-y", "-ss", str(start_sec), "-t", str(CHUNK_SEC), "-i", wav_path, "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", chunk_wav]
            subprocess.run(cmd, capture_output=True, check=True)
            chunk_info = sf.info(chunk_wav)
            if chunk_info.duration < 0.1:
                print(f"  [!] Warning: Chunk {i + 1} duration is {chunk_info.duration}s, skipping.")
                continue
            chunk_segs = _transcribe_single_wav(chunk_wav, model_size, device, compute_type, time_offset=start_sec)
            all_segments.extend(chunk_segs)
        finally:
            if os.path.exists(chunk_wav):
                try:
                    os.remove(chunk_wav)
                except Exception:
                    pass

    return all_segments


# ---------------------------------------------------------------------------
# Stage 2 Worker: Neural Diarization & Profile Matching (SpeechBrain ECAPA-TDNN)
# ---------------------------------------------------------------------------
def run_diarization_worker(
    wav_path: str,
    segments: List[Dict[str, Any]],
    profiles_path: str,
    threshold: float,
    interactive: bool
) -> Tuple[List[Dict[str, Any]], Dict[int, str], Dict[str, float]]:
    """Runs SpeechBrain ECAPA-TDNN 192-dim neural speaker diarization on GPU in an isolated subprocess."""
    payload = {
        "wav_path": wav_path,
        "segments": segments,
        "profiles_path": profiles_path,
        "threshold": threshold,
        "interactive": interactive
    }

    worker_script = f"""
import sys, json, os, time, warnings
warnings.filterwarnings('ignore')
import numpy as np
import soundfile as sf
import torch, torchaudio
from sklearn.cluster import AgglomerativeClustering
from speechbrain.inference.speaker import EncoderClassifier

def cosine_similarity(v1, v2):
    n1 = np.linalg.norm(v1)
    n2 = np.linalg.norm(v2)
    if n1 < 1e-6 or n2 < 1e-6:
        return 0.0
    return float(np.dot(v1, v2) / (n1 * n2))

payload = json.loads(sys.stdin.read())
wav_path = payload['wav_path']
raw_segments = payload['segments']
profiles_path = payload['profiles_path']
threshold = payload['threshold']
interactive = payload['interactive']

# 1. Open Audio File (streamed on-demand to support 10+ hour recordings with zero RAM pressure)
sfile = sf.SoundFile(wav_path)
sr = sfile.samplerate
total_samples = len(sfile)

# 2. Load Profiles
profiles = {{}}
if os.path.exists(profiles_path):
    try:
        with open(profiles_path, 'r', encoding='utf-8') as f:
            profiles = json.load(f).get('profiles', {{}})
    except Exception:
        profiles = {{}}

# 3. Load SpeechBrain ECAPA-TDNN on GPU
classifier = EncoderClassifier.from_hparams(
    source='speechbrain/spkrec-ecapa-voxceleb',
    savedir=os.path.join(os.path.expanduser('~'), '.cache', 'speechbrain', 'spkrec-ecapa-voxceleb'),
    run_opts={{'device': 'cuda:0'}}
)

# 4. Extract 192-dim neural embeddings for each segment with context padding
segment_embeddings = []
for seg in raw_segments:
    dur = seg['end'] - seg['start']
    pad = max(0.0, (1.8 - dur) / 2.0)
    start_sample = max(0, int((seg['start'] - pad) * sr))
    end_sample = min(total_samples, int((seg['end'] + pad) * sr))
    count = end_sample - start_sample

    seg_audio = np.zeros(0, dtype=np.float32)
    if count > 0:
        sfile.seek(start_sample)
        seg_audio = sfile.read(count, dtype='float32')
        if seg_audio.ndim > 1:
            seg_audio = np.mean(seg_audio, axis=1)

    if len(seg_audio) > sr * 0.35:
        max_val = np.max(np.abs(seg_audio))
        if max_val > 1e-6:
            seg_audio = seg_audio / max_val
        t = torch.from_numpy(seg_audio).unsqueeze(0).to('cuda:0')
        with torch.no_grad():
            emb = classifier.encode_batch(t).squeeze().cpu().numpy()
        norm = np.linalg.norm(emb)
        if norm > 1e-6:
            emb = emb / norm
    else:
        emb = np.zeros(192, dtype=np.float32)
    segment_embeddings.append(emb)

sfile.close()

# 5. Cluster speakers using Cosine Distance
valid_indices = [i for i, emb in enumerate(segment_embeddings) if np.linalg.norm(emb) > 0.5]
if len(valid_indices) >= 2:
    feat_matrix = np.array([segment_embeddings[i] for i in valid_indices])
    clustering = AgglomerativeClustering(
        n_clusters=None,
        distance_threshold=0.70,
        metric='cosine',
        linkage='average'
    )
    labels = clustering.fit_predict(feat_matrix)
    for idx, cid in zip(valid_indices, labels):
        raw_segments[idx]['cluster_id'] = int(cid)
else:
    for idx in valid_indices:
        raw_segments[idx]['cluster_id'] = 0

# 6. Dominant cluster consolidation (merge micro-clusters)
cluster_talk_time = {{}}
for r in raw_segments:
    cid = r.get('cluster_id', 0)
    cluster_talk_time[cid] = cluster_talk_time.get(cid, 0.0) + (r['end'] - r['start'])

cluster_centroids = {{}}
for cid in set(r.get('cluster_id', 0) for r in raw_segments if 'cluster_id' in r):
    c_embs = [segment_embeddings[i] for i, r in enumerate(raw_segments) if r.get('cluster_id') == cid and np.linalg.norm(segment_embeddings[i]) > 0.5]
    if c_embs:
        mean_emb = np.mean(c_embs, axis=0)
        cluster_centroids[cid] = mean_emb / (np.linalg.norm(mean_emb) + 1e-10)

dominant_clusters = [cid for cid, t in cluster_talk_time.items() if t >= 5.0]
if not dominant_clusters:
    dominant_clusters = list(cluster_centroids.keys())

for r in raw_segments:
    cid = r.get('cluster_id', 0)
    if cid not in dominant_clusters and dominant_clusters and cid in cluster_centroids:
        c_emb = cluster_centroids[cid]
        best_dom = max(dominant_clusters, key=lambda d: cosine_similarity(c_emb, cluster_centroids[d]))
        r['cluster_id'] = best_dom

# 7. Speaker Identification against voice_profiles.json
cluster_to_speaker = {{}}
matched_profiles = set()

for cid in dominant_clusters:
    mean_emb = cluster_centroids[cid]
    best_name = None
    best_sim = -1.0
    for pname, pdata in profiles.items():
        pe = pdata.get('embedding')
        if pe and len(pe) == 192:
            s = cosine_similarity(mean_emb, np.array(pe, dtype=np.float32))
            if s > best_sim:
                best_sim = s
                best_name = pname

    if best_name and best_sim >= threshold and best_name not in matched_profiles:
        cluster_to_speaker[cid] = best_name
        matched_profiles.add(best_name)
        # Update profile with EMA
        existing = np.array(profiles[best_name]['embedding'], dtype=np.float32)
        cnt = profiles[best_name].get('sample_count', 1)
        upd = (existing * cnt + mean_emb) / (cnt + 1)
        upd = upd / np.linalg.norm(upd)
        profiles[best_name]['embedding'] = upd.tolist()
        profiles[best_name]['sample_count'] = cnt + 1
        profiles[best_name]['last_updated'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())

# 8. Chronological Sequential Numbering (Speaker 1, Speaker 2, Speaker 3...)
speaker_counter = 1
for r in raw_segments:
    cid = r.get('cluster_id', 0)
    if cid not in cluster_to_speaker:
        cluster_to_speaker[cid] = f'Speaker {{speaker_counter}}'
        speaker_counter += 1

# Save updated profiles
with open(profiles_path, 'w', encoding='utf-8') as f:
    json.dump({{
        'version': '2.0-neural',
        'updated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'embedding_model': 'speechbrain/spkrec-ecapa-voxceleb',
        'embedding_dim': 192,
        'profiles': profiles
    }}, f, indent=2)

# Assign names to segments
for r in raw_segments:
    cid = r.get('cluster_id', 0)
    r['speaker'] = cluster_to_speaker.get(cid, 'Speaker 1')

# Re-calculate clean talk time per named speaker
speaker_talk_time = {{}}
for r in raw_segments:
    spk = r['speaker']
    speaker_talk_time[spk] = speaker_talk_time.get(spk, 0.0) + (r['end'] - r['start'])

# Merge consecutive segments from same speaker
merged = []
for r in raw_segments:
    if not r['text']:
        continue
    if merged and merged[-1]['speaker'] == r['speaker'] and (r['start'] - merged[-1]['end']) < 2.0:
        merged[-1]['end'] = r['end']
        merged[-1]['text'] += ' ' + r['text']
    else:
        merged.append({{
            'start': r['start'],
            'end': r['end'],
            'speaker': r['speaker'],
            'text': r['text']
        }})

out_payload = {{
    'merged_segments': merged,
    'cluster_to_speaker': {{str(k): v for k, v in cluster_to_speaker.items()}},
    'speaker_talk_time': {{k: round(v, 2) for k, v in speaker_talk_time.items()}}
}}

print('__SPACEPIPE_JSON_START__')
print(json.dumps(out_payload))
"""
    res = subprocess.run(
        [PYTHON_EXE, "-c", worker_script],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        encoding="utf-8"
    )
    if res.returncode != 0 or "__SPACEPIPE_JSON_START__" not in res.stdout:
        raise RuntimeError(f"Diarization worker failed (exit code {res.returncode}):\n{res.stderr}\n{res.stdout}")

    json_str = res.stdout.split("__SPACEPIPE_JSON_START__")[1].strip()
    data = json.loads(json_str)
    return data["merged_segments"], data["cluster_to_speaker"], data["speaker_talk_time"]


# ---------------------------------------------------------------------------
# AI Contextual Speaker Resolution (Gemini 2.5 Flash)
# ---------------------------------------------------------------------------
def resolve_speakers_with_gemini(
    segments: List[Dict[str, Any]],
    profiles_path: str,
    api_key: Optional[str] = None
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """Uses Gemini 2.5 Flash to deduce speaker real names and roles from conversational context."""
    resolved_key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not resolved_key:
        return segments, {}

    try:
        from google import genai
        from pydantic import BaseModel, Field

        class SpeakerIdentification(BaseModel):
            speaker_id: str = Field(description="The generic speaker label, e.g. Speaker 1")
            identified_name: str = Field(description="Real name or specific conversational title, e.g. Parr, Mr. Ebo, Sarah, Host (Anchorage)")
            confidence: float = Field(description="Confidence between 0.0 and 1.0")
            reasoning: str = Field(description="Quote or reason from transcript")

        class DiarizationResolution(BaseModel):
            speaker_mappings: List[SpeakerIdentification]

        client = genai.Client(api_key=resolved_key)

        profiles = {}
        if os.path.exists(profiles_path):
            try:
                with open(profiles_path, "r", encoding="utf-8") as f:
                    profiles = json.load(f).get("profiles", {})
            except Exception:
                profiles = {}

        known_speakers = list(profiles.keys())
        known_str = ", ".join(known_speakers) if known_speakers else "None"

        # Build transcript sample (up to 180 segments for rich conversational context)
        sample_lines = []
        for s in segments[:180]:
            sample_lines.append(f"[{s['start']:.1f}s] {s['speaker']}: {s['text']}")
        transcript_sample = "\n".join(sample_lines)

        prompt = f"""
You are an expert audio diarization analyst. Analyze this Twitter Space transcript and identify the real names or specific roles of the generic speakers (e.g. Speaker 1, Speaker 2, etc.) based on:
1. Direct self-introductions (e.g. "I am [Name]")
2. How others address them in conversation (e.g. "Good morning there, Parr", "Mr. Ebo", "Hey Sarah")
3. Self-descriptions, location, and topic context.

Known enrolled speakers: {known_str}

Transcript sample:
{transcript_sample}
"""

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config={
                "response_mime_type": "application/json",
                "response_json_schema": DiarizationResolution.model_json_schema()
            }
        )

        res = DiarizationResolution.model_validate_json(response.text)
        mapping = {}
        generic_tokens = ("participant", "unknown", "listener", "guest", "someone", "unidentified", "audience", "none")
        for m in res.speaker_mappings:
            name_clean = m.identified_name.strip()
            is_generic = any(token in name_clean.lower() for token in generic_tokens)
            if m.confidence >= 0.70 and not is_generic and len(name_clean) > 1 and not name_clean.lower().startswith("speaker"):
                mapping[m.speaker_id] = name_clean

        if mapping:
            print(f"\n[AI Contextual Speaker Discovery (Gemini 2.5 Flash)]")
            for raw_spk, new_spk in mapping.items():
                print(f"  • {raw_spk} -> {new_spk}")

            for s in segments:
                if s["speaker"] in mapping:
                    s["speaker"] = mapping[s["speaker"]]

        return segments, mapping

    except Exception as e:
        print(f"[!] Gemini contextual speaker resolution skipped: {e}")
        return segments, {}


# ---------------------------------------------------------------------------
# Batch Audio Transcriber Pipeline
# ---------------------------------------------------------------------------
class BatchAudioTranscriber:
    def __init__(
        self,
        model_size: str = DEFAULT_MODEL,
        device: str = "cuda",
        compute_type: str = "float16",
        profiles_file: str = DEFAULT_PROFILES_FILE,
        similarity_threshold: float = DEFAULT_SIMILARITY_THRESHOLD,
        output_dir: str = DEFAULT_OUTPUT_DIR,
        interactive: bool = True,
        use_ai_identification: bool = True
    ):
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self.similarity_threshold = similarity_threshold
        self.profiles_file = str(Path(profiles_file).resolve())
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.interactive = interactive
        self.use_ai_identification = use_ai_identification

    def format_timestamp(self, seconds: float, srt: bool = False) -> str:
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        millis = int((seconds - int(seconds)) * 1000)
        if srt:
            return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"
        if hours > 0:
            return f"{hours:02d}:{minutes:02d}:{secs:02d}"
        return f"{minutes:02d}:{secs:02d}"

    def process_file(self, audio_source: str, title: Optional[str] = None, github_token: Optional[str] = None) -> Dict[str, Any]:
        if not title:
            clean_name = Path(audio_source.split("?")[0]).name
            title = clean_name if clean_name else "audio_transcript"

        print(f"\n========================================================")
        print(f"[*] Processing: {title}")
        print(f"[*] Source: {audio_source}")
        print(f"========================================================")

        start_time = time.time()

        with tempfile.TemporaryDirectory() as tmp_dir:
            wav_path = os.path.join(tmp_dir, "audio_16k.wav")
            print(f"[1/4] Ingesting & streaming audio via FFmpeg...")
            t0 = time.time()
            if not extract_audio_to_wav(audio_source, wav_path, github_token=github_token):
                print(f"[!] Failed to ingest audio from {audio_source}")
                return {"status": "error", "title": title}
            print(f"[✓] Audio stream prepared in {time.time() - t0:.2f}s")

            # Check duration
            audio_info = sf.info(wav_path)
            duration_sec = audio_info.duration
            print(f"[*] Total Audio Duration: {self.format_timestamp(duration_sec)} ({duration_sec / 60:.1f} minutes)")

            # Step 2: GPU Faster-Whisper ASR
            print(f"[2/4] Transcribing on GPU with Faster-Whisper ({self.model_size})...")
            t_asr = time.time()
            raw_segments = run_asr_worker(wav_path, self.model_size, self.device, self.compute_type)
            asr_duration = time.time() - t_asr
            speed_ratio = (duration_sec / asr_duration) if asr_duration > 0 else 0
            print(f"[✓] ASR Complete: {len(raw_segments)} segments in {asr_duration:.2f}s ({speed_ratio:.1f}x real-time speed)")

            # Step 3: GPU SpeechBrain Neural Diarization
            print(f"[3/4] Running Neural Speaker Diarization on GPU (192-dim ECAPA-TDNN)...")
            t_diar = time.time()
            merged_segments, cluster_to_speaker, speaker_talk_time = run_diarization_worker(
                wav_path=wav_path,
                segments=raw_segments,
                profiles_path=self.profiles_file,
                threshold=self.similarity_threshold,
                interactive=self.interactive
            )
            print(f"[✓] Neural Diarization Complete in {time.time() - t_diar:.2f}s")

            # Step 4: AI Contextual Speaker Resolution (Gemini 2.5 Flash)
            if self.use_ai_identification:
                merged_segments, ai_mappings = resolve_speakers_with_gemini(
                    segments=merged_segments,
                    profiles_path=self.profiles_file
                )
                if ai_mappings:
                    # Update talk times with resolved names
                    speaker_talk_time = {}
                    for s in merged_segments:
                        spk = s["speaker"]
                        speaker_talk_time[spk] = speaker_talk_time.get(spk, 0.0) + (s["end"] - s["start"])

            print(f"[4/4] Final Speaker Breakdown:")
            for spk_name, tt in sorted(speaker_talk_time.items(), key=lambda x: x[1], reverse=True):
                print(f"  • {spk_name}: {self.format_timestamp(tt)} ({tt/60:.1f} min)")

            # Step 5: Export Transcripts (.txt, .srt, .json)
            safe_title = "".join(c for c in title if c.isalnum() or c in (" ", "-", "_")).strip().replace(" ", "_")
            txt_path = self.output_dir / f"{safe_title}.txt"
            srt_path = self.output_dir / f"{safe_title}.srt"
            json_path = self.output_dir / f"{safe_title}.json"

            # 1. Text transcript
            with open(txt_path, "w", encoding="utf-8") as f:
                f.write(f"=== TRANSCRIPT: {title} ===\n")
                f.write(f"Duration: {self.format_timestamp(duration_sec)}\n")
                f.write(f"Generated: {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}\n\n")
                for s in merged_segments:
                    start_str = self.format_timestamp(s["start"])
                    end_str = self.format_timestamp(s["end"])
                    f.write(f"[{start_str} - {end_str}] {s['speaker']}: {s['text']}\n\n")

            # 2. SRT transcript
            with open(srt_path, "w", encoding="utf-8") as f:
                if merged_segments:
                    for i, s in enumerate(merged_segments, 1):
                        start_srt = self.format_timestamp(s["start"], srt=True)
                        end_srt = self.format_timestamp(s["end"], srt=True)
                        f.write(f"{i}\n{start_srt} --> {end_srt}\n{s['speaker']}: {s['text']}\n\n")
                else:
                    f.write("1\n00:00:00,000 --> 00:00:01,000\n[Silence or ambient audio]\n\n")

            # 3. JSON transcript
            json_payload = {
                "title": title,
                "source": audio_source,
                "duration_seconds": duration_sec,
                "duration_formatted": self.format_timestamp(duration_sec),
                "model": self.model_size,
                "speakers_detected": list(speaker_talk_time.keys()),
                "speaker_talk_time": speaker_talk_time,
                "segments": merged_segments
            }
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(json_payload, f, indent=2)

            total_time = time.time() - start_time
            print(f"\n[✓] Finished in {total_time:.2f}s (Overall Speed: {duration_sec / total_time:.1f}x real-time)")
            print(f"    • TXT:  {txt_path}")
            print(f"    • SRT:  {srt_path}")
            print(f"    • JSON: {json_path}")

            return {
                "status": "success",
                "title": title,
                "duration": duration_sec,
                "elapsed_time": total_time,
                "txt_path": str(txt_path),
                "srt_path": str(srt_path),
                "json_path": str(json_path)
            }


# ---------------------------------------------------------------------------
# GitHub Ingestion Discovery
# ---------------------------------------------------------------------------
def discover_github_audio(repo: str, github_token: Optional[str] = None) -> List[Dict[str, str]]:
    """Discovers audio files across releases in a GitHub repository."""
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "SpacePipeBatchTranscriber"}
    if github_token:
        headers["Authorization"] = f"Bearer {github_token}"

    audio_items = []
    page = 1
    while True:
        url = f"https://api.github.com/repos/{repo}/releases?per_page=100&page={page}"
        try:
            r = requests.get(url, headers=headers, timeout=30)
            if r.status_code != 200:
                print(f"[!] GitHub API error ({r.status_code}): {r.text[:200]}")
                break
            releases = r.json()
            if not releases:
                break
            for rel in releases:
                if rel.get("draft") or rel.get("prerelease"):
                    continue
                tag = rel.get("tag_name", "")
                name = rel.get("name") or tag
                for asset in rel.get("assets", []):
                    aname = asset.get("name", "")
                    if any(aname.lower().endswith(ext) for ext in (".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac", ".opus")):
                        audio_items.append({
                            "title": f"{name} ({aname})",
                            "url": asset.get("browser_download_url"),
                            "tag": tag,
                            "size": asset.get("size", 0)
                        })
            page += 1
        except Exception as e:
            print(f"[!] Exception fetching releases page {page}: {e}")
            break

    return audio_items


# ---------------------------------------------------------------------------
# Single / Batch Speaker Enrollment
# ---------------------------------------------------------------------------
def enroll_speaker_file(speaker_name: str, audio_file: str, profiles_file: str) -> bool:
    """Enrolls a speaker voice sample into voice_profiles.json."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_wav = os.path.join(tmp_dir, "enroll.wav")
        if not extract_audio_to_wav(audio_file, tmp_wav):
            return False
        
        worker_code = f"""
import sys, json, os, time, warnings
warnings.filterwarnings('ignore')
import soundfile as sf
import numpy as np
import torch
from speechbrain.inference.speaker import EncoderClassifier

classifier = EncoderClassifier.from_hparams(
    source='speechbrain/spkrec-ecapa-voxceleb',
    savedir=os.path.join(os.path.expanduser('~'), '.cache', 'speechbrain', 'spkrec-ecapa-voxceleb'),
    run_opts={{'device': 'cuda:0'}}
)

aud, sr = sf.read(r'{tmp_wav}')
if aud.ndim > 1:
    aud = np.mean(aud, axis=1)
t = torch.from_numpy(aud.astype(np.float32)).unsqueeze(0).to('cuda:0')
with torch.no_grad():
    emb = classifier.encode_batch(t).squeeze().cpu().numpy()
emb = emb / np.linalg.norm(emb)

profiles_path = r'{profiles_file}'
profiles = {{}}
if os.path.exists(profiles_path):
    try:
        with open(profiles_path, 'r', encoding='utf-8') as f:
            profiles = json.load(f).get('profiles', {{}})
    except Exception:
        profiles = {{}}

name = '{speaker_name}'
if name in profiles and 'embedding' in profiles[name]:
    existing = np.array(profiles[name]['embedding'], dtype=np.float32)
    cnt = profiles[name].get('sample_count', 1)
    upd = (existing * cnt + emb) / (cnt + 1)
    upd = upd / np.linalg.norm(upd)
    profiles[name]['embedding'] = upd.tolist()
    profiles[name]['sample_count'] = cnt + 1
    profiles[name]['last_updated'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
else:
    profiles[name] = {{
        'name': name,
        'sample_count': 1,
        'embedding': emb.tolist(),
        'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'last_updated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    }}

with open(profiles_path, 'w', encoding='utf-8') as f:
    json.dump({{
        'version': '2.0-neural',
        'updated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'embedding_model': 'speechbrain/spkrec-ecapa-voxceleb',
        'embedding_dim': 192,
        'profiles': profiles
    }}, f, indent=2)

print('ENROLL_OK')
"""
        res = subprocess.run([PYTHON_EXE, "-c", worker_code], capture_output=True, text=True, encoding="utf-8")
        return "ENROLL_OK" in res.stdout


# ---------------------------------------------------------------------------
# CLI Interface
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="GPU-Accelerated GitHub Audio Batch Transcriber & Neural Speaker Diarization Pipeline")
    parser.add_argument("--url", type=str, help="Direct audio URL (e.g. GitHub raw URL, Release download link, or HTTPS audio)")
    parser.add_argument("--repo", type=str, help="GitHub repository (e.g. 'owner/repo') to automatically scan for all audio releases/files")
    parser.add_argument("--file", type=str, help="Path to a local audio file (.mp3, .m4a, .wav, etc.)")
    parser.add_argument("--list", type=str, help="Path to a text file containing URLs or file paths (one per line)")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL, choices=["tiny", "base", "small", "medium", "large-v3", "large-v3-turbo"], help="Whisper model size")
    parser.add_argument("--device", type=str, default="cuda", choices=["cuda", "cpu"], help="Compute device (default: cuda)")
    parser.add_argument("--compute-type", type=str, default="float16", help="Computation precision (default: float16)")
    parser.add_argument("--profiles", type=str, default=DEFAULT_PROFILES_FILE, help="Path to voice_profiles.json")
    parser.add_argument("--threshold", type=float, default=DEFAULT_SIMILARITY_THRESHOLD, help="Cosine similarity threshold for speaker recognition (default: 0.60)")
    parser.add_argument("--output-dir", type=str, default=DEFAULT_OUTPUT_DIR, help="Directory to save generated transcripts")
    parser.add_argument("--github-token", type=str, default=os.environ.get("GITHUB_TOKEN"), help="GitHub Personal Access Token (for private repos / high rate limits)")
    parser.add_argument("--non-interactive", action="store_true", help="Run without prompting for unrecognized speakers")
    parser.add_argument("--no-ai", action="store_true", help="Disable Gemini conversational speaker name discovery")
    parser.add_argument("--enroll-speaker", type=str, help="Name of speaker to enroll into voice_profiles.json")
    parser.add_argument("--enroll-audio", type=str, help="Audio file containing clean voice sample of speaker to enroll")
    parser.add_argument("--enroll-dir", type=str, help="Directory containing speaker sample files (e.g. Logan.wav, Randy.mp3) to batch-enroll")

    args = parser.parse_args()

    # Handle directory batch speaker enrollment
    if args.enroll_dir:
        enroll_path = Path(args.enroll_dir)
        if not enroll_path.exists():
            print(f"[!] Directory not found: {args.enroll_dir}")
            return
        audio_exts = (".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus")
        enrolled_count = 0
        for f in enroll_path.iterdir():
            if f.is_file() and f.suffix.lower() in audio_exts:
                speaker_name = f.stem.replace("_", " ").title()
                if enroll_speaker_file(speaker_name, str(f), args.profiles):
                    print(f"[✓] Enrolled '{speaker_name}' from {f.name}")
                    enrolled_count += 1
                else:
                    print(f"[!] Could not process: {f.name}")
        print(f"\n[✓] Finished batch enrollment: {enrolled_count} speaker profiles saved to {args.profiles}")
        return

    # Handle direct single speaker enrollment
    if args.enroll_speaker and args.enroll_audio:
        if enroll_speaker_file(args.enroll_speaker, args.enroll_audio, args.profiles):
            print(f"[✓] Successfully enrolled '{args.enroll_speaker}' into {args.profiles}")
        else:
            print(f"[!] Failed to process enrollment audio: {args.enroll_audio}")
        return

    # Collect queue of audio items
    queue: List[Dict[str, str]] = []

    if args.url:
        queue.append({"url": args.url, "title": None})
    elif args.file:
        queue.append({"url": os.path.abspath(args.file), "title": Path(args.file).stem})
    elif args.repo:
        print(f"[*] Scanning GitHub repository '{args.repo}' for audio assets...")
        discovered = discover_github_audio(args.repo, github_token=args.github_token)
        print(f"[✓] Discovered {len(discovered)} audio files in {args.repo}")
        for item in discovered:
            queue.append({"url": item["url"], "title": item["title"]})
    elif args.list:
        with open(args.list, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    queue.append({"url": line, "title": None})
    else:
        print("[!] No input provided. Please provide --file, --url, --repo, or --enroll-dir.")
        return

    if not queue:
        print("[!] No audio files found in queue to process.")
        sys.exit(0)

    # Initialize Transcriber
    transcriber = BatchAudioTranscriber(
        model_size=args.model,
        device=args.device,
        compute_type=args.compute_type,
        profiles_file=args.profiles,
        similarity_threshold=args.threshold,
        output_dir=args.output_dir,
        interactive=not args.non_interactive,
        use_ai_identification=not args.no_ai
    )

    # Process all files
    results = []
    print(f"\n[*] Starting Batch Processing ({len(queue)} total files)...")
    for i, item in enumerate(queue, 1):
        print(f"\n--- Processing Queue Item {i} of {len(queue)} ---")
        res = transcriber.process_file(item["url"], title=item["title"], github_token=args.github_token)
        results.append(res)

    print("\n========================================================")
    print("                 BATCH PROCESSING SUMMARY                ")
    print("========================================================")
    for r in results:
        status_icon = "[✓]" if r.get("status") == "success" else "[!]"
        print(f"{status_icon} {r.get('title')}: {r.get('status')} (Duration: {r.get('duration', 0)/60:.1f}m, Processed in: {r.get('elapsed_time', 0):.1f}s)")
    print(f"Output files saved to: {os.path.abspath(args.output_dir)}")


if __name__ == "__main__":
    main()
