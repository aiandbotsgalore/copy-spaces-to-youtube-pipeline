import { describe, it, expect } from 'vitest';
import {
  parseGoogleQuery,
  evaluateTurnMatch,
  highlightTranscriptMatches,
  renderTranscriptMatch,
  hasActiveQuery,
  extractSpeakerPrefix,
  normalizeSpeakerName,
  isNormalizedSpeakerMatch,
  partitionTextWithFocusSpans,
  renderTranscriptWithContextFocus,
} from '../transcriptSearch';

describe('Google Search Query Parser & Turn Matcher', () => {
  describe('parseGoogleQuery', () => {
    it('parses empty query', () => {
      const ast = parseGoogleQuery('');
      expect(ast.exactPhrases).toEqual([]);
      expect(ast.mustTerms).toEqual([]);
      expect(ast.excludedTerms).toEqual([]);
      expect(ast.excludedPhrases).toEqual([]);
      expect(ast.orGroups).toEqual([]);
      expect(hasActiveQuery(ast)).toBe(false);
    });

    it('parses exact phrase in quotes', () => {
      const ast = parseGoogleQuery('"murder me"');
      expect(ast.exactPhrases).toEqual(['murder me']);
      expect(ast.mustTerms).toEqual([]);
      expect(ast.excludedTerms).toEqual([]);
      expect(ast.excludedPhrases).toEqual([]);
      expect(hasActiveQuery(ast)).toBe(true);
    });

    it('parses implicit AND multi-word terms', () => {
      const ast = parseGoogleQuery('murder suicide');
      expect(ast.mustTerms).toEqual(['murder', 'suicide']);
      expect(ast.exactPhrases).toEqual([]);
      expect(hasActiveQuery(ast)).toBe(true);
    });

    it('parses excluded terms with hyphen', () => {
      const ast = parseGoogleQuery('"murder me" -sav -police');
      expect(ast.exactPhrases).toEqual(['murder me']);
      expect(ast.excludedTerms).toEqual(['sav', 'police']);
      expect(ast.mustTerms).toEqual([]);
    });

    it('parses excluded quoted phrases', () => {
      const ast = parseGoogleQuery('truth -"fake news"');
      expect(ast.mustTerms).toEqual(['truth']);
      expect(ast.excludedPhrases).toEqual(['fake news']);
    });

    it('parses explicit OR operator', () => {
      const ast = parseGoogleQuery('murder OR suicide');
      expect(ast.orGroups).toEqual([['murder', 'suicide']]);
    });

    it('parses pipe | as OR operator', () => {
      const ast = parseGoogleQuery('murder | suicide');
      expect(ast.orGroups).toEqual([['murder', 'suicide']]);
    });
  });

  describe('Verification Checklist: evaluateTurnMatch', () => {
    it('1. Quoted Search: matches exact contiguous phrase and rejects partial/scattered', () => {
      const ast = parseGoogleQuery('"murder me"');
      expect(evaluateTurnMatch('She said you want to murder me tonight', ast)).toBe(true);
      expect(evaluateTurnMatch('You want to murder, me and my friends', ast)).toBe(true);
      expect(evaluateTurnMatch('You want to murder—me right here', ast)).toBe(true);

      // Rejects non-contiguous occurrences
      expect(evaluateTurnMatch('He committed murder and looked at me', ast)).toBe(false);

      // Rejects partial word "murdered"
      expect(evaluateTurnMatch('She was murdered me', ast)).toBe(false);

      // Rejects standalone words
      expect(evaluateTurnMatch('This was a murder investigation', ast)).toBe(false);
      expect(evaluateTurnMatch('Look at me', ast)).toBe(false);
    });

    it('2. Implicit AND Search: matches turns containing all terms, rejects missing terms', () => {
      const ast = parseGoogleQuery('murder me');
      // Matches both words even if separated
      expect(evaluateTurnMatch('He committed murder and then looked at me', ast)).toBe(true);
      expect(evaluateTurnMatch('Murder me right now', ast)).toBe(true);

      // Rejects turns missing one term
      expect(evaluateTurnMatch('He committed murder', ast)).toBe(false);
      expect(evaluateTurnMatch('Look at me', ast)).toBe(false);

      // Word boundary: rejects "murdered me"
      expect(evaluateTurnMatch('He murdered me', ast)).toBe(false);
    });

    it('3. Word Boundary Check: standalone "me" does not match inside longer words', () => {
      const ast = parseGoogleQuery('me');
      expect(evaluateTurnMatch('look at me', ast)).toBe(true);
      expect(evaluateTurnMatch('tell me, please', ast)).toBe(true);
      expect(evaluateTurnMatch('me!', ast)).toBe(true);

      // Rejects substring occurrences
      expect(evaluateTurnMatch('someone is outside', ast)).toBe(false);
      expect(evaluateTurnMatch('extreme weather', ast)).toBe(false);
      expect(evaluateTurnMatch('read the messages', ast)).toBe(false);
      expect(evaluateTurnMatch('it was smeared on the wall', ast)).toBe(false);
      expect(evaluateTurnMatch('her name is Angela', ast)).toBe(false);
      expect(evaluateTurnMatch('what do you mean', ast)).toBe(false);
      expect(evaluateTurnMatch('at all times', ast)).toBe(false);
    });

    it('4. Negation Check: excludes turns where term is present in text or speaker', () => {
      const ast = parseGoogleQuery('"murder me" -sav');
      expect(evaluateTurnMatch('Angela: he wants to murder me', ast)).toBe(true);
      // Excluded when Sav is speaking
      expect(evaluateTurnMatch('Sav: he wants to murder me', ast)).toBe(false);
      // Excluded when Sav is mentioned in text
      expect(evaluateTurnMatch('Angela: he wants to murder me and Sav', ast)).toBe(false);
    });

    it('5. OR Group: matches if either branch is present', () => {
      const ast = parseGoogleQuery('murder OR suicide');
      expect(evaluateTurnMatch('He investigated the murder case', ast)).toBe(true);
      expect(evaluateTurnMatch('He called it a suicide', ast)).toBe(true);
      expect(evaluateTurnMatch('He called it a robbery', ast)).toBe(false);
    });
  });

  describe('Highlighter: highlightTranscriptMatches', () => {
    it('highlights exact word "me" without touching substring collisions', () => {
      const ast = parseGoogleQuery('me');
      const text = 'someone told me to send extreme messages to her name';
      const result = highlightTranscriptMatches(text, ast);

      expect(result).toBe(
        'someone told <mark class="bg-amber-400 text-black font-semibold rounded px-0.5">me</mark> to send extreme messages to her name'
      );
      expect(result).not.toContain('so<mark');
      expect(result).not.toContain('extre<mark');
      expect(result).not.toContain('<mark>me</mark>ssages');
      expect(result).not.toContain('na<mark');
    });

    it('highlights exact phrase "murder me"', () => {
      const ast = parseGoogleQuery('"murder me"');
      const text = 'He was going to murder me and everyone knew it';
      const result = highlightTranscriptMatches(text, ast);

      expect(result).toBe(
        'He was going to <mark class="bg-amber-400 text-black font-semibold rounded px-0.5">murder me</mark> and everyone knew it'
      );
    });

    it('does not highlight excluded terms', () => {
      const ast = parseGoogleQuery('"murder me" -sav');
      const text = 'He wants to murder me';
      const result = highlightTranscriptMatches(text, ast);

      expect(result).toContain('<mark class="bg-amber-400 text-black font-semibold rounded px-0.5">murder me</mark>');
      expect(result).not.toContain('sav');
    });
  });

  describe('React Highlighter: renderTranscriptMatch', () => {
    it('returns array of strings and mark elements', () => {
      const ast = parseGoogleQuery('me');
      const text = 'someone told me to extreme messages';
      const rendered = renderTranscriptMatch(text, ast) as any[];

      expect(Array.isArray(rendered)).toBe(true);
      expect(rendered[0]).toBe('someone told ');
      expect(rendered[1].type).toBe('mark');
      expect(rendered[1].props.children).toBe('me');
      expect(rendered[1].props.className).toContain('bg-amber-400');
      expect(rendered[2]).toBe(' to extreme messages');
    });

    it('returns original string when query is empty', () => {
      expect(renderTranscriptMatch('Hello world', '')).toBe('Hello world');
    });
  });

  describe('extractSpeakerPrefix', () => {
    it('extracts speaker:Name prefix', () => {
      const res = extractSpeakerPrefix('speaker:Angela why she left');
      expect(res).toEqual({ speaker: 'Angela', query: 'why she left' });
    });

    it('extracts from:Name prefix', () => {
      const res = extractSpeakerPrefix('from:Logan legal action');
      expect(res).toEqual({ speaker: 'Logan', query: 'legal action' });
    });

    it('supports quoted speaker names', () => {
      const res1 = extractSpeakerPrefix('speaker:"Eric Hecker" south pole station');
      expect(res1).toEqual({ speaker: 'Eric Hecker', query: 'south pole station' });

      const res2 = extractSpeakerPrefix("from:'David Grusch' uap crash recovery");
      expect(res2).toEqual({ speaker: 'David Grusch', query: 'uap crash recovery' });
    });

    it('handles query with only speaker prefix and no search terms', () => {
      const res = extractSpeakerPrefix('speaker:Angela');
      expect(res).toEqual({ speaker: 'Angela', query: '' });
    });

    it('returns plain query when no speaker prefix is present', () => {
      const res = extractSpeakerPrefix('government concealing recovered materials');
      expect(res).toEqual({ query: 'government concealing recovered materials' });
    });

    it('handles empty or whitespace strings', () => {
      expect(extractSpeakerPrefix('')).toEqual({ query: '' });
      expect(extractSpeakerPrefix('   ')).toEqual({ query: '' });
    });
  });

  describe('normalizeSpeakerName & isNormalizedSpeakerMatch', () => {
    it('Dan matches Dan, but not Danny', () => {
      expect(isNormalizedSpeakerMatch('Dan', 'Dan')).toBe(true);
      expect(isNormalizedSpeakerMatch('dan', 'Dan')).toBe(true);
      expect(isNormalizedSpeakerMatch('Dan', 'Danny')).toBe(false);
      expect(isNormalizedSpeakerMatch('Danny', 'Dan')).toBe(false);
    });

    it('Logan matches Logan, but not Logan Smith unless exact name requested', () => {
      expect(isNormalizedSpeakerMatch('Logan', 'Logan')).toBe(true);
      expect(isNormalizedSpeakerMatch('Logan', 'Logan Smith')).toBe(false);
      expect(isNormalizedSpeakerMatch('Logan Smith', 'Logan')).toBe(false);
      expect(isNormalizedSpeakerMatch('Logan Smith', 'Logan Smith')).toBe(true);
      expect(isNormalizedSpeakerMatch('logan smith', 'Logan Smith')).toBe(true);
    });

    it('matching is case-insensitive', () => {
      expect(isNormalizedSpeakerMatch('angela', 'Angela')).toBe(true);
      expect(isNormalizedSpeakerMatch('ANGELA', 'angela')).toBe(true);
      expect(isNormalizedSpeakerMatch('david grusch', 'David Grusch')).toBe(true);
    });

    it('leading and trailing whitespace does not break matching', () => {
      expect(isNormalizedSpeakerMatch('  Dan  ', 'Dan')).toBe(true);
      expect(isNormalizedSpeakerMatch('Logan', '  Logan ')).toBe(true);
      expect(isNormalizedSpeakerMatch('\tAngela\n', 'Angela')).toBe(true);
    });

    it('quoted multiword names match correctly when parsed', () => {
      const parsed1 = extractSpeakerPrefix('speaker:"Eric Hecker" south pole');
      expect(parsed1.speaker).toBe('Eric Hecker');
      expect(isNormalizedSpeakerMatch(parsed1.speaker, 'Eric Hecker')).toBe(true);
      expect(isNormalizedSpeakerMatch(parsed1.speaker, 'eric hecker')).toBe(true);
      expect(isNormalizedSpeakerMatch(parsed1.speaker, 'Eric')).toBe(false);

      const parsed2 = extractSpeakerPrefix("from:'David Grusch' testimony");
      expect(parsed2.speaker).toBe('David Grusch');
      expect(isNormalizedSpeakerMatch(parsed2.speaker, 'David Grusch')).toBe(true);
      expect(isNormalizedSpeakerMatch(parsed2.speaker, 'Grusch')).toBe(false);
    });

    it('generic diarization labels remain distinct', () => {
      expect(isNormalizedSpeakerMatch('Speaker 1', 'SPEAKER_01')).toBe(false);
      expect(isNormalizedSpeakerMatch('Speaker 1', 'Speaker 2')).toBe(false);
      expect(isNormalizedSpeakerMatch('Speaker 1', 'speaker 1')).toBe(true);
      expect(isNormalizedSpeakerMatch('SPEAKER_01', 'speaker_01')).toBe(true);
    });

    it('returns false for falsy or empty inputs', () => {
      expect(isNormalizedSpeakerMatch('', 'Dan')).toBe(false);
      expect(isNormalizedSpeakerMatch('Dan', '')).toBe(false);
      expect(isNormalizedSpeakerMatch(null, 'Dan')).toBe(false);
      expect(isNormalizedSpeakerMatch('Dan', undefined)).toBe(false);
      expect(isNormalizedSpeakerMatch('   ', 'Dan')).toBe(false);
    });
  });

  describe('Context Focus Inline Presentation & Span Validation', () => {
    const sampleText = 'We have confirmed recovered materials from anomalous vehicles in government custody.';

    it('correctly highlights a valid character range in its original position', () => {
      // "recovered materials" is at index 18 to 37
      const start = sampleText.indexOf('recovered materials');
      const end = start + 'recovered materials'.length;
      const spans = [{ start, end, score: 0.942 }];
      const segments = partitionTextWithFocusSpans(sampleText, spans);

      expect(segments).toHaveLength(3);
      expect(segments[0]).toEqual({ text: 'We have confirmed ', isFocus: false });
      expect(segments[1]).toEqual({ text: 'recovered materials', isFocus: true, score: 0.942 });
      expect(segments[2]).toEqual({ text: ' from anomalous vehicles in government custody.', isFocus: false });

      // Exact concatenation matches original text
      expect(segments.map(s => s.text).join('')).toBe(sampleText);
    });

    it('preserves text before and after the highlighted range without truncation or modification', () => {
      const spans = [{ start: 8, end: 17 }]; // "confirmed"
      const segments = partitionTextWithFocusSpans(sampleText, spans);

      expect(segments[0].text).toBe('We have ');
      expect(segments[0].isFocus).toBe(false);
      expect(segments[1].text).toBe('confirmed');
      expect(segments[1].isFocus).toBe(true);
      expect(segments[2].text).toBe(' recovered materials from anomalous vehicles in government custody.');
      expect(segments[2].isFocus).toBe(false);
      expect(segments.map(s => s.text).join('')).toBe(sampleText);
    });

    it('safely rejects invalid negative offsets without crashing or truncating', () => {
      const invalidSpans = [{ start: -10, end: 15 }];
      const segments = partitionTextWithFocusSpans(sampleText, invalidSpans);

      expect(segments).toHaveLength(1);
      expect(segments[0]).toEqual({ text: sampleText, isFocus: false });
      expect(segments.map(s => s.text).join('')).toBe(sampleText);
    });

    it('safely rejects end offsets beyond text length without crashing or modifying text', () => {
      const invalidSpans = [{ start: 10, end: sampleText.length + 50 }];
      const segments = partitionTextWithFocusSpans(sampleText, invalidSpans);

      expect(segments).toHaveLength(1);
      expect(segments[0]).toEqual({ text: sampleText, isFocus: false });
      expect(segments.map(s => s.text).join('')).toBe(sampleText);
    });

    it('safely handles non-finite numbers and inverted bounds', () => {
      expect(partitionTextWithFocusSpans(sampleText, [{ start: NaN, end: 10 }])).toEqual([
        { text: sampleText, isFocus: false },
      ]);
      expect(partitionTextWithFocusSpans(sampleText, [{ start: 10, end: Infinity }])).toEqual([
        { text: sampleText, isFocus: false },
      ]);
      expect(partitionTextWithFocusSpans(sampleText, [{ start: 20, end: 10 }])).toEqual([
        { text: sampleText, isFocus: false },
      ]);
      expect(partitionTextWithFocusSpans(sampleText, [{ start: 15, end: 15 }])).toEqual([
        { text: sampleText, isFocus: false },
      ]);
    });

    it('handles empty or missing spans gracefully', () => {
      expect(partitionTextWithFocusSpans(sampleText, null)).toEqual([{ text: sampleText, isFocus: false }]);
      expect(partitionTextWithFocusSpans(sampleText, undefined)).toEqual([{ text: sampleText, isFocus: false }]);
      expect(partitionTextWithFocusSpans(sampleText, [])).toEqual([{ text: sampleText, isFocus: false }]);
      expect(partitionTextWithFocusSpans('', [{ start: 0, end: 5 }])).toEqual([]);
    });

    it('handles multiple non-overlapping spans in order', () => {
      // Highlight "confirmed" (8..17) and "vehicles" (53..61)
      const spans = [
        { start: 8, end: 17, score: 0.8 },
        { start: 53, end: 61, score: 0.9 },
      ];
      const segments = partitionTextWithFocusSpans(sampleText, spans);

      expect(segments).toHaveLength(5);
      expect(segments[0]).toEqual({ text: 'We have ', isFocus: false });
      expect(segments[1]).toEqual({ text: 'confirmed', isFocus: true, score: 0.8 });
      expect(segments[2]).toEqual({ text: ' recovered materials from anomalous ', isFocus: false });
      expect(segments[3]).toEqual({ text: 'vehicles', isFocus: true, score: 0.9 });
      expect(segments[4]).toEqual({ text: ' in government custody.', isFocus: false });

      expect(segments.map(s => s.text).join('')).toBe(sampleText);
    });

    it('sorts and merges overlapping or incorrectly ordered spans without duplicating text', () => {
      // Out of order and overlapping: [50..62], [10..25], [19..38]
      const messySpans = [
        { start: 50, end: 62 },
        { start: 10, end: 25 },
        { start: 19, end: 38 },
      ];
      const segments = partitionTextWithFocusSpans(sampleText, messySpans);

      // [10..25] and [19..38] overlap, so they merge to [10..38]
      expect(segments).toHaveLength(5);
      expect(segments[0]).toEqual({ text: sampleText.slice(0, 10), isFocus: false });
      expect(segments[1]).toEqual({ text: sampleText.slice(10, 38), isFocus: true, score: undefined });
      expect(segments[2]).toEqual({ text: sampleText.slice(38, 50), isFocus: false });
      expect(segments[3]).toEqual({ text: sampleText.slice(50, 62), isFocus: true, score: undefined });
      expect(segments[4]).toEqual({ text: sampleText.slice(62), isFocus: false });

      // Guarantee exact character preservation
      expect(segments.map(s => s.text).join('')).toBe(sampleText);
    });

    it('renderTranscriptWithContextFocus returns mark elements for focused passages', () => {
      const start = sampleText.indexOf('recovered materials');
      const end = start + 'recovered materials'.length;
      const spans = [{ start, end, score: 0.95 }];
      const rendered = renderTranscriptWithContextFocus(sampleText, spans) as any[];

      expect(Array.isArray(rendered)).toBe(true);
      expect(rendered[0].props.children).toBe('We have confirmed ');
      expect(rendered[1].type).toBe('mark');
      expect(rendered[1].props.children).toBe('recovered materials');
      expect(rendered[1].props.className).toContain('bg-amber-500/20');
      expect(rendered[2].props.children).toBe(' from anomalous vehicles in government custody.');
    });

    it('renderTranscriptWithContextFocus falls back safely when spans are invalid', () => {
      const invalid = [{ start: -100, end: 999 }];
      const rendered = renderTranscriptWithContextFocus(sampleText, invalid);
      expect(rendered).toBe(sampleText);
    });
  });
});
