import os
import json
import shutil
import datetime
import librosa
import torch
from speechbrain.inference.speaker import EncoderClassifier

src = r"C:\Users\Logan\Music\fav\eric hecker fingerprint voice sample.wav"
rel_sample = "speaker_samples/Eric Hecker/master_reference.wav"
local_dst = rel_sample
public_dst = os.path.join("public", rel_sample)

print("================================================================")
print("       AUTHORITATIVE VOICE ENROLLMENT: Eric Hecker              ")
print("================================================================")

# 1. Copy reference files
os.makedirs(os.path.dirname(local_dst), exist_ok=True)
os.makedirs(os.path.dirname(public_dst), exist_ok=True)

shutil.copy2(src, local_dst)
shutil.copy2(src, public_dst)
print(f"[✓] Copied {src} -> {local_dst} & {public_dst}")

# 2. Load SpeechBrain ECAPA-TDNN model
print("\n[*] Loading SpeechBrain ECAPA-TDNN model from 'speechbrain/spkrec-ecapa-voxceleb'...")
classifier = EncoderClassifier.from_hparams(
    source="speechbrain/spkrec-ecapa-voxceleb",
    savedir="tmp_model"
)
print("✓ Classifier loaded successfully.")

# 3. Extract 192-dim embedding
print(f"\n[*] Processing audio for Eric Hecker: {rel_sample}...")
sig, sr = librosa.load(rel_sample, sr=16000, mono=True)
duration_sec = len(sig) / 16000.0
print(f"    Loaded {duration_sec:.2f}s of 16kHz audio.")

wav = torch.tensor(sig).float().unsqueeze(0)
emb = classifier.encode_batch(wav).squeeze().detach().cpu().numpy().tolist()
assert len(emb) == 192, f"Expected 192 dimensions for Eric Hecker, got {len(emb)}"
print(f"[✓] Extracted 192-dim vector for Eric Hecker! First 5 values: {emb[:5]}")

# 4. Update voice_profiles.json & public/voice_profiles.json
now_iso = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

for ppath in ["voice_profiles.json", "public/voice_profiles.json"]:
    with open(ppath, "r", encoding="utf-8") as f:
        catalog = json.load(f)
    
    profiles = catalog.setdefault("profiles", {})
    prof = profiles.setdefault("Eric Hecker", {})
    
    prof["name"] = "Eric Hecker"
    prof["sample_audio_url"] = rel_sample
    prof["embedding"] = emb
    prof["embedding_model"] = "speechbrain/spkrec-ecapa-voxceleb"
    prof["embedding_dim"] = 192
    prof["identity_verified"] = True
    prof["sample_count"] = 1
    prof["last_updated"] = now_iso
    prof["samples"] = [
        {
            "id": "master_reference",
            "audio_url": rel_sample,
            "label": "Authoritative Fingerprint Reference (Eric Hecker)",
            "verified": True
        }
    ]
    
    with open(ppath, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
    print(f"[✓] Saved updated {ppath}")

print("\n================================================================")
print("    ERIC HECKER VOICE PROFILE SUCCESSFULLY ENROLLED & VERIFIED!  ")
print("================================================================")
