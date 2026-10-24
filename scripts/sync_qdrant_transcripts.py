#!/usr/bin/env python3
"""
scripts/sync_qdrant_transcripts.py
Synchronizes transcript dialogue and curated investigative quotes
to Qdrant Cloud vector database using the local ONNX all-MiniLM-L6-v2 model (384-dim).
Zero Hugging Face network downloads required!
"""

import os
import sys
import json
import time
import argparse
from pathlib import Path
from typing import List, Dict, Any

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct

def load_env_file():
    for f in [".env.local", ".env"]:
        p = Path(f)
        if p.exists():
            for line in p.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    if k not in os.environ:
                        os.environ[k] = v

class LocalMiniLMEmbedder:
    def __init__(self, repo_root: Path):
        model_path = repo_root / ".cache" / "models" / "Xenova" / "all-MiniLM-L6-v2" / "onnx" / "model_quantized.onnx"
        tok_path = repo_root / ".cache" / "models" / "Xenova" / "all-MiniLM-L6-v2" / "tokenizer.json"
        
        if not model_path.exists() or not tok_path.exists():
            print("[*] Downloading lightweight ONNX embedding model (23MB) from Hugging Face...")
            model_path.parent.mkdir(parents=True, exist_ok=True)
            import urllib.request
            headers = {"User-Agent": "Mozilla/5.0"}
            if not tok_path.exists():
                req = urllib.request.Request("https://huggingface.co/Xenova/all-MiniLM-L6-v2/raw/main/tokenizer.json", headers=headers)
                with urllib.request.urlopen(req) as resp, open(tok_path, "wb") as f:
                    f.write(resp.read())
            if not model_path.exists():
                req = urllib.request.Request("https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx", headers=headers)
                with urllib.request.urlopen(req) as resp, open(model_path, "wb") as f:
                    f.write(resp.read())
            print("[✓] Model downloaded successfully.")
            
        self.tokenizer = Tokenizer.from_file(str(tok_path))
        self.tokenizer.enable_truncation(max_length=256)
        self.tokenizer.enable_padding(length=256)
        
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 4
        self.session = ort.InferenceSession(str(model_path), opts)

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        
        encoded = self.tokenizer.encode_batch(texts)
        input_ids = np.array([e.ids for e in encoded], dtype=np.int64)
        attention_mask = np.array([e.attention_mask for e in encoded], dtype=np.int64)
        token_type_ids = np.zeros_like(input_ids)
        
        inputs = {
            "input_ids": input_ids,
            "attention_mask": attention_mask,
            "token_type_ids": token_type_ids
        }
        out = self.session.run(None, inputs)[0]
        
        # Mean pooling
        mask_expanded = np.expand_dims(attention_mask, -1)
        sum_embeddings = (out * mask_expanded).sum(axis=1)
        sum_mask = np.clip(mask_expanded.sum(axis=1), a_min=1e-9, a_max=None)
        pooled = sum_embeddings / sum_mask
        
        # Normalize
        norms = np.linalg.norm(pooled, axis=1, keepdims=True)
        norms = np.clip(norms, a_min=1e-9, a_max=None)
        normalized = pooled / norms
        
        return normalized.tolist()

def main():
    load_env_file()
    parser = argparse.ArgumentParser(description="Sync Space transcripts to Qdrant Vector DB")
    parser.add_argument("--quotes-only", action="store_true", help="Sync curated quotes from knowledge graph only")
    parser.add_argument("--limit-episodes", type=int, default=5, help="Number of episode transcripts to sync (0 for all)")
    args = parser.parse_args()

    qdrant_url = os.environ.get("QDRANT_URL")
    qdrant_key = os.environ.get("QDRANT_API_KEY")

    if not qdrant_url or not qdrant_key:
        print("[!] Error: QDRANT_URL or QDRANT_API_KEY not set.")
        sys.exit(1)

    print(f"[*] Connecting to Qdrant Cloud at: {qdrant_url}")
    client = QdrantClient(url=qdrant_url, api_key=qdrant_key, timeout=60)

    repo_root = Path(__file__).resolve().parent.parent
    print("[*] Loading offline ONNX all-MiniLM-L6-v2 embedder (384 dims)...")
    embedder = LocalMiniLMEmbedder(repo_root)

    graph_path = repo_root / "public" / "transcripts" / "investigative_knowledge_graph.json"
    points: List[PointStruct] = []
    point_id = 1

    # 1. Sync Curated Quotes from Knowledge Graph
    if graph_path.exists():
        print("[*] Processing curated quotes from knowledge graph...")
        with open(graph_path, "r", encoding="utf-8") as f:
            kg = json.load(f)
        
        quotes = kg.get("quotes", [])
        quote_texts = [f"[{q.get('speaker', '')}]: {q.get('exact_quote', '')}" for q in quotes]
        
        # Embed in batches of 32
        embeddings = []
        for i in range(0, len(quote_texts), 32):
            batch = quote_texts[i:i+32]
            embeddings.extend(embedder.embed_batch(batch))

        for idx, q in enumerate(quotes):
            payload = {
                "type": "curated_quote",
                "quote_id": q.get("quote_id"),
                "speaker": q.get("speaker"),
                "release_tag": q.get("release_tag"),
                "date": q.get("date"),
                "category": q.get("category"),
                "target": q.get("target"),
                "why_it_matters": q.get("why_it_matters"),
                "pre_or_post_fallout": q.get("pre_or_post_fallout"),
                "text": q.get("exact_quote"),
                "time_window": q.get("time_window")
            }
            points.append(PointStruct(id=point_id, vector=embeddings[idx], payload=payload))
            point_id += 1

        print(f"[✓] Prepared {len(points)} curated quote vectors.")

    # 2. Sync Episode Dialogue (Sliding Windows)
    if not args.quotes_only:
        episodes_dir = repo_root / "public" / "transcripts" / "episodes"
        if episodes_dir.exists():
            ep_files = sorted(list(episodes_dir.glob("*.json")))
            if args.limit_episodes > 0:
                ep_files = ep_files[:args.limit_episodes]
            
            print(f"[*] Processing dialogue windows across {len(ep_files)} episode(s)...")
            for ep_file in ep_files:
                tag = ep_file.stem
                try:
                    with open(ep_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    segments = data.get("segments", []) if isinstance(data, dict) else data
                    if not segments:
                        continue

                    # Group into sliding windows of 3 conversational turns
                    window_texts = []
                    window_meta = []
                    for i in range(0, len(segments) - 2, 2):
                        w_segs = segments[i:i+3]
                        w_text = " ".join([f"{s.get('speaker', 'Speaker')}: {s.get('text', '')}" for s in w_segs])
                        if len(w_text.split()) < 8:
                            continue
                        window_texts.append(w_text)
                        window_meta.append({
                            "type": "dialogue_window",
                            "release_tag": tag,
                            "speaker": w_segs[0].get("speaker", "Speaker"),
                            "start": w_segs[0].get("start", 0),
                            "end": w_segs[-1].get("end", 0),
                            "text": w_text
                        })

                    if window_texts:
                        w_embeddings = []
                        for i in range(0, len(window_texts), 32):
                            batch = window_texts[i:i+32]
                            w_embeddings.extend(embedder.embed_batch(batch))

                        for idx, meta in enumerate(window_meta):
                            points.append(PointStruct(
                                id=point_id,
                                vector=w_embeddings[idx],
                                payload=meta
                            ))
                            point_id += 1
                except Exception as e:
                    print(f"[!] Warning reading {ep_file.name}: {e}")

    # 3. Batch Upload to Qdrant
    print(f"[*] Uploading {len(points)} total vectors to Qdrant collection 'transcripts' in batches of 100...")
    batch_size = 100
    for i in range(0, len(points), batch_size):
        chunk = points[i:i+batch_size]
        client.upsert(collection_name="transcripts", points=chunk)
        print(f"    Uploaded {i + len(chunk)} / {len(points)} points...")

    print(f"\n[✓] Successfully synchronized {len(points)} vector embeddings to Qdrant Cloud!")

if __name__ == "__main__":
    main()
