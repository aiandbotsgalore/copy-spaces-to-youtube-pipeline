import os
import json
import shutil
import datetime
import librosa
import torch
from speechbrain.inference.speaker import EncoderClassifier

# Mapping of speaker name to source audio path
ENROLLMENT_TARGETS = [
    {
        "name": "Rick Doty",
        "key": "Rick Doty",
        "src": r"C:\Users\Logan\Music\fav\RICK DOTY FINGERPRINT VOICE SAMPLE.wav",
        "sample_rel": "speaker_samples/Rick Doty/master_reference.wav",
        "label": "Authoritative Fingerprint Reference (Rick Doty)"
    },
    {
        "name": "God Sauce",
        "key": "God Sauce",
        "src": r"C:\Users\Logan\Music\fav\God Sauce FINGERPRINT Voice Sample_01.wav",
        "sample_rel": "speaker_samples/God Sauce/master_reference.wav",
        "label": "Authoritative Fingerprint Reference (God Sauce)"
    },
    {
        "name": "Rose",
        "key": "Rose",
        "src": r"C:\Users\Logan\Music\fav\Rose fingerprint voice sample.wav",
        "sample_rel": "speaker_samples/Rose/master_reference.wav",
        "label": "Authoritative Fingerprint Reference (Rose)"
    }
]

print("================================================================")
print("  AUTHORITATIVE VOICE ENROLLMENT: Rick Doty, God Sauce, Rose   ")
print("================================================================")

# 1. Copy reference files
for item in ENROLLMENT_TARGETS:
    src = item["src"]
    rel = item["sample_rel"]
    local_dst = rel
    public_dst = os.path.join("public", rel)
    
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

# 3. Extract 192-dim embeddings
extracted_embeddings = {}
for item in ENROLLMENT_TARGETS:
    key = item["key"]
    rel = item["sample_rel"]
    print(f"\n[*] Processing audio for {key}: {rel}...")
    
    sig, sr = librosa.load(rel, sr=16000, mono=True)
    duration_sec = len(sig) / 16000.0
    print(f"    Loaded {duration_sec:.2f}s of 16kHz audio.")
    
    wav = torch.tensor(sig).float().unsqueeze(0)
    emb = classifier.encode_batch(wav).squeeze().detach().cpu().numpy().tolist()
    assert len(emb) == 192, f"Expected 192 dimensions for {key}, got {len(emb)}"
    
    extracted_embeddings[key] = {
        "embedding": emb,
        "sample_rel": rel,
        "label": item["label"]
    }
    print(f"[✓] Extracted 192-dim vector for {key}! First 5 values: {emb[:5]}")

# 4. Update voice_profiles.json & public/voice_profiles.json
now_iso = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

for ppath in ["voice_profiles.json", "public/voice_profiles.json"]:
    with open(ppath, "r", encoding="utf-8") as f:
        catalog = json.load(f)
    
    profiles = catalog.setdefault("profiles", {})
    
    for key, data in extracted_embeddings.items():
        prof = profiles.setdefault(key, {})
        prof["name"] = prof.get("name", key)
        prof["sample_audio_url"] = data["sample_rel"]
        prof["embedding"] = data["embedding"]
        prof["embedding_model"] = "speechbrain/spkrec-ecapa-voxceleb"
        prof["embedding_dim"] = 192
        prof["identity_verified"] = True
        prof["sample_count"] = 1
        prof["last_updated"] = now_iso
        prof["samples"] = [
            {
                "id": "master_reference",
                "audio_url": data["sample_rel"],
                "label": data["label"],
                "verified": True
            }
        ]
        print(f"    - Enrolled {key} in {ppath}")
        
    with open(ppath, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
    print(f"[✓] Saved updated {ppath}")

print("\n================================================================")
print("  ALL 3 PROFILES (Rick Doty, God Sauce, Rose) ENROLLED & VERIFIED!")
print("================================================================")
