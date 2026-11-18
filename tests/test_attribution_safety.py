"""Safety regressions with synthetic fixtures, not real-audio validation."""
import copy,json,sys,types
from pathlib import Path
from unittest.mock import patch
import pytest
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'spaces/zerogpu-transcriber'),str(ROOT/'scripts')]
import spacepipe_transcribe_core as core
import cloud_transcribe_client as client
import rediarize_transcripts as batch
from resolve_archive_speakers import CandidateOverlay
from clean_transcript_index import clean_episode_segments
from apply_voice_profiles_to_transcripts import analyze_episode_speakers

def test_reversed_chunk_labels():
    ids=['chunk0_A','chunk0_B','chunk1_A','chunk1_B']
    turns=[{'speaker':s,'start':i,'end':i+1} for i,s in enumerate(ids)]
    out,_=core.reconcile_chunk_speakers(turns,dict(zip(ids,[[1,0],[0,1],[0,1],[1,0]])))
    assert out[0]['speaker']==out[3]['speaker']
    assert out[1]['speaker']==out[2]['speaker']
    assert out[0]['speaker']!=out[1]['speaker']
    assert out[0]['raw_speaker']=='chunk0_A'

def test_same_chunk_cannot_merge_and_missing_embedding_stays_distinct():
    turns=[{'speaker':s,'start':i,'end':i+1} for i,s in enumerate(['chunk0_A','chunk0_B','chunk1_A'])]
    out,_=core.reconcile_chunk_speakers(turns,{'chunk0_A':[1,0],'chunk0_B':[1,0]})
    assert len({t['speaker'] for t in out})==3

@pytest.mark.parametrize('emb',[[0,0],[float('nan'),1],[1],None,'bad'])
def test_invalid_profiles(emb):
    p={'Angela':{'embedding':emb,'identity_verified':True,'embedding_model':'speechbrain/spkrec-ecapa-voxceleb'}}
    assert core.match_biometrics_1to1({'Speaker 1':[1,0]},p)=={}

def test_unverified_and_low_margin():
    assert core.match_biometrics_1to1({'Speaker 1':[1,0]},{'Angela':{'embedding':[1,0]}})=={}
    p={n:{'embedding':v,'identity_verified':True,'embedding_model':'speechbrain/spkrec-ecapa-voxceleb'} for n,v in [('Angela',[1,0]),('Lana',[.999,.001])]}
    assert core.match_biometrics_1to1({'Speaker 1':[1,0]},p)=={}

def test_hash_checks_exact_segment_text_even_with_words():
    s=[{'start':.00001,'end':1,'text':' hello ','words':[{'word':'hello','start':0,'end':1}]}]
    for field,value in [('start',.00002),('text','hello')]:
        changed=copy.deepcopy(s);changed[0][field]=value
        assert core.compute_transcript_text_hash(s)!=core.compute_transcript_text_hash(changed)

def test_projection_preserves_human_and_clears_uncovered_names():
    s=[{'start':0,'end':1,'text':'hi','speaker':'Angela'},{'start':2,'end':3,'text':'hello','speaker':'Lana','attribution':{'method':'human_verified'}}]
    out=core.project_diarization_onto_segments(s,[])
    assert out[0]['speaker']=='Unknown' and out[0]['previous_speaker']=='Angela'
    assert out[1]['speaker']=='Lana'
    assert core.compute_transcript_text_hash(s)==core.compute_transcript_text_hash(out)

def test_index_and_context_preserve_brief_speaker():
    s=[{'speaker':'Speaker 1','start':0,'end':100,'text':"I'm Angela"},{'speaker':'Speaker 2','start':100,'end':100.5,'text':'yes'}]
    assert clean_episode_segments(s,'Angela','Angela')==s
    assert analyze_episode_speakers({'segments':s},{'host_handle':'Angela'},{})=={}

def test_unproven_autoapproval_and_human_precedence():
    c={'id':'c','episode_id':'e','raw_speaker':'Speaker 1','resolved_name':'Angela','status':'auto_approved','confidence':.99}
    o=CandidateOverlay({'candidates':[c]})
    assert o.get_effective_speaker('e','Speaker 1')=='Speaker 1'
    c=dict(c,status='human_verified',resolved_name='Lana');o.add_or_update(c)
    o.add_or_update(dict(c,status='auto_approved',resolved_name='Angela'))
    assert o.get_effective_speaker('e','Speaker 1')=='Lana'

@pytest.mark.parametrize('parameter',['token','hf_token'])
def test_gradio_auth_signature(parameter):
    calls=[]
    if parameter=='token':
        def factory(endpoint,token=None):calls.append((endpoint,token));return object()
    else:
        def factory(endpoint,hf_token=None):calls.append((endpoint,hf_token));return object()
    with patch.dict(sys.modules,{'gradio_client':types.SimpleNamespace(Client=factory)}):client.create_gradio_client('space','secret')
    assert calls==[('space','secret')]

@pytest.mark.parametrize('res',[{}, {'status':'success','segments':[],'turns':[]}])
def test_empty_result_never_checkpoints(tmp_path,monkeypatch,res):
    monkeypatch.chdir(tmp_path);p=tmp_path/'in.json';p.write_text(json.dumps({'segments':[{'start':0,'end':1,'text':'hi','speaker':'Angela'}]}))
    with patch('windowed_rediarization.rediarize_in_windows',return_value=res),patch.object(batch,'mark_tag_completed') as mark:
        with pytest.raises(ValueError):batch.process_single_episode('e','url',str(p),{},'repo')
        mark.assert_not_called()

def test_no_fake_dependency_fallback():
    import app
    with patch.dict(sys.modules,{'faster_whisper':None}):
        with pytest.raises(RuntimeError):app._gpu_transcribe_chunk('no.wav')
    with patch.dict(sys.modules,{'pyannote.audio':None}):
        with pytest.raises(RuntimeError):app._gpu_diarize_chunk('no.wav')

@pytest.mark.parametrize('mode,expected',[('failure',1),('quota',75),('success',0)])
def test_batch_exit_status(tmp_path,monkeypatch,mode,expected):
    monkeypatch.chdir(tmp_path)
    p=tmp_path/'summary.json';p.write_text(json.dumps([{'release_tag':'e'}]))
    monkeypatch.setattr(batch,'DEFAULT_SUMMARY_INDEX',str(p))
    monkeypatch.setattr(sys,'argv',['rediarize','--limit','1'])
    effect=RuntimeError('429 quota exceeded') if mode=='quota' else RuntimeError('bad configuration') if mode=='failure' else None
    with patch.object(batch,'process_single_episode',side_effect=effect,return_value=True):
        if expected:
            with pytest.raises(SystemExit) as exc:batch.main()
            assert exc.value.code==expected
        else:batch.main()


def test_forged_hash_and_failed_persistence_never_checkpoint(tmp_path,monkeypatch):
    monkeypatch.chdir(tmp_path)
    segs=[{'start':0,'end':1,'text':'hello','speaker':'Angela'}]
    p=tmp_path/'in.json';p.write_text(json.dumps({'segments':segs}))
    response={'status':'success','segments':[dict(segs[0],text='changed')],
              'turns':[{'start':0,'end':1,'speaker':'Speaker 1'}],
              'text_hash':core.compute_transcript_text_hash(segs)}
    with patch('windowed_rediarization.rediarize_in_windows',return_value=response),patch.object(batch,'mark_tag_completed') as mark:
        with pytest.raises(ValueError):batch.process_single_episode('e','url',str(p),{},'repo')
        mark.assert_not_called()
    response['segments']=segs
    with patch('windowed_rediarization.rediarize_in_windows',return_value=response),patch.object(client,'sync_to_local_transcripts',side_effect=OSError('disk full')),patch.object(batch,'mark_tag_completed') as mark:
        with pytest.raises(OSError):batch.process_single_episode('e','url',str(p),{},'repo')
        mark.assert_not_called()


def test_mixed_segment_does_not_get_single_person_name():
    segs=[{'start':0,'end':2,'text':'two voices','speaker':'Angela'}]
    turns=[{'start':0,'end':1,'speaker':'Speaker 1'},{'start':1,'end':2,'speaker':'Speaker 2'}]
    out=core.project_diarization_onto_segments(segs,turns)
    assert out[0]['speaker']=='Multiple speakers'


def test_persistence_preserves_episode_metadata(tmp_path):
    base=tmp_path/'transcripts';episodes=base/'episodes';episodes.mkdir(parents=True)
    (episodes/'e.json').write_text(json.dumps({'title':'original','custom_metadata':'keep','segments':[]}))
    segments=[{'start':0.00001,'end':2,'text':' hi ','speaker':'Speaker 1','raw_speaker':'Speaker 1'}]
    artifacts=client.sync_to_local_transcripts('e','updated',segments,base_dir=str(base))
    result=json.loads(Path(artifacts['json']).read_text())
    assert result['custom_metadata']=='keep' and result['segments']==segments
    assert not list(episodes.glob('*.tmp'))


def test_release_audio_lookup_import_and_asset_selection():
    import io
    payload={'assets':[{'name':'notes.txt','browser_download_url':'notes'},
                       {'name':'episode.mp3','browser_download_url':'https://example.com/audio.mp3'}]}
    with patch.object(client.urllib.request,'urlopen',return_value=io.BytesIO(json.dumps(payload).encode())):
        assert client.fetch_release_audio_url('owner/repo','tag')=='https://example.com/audio.mp3'


def test_gradio_large_transcript_upload_timeout():
    calls=[]
    def factory(endpoint, token=None, httpx_kwargs=None):
        calls.append(httpx_kwargs)
        return object()
    with patch.dict(sys.modules,{'gradio_client':types.SimpleNamespace(Client=factory)}):
        client.create_gradio_client('space','secret')
    assert calls[0]['timeout']>=120


def test_archive_rescan_never_uses_dialogue_as_identity():
    import rescan_archive_speakers as scanner
    segments=[{'speaker':'Speaker 1','text':"I'm Angela"}]*5
    assert scanner.scan_conversational_heuristics(segments,'Angela') is None


def test_archive_rescan_rejects_unverified_profile(tmp_path,monkeypatch):
    import rescan_archive_speakers as scanner
    p=tmp_path/'profiles.json'
    p.write_text(json.dumps({'profiles':{'Angela':{'embedding':[0.1]*192}}}))
    monkeypatch.setattr(scanner,'PROFILES_PATH',p)
    assert scanner.load_profile_embedding('Angela') is None


def test_archive_rescan_preserves_human_name(tmp_path):
    import rescan_archive_speakers as scanner
    p=tmp_path/'e.json'
    seg={'start':0,'end':1,'text':'hi','speaker':'Lana','raw_speaker':'Speaker 1',
         'attribution':{'method':'human_verified'}}
    p.write_text(json.dumps({'segments':[seg]}))
    assert scanner.update_episode_speaker(p,{},'Speaker 1','Angela')==0
    assert json.loads(p.read_text())['segments'][0]==seg


def test_summary_identity_and_search_labels_survive_repair(tmp_path):
    base=tmp_path/'transcripts';base.mkdir()
    old={'release_tag':'e','release_id':123,'published_at':'2020-01-01','body':'original metadata','speakers':['Angela']}
    (base/'transcripts_summary_index.json').write_text(json.dumps([old]))
    (base/'transcripts_search_index.json').write_text(json.dumps([dict(old,segments=[])]))
    segments=[{'start':0,'end':1,'text':'hello','speaker':'Speaker 1'}]
    client.sync_to_local_transcripts('e','title',segments,base_dir=str(base))
    summary=json.loads((base/'transcripts_summary_index.json').read_text())[0]
    search=json.loads((base/'transcripts_search_index.json').read_text())[0]
    assert summary['release_id']==123 and summary['published_at']=='2020-01-01'
    assert summary['body']=='original metadata' and summary['speakers']==['Speaker 1']
    assert search['segments']==segments and search['speakers']==['Speaker 1']


def test_release_repair_reuses_original_asset_names(tmp_path):
    release=tmp_path/'release';release.mkdir()
    (release/'Original_Title.json').write_text(json.dumps({'segments':[{'text':'hello'}]}))
    (release/'episode.embeddings.json').write_text(json.dumps({'segments':[{'vector':[1,0]}]}))
    artifacts={}
    for ext in ['json','srt','txt']:
        p=tmp_path/('tag.'+ext);p.write_text('repaired');artifacts[ext]=str(p)
    staged=batch.stage_existing_release_artifacts(tmp_path,artifacts)
    assert [Path(p).name for p in staged]==['Original_Title.json','Original_Title.srt','Original_Title.txt']
    assert all(Path(p).read_text()=='repaired' for p in staged)


def test_unreadable_index_is_not_silently_replaced(tmp_path):
    p=tmp_path/'index.json';p.write_text('{broken')
    with pytest.raises(ValueError):
        client.atomic_update_summary_index(str(p),{'release_tag':'e'})
    assert p.read_text()=='{broken'
