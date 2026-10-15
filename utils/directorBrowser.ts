/** Browser wiring for the Director runtime (network client, duration probe, audio decode for silence snapping). */
import { callDirector } from './directorClient';
import { probeFileDuration } from './clipProbe';
import { decodeAudioUrl, getSharedAudioContext } from './sequencePlayer';
import { getCachedAudioUrl } from './audioCache';
import type { RuntimeDeps } from './directorRuntime';

export const LAST_PROMPT_KEY = 'spacepipe_director_last_prompt_v1';

export function browserRuntimeDeps(): RuntimeDeps {
  return {
    call: callDirector,
    probe: url => probeFileDuration(url),
    trim: {
      // Segment boundaries are intentionally not wired: clips cannot be reliably mapped to episode transcripts.
      getChannel: async url => {
        try {
          const buf = await decodeAudioUrl(url, getSharedAudioContext(), async u => (await getCachedAudioUrl(u)) || u);
          if (!buf) return null;
          return { data: buf.getChannelData(0), sampleRate: buf.sampleRate };
        } catch {
          return null;
        }
      },
    },
  };
}
