import json
import sys
from pathlib import Path
from unittest.mock import patch
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import windowed_rediarization as windows
import cloud_transcribe_client as client

def response(start, duration, vector=(1,0)):
    return {'status':'success','start_seconds':start,'duration_seconds':duration,
            'audio_seconds':duration,'turns':[{'start':0,'end':duration,'speaker':'SPEAKER_00'}],
            'embeddings':{'SPEAKER_00':list(vector)},
            'embedding_model':'speechbrain/spkrec-ecapa-voxceleb'}

def test_resume_does_not_repeat_completed_window(tmp_path):
    segments=[{'start':0,'end':2,'text':'first','speaker':'Angela'},
              {'start':2,'end':4,'text':'second','speaker':'Angela'}]
    class Fake:
        calls=[]
        fail=True
        def predict(self, **kwargs):
            start=kwargs['start_seconds']; self.calls.append(start)
            if start==2 and self.fail: raise RuntimeError('429 quota exceeded')
            return response(start,kwargs['duration_seconds'],(1,0) if start==0 else (0,1))
    fake=Fake()
    with patch.object(client,'create_gradio_client',return_value=fake):
        with pytest.raises(RuntimeError):
            windows.rediarize_in_windows('url',segments,cache_dir=tmp_path,window_seconds=2)
        assert len(list(tmp_path.rglob('window_*.json')))==1
        fake.fail=False
        result=windows.rediarize_in_windows('url',segments,cache_dir=tmp_path,window_seconds=2)
    assert fake.calls==[0,2,2]
    assert result['segments'][0]['speaker']!=result['segments'][1]['speaker']
    assert result['matched_speakers']=={}
    assert windows.compute_transcript_text_hash(result['segments'])==windows.compute_transcript_text_hash(segments)

def test_empty_window_is_not_whole_episode_success(tmp_path):
    segments=[{'start':0,'end':1,'text':'speech','speaker':'Angela'}]
    result=response(0,1);result['turns']=[];result['embeddings']={}
    with patch.object(client,'create_gradio_client') as create:
        create.return_value.predict.return_value=result
        with pytest.raises(ValueError,match='No speech turns'):
            windows.rediarize_in_windows('url',segments,cache_dir=tmp_path)

@pytest.mark.parametrize('change',[{'start_seconds':10},{'status':'failed'},
                                  {'turns':[{'start':0,'end':999,'speaker':'A'}]},
                                  {'error':'Expired ZeroGPU proxy token'}])
def test_invalid_window_is_rejected(change):
    data=response(0,2);data.update(change)
    with pytest.raises((ValueError,RuntimeError)):
        windows.validate_window(data,0,2)

def test_window_boundary_preserves_verified_identity(tmp_path):
    segments=[{'start':0,'end':4,'text':'same words','speaker':'Lana',
               'attribution':{'method':'human_verified'}}]
    class Fake:
        def predict(self,**kw):return response(kw['start_seconds'],kw['duration_seconds'])
    with patch.object(client,'create_gradio_client',return_value=Fake()):
        result=windows.rediarize_in_windows('url',segments,cache_dir=tmp_path,window_seconds=2)
    assert result['segments'][0]['speaker']=='Lana'
    assert result['segments'][0]['attribution']['method']=='human_verified'
