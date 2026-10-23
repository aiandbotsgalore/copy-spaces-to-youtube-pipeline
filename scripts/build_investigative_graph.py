#!/usr/bin/env python3
"""
scripts/build_investigative_graph.py
Compiles the master investigative knowledge graph & contradiction matrix
into a high-speed JSON asset for the React frontend and Qdrant synchronization.
"""

import os
import re
import json
from pathlib import Path

def parse_contradiction_matrix(matrix_md_path: Path):
    if not matrix_md_path.exists():
        return []
    
    text = matrix_md_path.read_text(encoding="utf-8")
    pairings = []
    
    # Extract Pairing sections: "### Pairing 01: ..."
    sections = re.split(r"### Pairing\s+(\d+):\s+(.*?)\n", text)
    if len(sections) > 1:
        # sections: [preamble, id_1, title_1, content_1, id_2, title_2, content_2, ...]
        for i in range(1, len(sections), 3):
            pair_id = sections[i].strip()
            title = sections[i+1].strip()
            content = sections[i+2]
            
            # Extract Pre-fallout
            pre_quote_id = re.search(r"Quote ID:\*\* `?([^`\n]+)`?", content)
            pre_date = re.search(r"Date:\*\* ([^\n|]+)", content)
            pre_ep = re.search(r"Episode:\*\* [^`\n]*`([^`\n]+)`", content)
            pre_quote = re.search(r"Verbatim Audio:\*\*\s*\n>\s*\*(.*?)\*", content, re.DOTALL)
            
            # Find post-fallout sub-block
            post_match = re.search(r"#### Post-Fallout Statement:(.*?)(?=####|---|$)", content, re.DOTALL)
            post_text = post_match.group(1) if post_match else ""
            post_quote_id = re.search(r"Quote ID:\*\* `?([^`\n]+)`?", post_text)
            post_date = re.search(r"Date:\*\* ([^\n|]+)", post_text)
            post_ep = re.search(r"Episode:\*\* [^`\n]*`([^`\n]+)`", post_text)
            post_quote = re.search(r"Verbatim Audio:\*\*\s*\n>\s*\*(.*?)\*", post_text, re.DOTALL)
            
            clean_pre_q = pre_quote.group(1).replace('\n> *', ' ').strip() if pre_quote else ""
            clean_post_q = post_quote.group(1).replace('\n> *', ' ').strip() if post_quote else ""

            pairings.append({
                "pairing_id": f"PAIR-{pair_id.zfill(2)}",
                "number": int(pair_id),
                "title": title,
                "pre_fallout": {
                    "quote_id": pre_quote_id.group(1).strip() if pre_quote_id else "",
                    "date": pre_date.group(1).strip() if pre_date else "Feb 2026",
                    "episode_tag": pre_ep.group(1).strip() if pre_ep else "",
                    "verbatim": clean_pre_q
                },
                "post_fallout": {
                    "quote_id": post_quote_id.group(1).strip() if post_quote_id else "",
                    "date": post_date.group(1).strip() if post_date else "Sep 2026",
                    "episode_tag": post_ep.group(1).strip() if post_ep else "",
                    "verbatim": clean_post_q
                }
            })
            
    return pairings

def main():
    repo_root = Path(__file__).resolve().parent.parent
    matrix_path = repo_root / "docs" / "documentary" / "research" / "ANGELA_CONTRADICTION_CALLBACK_MATRIX.md"
    quotes_path = repo_root / "docs" / "documentary" / "data" / "angela_quotes_master.json"
    out_dir = repo_root / "public" / "transcripts"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "investigative_knowledge_graph.json"

    pairings = parse_contradiction_matrix(matrix_path)
    print(f"[*] Parsed {len(pairings)} master contradiction pairings from matrix.")

    raw_quotes = []
    if quotes_path.exists():
        with open(quotes_path, "r", encoding="utf-8") as f:
            raw_quotes = json.load(f)
    print(f"[*] Loaded {len(raw_quotes)} curated master quotes.")

    # Deduplicate and extract entities
    speakers = sorted(list(set(q.get("speaker", "Unknown") for q in raw_quotes if q.get("speaker"))))
    categories = sorted(list(set(q.get("category", "General") for q in raw_quotes if q.get("category"))))

    # Clean quotes for lightweight browser loading
    curated_quotes = []
    for q in raw_quotes:
        curated_quotes.append({
            "quote_id": q.get("quote_id"),
            "speaker": q.get("speaker"),
            "date": q.get("date"),
            "episode_title": q.get("episode_title"),
            "release_tag": q.get("release_tag"),
            "exact_quote": q.get("exact_quote"),
            "category": q.get("category"),
            "target": q.get("target"),
            "why_it_matters": q.get("why_it_matters"),
            "pre_or_post_fallout": q.get("pre_or_post_fallout", "UNKNOWN"),
            "contradiction_candidate": q.get("contradiction_candidate", False),
            "recommendation": q.get("recommendation", "OPTIONAL"),
            "time_window": q.get("transcript_search_window")
        })

    knowledge_graph = {
        "version": "1.0",
        "title": "The Paper Trail Investigative Knowledge Graph",
        "updated_at": "2026-10-23",
        "stats": {
            "total_curated_quotes": len(curated_quotes),
            "total_contradiction_pairs": len(pairings),
            "total_speakers": len(speakers),
            "total_categories": len(categories)
        },
        "speakers": speakers,
        "categories": categories,
        "contradiction_pairings": pairings,
        "quotes": curated_quotes
    }

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(knowledge_graph, f, indent=2, ensure_ascii=False)

    print(f"[✓] Knowledge Graph successfully generated at: {out_file} ({out_file.stat().st_size / 1024:.1f} KB)")

if __name__ == "__main__":
    main()
