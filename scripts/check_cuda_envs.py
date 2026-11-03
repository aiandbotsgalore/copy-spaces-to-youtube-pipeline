import sys

print(f"Python: {sys.executable}")
print(f"Version: {sys.version.split()[0]}")

try:
    import torch
    cuda = torch.cuda.is_available()
    device = torch.cuda.get_device_name(0) if cuda else "None"
    print(f"PyTorch: {torch.__version__} | CUDA available: {cuda} | Device: {device}")
except Exception as e:
    print(f"PyTorch: Not available ({e})")

try:
    import onnxruntime as ort
    print(f"ONNX Runtime: {ort.__version__} | Providers: {ort.get_available_providers()}")
except Exception as e:
    pass

try:
    import transformers
    print(f"Transformers: {transformers.__version__}")
except Exception:
    pass

try:
    import sentence_transformers
    print(f"SentenceTransformers: {sentence_transformers.__version__}")
except Exception:
    pass
