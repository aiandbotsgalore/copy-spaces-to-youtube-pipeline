import os
import json

with open('voice_profiles.json', 'r', encoding='utf-8') as f:
    profiles = json.load(f).get('profiles', {})

rows = []
for name, p in profiles.items():
    emb = p.get('embedding', [])
    emb_status = '<span class="badge badge-green">Active (192-dim)</span>' if len(emb) == 192 else '<span class="badge badge-red">Missing (0-dim)</span>'
    sample = p.get('sample_audio_url', '')
    
    if not sample:
        player = '<span class="badge badge-red">No Audio Assigned</span>'
        src_display = '<span style="color:#64748b;">None</span>'
    else:
        if sample.startswith('http'):
            audio_src = sample
        else:
            audio_src = '/' + sample.lstrip('/')
        player = f'<audio controls preload="metadata" src="{audio_src}"></audio>'
        src_display = f'<span class="file-path">{sample}</span>'
        
    rows.append(f'''  <tr>
    <td style="font-weight:600; font-size:15px; color:#f1f5f9;">{name}</td>
    <td>{emb_status}</td>
    <td>{player}</td>
    <td>{src_display}</td>
  </tr>''')

local_rows = []
for root, dirs, files in sorted(os.walk('speaker_samples')):
    for f in sorted(files):
        if f.lower().endswith(('.wav', '.mp3', '.m4a')):
            rel = os.path.relpath(os.path.join(root, f), 'speaker_samples').replace('\\', '/')
            speaker = rel.split('/')[0]
            web_url = f'/speaker_samples/{rel}'
            local_rows.append(f'''  <tr>
    <td style="font-weight:600; color:#cbd5e1;">{speaker}</td>
    <td class="file-path">{f}</td>
    <td><audio controls preload="none" src="{web_url}"></audio></td>
  </tr>''')

html = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Voice Profiles Audio Audit</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0f172a; color: #f8fafc; padding: 24px; }}
  h1 {{ color: #38bdf8; margin-bottom: 8px; }}
  p.subtitle {{ color: #94a3b8; margin-bottom: 24px; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 16px; background: #1e293b; border-radius: 8px; overflow: hidden; }}
  th, td {{ padding: 12px 16px; text-align: left; border-bottom: 1px solid #334155; }}
  th {{ background: #0f172a; color: #cbd5e1; font-weight: 600; text-transform: uppercase; font-size: 12px; letter-spacing: 0.05em; }}
  tr:hover {{ background: #243248; }}
  .badge {{ display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }}
  .badge-green {{ background: #065f46; color: #34d399; }}
  .badge-red {{ background: #7f1d1d; color: #f87171; }}
  .badge-yellow {{ background: #78350f; color: #fde047; }}
  audio {{ height: 32px; width: 260px; outline: none; }}
  .file-path {{ font-family: monospace; font-size: 12px; color: #94a3b8; word-break: break-all; }}
</style>
</head>
<body>
<h1>Voice Profiles Reference Audio Audit</h1>
<p class="subtitle">Complete audit of every audio clip assigned to voice profiles in <code>voice_profiles.json</code>.</p>
<table>
<thead>
  <tr>
    <th>Speaker</th>
    <th>Biometric Status</th>
    <th>Current Audio Player</th>
    <th>Audio Source File / URL</th>
  </tr>
</thead>
<tbody>
{chr(10).join(rows)}
</tbody>
</table>

<h2 style="margin-top: 40px; color: #38bdf8;">Local Speaker Samples Directory (Alternative Clips on Disk)</h2>
<p class="subtitle">Additional clips available locally in <code>speaker_samples/</code> for review or assignment:</p>
<table>
<thead>
  <tr>
    <th>Speaker Folder</th>
    <th>File Name</th>
    <th>Player</th>
  </tr>
</thead>
<tbody>
{chr(10).join(local_rows)}
</tbody>
</table>
</body>
</html>'''

with open('public/voice_audit.html', 'w', encoding='utf-8') as out:
    out.write(html)
print('Generated public/voice_audit.html successfully')
