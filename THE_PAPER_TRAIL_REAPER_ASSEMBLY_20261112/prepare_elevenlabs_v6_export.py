from pathlib import Path
p=Path(__file__).resolve().parent
src=(p/'export_elevenlabs_v5_audio_items.lua').read_text(encoding='utf-8')
src=src.replace('THE_PAPER_TRAIL_ELEVENLABS_LOGAN_FULL_ASSEMBLY_v5.RPP',
                'THE_PAPER_TRAIL_ELEVENLABS_LOGAN_AUDIBLE_SUNO_SCORE_v6.RPP')
src=src.replace('ELEVENLABS_V5_ALL_AUDIO_MIX_ITEMS.tsv',
                'ELEVENLABS_V6_ALL_AUDIO_MIX_ITEMS.tsv')
src=src.replace('ELEVENLABS_V5_MIX_EXPORT_RESULT.txt',
                'ELEVENLABS_V6_MIX_EXPORT_RESULT.txt')
(p/'export_elevenlabs_v6_audio_items.lua').write_text(src,encoding='utf-8')
print('V6 EXPORT SCRIPT READY')
