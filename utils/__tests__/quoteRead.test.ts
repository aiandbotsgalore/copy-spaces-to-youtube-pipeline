import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { createQuoteLibrary, sharesConsecutiveWords } from '../../server/quoteLibrary';
import { createScriptStore } from '../../server/scriptStore';
import { readPrompt } from '../../server/scriptPrompts';

describe('sharesConsecutiveWords', () => {
  it('detects 8 or more consecutive words matching regardless of casing or punctuation', () => {
    const a = 'This is gonna be like a monologue echo chamber space. Just for the record.';
    const b = 'I said this is gonna be like a monologue echo chamber space anyway.';
    expect(sharesConsecutiveWords(a, b, 8)).toBe(true);
  });

  it('returns false when overlap is less than 8 consecutive words', () => {
    const a = 'one two three four five six seven and some different words here';
    const b = 'completely different start one two three four five six seven finished';
    expect(sharesConsecutiveWords(a, b, 8)).toBe(false);
    expect(sharesConsecutiveWords(a, b, 7)).toBe(true);
  });

  it('handles short strings under minWords when one is contained in the other', () => {
    const a = 'short quote';
    const b = 'this is a short quote here';
    expect(sharesConsecutiveWords(a, b, 8)).toBe(true);
  });
});

describe('readPrompt', () => {
  it('formats the system and user prompt with untrusted data blocks', () => {
    const pr = readPrompt({
      releaseTag: '20260908_test',
      title: 'Test Space',
      lines: '[u0 00:00:05 Alice] Hello world.\n[u1 00:00:10 Bob] How are you?',
      question: 'Why did the partnership dissolve?',
    });
    expect(pr.version).toBe('read-question.v1');
    expect(pr.system).toContain('Question: Why did the partnership dissolve?');
    expect(pr.user).toContain('Recording 20260908_test: Test Space');
    expect(pr.user).toContain('<<<TRANSCRIPT_DATA');
    expect(pr.user).toContain('[u0 00:00:05 Alice] Hello world.');
  });
});

describe('readForQuestion', () => {
  const root = path.resolve(__dirname, '../..');
  const tag = '20260908_1wxWjlrwXokJQ';

  function mockStore() {
    const storage = new Map<string, any>();
    const base = createScriptStore(root);
    return {
      ...base,
      getLibrary: (t: string) => storage.get(`lib:${t}`) ?? null,
      saveLibrary: (lib: any) => { storage.set(`lib:${lib.releaseTag}`, structuredClone(lib)); },
    };
  }

  it('verifies exact quotes, rejects paraphrases with transcript span, dedupes against AQ, and caches reads', async () => {
    const store = mockStore();
    let clock = 1000;
    const qlib = createQuoteLibrary(root, store as any, { now: () => ++clock });

    // Ensure AQ quotes are synced first
    qlib.syncAq();

    let modelCalls = 0;
    const mockModel = async () => {
      modelCalls++;
      return {
        ok: true,
        model: 'mock-analyst:v1',
        json: {
          quotes: [
            // 1. This quote overlaps AQ-0261 in utterance u0 (8+ consecutive words)
            {
              utteranceIds: ['u0'],
              verbatim: "This is gonna be like a monologue echo chamber space. This is just for the record.",
              speaker: 'Logan',
              about: 'Declaration of war',
              type: 'threat_or_plan' as const,
              status: 'allegation' as const,
              why: 'Opens her monologue attacking Logan.',
            },
            // 2. A non-AQ quote later in the transcript that is 100% verbatim
            {
              utteranceIds: ['u8'],
              verbatim: "All right. And now we're getting to the disgusting ones. This is how he talks to his girlfriend.",
              speaker: 'Logan',
              about: 'Introducing screenshots',
              type: 'evidence_claim' as const,
              status: 'allegation' as const,
              why: 'Presents the text exchange exhibits.',
            },
            // 3. A paraphrased quote that FAILS verbatim check ("going to" instead of transcript's actual words)
            {
              utteranceIds: ['u0'],
              verbatim: "This is going to be an echo chamber space for the public record.",
              speaker: 'Angela',
              about: 'Echo chamber',
              type: 'other' as const,
              status: 'opinion' as const,
              why: 'Explaining format.',
            },
          ],
          context: 'Angela speaking solo on a monologue space addressing Logan directly after their fallout.',
        },
      };
    };

    const question = 'What accusations were made in the September 8 space?';

    // First read: model called once
    const res1 = await qlib.readForQuestion(tag, question, mockModel);
    expect(res1.fromCache).toBe(false);
    expect(modelCalls).toBe(1);

    // 100% of stored quotes pass verifyVerbatim
    const libAfter = store.getLibrary(tag);
    expect(libAfter).toBeDefined();
    expect(libAfter.quotes.length).toBeGreaterThan(0);
    for (const q of libAfter.quotes) {
      expect(q.text.status).toBe('exact');
    }

    // Overlap with AQ-0261 was merged into mergedRefs and NOT duplicated in lib.quotes
    expect(res1.mergedRefs).toContain('aq:AQ-0261');
    const duplicateAqInQuotes = libAfter.quotes.find((q: any) => q.verbatim.includes('monologue echo chamber'));
    expect(duplicateAqInQuotes).toBeUndefined();

    // Verbatim non-AQ quote was stored in lib.quotes
    const nonAqQuote = libAfter.quotes.find((q: any) => q.verbatim.includes('disgusting ones'));
    expect(nonAqQuote).toBeDefined();
    expect(nonAqQuote.utteranceIds).toEqual(['u8']);

    // Paraphrased quote went to lib.rejected, with transcript span recorded
    expect(libAfter.rejected.length).toBe(1);
    expect(libAfter.rejected[0].verbatim).toContain('This is going to be an echo chamber');
    expect(libAfter.rejected[0].reason).toContain('transcript');

    // Context note was saved
    expect(libAfter.notes.length).toBe(1);
    expect(libAfter.notes[0].text).toContain('Angela speaking solo');

    // Second read for the same question: hits cache, 0 model calls!
    const res2 = await qlib.readForQuestion(tag, question, mockModel);
    expect(res2.fromCache).toBe(true);
    expect(modelCalls).toBe(1); // STILL 1!
    expect(res2.mergedRefs).toContain('aq:AQ-0261');
  });

  it('creates no duplicates of AQ-0261 to AQ-0268 when reading 20260908_1wxWjlrwXokJQ', async () => {
    const store = mockStore();
    const qlib = createQuoteLibrary(root, store as any);
    qlib.syncAq();

    // Model returns multiple quotes that match AQ-0261, AQ-0263, AQ-0268
    const mockModel = async () => ({
      ok: true,
      model: 'test:v1',
      json: {
        quotes: [
          {
            utteranceIds: ['u0'],
            verbatim: 'This is gonna be like a monologue echo chamber space. This is just for the record.',
            speaker: 'Logan',
            about: 'Monologue',
            type: 'threat_or_plan' as const,
            status: 'allegation' as const,
            why: 'Intro',
          },
          {
            utteranceIds: ['u13'],
            verbatim: "You're a pig. And you're lucky she won't let me share that screenshot where you compared her to a fucking dog. But I have it.",
            speaker: 'Logan',
            about: 'Accusation',
            type: 'accusation' as const,
            status: 'allegation' as const,
            why: 'Attacks Logan',
          },
          {
            utteranceIds: ['u15'],
            verbatim: "I want the truth out there. All of it. To the point where I will sit in the fucking hot seat, let you guys pick me the fuck apart solely for the simple facts that patterns don't lie. People do.",
            speaker: 'Logan',
            about: 'Truth motive',
            type: 'motive' as const,
            status: 'allegation' as const,
            why: 'States intent',
          },
        ],
        context: 'Monologue against Logan',
      },
    });

    const res = await qlib.readForQuestion(tag, 'What was the motive?', mockModel);
    expect(res.fromCache).toBe(false);

    // All three were deduplicated against AQ-0261, AQ-0263, AQ-0268
    expect(res.mergedRefs).toContain('aq:AQ-0261');
    expect(res.mergedRefs).toContain('aq:AQ-0263');
    expect(res.mergedRefs).toContain('aq:AQ-0268');

    // Exactly 0 new quotes were added to lib.quotes for those AQ quotes
    expect(res.newQuotes.length).toBe(0);
    const lib = store.getLibrary(tag);
    expect(lib.quotes.length).toBe(0);
  });
});
