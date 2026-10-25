import os
import re
import gc
import urllib.request
import numpy as np
import soundfile as sf
import torch
import torchaudio
import gradio as gr
import spaces
from pathlib import Path
from voxcpm import VoxCPM

# ================================================================
# ZeroGPU Compatibility Patches
# ================================================================
def dummy_compile(model, *args, **kwargs):
    return model
torch.compile = dummy_compile
import torch._dynamo
torch._dynamo.config.disable = True

def safe_torchaudio_load(filepath, *args, **kwargs):
    data, sr = sf.read(filepath)
    if data.ndim > 1:
        data = data.mean(axis=1)
    return torch.from_numpy(data).float().unsqueeze(0), sr
torchaudio.load = safe_torchaudio_load

# Default reference voice (Logan Black Master)
DEFAULT_REF_TEXT = (
    "Ten years before Hiroshima, the American presidency still belonged to a different world. "
    "This is Franklin Roosevelt at Boulder Dam in 1935."
)
DEFAULT_REF_PATH = str(Path(__file__).parent / "master_reference.wav")
REF_URL = "https://raw.githubusercontent.com/aiandbotsgalore/copy-spaces-to-youtube-pipeline/master/public/speaker_samples/Logan/master_reference.wav"

if not os.path.exists(DEFAULT_REF_PATH):
    print("[*] Downloading Logan Black master reference audio...")
    try:
        urllib.request.urlretrieve(REF_URL, DEFAULT_REF_PATH)
        print("[*] Master reference audio downloaded successfully.")
    except Exception as e:
        print(f"[!] Warning downloading reference audio: {e}")

MODEL_ID = "openbmb/VoxCPM2"
model = None

def get_model():
    global model
    if model is None:
        print(f"[*] Initializing {MODEL_ID} on ZeroGPU...")
        model = VoxCPM.from_pretrained(MODEL_ID, load_denoiser=False)
        print("[*] Model loaded successfully.")
    return model

@spaces.GPU(duration=60)
def generate_speech(text: str, ref_audio: str = None, ref_text: str = None, timesteps: int = 15) -> str:
    """
    Synthesize speech using VoxCPM-2 with reference voice cloning.
    Args:
        text: Target text to speak
        ref_audio: Optional path to custom reference audio (defaults to Logan Black master)
        ref_text: Optional transcript of the reference audio
        timesteps: Number of diffusion timesteps (10-30, default 15)
    Returns:
        Path to generated 48kHz WAV audio file
    """
    if not text or not text.strip():
        raise gr.Error("Please enter text to synthesize.")

    tts_model = get_model()
    actual_sr = getattr(getattr(tts_model, "tts_model", None), "sample_rate", 48000)

    audio_ref = ref_audio if ref_audio and os.path.exists(ref_audio) else DEFAULT_REF_PATH
    prompt_transcript = ref_text.strip() if ref_text and ref_text.strip() else DEFAULT_REF_TEXT

    gen_kwargs = {
        'cfg_value': 2.0,
        'inference_timesteps': int(timesteps) if timesteps else 15
    }
    if audio_ref and os.path.exists(audio_ref):
        gen_kwargs['prompt_wav_path'] = audio_ref
        gen_kwargs['reference_wav_path'] = audio_ref
        if prompt_transcript:
            gen_kwargs['prompt_text'] = prompt_transcript

    clean_text = text.strip() + " "
    print(f"[*] Synthesizing: {clean_text[:60]}...")

    with torch.inference_mode():
        wav_chunk = tts_model.generate(text=clean_text, **gen_kwargs)
        if isinstance(wav_chunk, tuple):
            wav_chunk = wav_chunk[0]
        if isinstance(wav_chunk, torch.Tensor):
            wav_chunk = wav_chunk.detach().cpu().numpy()
        wav_chunk = wav_chunk.astype(np.float32).flatten()
        max_amp = np.max(np.abs(wav_chunk))
        if max_amp > 0:
            wav_chunk = (wav_chunk / max_amp) * 0.95

    out_file = "cloned_take.wav"
    sf.write(out_file, wav_chunk, actual_sr, subtype="PCM_24")
    return out_file

with gr.Blocks(title="Logan Black VoxCPM-2 Studio") as demo:
    gr.Markdown("# 🎙️ Logan Black VoxCPM-2 Cloud Voice Cloner")
    gr.Markdown("Powered by **openbmb/VoxCPM2** on Hugging Face ZeroGPU. 100% Free, Private, and High-Fidelity 48 kHz Audio.")

    with gr.Row():
        with gr.Column(scale=3):
            text_input = gr.Textbox(
                label="Text to Synthesize",
                placeholder="Type any sentence here...",
                lines=3
            )
            with gr.Accordion("Voice Reference Settings (Default: Logan Black Master)", open=False):
                ref_audio_input = gr.Audio(
                    label="Custom Speaker Reference Audio (Optional)",
                    type="filepath",
                    value=DEFAULT_REF_PATH if Path(DEFAULT_REF_PATH).exists() else None
                )
                ref_text_input = gr.Textbox(
                    label="Reference Audio Transcript",
                    value=DEFAULT_REF_TEXT
                )
                steps_slider = gr.Slider(
                    minimum=10,
                    maximum=30,
                    value=15,
                    step=1,
                    label="Diffusion Steps (Higher = more detail, Lower = faster)"
                )
            generate_btn = gr.Button("🚀 Generate Cloned Voice Take", variant="primary")

        with gr.Column(scale=2):
            audio_output = gr.Audio(label="Synthesized Speech (48 kHz Broadcast Master)", type="filepath")

    generate_btn.click(
        fn=generate_speech,
        inputs=[text_input, ref_audio_input, ref_text_input, steps_slider],
        outputs=audio_output,
        api_name="generate"
    )

if __name__ == "__main__":
    demo.launch(theme=gr.themes.Soft())
