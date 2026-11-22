import os
import json
import shutil
import librosa
import torch
from speechbrain.inference.speaker import EncoderClassifier

# Paths
uploaded_src = r"C:\Users\Logan\.gemini\antigravity\brain\4330a60d-38f8-4988-b2f6-cf8efad710e2\.user_uploaded\uploaded_media_1795360719158.wav"
dst_local = "speaker_samples/Logan/master_reference.wav"
dst_public = "public/speaker_samples/Logan/master_reference.wav"

os.makedirs("speaker_samples/Logan", exist_ok=True)
os.makedirs("public/speaker_samples/Logan", exist_ok=True)

shutil.copy2(uploaded_src, dst_local)
shutil.copy2(uploaded_src, dst_public)
print(f"[✓] Copied uploaded sample to {dst_local} and {dst_public}")

# Initialize SpeechBrain ECAPA-TDNN classifier
print("[*] Loading SpeechBrain ECAPA-TDNN model...")
classifier = EncoderClassifier.from_hparams(
    source="speechbrain/spkrec-ecapa-voxceleb",
    savedir="tmp_model"
)

# Extract embedding at 16kHz mono
print(f"[*] Extracting 192-dim biometric embedding from {dst_local}...")
sig, sr = librosa.load(dst_local, sr=16000, mono=True)
wav = torch.tensor(sig).float().unsqueeze(0)
emb = classifier.encode_batch(wav).squeeze().detach().cpu().numpy().tolist()
assert len(emb) == 192, f"Expected 192 dims, got {len(emb)}"
print(f"[✓] Extracted 192-dim embedding for Logan! First 5: {emb[:5]}")

# Update voice_profiles.json and public/voice_profiles.json
for ppath in ["voice_profiles.json", "public/voice_profiles.json"]:
    with open(ppath, "r", encoding="utf-8") as f:
        catalog = json.load(f)
    
    profiles = catalog.setdefault("profiles", {})
    if "Logan" in profiles:
        profiles["Logan"]["sample_audio_url"] = "speaker_samples/Logan/master_reference.wav"
        profiles["Logan"]["embedding"] = emb
        profiles["Logan"]["identity_verified"] = True
        profiles["Logan"]["samples"] = [
            {
                "id": "master_reference",
                "audio_url": "speaker_samples/Logan/master_reference.wav",
                "label": "Authoritative Studio Reference (COG Narration)",
                "verified": True
            }
        ]
    
    with open(ppath, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
    print(f"[✓] Updated {ppath}")

print("[*] Logan voice profile successfully enrolled!")
