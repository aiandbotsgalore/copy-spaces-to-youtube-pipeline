import { describe, it, expect } from 'vitest';
import {
  parseGoogleQuery,
  evaluateTurnMatch,
  highlightTranscriptMatches,
  renderTranscriptMatch,
  hasActiveQuery,
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
});
