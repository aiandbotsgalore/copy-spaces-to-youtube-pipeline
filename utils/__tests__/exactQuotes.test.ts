import { describe, it, expect } from 'vitest';
import { extractQuotesFromPrompt, isExactQuotesPrompt, cleanQuoteText } from '../quoteExtractor';
import { matchAllQuotes } from '../quoteMatcher';
import { buildExactTimeline } from '../exactTimelineBuilder';
import type { MontageClipItem } from '../../contexts/MontageContext';

describe('Exact Quotes Montage Assembler', () => {
  describe('quoteExtractor', () => {
    it('detects exact quotes prompt with command header and curly quotes', () => {
      const prompt = `BUILD A MONTAGE USING THESE QUOTES '“People sat in spaces fantasizing about different ways to murder me.”
“Coming from a man who said he wanted to bash my skull in.”
“You don't get to step on my neck.”“I won't give an inch.”
“I've already filed. I'm not afraid.”
“I'm declaring war.”'`;

      expect(isExactQuotesPrompt(prompt)).toBe(true);
      const quotes = extractQuotesFromPrompt(prompt);
      expect(quotes.length).toBe(6);
      expect(quotes[0].cleanText).toBe('People sat in spaces fantasizing about different ways to murder me.');
      expect(quotes[1].cleanText).toBe('Coming from a man who said he wanted to bash my skull in.');
      expect(quotes[2].cleanText).toBe("You don't get to step on my neck.");
      expect(quotes[3].cleanText).toBe("I won't give an inch.");
      expect(quotes[4].cleanText).toBe("I've already filed. I'm not afraid.");
      expect(quotes[5].cleanText).toBe("I'm declaring war.");
    });

    it('extracts standard double quotes', () => {
      const prompt = `Use these quotes: "First quote here" and "Second quote here"`;
      expect(isExactQuotesPrompt(prompt)).toBe(true);
      const quotes = extractQuotesFromPrompt(prompt);
      expect(quotes.length).toBe(2);
      expect(quotes[0].cleanText).toBe('First quote here');
      expect(quotes[1].cleanText).toBe('Second quote here');
    });

    it('extracts bulleted lists', () => {
      const prompt = `Make a montage with:
- I'm not afraid of you
- We have the evidence
- See you in court`;

      expect(isExactQuotesPrompt(prompt)).toBe(true);
      const quotes = extractQuotesFromPrompt(prompt);
      expect(quotes.length).toBe(3);
      expect(quotes[0].cleanText).toBe("I'm not afraid of you");
      expect(quotes[1].cleanText).toBe('We have the evidence');
      expect(quotes[2].cleanText).toBe('See you in court');
    });

    it('returns false for open-ended creative prompts', () => {
      const prompt = '90 seconds, chronological, from trust-building to public reversal';
      expect(isExactQuotesPrompt(prompt)).toBe(false);
    });
  });

  describe('quoteMatcher & exactTimelineBuilder', () => {
    const mockPool: MontageClipItem[] = [
      {
        id: 'clip_1',
        title: 'Ways to murder me',
        quote: 'People sat in spaces fantasizing about different ways to murder me.',
        speaker: 'Angela Maggard',
        sourceTitle: 'Space 1',
        startSec: 10,
        endSec: 25,
        status: 'EXISTS',
      },
      {
        id: 'clip_2',
        title: 'Bash my skull in',
        quote: 'Coming from a man who literally said he wanted to bash my skull in today.',
        speaker: 'Angela Maggard',
        sourceTitle: 'Space 1',
        startSec: 30,
        endSec: 45,
        status: 'EXISTS',
      },
      {
        id: 'clip_3',
        title: 'Step on neck',
        quote: "You don't get to step on my neck and walk away.",
        speaker: 'Angela Maggard',
        sourceTitle: 'Space 2',
        startSec: 50,
        endSec: 62,
        status: 'EXISTS',
      },
      {
        id: 'clip_precut',
        title: 'Pre-cut catalog clip',
        quote: "I'm declaring war on this entire corrupt operation.",
        speaker: 'Angela Maggard',
        sourceTitle: 'Space 3',
        startSec: 2500, // episode-relative
        endSec: 2560,
        status: 'EXISTS',
      },
    ];

    it('matches quotes to pool items and builds exact timeline in user order', () => {
      const userPrompt = `“People sat in spaces fantasizing about different ways to murder me.”
“Coming from a man who said he wanted to bash my skull in.”
“You don't get to step on my neck.”
“I'm declaring war.”`;

      const extracted = extractQuotesFromPrompt(userPrompt);
      const matches = matchAllQuotes(extracted, mockPool);

      expect(matches.length).toBe(4);
      expect(matches[0].matchedClip?.id).toBe('clip_1');
      expect(matches[1].matchedClip?.id).toBe('clip_2');
      expect(matches[2].matchedClip?.id).toBe('clip_3');
      expect(matches[3].matchedClip?.id).toBe('clip_precut');

      const timeline = buildExactTimeline(matches);
      expect(timeline.matchedCount).toBe(4);
      expect(timeline.clips.length).toBe(4);
      expect(timeline.clips[0].id).toBe('clip_1');
      expect(timeline.clips[1].id).toBe('clip_2');
      expect(timeline.clips[2].id).toBe('clip_3');
      expect(timeline.clips[3].id).toBe('clip_precut');

      // Pre-cut normalization: clip_precut startSec should be normalized from 2500 to 0
      expect(timeline.clips[3].startSec).toBe(0);
      expect(timeline.clips[3].endSec).toBe(60);

      // Final clip gap should always be 0
      expect(timeline.clips[3].gapAfterSec).toBe(0.0);
      // Non-final clips have positive gaps
      expect(timeline.clips[0].gapAfterSec).toBeGreaterThan(0);
    });

    it('handles partially matched quotes gracefully without crashing', () => {
      const userPrompt = `“People sat in spaces fantasizing about different ways to murder me.”
“This quote does not exist anywhere in audio library.”`;

      const extracted = extractQuotesFromPrompt(userPrompt);
      const matches = matchAllQuotes(extracted, mockPool);

      expect(matches[0].matchedClip).not.toBeNull();
      expect(matches[1].matchedClip).toBeNull();
      expect(matches[1].matchSource).toBe('none');

      const timeline = buildExactTimeline(matches);
      expect(timeline.matchedCount).toBe(1);
      expect(timeline.totalCount).toBe(2);
      expect(timeline.clips.length).toBe(1);
    });
  });

  describe('Real Pool Verification', () => {
    it('returns zero false positive matches for un-clipped transcript quotes', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const manPath = path.resolve('public/clips/angela/manifest.json');
      const catPath = path.resolve('public/clips/clips_catalog.json');

      const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
      const cat = JSON.parse(fs.readFileSync(catPath, 'utf8'));

      const pool: MontageClipItem[] = [
        ...man.map((m: any) => ({
          id: 'man_' + m.id,
          title: m.title,
          quote: m.quote,
          startSec: 0,
          endSec: 30,
          audioUrl: m.url || ('clips/angela/' + m.filename),
          status: 'EXISTS' as const,
        })),
        ...cat.map((c: any, idx: number) => ({
          id: 'cat_' + idx,
          title: c.title,
          quote: c.transcript_snippet || c.title,
          startSec: c.start_seconds,
          endSec: c.end_seconds,
          audioUrl: c.download_url || c.file_path,
          status: 'EXISTS' as const,
        })),
      ];

      const prompt = `BUILD A MONTAGE USING THESE QUOTES
“People sat in spaces fantasizing about different ways to murder me.”
“Coming from a man who said he wanted to bash my skull in.”
“You don't get to step on my neck.”
“I won't give an inch.”
“I've already filed. I'm not afraid.”
“I'm declaring war.”`;

      const quotes = extractQuotesFromPrompt(prompt);
      const matches = matchAllQuotes(quotes, pool);

      // Strict matching guarantee: no loose single-word false matches
      expect(matches.every(m => m.matchedClip === null)).toBe(true);
    });

    it('matches pre-cut Angela manifest quotes with 100% precision', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const manPath = path.resolve('public/clips/angela/manifest.json');
      const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
      const pool: MontageClipItem[] = man.map((m: any) => ({
        id: 'man_' + m.id,
        title: m.title,
        quote: m.quote,
        startSec: 0,
        endSec: 30,
        audioUrl: m.url || ('clips/angela/' + m.filename),
        status: 'EXISTS' as const,
      }));

      const realPrompt = `“I already have their address and phone number and personal information”
“I've doxed people. Let's not even sit here and beat around the motherfucking bush”
“I didn't call you a fucking pedophile. I called you a predator”
“I go zero to a 100. There's no doubling back”
“I'm going to bankrupt you. I mean it”`;

      const quotes = extractQuotesFromPrompt(realPrompt);
      const matches = matchAllQuotes(quotes, pool);

      expect(matches.length).toBe(5);
      expect(matches[0].matchedClip?.id).toBe('man_angela_clip_02');
      expect(matches[1].matchedClip?.id).toBe('man_angela_clip_08');
      expect(matches[2].matchedClip?.id).toBe('man_angela_clip_32');
      expect(matches[3].matchedClip?.id).toBe('man_angela_clip_14');
      expect(matches[4].matchedClip?.id).toBe('man_angela_clip_30');
    });
  });
});

