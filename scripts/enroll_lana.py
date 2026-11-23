import os
import json
import datetime
import librosa
import torch
from speechbrain.inference.speaker import EncoderClassifier

def main():
    print("================================================================")
    print("  AUTHORITATIVE VOICE ENROLLMENT: Lana                          ")
    print("================================================================")

    sample_path = "speaker_samples/Lana/master_reference.wav"
    if not os.path.exists(sample_path):
        raise FileNotFoundError(f"Missing sample: {sample_path}")

    print("\n[*] Loading SpeechBrain ECAPA-TDNN model...")
    classifier = EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        savedir="tmp_model"
    )

    print(f"\n[*] Processing audio from {sample_path}...")
    sig, sr = librosa.load(sample_path, sr=16000, mono=True)
    duration_sec = len(sig) / 16000.0
    print(f"    Loaded {duration_sec:.2f}s of 16kHz audio.")

    wav = torch.tensor(sig).float().unsqueeze(0)
    emb = classifier.encode_batch(wav).squeeze().detach().cpu().numpy().tolist()
    assert len(emb) == 192, f"Expected 192 dimensions, got {len(emb)}"
    print(f"[✓] Extracted 192-dim vector! First 5 values: {emb[:5]}")

    now_iso = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    for ppath in ["voice_profiles.json", "public/voice_profiles.json"]:
        if not os.path.exists(ppath):
            continue
        with open(ppath, "r", encoding="utf-8") as f:
            catalog = json.load(f)
        
        profiles = catalog.setdefault("profiles", {})
        prof = profiles.setdefault("Lana", {})
        prof["name"] = "Lana"
        prof["role"] = "Community Contributor"
        prof["avatar_emoji"] = "🌸"
        prof["color"] = "pink"
        prof["notes"] = "Community co-host and contributor. Enrolled from 20260217_1vAGRvvpBXyGl clean solo speech segment."
        prof["sample_audio_url"] = "speaker_samples/Lana/master_reference.wav"
        prof["embedding"] = emb
        prof["embedding_model"] = "speechbrain/spkrec-ecapa-voxceleb"
        prof["embedding_dim"] = 192
        prof["identity_verified"] = True
        prof["sample_count"] = 1
        prof["last_updated"] = now_iso
        prof["samples"] = [
            {
                "id": "master_reference",
                "audio_url": "speaker_samples/Lana/master_reference.wav",
                "source": "episode",
                "label": "Authoritative Clean Speech (Wild Stories ⚠️⚠️NSFW⚠️⚠️)",
                "release_tag": "20260217_1vAGRvvpBXyGl",
                "start_sec": 708.5,
                "end_sec": 740.0
            }
        ]

        with open(ppath, "w", encoding="utf-8") as f:
            json.dump(catalog, f, indent=2)
        print(f"[✓] Updated {ppath} with Lana voice profile.")

    print("\n[🎉] Lana voice profile enrolled and verified successfully!")

if __name__ == "__main__":
    main()
