#!/usr/bin/env python3
"""
extract_investigative_claims.py - Automated Claim & Contradiction Extractor

Analyzes Twitter Space transcripts using verified AI models (Cohere v2,
Google AI Pro via Antigravity CLI, Inception Labs Mercury-3, or OpenRouter)
to extract high-value factual statements, timeline commitments, denials,
and contradiction candidates.

Appends verified claims into public/transcripts/investigative_knowledge_graph.json
and optionally syncs them directly to Qdrant Cloud.
"""

import os
import sys
import json
import re
import shutil
import argparse
import subprocess
import urllib.request
import urllib.error
from pathlib import Path
from typing import List, Dict, Any, Optional


def load_env_local(repo_root: Path):
    """Loads environment variables from .env.local and .env if present."""
    for fname in [".env.local", ".env"]:
        env_file = repo_root / fname
        if env_file.exists():
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        if k.strip() not in os.environ:
                            os.environ[k.strip()] = v.strip().strip('"').strip("'")


def find_agy_cli() -> Optional[str]:
    """Locates the Antigravity CLI (agy) binary on PATH or in local AppData."""
    agy_on_path = shutil.which("agy")
    if agy_on_path:
        return agy_on_path
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        p = Path(local_app_data) / "agy" / "bin" / "agy.exe"
        if p.exists():
            return str(p)
    return None


def clean_json_response(content: str) -> Dict[str, Any]:
    """Strips markdown code fences and parses JSON object."""
    trimmed = content.strip()
    if "```" in trimmed:
        m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", trimmed)
        if m:
            trimmed = m.group(1).strip()
    return json.loads(trimmed)


def call_cohere_extraction(system_prompt: str, user_prompt: str) -> Dict[str, Any]:
    """Extracts claims using Cohere v2 Chat API (command-a-03-2025)."""
    key = os.environ.get("COHERE_API_KEY")
    if not key:
        raise ValueError("COHERE_API_KEY not found in environment")
    url = "https://api.cohere.com/v2/chat"
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "command-a-03-2025",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.2
    }
    print("[*] Extracting claims with Cohere (command-a-03-2025)...")
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        content_items = data.get("message", {}).get("content", [])
        text = "".join(c.get("text", "") for c in content_items if isinstance(c, dict)).strip()
        return clean_json_response(text)


def call_agy_extraction(system_prompt: str, user_prompt: str) -> Dict[str, Any]:
    """Extracts claims using Google AI Pro plan via Antigravity CLI (gemini-3.8-flash-high)."""
    agy_bin = find_agy_cli()
    if not agy_bin:
        raise ValueError("Antigravity CLI (agy) not found on PATH or LocalAppData")
    combined_prompt = f"{system_prompt}\n\n{user_prompt}"
    # Bound input size to protect CLI limits
    if len(combined_prompt) > 25000:
        combined_prompt = combined_prompt[:25000]
    cmd = [
        agy_bin,
        "-p", combined_prompt,
        "--model", "gemini-3.8-flash-high",
        "--output-format", "json",
        "--disable-slash-commands"
    ]
    print("[*] Extracting claims with Gemini (gemini-3.8-flash-high) via Google AI Pro CLI...")
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if res.returncode != 0:
        raise RuntimeError(f"Antigravity CLI failed (exit {res.returncode}): {res.stderr[:200]}")
    data = json.loads(res.stdout)
    raw_text = data.get("response", "")
    return clean_json_response(raw_text)


def call_inception_extraction(system_prompt: str, user_prompt: str) -> Dict[str, Any]:
    """Extracts claims using Inception Labs (mercury-3) via OpenAI-compatible endpoint."""
    key = os.environ.get("INCEPTION_API_KEY") or os.environ.get("DIRECTOR_API_KEY")
    if not key:
        raise ValueError("INCEPTION_API_KEY not found in environment")
    base_url = os.environ.get("INCEPTION_BASE_URL", "https://api.inceptionlabs.ai/v1").rstrip("/")
    url = f"{base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "mercury-3",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.2,
        "max_tokens": 4096
    }
    print("[*] Extracting claims with Inception Labs (mercury-3)...")
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        content = data["choices"][0]["message"]["content"]
        return clean_json_response(content)


def call_openrouter_extraction(system_prompt: str, user_prompt: str) -> Dict[str, Any]:
    """Extracts claims using OpenRouter."""
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise ValueError("OPENROUTER_API_KEY not found in environment")
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "google/gemini-2.5-flash",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.2,
        "max_tokens": 4096
    }
    print("[*] Extracting claims with OpenRouter...")
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        content = data["choices"][0]["message"]["content"]
        return clean_json_response(content)


def call_investigative_extraction(system_prompt: str, user_prompt: str, provider: str = "auto") -> Dict[str, Any]:
    """Unified dispatcher for investigative claim extraction supporting user-selected providers."""
    p_norm = (provider or "auto").strip().lower()

    if p_norm == "cohere":
        return call_cohere_extraction(system_prompt, user_prompt)
    elif p_norm in ("agy", "gemini"):
        return call_agy_extraction(system_prompt, user_prompt)
    elif p_norm in ("inception", "mercury"):
        return call_inception_extraction(system_prompt, user_prompt)
    elif p_norm == "openrouter":
        return call_openrouter_extraction(system_prompt, user_prompt)

    # 'auto' mode: try Cohere -> Google AI Pro CLI -> Inception Labs -> OpenRouter
    errors = []
    if os.environ.get("COHERE_API_KEY"):
        try:
            return call_cohere_extraction(system_prompt, user_prompt)
        except Exception as e:
            errors.append(f"Cohere error: {e}")

    if find_agy_cli():
        try:
            return call_agy_extraction(system_prompt, user_prompt)
        except Exception as e:
            errors.append(f"Agy CLI error: {e}")

    if os.environ.get("INCEPTION_API_KEY") or os.environ.get("DIRECTOR_API_KEY"):
        try:
            return call_inception_extraction(system_prompt, user_prompt)
        except Exception as e:
            errors.append(f"Inception error: {e}")

    if os.environ.get("OPENROUTER_API_KEY"):
        try:
            return call_openrouter_extraction(system_prompt, user_prompt)
        except Exception as e:
            errors.append(f"OpenRouter error: {e}")

    raise RuntimeError(f"No available AI provider succeeded for claim extraction. Details: {'; '.join(errors)}")


def extract_claims_from_episode(ep_path: Path, provider: str = "auto") -> List[Dict[str, Any]]:
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
    # If transcript is massive, sample high-signal turns
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

    print(f"[*] Analyzing '{title}' ({len(segments)} turns) with AI provider '{provider}'...")
    result = call_investigative_extraction(system_prompt, user_prompt, provider=provider)

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
    parser.add_argument("--provider", choices=["auto", "cohere", "agy", "gemini", "inception", "mercury", "openrouter"], default="auto", help="AI provider for claim extraction (default: auto)")
    parser.add_argument("--sync-qdrant", action="store_true", help="Automatically sync to Qdrant Cloud after extraction")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    load_env_local(repo_root)
    graph_path = repo_root / "public" / "transcripts" / "investigative_knowledge_graph.json"

    if args.episode:
        ep_name = args.episode if args.episode.endswith(".json") else f"{args.episode}.json"
        ep_path = repo_root / "public" / "transcripts" / "episodes" / ep_name
        if not ep_path.exists():
            print(f"[!] Episode file not found: {ep_path}")
            sys.exit(1)
        claims = extract_claims_from_episode(ep_path, provider=args.provider)
        if claims:
            append_to_knowledge_graph(claims, graph_path)
    else:
        print("[*] No episode specified. Usage: python scripts/extract_investigative_claims.py --episode <tag> [--provider <choice>] [--sync-qdrant]")
        sys.exit(0)

    if args.sync_qdrant:
        print("\n[*] Triggering Qdrant Cloud synchronization...")
        sync_script = repo_root / "scripts" / "sync_qdrant_transcripts.py"
        subprocess.run([sys.executable, str(sync_script), "--quotes-only"])


if __name__ == "__main__":
    main()
