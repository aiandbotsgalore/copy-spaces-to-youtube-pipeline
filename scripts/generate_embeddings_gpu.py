import sys
import os
import json
import time
import numpy as np

# Ensure dependencies from agent-starter-python are available
agent_site_packages = r'C:\Users\Logan\agent-starter-python\.venv\Lib\site-packages'
if os.path.exists(agent_site_packages) and agent_site_packages not in sys.path:
    sys.path.append(agent_site_packages)

from transformers import AutoTokenizer
import onnxruntime as ort

CWD = os.path.abspath(os.getcwd())
CACHE_DIR = os.path.join(CWD, '.cache', 'transcripts')
EPISODES_DIR = os.path.join(CWD, 'public', 'transcripts', 'episodes')
SUMMARY_PATH = os.path.join(CWD, 'public', 'transcripts', 'transcripts_summary_index.json')
MODEL_DIR = os.path.join(CWD, '.cache', 'models', 'Xenova', 'all-MiniLM-L6-v2')
MODEL_ONNX = os.path.join(MODEL_DIR, 'onnx', 'model_quantized.onnx')

os.makedirs(CACHE_DIR, exist_ok=True)

def load_summary_map():
    summary_map = {}
    if os.path.exists(SUMMARY_PATH):
        try:
            with open(SUMMARY_PATH, 'r', encoding='utf8') as f:
                data = json.load(f)
                items = data if isinstance(data, list) else data.get('episodes', [])
                for item in items:
                    tag = item.get('release_tag') or item.get('id') or item.get('slug')
                    if tag:
                        summary_map[tag] = item
        except Exception as e:
            print(f"[Warning] Failed to load summary map: {e}")
    return summary_map

def find_best_transcript_file(tag, summary_map):
    candidates = []
    # 1. public/transcripts/episodes
    pub_path = os.path.join(EPISODES_DIR, f"{tag}.json")
    if os.path.exists(pub_path):
        try:
            with open(pub_path, 'r', encoding='utf8') as f:
                d = json.load(f)
                segs = d.get('segments', []) if isinstance(d, dict) else (d if isinstance(d, list) else [])
                candidates.append((len(segs), pub_path, d))
        except:
            pass

    # 2. .cache/transcripts
    if os.path.exists(CACHE_DIR):
        for fname in os.listdir(CACHE_DIR):
            if fname.startswith(tag) and fname.endswith('.json') and not fname.endswith('.embeddings.json'):
                c_path = os.path.join(CACHE_DIR, fname)
                try:
                    with open(c_path, 'r', encoding='utf8') as f:
                        d = json.load(f)
                        segs = d.get('segments', []) if isinstance(d, dict) else (d if isinstance(d, list) else [])
                        candidates.append((len(segs), c_path, d))
                except:
                    pass

    if not candidates:
        return None, []
    # Pick file with maximum turns
    candidates.sort(key=lambda x: x[0], reverse=True)
    best_count, best_path, best_data = candidates[0]
    raw_segs = best_data.get('segments', []) if isinstance(best_data, dict) else (best_data if isinstance(best_data, list) else [])
    return best_path, raw_segs

def validate_existing(tag):
    bin_path = os.path.join(CACHE_DIR, f"{tag}.embeddings.bin")
    json_path = os.path.join(CACHE_DIR, f"{tag}.embeddings.json")
    if not (os.path.exists(bin_path) and os.path.exists(json_path)):
        return False
    try:
        with open(json_path, 'r', encoding='utf8') as f:
            manifest = json.load(f)
        segs = manifest.get('segmentCount', 0)
        dims = manifest.get('dims', 384)
        expected_size = segs * dims * 4
        actual_size = os.path.getsize(bin_path)
        return actual_size == expected_size and segs > 0
    except:
        return False

def atomic_write(tag, manifest, vectors_bytes):
    nonce = f"{int(time.time()*1000)}"
    tmp_bin = os.path.join(CACHE_DIR, f"{tag}.embeddings.bin.tmp.{nonce}")
    tmp_json = os.path.join(CACHE_DIR, f"{tag}.embeddings.json.tmp.{nonce}")
    final_bin = os.path.join(CACHE_DIR, f"{tag}.embeddings.bin")
    final_json = os.path.join(CACHE_DIR, f"{tag}.embeddings.json")

    try:
        with open(tmp_bin, 'wb') as f:
            f.write(vectors_bytes)
        with open(tmp_json, 'w', encoding='utf8') as f:
            json.dump(manifest, f, indent=2)

        # Verification
        expected_bytes = manifest['segmentCount'] * manifest['dims'] * 4
        if os.path.getsize(tmp_bin) != expected_bytes:
            raise ValueError(f"Byte mismatch on {tag}: got {os.path.getsize(tmp_bin)}, expected {expected_bytes}")

        # Atomic rename
        if os.path.exists(final_bin): os.remove(final_bin)
        if os.path.exists(final_json): os.remove(final_json)
        os.rename(tmp_bin, final_bin)
        os.rename(tmp_json, final_json)
    except Exception as e:
        if os.path.exists(tmp_bin): os.remove(tmp_bin)
        if os.path.exists(tmp_json): os.remove(tmp_json)
        raise e

def main():
    print("==================================================================")
    print("   SpacePipe Studio — High-Speed GPU Angela Embedding Pipeline    ")
    print("==================================================================")
    print("Device: NVIDIA GeForce RTX 4060 Ti (CUDAExecutionProvider)")
    print(f"Model: {MODEL_ONNX}")

    # 1. Load Tokenizer & Session
    print("\n1. Initializing GPU Session...")
    t0 = time.time()
    tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR)
    session = ort.InferenceSession(
        MODEL_ONNX,
        providers=['CUDAExecutionProvider', 'CPUExecutionProvider']
    )
    print(f"✓ GPU Session ready in {time.time()-t0:.2f}s | Active Provider: {session.get_providers()[0]}")

    # 2. Collect Angela Episodes
    summary_map = load_summary_map()
    all_episodes = []
    
    # Load tags from generated json lists
    tags_file = os.path.join(CACHE_DIR, 'angela_all_mentions.json')
    if os.path.exists(tags_file):
        with open(tags_file, 'r', encoding='utf8') as f:
            all_tags = json.load(f)
    else:
        # Fallback to direct directory scan
        all_tags = [f.replace('.json', '') for f in os.listdir(EPISODES_DIR) if f.endswith('.json')]

    # Classify into Tiers
    speaker_tier = []
    high_signal_tier = []
    other_tier = []

    for tag in all_tags:
        sum_info = summary_map.get(tag, {})
        speakers = sum_info.get('speakers', [])
        is_spk = any('angela' in str(s).lower() for s in speakers)
        
        best_path, segs = find_best_transcript_file(tag, summary_map)
        mentions = 0
        transcript_spk = False
        for s in segs:
            spk_name = str(s.get('speaker', '')).lower()
            text_str = str(s.get('text', '')).lower()
            if 'angela' in spk_name: transcript_spk = True
            if 'angela' in text_str: mentions += 1

        entry = {'tag': tag, 'title': sum_info.get('title', tag), 'turns': len(segs), 'mentions': mentions}
        if is_spk or transcript_spk:
            entry['tier'] = 'Tier 1 (Speaker)'
            speaker_tier.append(entry)
        elif mentions >= 3:
            entry['tier'] = 'Tier 2 (High-Signal)'
            high_signal_tier.append(entry)
        elif mentions >= 1:
            entry['tier'] = 'Tier 3 (Mention)'
            other_tier.append(entry)

    # Sort each tier by turn count descending
    speaker_tier.sort(key=lambda x: x['turns'], reverse=True)
    high_signal_tier.sort(key=lambda x: x['turns'], reverse=True)
    other_tier.sort(key=lambda x: x['turns'], reverse=True)

    ordered_episodes = speaker_tier + high_signal_tier + other_tier
    total_episodes = len(ordered_episodes)
    total_turns = sum(e['turns'] for e in ordered_episodes)

    print(f"\n2. Angela Episode Target Schedule:")
    print(f"   - Tier 1: Direct Speaker: {len(speaker_tier)} episodes ({sum(e['turns'] for e in speaker_tier):,} turns)")
    print(f"   - Tier 2: High-Signal:    {len(high_signal_tier)} episodes ({sum(e['turns'] for e in high_signal_tier):,} turns)")
    print(f"   - Tier 3: Other Mentions: {len(other_tier)} episodes ({sum(e['turns'] for e in other_tier):,} turns)")
    print(f"   Total: {total_episodes} episodes ({total_turns:,} total turns)\n")

    # 3. Execution Loop
    BATCH_SIZE = 256
    processed_count = 0
    skipped_count = 0
    total_turns_embedded = 0
    start_run_time = time.time()

    for idx, ep in enumerate(ordered_episodes):
        tag = ep['tag']
        tier_label = ep['tier']

        if validate_existing(tag):
            skipped_count += 1
            print(f"[{idx+1}/{total_episodes}] [SKIPPED - Already Valid] {tag} ({tier_label})")
            continue

        best_path, raw_segs = find_best_transcript_file(tag, summary_map)
        if not raw_segs:
            skipped_count += 1
            continue

        # Prepare dialogue inputs
        valid_segments = []
        input_texts = []
        v_idx = 0
        for s in raw_segs:
            text = (s.get('text') or '').strip()
            if not text:
                continue
            spk = (s.get('speaker') or 'Unknown').strip()
            start = float(s.get('start') or 0.0)
            end = float(s.get('end') or start)

            valid_segments.append({
                'index': v_idx,
                'start': start,
                'end': end,
                'speaker': spk,
                'text': text
            })
            input_texts.append(f"[Speaker: {spk}] {text}")
            v_idx += 1

        if not valid_segments:
            skipped_count += 1
            continue

        ep_start_time = time.time()
        all_embeddings = np.zeros((len(input_texts), 384), dtype=np.float32)

        # Batch embed on RTX 4060 Ti
        for b in range(0, len(input_texts), BATCH_SIZE):
            chunk = input_texts[b:b + BATCH_SIZE]
            encoded = tokenizer(chunk, padding=True, truncation=True, max_length=128, return_tensors='np')
            
            feed = {
                'input_ids': encoded['input_ids'].astype(np.int64),
                'attention_mask': encoded['attention_mask'].astype(np.int64),
                'token_type_ids': encoded.get('token_type_ids', np.zeros_like(encoded['input_ids'])).astype(np.int64)
            }
            outputs = session.run(None, feed)
            last_hidden = outputs[0] # [B, seq, 384]
            att_mask = encoded['attention_mask'][:, :, np.newaxis] # [B, seq, 1]

            # Mean pooling
            sum_emb = np.sum(last_hidden * att_mask, axis=1)
            sum_m = np.clip(np.sum(att_mask, axis=1), a_min=1e-9, a_max=None)
            mean_p = sum_emb / sum_m

            # L2 normalization
            norm = np.linalg.norm(mean_p, axis=1, keepdims=True)
            norm_emb = mean_p / np.clip(norm, a_min=1e-12, a_max=None)

            all_embeddings[b:b + len(chunk)] = norm_emb.astype(np.float32)

        # Manifest
        manifest = {
            'version': 1,
            'episodeTag': tag,
            'title': ep['title'],
            'dims': 384,
            'segmentCount': len(valid_segments),
            'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'segments': valid_segments
        }

        # Write atomically
        atomic_write(tag, manifest, all_embeddings.tobytes())

        processed_count += 1
        total_turns_embedded += len(valid_segments)
        ep_elapsed = max(0.001, time.time() - ep_start_time)
        ep_rate = len(valid_segments) / ep_elapsed

        total_elapsed = max(0.001, time.time() - start_run_time)
        overall_rate = total_turns_embedded / total_elapsed
        percent = ((idx + 1) / total_episodes) * 100

        print(
            f"[{idx+1}/{total_episodes} | {percent:.1f}%] "
            f"Embedded {tag} ({tier_label}): {len(valid_segments):,} turns in {ep_elapsed:.1f}s ({ep_rate:.0f} t/s) | "
            f"Overall: {overall_rate:.0f} t/s"
        )

    total_time = time.time() - start_run_time
    print("\n==================================================================")
    print("   GPU Embedding Generation Completed Successfully!               ")
    print("==================================================================")
    print(f"Episodes Embedded: {processed_count}")
    print(f"Episodes Skipped (Already Valid): {skipped_count}")
    print(f"Total Turns Embedded: {total_turns_embedded:,}")
    print(f"Total Wall Time: {total_time/60:.2f} minutes ({total_turns_embedded/max(0.001, total_time):.1f} avg turns/sec)")
    print("==================================================================\n")

if __name__ == '__main__':
    main()
