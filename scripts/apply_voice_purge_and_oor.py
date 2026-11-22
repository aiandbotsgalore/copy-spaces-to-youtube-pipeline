import os
import json
import shutil
import librosa
import torch
import soundfile as sf
from speechbrain.inference.speaker import EncoderClassifier

# 1. Initialize SpeechBrain ECAPA-TDNN classifier
print("[*] Loading SpeechBrain ECAPA-TDNN model...")
classifier = EncoderClassifier.from_hparams(
    source="speechbrain/spkrec-ecapa-voxceleb",
    savedir="tmp_model"
)

# 2. Setup Oor permanent reference
oor_src = "speaker_samples/Oor voice Sample.wav"
oor_dst_local = "speaker_samples/Oor/master_reference.wav"
oor_dst_public = "public/speaker_samples/Oor/master_reference.wav"

os.makedirs("speaker_samples/Oor", exist_ok=True)
os.makedirs("public/speaker_samples/Oor", exist_ok=True)
shutil.copy2(oor_src, oor_dst_local)
shutil.copy2(oor_src, oor_dst_public)
print(f"[✓] Copied Oor voice sample to {oor_dst_local} and {oor_dst_public}")

# 3. Extract 192-dim embeddings for Oor, Angela, and Shane
def compute_embedding(audio_path):
    print(f"[*] Extracting embedding for {audio_path}...")
    sig, sr = librosa.load(audio_path, sr=16000, mono=True)
    wav = torch.tensor(sig).float().unsqueeze(0)
    emb = classifier.encode_batch(wav).squeeze().detach().cpu().numpy().tolist()
    assert len(emb) == 192, f"Expected 192 dims, got {len(emb)}"
    print(f"[✓] Extracted 192-dim embedding for {audio_path}")
    return emb

oor_emb = compute_embedding(oor_dst_local)
angela_emb = compute_embedding("speaker_samples/Angela/master_reference.mp3")
shane_emb = compute_embedding("speaker_samples/Shane/master_reference.mp3")

# 4. Files to delete
bad_files = [
    "speaker_samples/Logan/master_reference.wav",
    "public/speaker_samples/Logan/master_reference.wav",
    "speaker_samples/Oor/clip_01_03m56s.wav",
    "public/speaker_samples/Oor/clip_01_03m56s.wav",
    "speaker_samples/Eric Hecker/clip_01_01h02m48s.wav",
    "public/speaker_samples/Eric Hecker/clip_01_01h02m48s.wav",
    "speaker_samples/God Sauce/auto_sample_49m19s.wav",
    "public/speaker_samples/God Sauce/auto_sample_49m19s.wav",
    "speaker_samples/Mary/clip_01_00m51s.wav",
    "public/speaker_samples/Mary/clip_01_00m51s.wav",
]

for bf in bad_files:
    if os.path.exists(bf):
        os.remove(bf)
        print(f"[✓] Deleted bad sample: {bf}")

# 5. Update voice_profiles.json & public/voice_profiles.json
for ppath in ["voice_profiles.json", "public/voice_profiles.json"]:
    with open(ppath, "r", encoding="utf-8") as f:
        catalog = json.load(f)
    
    profiles = catalog.setdefault("profiles", {})
    
    # Oor
    if "Oor" in profiles:
        profiles["Oor"]["sample_audio_url"] = "speaker_samples/Oor/master_reference.wav"
        profiles["Oor"]["embedding"] = oor_emb
        profiles["Oor"]["identity_verified"] = True
    
    # Angela
    if "Angela" in profiles:
        profiles["Angela"]["sample_audio_url"] = "speaker_samples/Angela/master_reference.mp3"
        profiles["Angela"]["embedding"] = angela_emb
        profiles["Angela"]["identity_verified"] = True
        
    # Shane
    if "Shane" in profiles:
        profiles["Shane"]["sample_audio_url"] = "speaker_samples/Shane/master_reference.mp3"
        profiles["Shane"]["embedding"] = shane_emb
        profiles["Shane"]["identity_verified"] = True

    # Purge bad samples & corrupted embeddings from Logan, Eric Hecker, God Sauce, Mary
    for purged_spk in ["Logan", "Eric Hecker", "God Sauce", "Mary"]:
        if purged_spk in profiles:
            profiles[purged_spk]["sample_audio_url"] = ""
            profiles[purged_spk]["embedding"] = []
            profiles[purged_spk]["samples"] = []

    with open(ppath, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
    print(f"[✓] Successfully updated {ppath}")

print("[*] All voice profiles updated successfully!")
