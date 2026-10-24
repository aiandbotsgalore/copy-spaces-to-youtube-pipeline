#!/usr/bin/env python3
"""
extract_investigative_claims.py - Automated Claim & Contradiction Extractor

Analyzes Twitter Space transcripts using Gemini 2.5 Flash (via Cheaper Inference
or OpenRouter) to extract high-value factual statements, timeline commitments,
denials, and contradiction candidates.

Appends verified claims into public/transcripts/investigative_knowledge_graph.json
and optionally syncs them directly to Qdrant Cloud.
"""

import os
import sys
import json
import argparse
import urllib.request
import urllib.error
from pathlib import Path
from typing import List, Dict, Any, Optional

def load_env_local(repo_root: Path):
    """Loads environment variables from .env.local if present."""
    env_file = repo_root / ".env.local"
    if env_file.exists():
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    if k not in os.environ:
                        os.environ[k] = v.strip()

def get_inference_client():
    """Resolves API key, base URL, and model for inference."""
    repo_root = Path(__file__).resolve().parent.parent
    load_env_local(repo_root)

    key = os.environ.get("CHEAPER_INFERENCE_API_KEY")
    base_url = os.environ.get("CHEAPER_INFERENCE_BASE_URL", "https://api.cheaperinference.com/v1").rstrip("/")
    model = os.environ.get("DIRECTOR_MODEL", "gemini-2.5-flash")

    if not key:
        key = os.environ.get("OPENROUTER_API_KEY")
        if key:
            base_url = "https://openrouter.ai/api/v1"
            model = "google/gemini-2.5-flash"

    if not key:
        raise ValueError("No CHEAPER_INFERENCE_API_KEY or OPENROUTER_API_KEY found in environment or .env.local")

    return key, base_url, model

def call_chat_completion(key: str, base_url: str, model: str, system_prompt: str, user_prompt: str) -> Dict[str, Any]:
    """Calls OpenAI-compatible /chat/completions endpoint."""
    url = f"{base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.2,
        "max_tokens": 4096
    }

    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            content = data["choices"][0]["message"]["content"]
            # Clean possible markdown fence
            if "```" in content:
                import re
                m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", content)
                if m:
                    content = m.group(1).strip()
            return json.loads(content)
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8")
        raise RuntimeError(f"HTTP Error {e.code}: {err_msg}")
    except Exception as e:
        raise RuntimeError(f"Inference error: {e}")

def extract_claims_from_episode(ep_path: Path) -> List[Dict[str, Any]]:
    """Runs extraction on a single episode JSON."""
    with open(ep_path, "r", encoding="utf-8") as f:
        ep_data = json.load(f)

    tag = ep_data.get("release_tag") or ep_path.stem
    title = ep_data.get("title", tag)
    date_str = ep_data.get("published_at", "")[:10]
    segments = ep_data.get("segments", [])

    if not segments:
        print(f"[-] No segments found in {ep_path.name}")
        return []

    # Build compressed transcript representation
    lines = []
    for s in segments:
        sec = int(s.get("start", 0))
        m, sec_rem = divmod(sec, 60)
        h, m = divmod(m, 60)
        ts = f"{h:02d}:{m:02d}:{sec_rem:02d}"
        spk = s.get("speaker", "Speaker")
        txt = s.get("text", "").strip()
        if txt:
            lines.append(f"[{ts}] {spk}: {txt}")

    dialogue_text = "\n".join(lines)
    # If transcript is absurdly massive, truncate or sample high-signal turns
    if len(dialogue_text) > 400000:
        dialogue_text = dialogue_text[:400000] + "\n...[Transcript continues]..."

    system_prompt = (
        "You are an expert investigative intelligence analyst specializing in forensic fact-checking and contradiction detection.\n"
        "Your task is to analyze this Twitter Space transcript and extract the top 3 to 10 most consequential, testable claims, statements of fact, timeline assertions, or denials.\n"
        "\n"
        "STRICT INVESTIGATIVE RULES:\n"
        "1. FILTER OUT BANTER: Discard obvious jokes, trolling, friendly sarcasm, laughter, or hyperbole.\n"
        "2. VERBATIM ACCURACY: The 'exact_quote' field must be an exact substring from the spoken dialogue.\n"
        "3. CATEGORIES: Choose strictly from: 'Hardware & Drives', 'Court & Law Enforcement', 'Allegations & Accusations', 'Financial & Payments', 'Alibi & Timeline', 'General Admission'.\n"
        "4. CONTRADICTION RISK: Mark contradiction_candidate=true if this claim is a strong factual commitment that could conflict with future denials or past statements.\n"
        "\n"
        "OUTPUT FORMAT: Return ONLY a valid JSON object with a single 'claims' array of objects:\n"
        "{\n"
        "  \"claims\": [\n"
        "    {\n"
        "      \"speaker\": \"Speaker Name\",\n"
        "      \"exact_quote\": \"verbatim quote here\",\n"
        "      \"category\": \"Category Name\",\n"
        "      \"why_it_matters\": \"1-2 sentence forensic explanation of why this claim is significant.\",\n"
        "      \"contradiction_candidate\": true,\n"
        "      \"time_window\": \"HH:MM:SS\"\n"
        "    }\n"
        "  ]\n"
        "}"
    )

    user_prompt = f"Episode Tag: {tag}\nTitle: {title}\nDate: {date_str}\n\nTRANSCRIPT:\n{dialogue_text}"

    print(f"[*] Analyzing '{title}' ({len(segments)} turns) with Gemini 2.5 Flash via Cheaper Inference...")
    key, base_url, model = get_inference_client()
    result = call_chat_completion(key, base_url, model, system_prompt, user_prompt)

    extracted = result.get("claims", [])
    print(f"[✓] Extracted {len(extracted)} verified claims.")

    # Format for knowledge graph
    formatted_quotes = []
    # Determine pre/post fallout based on date (Sept 1, 2026 cutoff)
    is_post = date_str >= "2026-09-01" if date_str else False
    fallout_status = "POST-FALLOUT" if is_post else "PRE-FALLOUT"

    for c in extracted:
        formatted_quotes.append({
            "speaker": c.get("speaker", "Unknown"),
            "date": date_str,
            "episode_title": title,
            "release_tag": tag,
            "exact_quote": c.get("exact_quote", ""),
            "category": c.get("category", "General Admission"),
            "target": c.get("speaker", "General"),
            "why_it_matters": c.get("why_it_matters", ""),
            "pre_or_post_fallout": fallout_status,
            "contradiction_candidate": bool(c.get("contradiction_candidate", False)),
            "time_window": c.get("time_window", "")
        })

    return formatted_quotes

def append_to_knowledge_graph(new_claims: List[Dict[str, Any]], graph_path: Path):
    """Appends new claims to the knowledge graph JSON safely."""
    if not graph_path.exists():
        print(f"[!] Knowledge graph not found at {graph_path}")
        return

    with open(graph_path, "r", encoding="utf-8") as f:
        graph = json.load(f)

    existing_quotes = graph.get("quotes", [])
    existing_texts = {q.get("exact_quote", "").strip().lower() for q in existing_quotes}

    highest_id = 0
    for q in existing_quotes:
        qid = q.get("quote_id", "")
        if qid.startswith("AQ-"):
            try:
                num = int(qid.split("-")[1])
                highest_id = max(highest_id, num)
            except ValueError:
                pass

    added = 0
    for claim in new_claims:
        q_text = claim["exact_quote"].strip().lower()
        if q_text and q_text not in existing_texts:
            highest_id += 1
            claim["quote_id"] = f"AQ-{highest_id:04d}"
            existing_quotes.append(claim)
            existing_texts.add(q_text)
            added += 1

    graph["quotes"] = existing_quotes
    graph["stats"]["total_curated_quotes"] = len(existing_quotes)

    with open(graph_path, "w", encoding="utf-8") as f:
        json.dump(graph, f, indent=2)

    print(f"[✓] Added {added} new claims to {graph_path.name} (Total: {len(existing_quotes)})")

def main():
    parser = argparse.ArgumentParser(description="Extract investigative claims from episode transcripts.")
    parser.add_argument("--episode", type=str, help="Specific episode release tag or JSON filename")
    parser.add_argument("--sync-qdrant", action="store_true", help="Automatically sync to Qdrant Cloud after extraction")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    graph_path = repo_root / "public" / "transcripts" / "investigative_knowledge_graph.json"

    if args.episode:
        ep_name = args.episode if args.episode.endswith(".json") else f"{args.episode}.json"
        ep_path = repo_root / "public" / "transcripts" / "episodes" / ep_name
        if not ep_path.exists():
            print(f"[!] Episode file not found: {ep_path}")
            sys.exit(1)
        claims = extract_claims_from_episode(ep_path)
        if claims:
            append_to_knowledge_graph(claims, graph_path)
    else:
        print("[*] No episode specified. Usage: python scripts/extract_investigative_claims.py --episode <tag> [--sync-qdrant]")
        sys.exit(0)

    if args.sync_qdrant:
        print("\n[*] Triggering Qdrant Cloud synchronization...")
        sync_script = repo_root / "scripts" / "sync_qdrant_transcripts.py"
        import subprocess
        subprocess.run([sys.executable, str(sync_script), "--quotes-only"])

if __name__ == "__main__":
    main()
