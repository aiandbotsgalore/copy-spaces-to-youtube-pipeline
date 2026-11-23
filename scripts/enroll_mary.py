#!/usr/bin/env python3
"""
scripts/enroll_mary.py

Extracts 192-dimensional ECAPA-TDNN embedding for Mary from her voice sample
and updates voice_profiles.json & public/voice_profiles.json.
"""

import os
import glob
import json
import datetime
import librosa
import torch
from speechbrain.inference.speaker import EncoderClassifier

def main():
    print("================================================================")
    print("  AUTHORITATIVE VOICE ENROLLMENT: Mary                          ")
    print("================================================================")

    sample_files = glob.glob("speaker_samples/Mary/*.mp3") + glob.glob("speaker_samples/Mary/*.wav")
    if not sample_files:
        raise FileNotFoundError("Missing sample file in speaker_samples/Mary/")
    
    sample_path = sample_files[0]
    print(f"\n[*] Processing audio from {sample_path}...")

    sig, sr = librosa.load(sample_path, sr=16000, mono=True)
    duration_sec = len(sig) / 16000.0
    print(f"    Loaded {duration_sec:.2f}s of 16kHz audio.")

    print("\n[*] Loading SpeechBrain ECAPA-TDNN model...")
    classifier = EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        savedir="tmp_model"
    )

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
        prof = profiles.setdefault("Mary", {})
        prof["name"] = "Mary"
        prof["role"] = "Co-Host"
        prof["avatar_emoji"] = "👩‍🎨"
        prof["color"] = "purple"
        prof["notes"] = "Regular co-host and contributor."
        prof["sample_audio_url"] = sample_path.replace("\\", "/")
        prof["embedding"] = emb
        prof["embedding_model"] = "speechbrain/spkrec-ecapa-voxceleb"
        prof["embedding_dim"] = 192
        prof["identity_verified"] = True
        prof["sample_count"] = 1
        prof["last_updated"] = now_iso

        rel_key = sample_path.replace("\\", "/")
        prof["samples"] = [
            {
                "id": "1b7401e9-419e-48e8-bce3-f728605a8a9e",
                "source": "upload",
                "audio_url": rel_key,
                "label": os.path.basename(sample_path),
                "audio_url_cdn": f"https://pub-b492226ab4ed45d692e9f14794366106.r2.dev/{rel_key}"
            }
        ]
        prof["sample_audio_url_cdn"] = f"https://pub-b492226ab4ed45d692e9f14794366106.r2.dev/{rel_key}"
        prof["enrolled_sample_id"] = "1b7401e9-419e-48e8-bce3-f728605a8a9e"

        catalog["updated_at"] = now_iso

        with open(ppath, "w", encoding="utf-8") as f:
            json.dump(catalog, f, indent=2, ensure_ascii=False)
        print(f"[✓] Successfully updated {ppath}")

    # Also upload to R2
    print("\n[*] Syncing Mary voice sample to Cloudflare R2...")
    os.system(f'python scripts/upload_slice_to_r2.py --file "{sample_path}" --key "{sample_path.replace(chr(92), "/")}"')
    print("[✓] All set!")

if __name__ == "__main__":
    main()
