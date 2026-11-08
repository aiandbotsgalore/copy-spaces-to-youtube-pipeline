r"""
STAGE 1: CPU PARSER & CHUNKER FOR ALL CANONICAL EVIDENCE
Parses all files in folders 01-08 in C:\Users\Logan\Downloads\sav\angela\evidence
Outputs staging manifests to .cache/evidence_staging/
"""

import os
import sys
import re
import json
import hashlib
import datetime
import numpy as np
import pandas as pd
import fitz  # PyMuPDF
from bs4 import BeautifulSoup
from tokenizers import Tokenizer

CWD = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
EVIDENCE_ROOT = r"C:\Users\Logan\Downloads\sav\angela\evidence"
MODEL_DIR = os.path.join(CWD, ".cache", "models", "Xenova", "all-MiniLM-L6-v2")
TOKENIZER_JSON = os.path.join(MODEL_DIR, "tokenizer.json")
STAGING_DIR = os.path.join(CWD, ".cache", "evidence_staging")

MAX_TOKENS = 100
OVERLAP = 20

os.makedirs(STAGING_DIR, exist_ok=True)

print("Loading tokenizer:", TOKENIZER_JSON)
tok = Tokenizer.from_file(TOKENIZER_JSON)
tok.no_truncation()
tok.no_padding()

def stable_chunk_id(tag: str, idx: int) -> str:
    raw_id = f"{tag}:chunk:{idx:05d}"
    return hashlib.sha1(raw_id.encode()).hexdigest()[:16]

def slugify(text: str) -> str:
    text = re.sub(r'\[.*?\]', '', text)
    text = re.sub(r'\(.*?\)', '', text)
    text = re.sub(r'[^a-zA-Z0-9]+', '_', text).strip('_').lower()
    return text[:40]

def chunk_text(text: str, max_tokens: int = MAX_TOKENS, overlap: int = OVERLAP):
    encoding = tok.encode(text)
    ids = encoding.ids
    if not ids:
        return []
    if len(ids) <= max_tokens:
        decoded = tok.decode(ids, skip_special_tokens=True).strip()
        return [(decoded, len(ids))] if decoded else []
    
    chunks = []
    start = 0
    while start < len(ids):
        end = min(start + max_tokens, len(ids))
        window_ids = ids[start:end]
        decoded = tok.decode(window_ids, skip_special_tokens=True).strip()
        if decoded:
            chunks.append((decoded, len(window_ids)))
        if end >= len(ids):
            break
        start += (max_tokens - overlap)
    return chunks

def get_metadata(fld_name: str, file_name: str):
    lf = fld_name.lower()
    lfile = file_name.lower()

    if lf.startswith("01"):
        if "communication analysis" in lfile:
            return "direct_message", "derivative_material", "editorial_note"
        return "direct_message", "primary_record", "verbatim_statement"
    elif lf.startswith("02"):
        if "court" in lfile or "case" in lfile:
            return "court_record", "primary_record", "official_record"
        return "court_record", "derivative_material", "unverified_allegation"
    elif lf.startswith("03"):
        if "ledger" in lfile or "index" in lfile:
            return "public_post", "derivative_material", "editorial_note"
        return "public_post", "primary_record", "verbatim_statement"
    elif lf.startswith("04"):
        return "recorded_call", "primary_record", "verbatim_statement"
    elif lf.startswith("05"):
        return "space_transcript", "primary_record", "verbatim_statement"
    elif lf.startswith("06"):
        return "research_dossier", "derivative_material", "editorial_note"
    elif lf.startswith("07"):
        return "research_dossier", "derivative_material", "editorial_note"
    elif lf.startswith("08"):
        return "research_dossier", "derivative_material", "editorial_note"
    return "research_dossier", "derivative_material", "editorial_note"

def parse_dialogue_text(raw_text: str, file_path: str):
    lines = raw_text.splitlines()
    turns = []
    
    # Check if file has isolated speaker lines (e.g. "Angela:\n")
    has_isolated_speakers = False
    for l in lines[:50]:
        st = l.strip()
        if st.endswith(':') and len(st) <= 40 and not any(c in st for c in '\n\r'):
            has_isolated_speakers = True
            break
            
    if has_isolated_speakers:
        curr_spk = None
        curr_lines = []
        curr_start_line = 1
        for line_idx, line in enumerate(lines):
            st = line.strip()
            if st.endswith(':') and len(st) <= 40 and not any(c in st for c in '\n\r'):
                if curr_spk and curr_lines:
                    turns.append({
                        'speaker': curr_spk,
                        'text': '\n'.join(curr_lines).strip(),
                        'line_start': curr_start_line,
                        'line_end': line_idx
                    })
                curr_spk = st[:-1].strip()
                curr_lines = []
                curr_start_line = line_idx + 1
            else:
                if curr_spk is not None:
                    curr_lines.append(line)
        if curr_spk and curr_lines:
            turns.append({
                'speaker': curr_spk,
                'text': '\n'.join(curr_lines).strip(),
                'line_start': curr_start_line,
                'line_end': len(lines)
            })
            
    if not turns:
        # Try inline pattern: "Speaker: Text" or "[00:15] Speaker: Text"
        inline_regex = re.compile(r'^(?:\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*)?([A-Za-z0-9_\- Ϟ\.\(\)]+):\s*(.*)$')
        curr_spk = None
        curr_lines = []
        curr_start_line = 1
        for line_idx, line in enumerate(lines):
            st = line.strip()
            if not st:
                continue
            m = inline_regex.match(st)
            if m and len(m.group(1)) <= 35:
                if curr_spk and curr_lines:
                    turns.append({
                        'speaker': curr_spk,
                        'text': ' '.join(curr_lines).strip(),
                        'line_start': curr_start_line,
                        'line_end': line_idx
                    })
                curr_spk = m.group(1).strip()
                curr_lines = [m.group(2).strip()] if m.group(2).strip() else []
                curr_start_line = line_idx + 1
            else:
                if curr_spk:
                    curr_lines.append(st)
                else:
                    curr_lines.append(st)
                    curr_spk = "Unknown"
        if curr_spk and curr_lines:
            turns.append({
                'speaker': curr_spk,
                'text': ' '.join(curr_lines).strip(),
                'line_start': curr_start_line,
                'line_end': len(lines)
            })

    # If still no turns (e.g. raw prose or notes), group by paragraphs
    if not turns:
        curr_lines = []
        curr_start_line = 1
        for line_idx, line in enumerate(lines):
            st = line.strip()
            if not st:
                if curr_lines:
                    turns.append({
                        'speaker': 'Document',
                        'text': ' '.join(curr_lines).strip(),
                        'line_start': curr_start_line,
                        'line_end': line_idx
                    })
                    curr_lines = []
                curr_start_line = line_idx + 2
            else:
                curr_lines.append(st)
        if curr_lines:
            turns.append({
                'speaker': 'Document',
                'text': ' '.join(curr_lines).strip(),
                'line_start': curr_start_line,
                'line_end': len(lines)
            })
            
    return [t for t in turns if t['text']]

def parse_text_file(path: str, tag: str, title: str, meta: dict):
    for enc in ['utf-8-sig', 'utf-8', 'latin-1', 'cp1252']:
        try:
            with open(path, 'r', encoding=enc) as f:
                raw_text = f.read()
            break
        except UnicodeDecodeError:
            continue
            
    turns = parse_dialogue_text(raw_text, path)
    chunks = []
    chunk_idx = 0
    speakers = set()
    
    for t_idx, turn in enumerate(turns):
        spk = turn['speaker']
        speakers.add(spk)
        t_chunks = chunk_text(turn['text'])
        for part_idx, (c_text, c_len) in enumerate(t_chunks):
            cid = stable_chunk_id(tag, chunk_idx)
            if len(t_chunks) > 1:
                disp = f"Lines {turn['line_start']}-{turn['line_end']} Part {part_idx+1} ({spk})"
            else:
                disp = f"Lines {turn['line_start']}-{turn['line_end']} ({spk})"
            chunks.append({
                'index': chunk_idx,
                'speaker': spk,
                'text': c_text,
                'tokenLen': c_len,
                'chunkId': cid,
                'documentLocation': {
                    'filePath': path,
                    'lineNumber': turn['line_start'],
                    'displayText': disp
                },
                'sourceType': meta['source_type'],
                'sourceClassification': meta['source_class'],
                'contentNature': meta['content_nature']
            })
            chunk_idx += 1
            
    return chunks, list(speakers)

def parse_pdf(path: str, tag: str, title: str, meta: dict):
    doc = fitz.open(path)
    chunks = []
    chunk_idx = 0
    speakers = set(['Record'])
    
    for p_idx in range(len(doc)):
        page = doc[p_idx]
        text = page.get_text()
        if not text.strip():
            continue
        p_chunks = chunk_text(text)
        for part_idx, (c_text, c_len) in enumerate(p_chunks):
            cid = stable_chunk_id(tag, chunk_idx)
            disp = f"{os.path.basename(path)} (Page {p_idx+1})" if len(p_chunks) == 1 else f"{os.path.basename(path)} (Page {p_idx+1} Part {part_idx+1})"
            chunks.append({
                'index': chunk_idx,
                'speaker': 'Record',
                'text': c_text,
                'tokenLen': c_len,
                'chunkId': cid,
                'documentLocation': {
                    'filePath': path,
                    'pageNumber': p_idx + 1,
                    'displayText': disp
                },
                'sourceType': meta['source_type'],
                'sourceClassification': meta['source_class'],
                'contentNature': meta['content_nature']
            })
            chunk_idx += 1
            
    return chunks, list(speakers)

def parse_discord_html(path: str, tag: str, title: str, meta: dict):
    with open(path, 'r', encoding='utf-8', errors='ignore') as f:
        soup = BeautifulSoup(f.read(), 'lxml')
    messages = []
    msg_divs = soup.find_all(class_=re.compile(r'chatlog__message-group|chatlog__message'))
    if msg_divs:
        for m in msg_divs:
            author = m.find(class_=re.compile(r'chatlog__author-name|chatlog__author'))
            timestamp = m.find(class_=re.compile(r'chatlog__timestamp'))
            content = m.find(class_=re.compile(r'chatlog__content|chatlog__markdown'))
            if content and content.get_text(strip=True):
                messages.append({
                    'author': author.get_text(strip=True) if author else 'Unknown',
                    'timestamp': timestamp.get_text(strip=True) if timestamp else 'Unknown',
                    'text': content.get_text(strip=True)
                })
    if not messages:
        text = soup.get_text(separator=' ', strip=True)
        messages.append({'author': 'Document', 'timestamp': 'Unknown', 'text': text})
    
    chunks = []
    chunk_idx = 0
    speakers = set()
    for m_idx, msg in enumerate(messages):
        spk = msg['author']
        speakers.add(spk)
        m_chunks = chunk_text(msg['text'])
        for part_idx, (c_text, c_len) in enumerate(m_chunks):
            cid = stable_chunk_id(tag, chunk_idx)
            loc_disp = f"Discord DM ({msg['timestamp']}) - {spk}" if msg['timestamp'] != 'Unknown' else f"Discord DM #{m_idx+1} ({spk})"
            if len(m_chunks) > 1:
                loc_disp += f" Part {part_idx+1}"
            chunks.append({
                'index': chunk_idx,
                'speaker': spk,
                'text': c_text,
                'tokenLen': c_len,
                'chunkId': cid,
                'documentLocation': {
                    'filePath': path,
                    'messageIndex': m_idx,
                    'displayText': loc_disp
                },
                'sourceType': meta['source_type'],
                'sourceClassification': meta['source_class'],
                'contentNature': meta['content_nature']
            })
            chunk_idx += 1
            
    return chunks, list(speakers)

def parse_csv(path: str, tag: str, title: str, meta: dict):
    df = pd.read_csv(path, dtype=str)
    text_col = None
    for c in ['full_text', 'text', 'Tweet Text', 'content', 'post', 'tweet']:
        if c in df.columns:
            text_col = c
            break
    if not text_col:
        text_col = max(df.columns, key=lambda col: df[col].dropna().astype(str).str.len().mean() if len(df[col].dropna()) > 0 else 0)
    
    chunks = []
    chunk_idx = 0
    speakers = set()
    default_spk = "Angela Maggard" if "angela" in path.lower() else "Twitter User"
    
    for r_idx, row in df.iterrows():
        raw_val = row[text_col]
        if pd.isna(raw_val) or not str(raw_val).strip():
            continue
        val = str(raw_val).strip()
        spk = default_spk
        if 'author' in df.columns and pd.notna(row['author']):
            spk = str(row['author']).strip()
        elif 'username' in df.columns and pd.notna(row['username']):
            spk = f"@{str(row['username']).strip()}"
        speakers.add(spk)
        
        created = row.get('created_at') or row.get('date') or row.get('timestamp') or ''
        disp = f"Tweet ({created}) {spk}" if pd.notna(created) and str(created).strip() else f"Social Post #{r_idx+1} ({spk})"
        
        c_list = chunk_text(val)
        for part_idx, (c_text, c_len) in enumerate(c_list):
            cid = stable_chunk_id(tag, chunk_idx)
            loc_str = disp if len(c_list) == 1 else f"{disp} Part {part_idx+1}"
            chunks.append({
                'index': chunk_idx,
                'speaker': spk,
                'text': c_text,
                'tokenLen': c_len,
                'chunkId': cid,
                'documentLocation': {
                    'filePath': path,
                    'lineNumber': r_idx + 2,
                    'displayText': loc_str
                },
                'sourceType': meta['source_type'],
                'sourceClassification': meta['source_class'],
                'contentNature': meta['content_nature']
            })
            chunk_idx += 1
            
    return chunks, list(speakers)

def parse_excel(path: str, tag: str, title: str, meta: dict):
    chunks = []
    chunk_idx = 0
    speakers = set()
    
    try:
        df = pd.read_excel(path, sheet_name='Evidence Ledger', dtype=str)
    except Exception:
        df = pd.read_excel(path, sheet_name=0, dtype=str)
        
    text_col = None
    for c in ['Transcript Excerpt', 'Quote / Excerpt', 'Text', 'Content', 'Excerpt', 'Transcript']:
        if c in df.columns:
            text_col = c
            break
    if not text_col:
        text_col = max(df.columns, key=lambda col: df[col].dropna().astype(str).str.len().mean() if len(df[col].dropna()) > 0 else 0)
        
    for r_idx, row in df.iterrows():
        raw_val = row[text_col]
        if pd.isna(raw_val) or not str(raw_val).strip():
            continue
        val = str(raw_val).strip()
            
        spk = str(row.get('Speaker', 'Speaker')).strip() if pd.notna(row.get('Speaker')) else 'Speaker'
        speakers.add(spk)
        
        ev_id = str(row.get('Evidence ID', f'row-{r_idx+1}')).strip() if pd.notna(row.get('Evidence ID')) else f'row-{r_idx+1}'
        disp = f"Evidence Ledger [{ev_id}] ({spk})"
        
        c_list = chunk_text(val)
        for part_idx, (c_text, c_len) in enumerate(c_list):
            cid = stable_chunk_id(tag, chunk_idx)
            loc_str = disp if len(c_list) == 1 else f"{disp} Part {part_idx+1}"
            chunks.append({
                'index': chunk_idx,
                'speaker': spk,
                'text': c_text,
                'tokenLen': c_len,
                'chunkId': cid,
                'documentLocation': {
                    'filePath': path,
                    'displayText': loc_str
                },
                'sourceType': meta['source_type'],
                'sourceClassification': meta['source_class'],
                'contentNature': meta['content_nature']
            })
            chunk_idx += 1
            
    return chunks, list(speakers)

# ──────────────────────────────────────────────────────────────────
# MAIN RUNNER
# ──────────────────────────────────────────────────────────────────
canonical_folders = [f"0{i}" for i in range(1, 9)]
file_records = []

for fld in sorted(os.listdir(EVIDENCE_ROOT)):
    if any(fld.startswith(cf) for cf in canonical_folders):
        fld_path = os.path.join(EVIDENCE_ROOT, fld)
        for root, dirs, files in os.walk(fld_path):
            for f in sorted(files):
                full_path = os.path.join(root, f)
                ext = os.path.splitext(f)[1].lower()
                st, sc, cn = get_metadata(fld, f)
                base_name = os.path.splitext(f)[0]
                slug = slugify(base_name)
                ext_slug = ext.replace('.', '')
                tag = f"evidence_{fld[:2]}_{slug}_{ext_slug}"
                clean_title = re.sub(r'[_]+', ' ', base_name).strip()
                
                file_records.append({
                    'folder': fld,
                    'file': f,
                    'ext': ext,
                    'tag': tag,
                    'title': clean_title,
                    'source_type': st,
                    'source_class': sc,
                    'content_nature': cn,
                    'full_path': full_path
                })

print(f"\nProcessing {len(file_records)} canonical evidence files across folders 01-08...")

all_staged_docs = []
total_chunks = 0
file_count = 0

for rec in file_records:
    path = rec['full_path']
    ext = rec['ext']
    tag = rec['tag']
    title = rec['title']
    meta = {
        'source_type': rec['source_type'],
        'source_class': rec['source_class'],
        'content_nature': rec['content_nature']
    }
    
    try:
        if ext == '.txt':
            chunks, speakers = parse_text_file(path, tag, title, meta)
        elif ext == '.pdf':
            chunks, speakers = parse_pdf(path, tag, title, meta)
        elif ext == '.html':
            chunks, speakers = parse_discord_html(path, tag, title, meta)
        elif ext == '.csv':
            chunks, speakers = parse_csv(path, tag, title, meta)
        elif ext in ['.xlsx', '.xls']:
            chunks, speakers = parse_excel(path, tag, title, meta)
        else:
            print(f"Skipping unsupported extension: {rec['file']}")
            continue
            
        if not chunks:
            print(f"⚠ Warning: 0 chunks extracted from {rec['file']}")
            continue
            
        doc_entry = {
            'tag': tag,
            'title': title,
            'folder': rec['folder'],
            'file': rec['file'],
            'full_path': path,
            'sourceType': meta['source_type'],
            'sourceClassification': meta['source_class'],
            'contentNature': meta['content_nature'],
            'speakers': speakers,
            'chunkCount': len(chunks),
            'chunks': chunks
        }
        
        all_staged_docs.append(doc_entry)
        total_chunks += len(chunks)
        file_count += 1
        print(f"  [{rec['folder'][:2]}] {rec['file'][:48]:48} -> {len(chunks):5d} chunks ({len(speakers):2d} speakers)")
        
    except Exception as e:
        print(f"❌ Error processing {rec['file']}: {e}")

print("\n=======================================================")
print("             STAGE 1 PARSING COMPLETE                  ")
print("=======================================================")
print(f"Total files parsed:   {file_count} / {len(file_records)}")
print(f"Total chunks created: {total_chunks:,}")
print(f"Staging to:           {STAGING_DIR}")

staged_index_file = os.path.join(STAGING_DIR, "staged_manifest.json")
with open(staged_index_file, 'w', encoding='utf-8') as f:
    json.dump([{
        'tag': d['tag'],
        'title': d['title'],
        'folder': d['folder'],
        'file': d['file'],
        'full_path': d['full_path'],
        'sourceType': d['sourceType'],
        'sourceClassification': d['sourceClassification'],
        'contentNature': d['contentNature'],
        'speakers': d['speakers'],
        'chunkCount': d['chunkCount']
    } for d in all_staged_docs], f, indent=2)

staged_chunks_file = os.path.join(STAGING_DIR, "all_staged_docs.json")
with open(staged_chunks_file, 'w', encoding='utf-8') as f:
    json.dump(all_staged_docs, f, indent=2)

print(f"Manifest written:     {staged_index_file}")
print(f"Full payload written: {staged_chunks_file}")
print("=======================================================\n")
