r"""
STAGE 2: GPU BATCH EMBEDDING ON NVIDIA RTX 4060 Ti
Reads staged documents from .cache/evidence_staging/all_staged_docs.json
Batches through ONNX Runtime with CUDAExecutionProvider
Writes:
  .cache/transcripts/{tag}.embeddings.bin
  .cache/transcripts/{tag}.embeddings.json
  .cache/transcripts/{tag}.json
  .cache/evidence/evidence_catalog.json
"""

import os
import sys
import time
import json
import datetime
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

CWD = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
STAGING_DIR = os.path.join(CWD, ".cache", "evidence_staging")
STAGED_DOCS_PATH = os.path.join(STAGING_DIR, "all_staged_docs.json")
MODEL_DIR = os.path.join(CWD, ".cache", "models", "Xenova", "all-MiniLM-L6-v2")
MODEL_ONNX = os.path.join(MODEL_DIR, "onnx", "model_quantized.onnx")
TOKENIZER_JSON = os.path.join(MODEL_DIR, "tokenizer.json")

TRANSCRIPTS_DIR = os.path.join(CWD, ".cache", "transcripts")
EVIDENCE_DIR = os.path.join(CWD, ".cache", "evidence")
CATALOG_PATH = os.path.join(EVIDENCE_DIR, "evidence_catalog.json")

BATCH_SIZE = 128
DIMS = 384

os.makedirs(TRANSCRIPTS_DIR, exist_ok=True)
os.makedirs(EVIDENCE_DIR, exist_ok=True)

print("=======================================================")
print("      STAGE 2: GPU BATCH EMBEDDING (RTX 4060 Ti)      ")
print("=======================================================")

print("Initializing ONNX Runtime session with CUDAExecutionProvider...")
sess = ort.InferenceSession(MODEL_ONNX, providers=['CUDAExecutionProvider'])
active_provider = sess.get_providers()[0]
print(f"Active Provider: {active_provider}")
assert active_provider == 'CUDAExecutionProvider', f"Assertion failed: Active provider is {active_provider}"
print("✓ GPU acceleration confirmed on NVIDIA GeForce RTX 4060 Ti.")

print("\nLoading tokenizer:", TOKENIZER_JSON)
tok = Tokenizer.from_file(TOKENIZER_JSON)
tok.enable_padding(pad_id=0, pad_token='[PAD]', length=128)
tok.enable_truncation(max_length=128)

print("\nReading staged evidence documents from:", STAGED_DOCS_PATH)
with open(STAGED_DOCS_PATH, 'r', encoding='utf-8') as f:
    staged_docs = json.load(f)

total_docs = len(staged_docs)
total_chunks_all = sum(d['chunkCount'] for d in staged_docs)
print(f"Loaded {total_docs} documents ({total_chunks_all:,} total chunks to embed).")

def embed_texts(texts: list) -> np.ndarray:
    """Runs batch inference on GPU with masked mean pooling and L2 normalization."""
    if not texts:
        return np.empty((0, DIMS), dtype=np.float32)
        
    embeddings_list = []
    for b_start in range(0, len(texts), BATCH_SIZE):
        b_end = min(b_start + BATCH_SIZE, len(texts))
        b_texts = texts[b_start:b_end]
        
        batch = tok.encode_batch(b_texts)
        input_ids = np.array([e.ids for e in batch], dtype=np.int64)
        attention_mask = np.array([e.attention_mask for e in batch], dtype=np.int64)
        token_type_ids = np.array([e.type_ids for e in batch], dtype=np.int64)
        
        outputs = sess.run(None, {
            'input_ids': input_ids,
            'attention_mask': attention_mask,
            'token_type_ids': token_type_ids
        })
        last_hidden = outputs[0]  # [B, 128, 384]
        
        # Masked Mean Pooling
        att_expanded = attention_mask[:, :, np.newaxis].astype(np.float32)
        sum_emb = np.sum(last_hidden * att_expanded, axis=1)
        sum_mask = np.clip(np.sum(att_expanded, axis=1), a_min=1e-9, a_max=None)
        mean_pooled = sum_emb / sum_mask
        
        # L2 Normalize
        norm = np.linalg.norm(mean_pooled, axis=1, keepdims=True)
        norm_emb = (mean_pooled / np.clip(norm, a_min=1e-12, a_max=None)).astype(np.float32)
        embeddings_list.append(norm_emb)
        
    return np.vstack(embeddings_list)

catalog_entries = []
# Preserve any existing catalog items
if os.path.exists(CATALOG_PATH):
    try:
        with open(CATALOG_PATH, 'r', encoding='utf-8') as f:
            existing_cat = json.load(f)
            catalog_entries = [e for e in existing_cat if not e.get('tag', '').startswith('evidence_')]
    except Exception:
        catalog_entries = []

overall_start = time.time()
processed_chunks = 0

print("\nStarting batch GPU embedding run...\n")

for doc_idx, doc in enumerate(staged_docs):
    t0_doc = time.time()
    tag = doc['tag']
    title = doc['title']
    chunks = doc['chunks']
    n_chunks = len(chunks)
    
    texts = [c['text'] for c in chunks]
    vecs = embed_texts(texts)
    
    # 1. Write .embeddings.bin
    bin_path = os.path.join(TRANSCRIPTS_DIR, f"{tag}.embeddings.bin")
    with open(bin_path, 'wb') as f:
        f.write(vecs.tobytes())
        
    # 2. Write .embeddings.json
    now_iso = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
    manifest_segments = []
    for i, c in enumerate(chunks):
        manifest_segments.append({
            'index': i,
            'start': 0.0,
            'end': 0.0,
            'speaker': c['speaker'],
            'text': c['text'],
            'chunkId': c['chunkId'],
            'sourceType': c['sourceType'],
            'sourceClassification': c['sourceClassification'],
            'contentNature': c['contentNature'],
            'documentLocation': c['documentLocation']
        })
        
    manifest = {
        'version': 1,
        'episodeTag': tag,
        'title': title,
        'dims': DIMS,
        'segmentCount': n_chunks,
        'generatedAt': now_iso,
        'sourceType': doc['sourceType'],
        'sourceClassification': doc['sourceClassification'],
        'documentLocation': {
            'filePath': doc['full_path'],
            'displayText': doc['file']
        },
        'segments': manifest_segments
    }
    
    manifest_path = os.path.join(TRANSCRIPTS_DIR, f"{tag}.embeddings.json")
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)
        
    # 3. Write lexical search document
    lexical_path = os.path.join(TRANSCRIPTS_DIR, f"{tag}.json")
    lexical_doc = {
        'releaseTag': tag,
        'title': title,
        'sourceType': doc['sourceType'],
        'sourceClassification': doc['sourceClassification'],
        'generatedAt': now_iso,
        'segments': manifest_segments
    }
    with open(lexical_path, 'w', encoding='utf-8') as f:
        json.dump(lexical_doc, f, indent=2)
        
    # 4. Catalog entry
    cat_entry = {
        'tag': tag,
        'title': title,
        'date': '2024-01-01',
        'source_type': doc['sourceType'],
        'source_classification': doc['sourceClassification'],
        'content_nature': doc['contentNature'],
        'origin_folder': doc['folder'],
        'file_path': doc['full_path'],
        'chunk_count': n_chunks,
        'speakers': doc['speakers'],
        'ingested_at': now_iso,
        'embeddings_manifest': manifest_path,
        'embeddings_bin': bin_path
    }
    catalog_entries.append(cat_entry)
    
    t_elapsed = time.time() - t0_doc
    processed_chunks += n_chunks
    rate = n_chunks / max(0.001, t_elapsed)
    pct = (processed_chunks / total_chunks_all) * 100
    
    print(f"[{doc_idx+1:02d}/{total_docs:02d}] {tag[:42]:42} | {n_chunks:5d} chunks in {t_elapsed:5.2f}s ({rate:5.1f} c/s) | {pct:5.1f}%")

# Save final unified evidence catalog
with open(CATALOG_PATH, 'w', encoding='utf-8') as f:
    json.dump(catalog_entries, f, indent=2)

total_elapsed = time.time() - overall_start
avg_rate = processed_chunks / max(0.001, total_elapsed)

print("\n=======================================================")
print("             STAGE 2 GPU EMBEDDING COMPLETE            ")
print("=======================================================")
print(f"Total documents embedded: {total_docs}")
print(f"Total chunks embedded:    {processed_chunks:,}")
print(f"Total GPU time elapsed:   {total_elapsed:.1f}s ({total_elapsed/60:.2f} mins)")
print(f"Average throughput:       {avg_rate:.1f} chunks/sec")
print(f"Hardware:                 NVIDIA GeForce RTX 4060 Ti")
print(f"Catalog saved:            {CATALOG_PATH} ({len(catalog_entries)} entries)")
print("=======================================================\n")
