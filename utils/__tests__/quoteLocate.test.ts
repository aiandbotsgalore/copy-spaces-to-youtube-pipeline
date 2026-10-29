/**
 * Phase 1: locating a verified quote in its transcript, and the text check that says whether the
 * quote is the transcript's exact wording. The quote text itself is never changed.
 */
import { describe, it, expect } from 'vitest';
import { LOCATOR_VERSION, locateQuote, textCheck, type LocUtterance } from '../quoteLocate';

const U = (i: number, start: number, speaker: string, text: string): LocUtterance => ({ id: `u${i}`, start, end: start + 5, speaker, text });
const transcript: LocUtterance[] = [
  U(0, 0, 'Speaker 1', 'Welcome back everybody, we are live.'),
  U(1, 10, 'Speaker 1', "The issue that you have with me is that I called you out, um, for what you did."),
  U(2, 20, 'Speaker 1', 'And I stand by it. I should have never been triangulated in the first place.'),
  U(3, 30, 'Speaker 2', 'Okay, that is fair.'),
  U(4, 40, 'Speaker 1', 'Moving on to the next topic of the night here.'),
  U(5, 300, 'Speaker 1', 'Let us just jot that down for the record.'),
  U(6, 900, 'Speaker 1', 'I stand by it. I said what I said.'),
];

describe('locateQuote', () => {
  it('finds a quote inside one utterance', () => {
    const r = locateQuote('I stand by it.', transcript.slice(0, 5));
    expect(r).toMatchObject({ located: true, utteranceIds: ['u2'], matchedPct: 1, speakerLabels: ['Speaker 1'] });
  });

  it('finds a quote spanning two utterances, with its transcript wording', () => {
    const r = locateQuote('for what you did. And I stand by it.', transcript);
    expect(r.utteranceIds).toEqual(['u1', 'u2']);
    expect(r.span).toBe('for what you did. And I stand by it');
    expect(r.segStart).toBe(10);
    expect(r.segEnd).toBe(25);
  });

  it('locates lightly cleaned wording (filler removed) and keeps the transcript span as spoken', () => {
    const r = locateQuote('The issue that you have with me is that I called you out for what you did.', transcript);
    expect(r).toMatchObject({ located: true, utteranceIds: ['u1'], matchedPct: 1 });
    expect(r.span).toBe("The issue that you have with me is that I called you out, um, for what you did");
  });

  it('locates a quote joined from distant passages with an ellipsis', () => {
    const r = locateQuote('I called you out... Let us just jot that down.', transcript);
    expect(r.located).toBe(true);
    expect(r.utteranceIds).toEqual(['u1', 'u2', 'u3', 'u4', 'u5']);
    expect(r.speakerLabels).toEqual(['Speaker 1', 'Speaker 2']);
    // Each passage's own wording, not everything said in between.
    expect(r.span).toBe('I called you out … Let us just jot that down');
  });

  it('prefers the occurrence inside the search window', () => {
    expect(locateQuote('I stand by it.', transcript).utteranceIds).toEqual(['u2']);
    expect(locateQuote('I stand by it.', transcript, { window: [880, 960] }).utteranceIds).toEqual(['u6']);
  });

  it('flags a quote it cannot find, with a reason', () => {
    const r = locateQuote('Nothing like this was ever said by anybody on the show.', transcript);
    expect(r.located).toBe(false);
    expect(r.utteranceIds).toEqual([]);
    expect(r.reason).toMatch(/best match covers \d+% of the quote words/);
  });

  it('flags an empty transcript', () => {
    expect(locateQuote('I stand by it.', [])).toMatchObject({ located: false, reason: 'The transcript has no utterances.' });
  });
});

describe('textCheck', () => {
  it('is exact when the quote is a contiguous excerpt of the located utterances', () => {
    const loc = locateQuote('for what you did. And I stand by it.', transcript);
    expect(textCheck('for what you did. And I stand by it.', loc, transcript, 'h1', 7)).toEqual({ status: 'exact', checkedAt: 7, transcriptHash: 'h1', matchedPct: 1, locator: LOCATOR_VERSION });
  });

  it('differs when the wording was cleaned, and records the transcript wording', () => {
    const q = 'The issue that you have with me is that I called you out for what you did.';
    const c = textCheck(q, locateQuote(q, transcript), transcript, 'h1', 7);
    expect(c).toMatchObject({ status: 'differs', transcriptSpan: "The issue that you have with me is that I called you out, um, for what you did", matchedPct: 1 });
    expect(c.note).toMatch(/wording differs/);
  });

  it('differs for an ellipsis join and says how many passages', () => {
    const q = 'I called you out... Let us just jot that down.';
    expect(textCheck(q, locateQuote(q, transcript), transcript, 'h1', 7).note).toMatch(/joined from 2 transcript passages/);
  });

  it('is unlocated with the reason when the quote was not found', () => {
    const q = 'Nothing like this was ever said by anybody on the show.';
    expect(textCheck(q, locateQuote(q, transcript), transcript, 'h1', 7)).toMatchObject({ status: 'unlocated', note: expect.stringMatching(/best match/) });
  });
});
