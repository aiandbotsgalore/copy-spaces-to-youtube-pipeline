// tests/test_copilot_max_context.ts
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { buildCopilotSystemPrompt } from '../server/copilotPrompt';
import type { CopilotContextPayload } from '../utils/copilotTypes';

console.log('=== Test: Copilot 4-Layer Producer & Dynamic Token Budgeting ===');

// 1. Verify 4-Layer System Prompt Structure
const mockContext: CopilotContextPayload = {
  activeTab: 'transcripts',
  investigativeVault: {
    curatedPairs: [
      {
        pairing_id: 'PAIR-01',
        title: 'The Definition of Harm',
        curated: true,
        pre_fallout: { date: 'February 17, 2026', episode_tag: 'ep1', quote: 'I never attacked him' },
        post_fallout: { date: 'September 18, 2026', episode_tag: 'ep2', quote: 'He is a predator' },
      }
    ],
    matchedTrajectories: [
      {
        pairing_id: 'PAIR_1234',
        title: 'Wright-Patt Tunnel Claims Reversal',
        speaker: 'Angela',
        topic_anchor: 'wright_patt_claims',
        pre_fallout: { date: '2025-07-16', episode_tag: 'ep_july', quote: 'There are tunnels under the base' },
        post_fallout: { date: '2026-02-18', episode_tag: 'ep_feb', quote: 'I never claimed tunnels' },
      }
    ],
  },
  currentEpisode: {
    releaseTag: 'ep1',
    title: 'Test Episode',
    speakers: ['Logan', 'Speaker 1'],
  }
};

const prompt = buildCopilotSystemPrompt(mockContext);

// Check Layer 1: Ground truth axioms & dossiers
assert(prompt.includes('EDITORIAL GROUND TRUTH AXIOMS'), 'Prompt must include ground truth axioms');
assert(prompt.includes('Logan and Shane organized the May eviction fundraiser'), 'Prompt must protect fundraiser attribution');

// Check Layer 2: Chronological spine
assert(prompt.includes('CHRONOLOGICAL MILESTONE SPINE') || prompt.includes('TIMELINE'), 'Prompt must include timeline spine');

// Check Layer 3: Primary Contradiction & Evidence Vault
assert(prompt.includes('PRIMARY CONTRADICTION & EVIDENCE VAULT'), 'Prompt must include Primary Contradiction Vault');
assert(prompt.includes('PAIR-01: "The Definition of Harm"'), 'Prompt must render curated manuscript pairs');
assert(prompt.includes('PAIR_1234: "Wright-Patt Tunnel Claims Reversal"'), 'Prompt must render matched dynamic trajectories');

// Check Layer 4: Producer actions
assert(prompt.includes('AVAILABLE ACTIONS'), 'Prompt must include available producer actions');
assert(prompt.includes('SEQUENCE_MONTAGE'), 'Prompt must include SEQUENCE_MONTAGE');

// Check Token Budget Safety
const estimatedTokens = Math.ceil(prompt.length / 3.8);
console.log(`Estimated system prompt tokens: ${estimatedTokens}`);
assert(estimatedTokens <= 28_000, `System prompt (${estimatedTokens} tokens) must be <= 28,000 tokens`);

console.log('[✓] Copilot 4-Layer Producer prompt verified successfully!');
