import os
import sys
import math
import time
import wave
import shutil
import subprocess
from PIL import Image
import numpy as np
import modal

app = modal.App("spacepipe-echomimicv3-test")
vol = modal.Volume.from_name("avatar-models-cache", create_if_missing=True)

# ---------------------------------------------------------------------------
# Image: EchoMimicV3-Preview environment
# ---------------------------------------------------------------------------
echomimic_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "ffmpeg", "libgl1", "libglib2.0-0", "build-essential", "cmake", "g++")
    .pip_install(
        "torch==2.5.1",
        "torchvision==0.20.1",
        "torchaudio==2.5.1",
        index_url="https://download.pytorch.org/whl/cu121"
    )
    .pip_install("setuptools", "wheel", "cython", "decord")
    .pip_install(
        "diffusers==0.32.2",
        "transformers==4.48.0",
        "accelerate==0.26.1",
        "einops",
        "omegaconf",
        "opencv-python-headless",
        "librosa",
        "moviepy==2.2.1",
        "safetensors",
        "timm",
        "torchdiffeq",
        "torchsde",
        "pillow>=10.2.0",
        "retina-face==0.0.17",
        "tensorflow-cpu==2.15.0",
        "huggingface-hub",
        "soundfile",
        "scipy",
        "scikit-image",
        "SentencePiece"
    )
    .run_commands(
        "git clone https://github.com/antgroup/echomimic_v3.git /opt/echomimic_v3"
    )
)

# ---------------------------------------------------------------------------
# Weight Caching Helper
# ---------------------------------------------------------------------------
def _ensure_echomimicv3_weights(volume: modal.Volume) -> None:
    from huggingface_hub import snapshot_download

    base_dir = "/models/echomimic_v3"
    wan_dir = os.path.join(base_dir, "Wan2.1-Fun-V1.1-1.3B-InP")
    wav_dir = os.path.join(base_dir, "wav2vec2-base-960h")
    tf_dir = os.path.join(base_dir, "transformer")
    os.makedirs(base_dir, exist_ok=True)

    # 1. Base Model: Wan2.1-Fun-V1.1-1.3B-InP
    if not (os.path.exists(os.path.join(wan_dir, "Wan2.1_VAE.pth")) and
            os.path.exists(os.path.join(wan_dir, "models_t5_umt5-xxl-enc-bf16.pth"))):
        print("[EchoMimicV3] Downloading Wan2.1-Fun-V1.1-1.3B-InP from alibaba-pai...")
        snapshot_download(
            repo_id="alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP",
            local_dir=wan_dir,
            max_workers=8
        )
        volume.commit()
        print("[EchoMimicV3] Base model cached successfully.")
    else:
        print("[EchoMimicV3] Base model already cached.")

    # 2. Audio Encoder: wav2vec2-base-960h
    if not os.path.exists(os.path.join(wav_dir, "config.json")):
        print("[EchoMimicV3] Downloading facebook/wav2vec2-base-960h...")
        snapshot_download(
            repo_id="facebook/wav2vec2-base-960h",
            local_dir=wav_dir,
            max_workers=8
        )
        volume.commit()
        print("[EchoMimicV3] Wav2Vec2 encoder cached successfully.")
    else:
        print("[EchoMimicV3] Wav2Vec2 encoder already cached.")

    # 3. EchoMimicV3 Preview Transformer Weights
    if not os.path.exists(os.path.join(tf_dir, "diffusion_pytorch_model.safetensors")):
        print("[EchoMimicV3] Downloading BadToBest/EchoMimicV3 transformer weights...")
        snapshot_download(
            repo_id="BadToBest/EchoMimicV3",
            allow_patterns=["transformer/*"],
            local_dir=base_dir,
            max_workers=8
        )
        volume.commit()
        print("[EchoMimicV3] Transformer weights cached successfully.")
    else:
        print("[EchoMimicV3] Transformer weights already cached.")

    # Symlink /models/echomimic_v3 -> /opt/echomimic_v3/models
    models_symlink = "/opt/echomimic_v3/models"
    if os.path.exists(models_symlink):
        if os.path.islink(models_symlink):
            os.unlink(models_symlink)
        else:
            shutil.rmtree(models_symlink)
    os.symlink(base_dir, models_symlink)
    print(f"[EchoMimicV3] Symlinked {base_dir} -> {models_symlink}")


# ---------------------------------------------------------------------------
# Cloud Inference Function (A100-80GB)
# ---------------------------------------------------------------------------
@app.function(
    image=echomimic_image,
    gpu="A100-80GB",
    volumes={"/models": vol},
    timeout=4500,
)
def run_echomimicv3_test(image_bytes: bytes, audio_bytes: bytes) -> bytes:
    import torch
    from omegaconf import OmegaConf
    from transformers import AutoTokenizer, Wav2Vec2Model, Wav2Vec2Processor
    from moviepy import AudioFileClip
    import librosa

    # Ensure models are on volume and symlinked
    _ensure_echomimicv3_weights(vol)

    # Change working directory so upstream relative imports work
    os.chdir("/opt/echomimic_v3")
    if "/opt/echomimic_v3" not in sys.path:
        sys.path.insert(0, "/opt/echomimic_v3")

    from src.wan_vae import AutoencoderKLWan
    from src.wan_image_encoder import CLIPModel
    from src.wan_text_encoder import WanT5EncoderModel
    from src.wan_transformer3d_audio import WanTransformerAudioMask3DModel
    from src.pipeline_wan_fun_inpaint_audio import WanFunInpaintAudioPipeline
    from src.fm_solvers import FlowDPMSolverMultistepScheduler
    from diffusers import FlowMatchEulerDiscreteScheduler
    from src.fm_solvers_unipc import FlowUniPCMultistepScheduler
    from src.utils import filter_kwargs, get_image_to_video_latent3, save_videos_grid

    work_dir = "/tmp/echomimic_work"
    os.makedirs(work_dir, exist_ok=True)

    # 1. Write reference image
    ref_img_path = os.path.join(work_dir, "ref_image.jpg")
    with open(ref_img_path, "wb") as f:
        f.write(image_bytes)

    # 2. Write original unpadded audio (15.000s)
    orig_audio_path = os.path.join(work_dir, "original_speech.wav")
    with open(orig_audio_path, "wb") as f:
        f.write(audio_bytes)

    # 3. Create temporary padded WAV: 15.000s + 0.250s trailing digital silence = 15.250s
    padded_audio_path = os.path.join(work_dir, "padded_speech_15.250s.wav")
    with wave.open(orig_audio_path, "rb") as w_in:
        nchannels = w_in.getnchannels()
        sampwidth = w_in.getsampwidth()
        framerate = w_in.getframerate()
        nframes = w_in.getnframes()
        orig_raw = w_in.readframes(nframes)

    target_total_frames = int(15.250 * framerate) # 15.250 * 48000 = 732000
    pad_frames = target_total_frames - nframes    # 732000 - 720000 = 12000 frames (0.250s)
    assert pad_frames > 0, f"Expected positive padding frames, got {pad_frames}"

    silence = b"\x00" * (pad_frames * nchannels * sampwidth)
    with wave.open(padded_audio_path, "wb") as w_out:
        w_out.setnchannels(nchannels)
        w_out.setsampwidth(sampwidth)
        w_out.setframerate(framerate)
        w_out.writeframes(orig_raw + silence)

    print(f"[EchoMimicV3] Created padded WAV ({target_total_frames / framerate:.3f}s: {nframes / framerate:.3f}s audio + {pad_frames / framerate:.3f}s silence)")

    # 4. Device and Model Configuration
    device = "cuda"
    weight_dtype = torch.bfloat16
    cfg = OmegaConf.load("config/config.yaml")

    model_name = "models/Wan2.1-Fun-V1.1-1.3B-InP"
    transformer_path = "models/transformer/diffusion_pytorch_model.safetensors"
    wav2vec_model_dir = "models/wav2vec2-base-960h"

    print("[EchoMimicV3] Loading transformer model...")
    transformer = WanTransformerAudioMask3DModel.from_pretrained(
        os.path.join(model_name, cfg['transformer_additional_kwargs'].get('transformer_subpath', 'transformer')),
        transformer_additional_kwargs=OmegaConf.to_container(cfg['transformer_additional_kwargs']),
        torch_dtype=weight_dtype,
    )
    if transformer_path is not None:
        from safetensors.torch import load_file
        state_dict = load_file(transformer_path)
        state_dict = state_dict["state_dict"] if "state_dict" in state_dict else state_dict
        missing, unexpected = transformer.load_state_dict(state_dict, strict=False)
        print(f"[EchoMimicV3] Transformer loaded (missing: {len(missing)}, unexpected: {len(unexpected)})")

    print("[EchoMimicV3] Loading VAE...")
    vae = AutoencoderKLWan.from_pretrained(
        os.path.join(model_name, cfg['vae_kwargs'].get('vae_subpath', 'vae')),
        additional_kwargs=OmegaConf.to_container(cfg['vae_kwargs']),
    ).to(weight_dtype)

    print("[EchoMimicV3] Loading Tokenizer & Text Encoder...")
    tokenizer = AutoTokenizer.from_pretrained(
        os.path.join(model_name, cfg['text_encoder_kwargs'].get('tokenizer_subpath', 'tokenizer')),
    )
    text_encoder = WanT5EncoderModel.from_pretrained(
        os.path.join(model_name, cfg['text_encoder_kwargs'].get('text_encoder_subpath', 'text_encoder')),
        additional_kwargs=OmegaConf.to_container(cfg['text_encoder_kwargs']),
        torch_dtype=weight_dtype,
    ).eval()

    print("[EchoMimicV3] Loading CLIP Image Encoder...")
    clip_image_encoder = CLIPModel.from_pretrained(
        os.path.join(model_name, cfg['image_encoder_kwargs'].get('image_encoder_subpath', 'image_encoder')),
    ).to(weight_dtype).eval()

    scheduler_cls = FlowMatchEulerDiscreteScheduler
    scheduler = scheduler_cls(**filter_kwargs(scheduler_cls, OmegaConf.to_container(cfg['scheduler_kwargs'])))

    pipeline = WanFunInpaintAudioPipeline(
        transformer=transformer,
        vae=vae,
        tokenizer=tokenizer,
        text_encoder=text_encoder,
        scheduler=scheduler,
        clip_image_encoder=clip_image_encoder,
    )
    pipeline.to(device=device)

    # 5. Extract Wav2Vec2 Audio Features using the padded WAV
    print("[EchoMimicV3] Loading Wav2Vec2 English processor & model...")
    wav2vec_processor = Wav2Vec2Processor.from_pretrained(wav2vec_model_dir)
    wav2vec_model = Wav2Vec2Model.from_pretrained(wav2vec_model_dir).eval().to(device)
    wav2vec_model.requires_grad_(False)

    sr = 16000
    audio_segment, sample_rate = librosa.load(padded_audio_path, sr=sr)
    input_values = wav2vec_processor(audio_segment, sampling_rate=sample_rate, return_tensors="pt").input_values.to(device)
    with torch.no_grad():
        features = wav2vec_model(input_values).last_hidden_state
    audio_features = features.squeeze(0).cpu() # [num_steps, feature_dim]

    print(f"[EchoMimicV3] Extracted Wav2Vec2 feature shape: {audio_features.shape}")
    assert audio_features.shape[0] == 762, (
        f"Assertion Failed: Expected exactly 762 Wav2Vec2 feature steps, got {audio_features.shape[0]}"
    )
    audio_embeds = audio_features.unsqueeze(0).to(device=device, dtype=weight_dtype)

    # 6. Pipeline Duration & Frame Calculation
    fps = 25
    audio_clip = AudioFileClip(padded_audio_path)
    video_length = int(audio_clip.duration * fps) # int(15.250 * 25) = 381
    temporal_cr = vae.config.temporal_compression_ratio # 4
    video_length = (
        int((video_length - 1) // temporal_cr * temporal_cr) + 1
        if video_length != 1 else 1
    )
    print(f"[EchoMimicV3] Calculated pipeline video_length: {video_length} frames")
    assert video_length == 381, f"Expected video_length 381, got {video_length}"

    # 7. Setup Image, Resolution, and IP Mask
    ref_img = Image.open(ref_img_path).convert("RGB")
    sample_size = [768, 768]
    width, height = ref_img.size
    original_area = width * height
    default_area = sample_size[0] * sample_size[1]
    if default_area < original_area:
        ratio = math.sqrt(original_area / default_area)
        sample_width = int(width / ratio // 16 * 16)
        sample_height = int(height / ratio // 16 * 16)
    else:
        sample_width = int(width // 16 * 16)
        sample_height = int(height // 16 * 16)

    # Face detection for IP mask
    ip_mask_path = os.path.join(work_dir, "ref_mask.npy")
    try:
        from src.face_detect import get_mask_coord
        coords = get_mask_coord(ref_img_path)
        if coords is None:
            raise ValueError("No face detected by RetinaFace")
        y1, y2, x1, x2, h_, w_ = coords
    except Exception as e:
        print(f"[EchoMimicV3] RetinaFace detection fallback: {e}")
        w, h = ref_img.size
        # Center-face crop approximation for 512x512 Logan portrait
        y1, y2, x1, x2, h_, w_ = int(h * 0.1), int(h * 0.55), int(w * 0.25), int(w * 0.75), h, w
    np.save(ip_mask_path, np.array([y1, y2, x1, x2, h_, w_]))

    downratio = math.sqrt(sample_height * sample_width / h_ / w_)
    coords = (
        y1 * downratio // 16, y2 * downratio // 16,
        x1 * downratio // 16, x2 * downratio // 16,
        sample_height // 16, sample_width // 16,
    )
    y1_c, y2_c, x1_c, x2_c, h_c, w_c = coords
    Y, X = torch.meshgrid(torch.arange(h_c), torch.arange(w_c), indexing='ij')
    mask = (Y.unsqueeze(-1) >= y1_c) & (Y.unsqueeze(-1) < y2_c) & (X.unsqueeze(-1) >= x1_c) & (X.unsqueeze(-1) < x2_c)
    ip_mask = mask.reshape(-1).float().unsqueeze(0)
    ip_mask = torch.cat([ip_mask] * 3).to(device=device, dtype=weight_dtype)

    input_video, input_video_mask, clip_image = get_image_to_video_latent3(
        ref_img, None, video_length=video_length, sample_size=[sample_height, sample_width]
    )

    prompt = (
        "A man is speaking naturally to the camera, realistic talking head, "
        "natural eye blinking and subtle head movement, neutral posture, shoulders up."
    )
    negative_prompt = (
        "Gesture is bad. Gesture is unclear. Strange and twisted hands. Bad hands. "
        "Bad fingers. Unclear and blurry hands. 手部快速摆动, 手指频繁抽搐, 夸张手势, 重复机械性动作."
    )

    generator = torch.Generator(device=device).manual_seed(43)
    partial_video_length = int((113 - 1) // temporal_cr * temporal_cr) + 1 # 113

    print(f"[EchoMimicV3] Starting Long Video CFG generation (num_frames={video_length}, partial={partial_video_length}, overlap=5)...")
    start_t = time.time()
    with torch.no_grad():
        sample = pipeline(
            prompt,
            num_frames            = video_length,
            negative_prompt       = negative_prompt,
            audio_embeds          = audio_embeds,
            audio_scale           = 1.0,
            ip_mask               = ip_mask,
            use_un_ip_mask        = False,
            height                = sample_height,
            width                 = sample_width,
            generator             = generator,
            neg_scale             = 1.5,
            neg_steps             = 2,
            use_dynamic_cfg       = True,
            use_dynamic_acfg      = True,
            guidance_scale        = 4.0,
            audio_guidance_scale  = 2.2,
            num_inference_steps   = 25,
            video                 = input_video,
            mask_video            = input_video_mask,
            clip_image            = clip_image,
            cfg_skip_ratio        = 0,
            shift                 = 5.0,
            use_longvideo_cfg     = True,
            overlap_video_length  = 5,
            partial_video_length  = partial_video_length,
        ).videos
    print(f"[EchoMimicV3] Generation completed in {time.time() - start_t:.1f}s")
    print(f"[EchoMimicV3] Raw decoded video tensor shape: {sample.shape}")

    # 8. Assertions and Slicing (381 -> 375 frames)
    assert sample.shape[2] == 381, f"Assertion Failed: Expected 381 intermediate frames, got {sample.shape[2]}"
    sample = sample[:, :, :375]
    assert sample.shape[2] == 375, f"Assertion Failed: Expected 375 sliced frames, got {sample.shape[2]}"
    print(f"[EchoMimicV3] Successfully sliced decoded video tensor to exactly 375 frames")

    # 9. Save Video and Mux with Original Unpadded Audio
    sample = sample.detach().cpu()
    raw_video_path = os.path.join(work_dir, "raw_375_frames.mp4")
    save_videos_grid(sample, raw_video_path, fps=fps)

    final_mp4_path = os.path.join(work_dir, "final_avatar_15s.mp4")
    mux_cmd = [
        "ffmpeg", "-y",
        "-i", raw_video_path,
        "-i", orig_audio_path,
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        final_mp4_path
    ]
    subprocess.run(mux_cmd, check=True)
    print(f"[EchoMimicV3] Successfully muxed video with original 15.000s speech recording")

    with open(final_mp4_path, "rb") as f:
        mp4_bytes = f.read()

    return mp4_bytes


# ---------------------------------------------------------------------------
# Local Entrypoint
# ---------------------------------------------------------------------------
@app.local_entrypoint()
def main():
    image_file = "public/avatars/logan.jpg"
    audio_file = "public/output/comparison_source/logan_15s_48k.wav"
    output_mp4 = "public/output/avatar_quality_test_15s.mp4"

    if not os.path.exists(image_file):
        raise FileNotFoundError(f"Missing input image: {image_file}")
    if not os.path.exists(audio_file):
        raise FileNotFoundError(f"Missing input audio: {audio_file}")

    print(f"[Local] Reading {image_file}...")
    with open(image_file, "rb") as f:
        img_bytes = f.read()

    print(f"[Local] Reading {audio_file}...")
    with open(audio_file, "rb") as f:
        aud_bytes = f.read()

    print("[Local] Dispatching EchoMimicV3-Preview test to Modal A100-80GB...")
    t0 = time.time()
    result_bytes = run_echomimicv3_test.remote(img_bytes, aud_bytes)
    t_elapsed = time.time() - t0

    os.makedirs(os.path.dirname(output_mp4), exist_ok=True)
    with open(output_mp4, "wb") as f:
        f.write(result_bytes)

    print(f"\n[Local] Test video saved successfully to: {os.path.abspath(output_mp4)}")
    print(f"[Local] Modal execution time: {t_elapsed:.1f} seconds")

    # Local ffprobe verification
    ffprobe_cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-count_packets", "-count_frames",
        "-show_entries", "stream=nb_read_frames,r_frame_rate,duration,width,height",
        "-of", "csv=p=0",
        output_mp4
    ]
    try:
        res_v = subprocess.check_output(ffprobe_cmd).decode().strip()
        print(f"[Local ffprobe Video]: {res_v}")
    except Exception as e:
        print(f"[Local ffprobe Error]: {e}")

    ffprobe_a_cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "a:0",
        "-show_entries", "stream=duration,sample_rate,channels",
        "-of", "csv=p=0",
        output_mp4
    ]
    try:
        res_a = subprocess.check_output(ffprobe_a_cmd).decode().strip()
        print(f"[Local ffprobe Audio]: {res_a}")
    except Exception as e:
        print(f"[Local ffprobe Error]: {e}")
