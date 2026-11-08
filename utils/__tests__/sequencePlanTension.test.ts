import { describe, it, expect } from 'vitest';
import { sequenceBy4BeatTensionArc, TensionScoredClip } from '../sequencePlan';

describe('4-Beat Narrative Storyline Montage Sequencing', () => {
  it('arranges clips into Hook -> Context -> Climax -> Outro arc', () => {
    const clips: TensionScoredClip[] = [
      { id: 'c1_context', startSec: 0, endSec: 30, tensionScore: 4, quote: 'Here is the background.' },
      { id: 'c2_hook', startSec: 0, endSec: 15, tensionScore: 8.5, quote: 'Boom! Initial shocking quote.' },
      { id: 'c3_outro', startSec: 0, endSec: 10, tensionScore: 6.5, quote: 'And that is the truth.' },
      { id: 'c4_climax', startSec: 0, endSec: 40, tensionScore: 9.8, quote: 'Explosive argument breakdown!' },
      { id: 'c5_build', startSec: 0, endSec: 25, tensionScore: 5.5, quote: 'Things started heating up.' },
    ];

    const sequenced = sequenceBy4BeatTensionArc(clips);

    expect(sequenced).toHaveLength(5);
    // Beat 1: Hook (c2_hook, tension >= 8)
    expect(sequenced[0].id).toBe('c2_hook');
    // Beat 4: Outro should be the last item
    expect(sequenced[sequenced.length - 1].id).toBe('c3_outro');
    // Beat 3: Climax should be right before Outro
    expect(sequenced[sequenced.length - 2].id).toBe('c4_climax');
  });

  it('handles small lists gracefully', () => {
    const single: TensionScoredClip[] = [{ id: 'c1', startSec: 0, endSec: 10, tensionScore: 7 }];
    expect(sequenceBy4BeatTensionArc(single)).toHaveLength(1);
  });
});
