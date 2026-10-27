import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { meterLevel, rms, toDbfs, isSameOriginUrl, VU_FLOOR_DB } from '../vuMeter';
import { COPILOT_MODEL_OPTIONS, DEFAULT_COPILOT_MODEL, normalizeCopilotModel } from '../copilotModels';
import { containsHardExcludePhrase, MONTAGE_EDITORIAL_CONFIG } from '../../config/montageEditorial';
import { HARD_EXCLUDE_PHRASE } from '../../contexts/MontageContext';
import { buildCopilotSystemPrompt } from '../../server/copilotPrompt';
import { isValidModelId } from '../../server/directorMiddleware';

describe('VU meter levels come from samples', () => {
  it('silence reads 0 and a full-scale square wave reads 1', () => {
    expect(meterLevel(new Float32Array(512))).toBe(0);
    const square = Float32Array.from({ length: 512 }, (_, i) => (i % 2 ? 1 : -1));
    expect(rms(square)).toBeCloseTo(1, 6);
    expect(meterLevel(square)).toBe(1);
  });
  it('maps dBFS linearly between the floor and 0', () => {
    // A constant 0.1 amplitude is -20 dBFS, i.e. 40/60 of the way up a -60 dB meter.
    const s = new Float32Array(256).fill(0.1);
    expect(toDbfs(rms(s))).toBeCloseTo(-20, 6);
    expect(meterLevel(s)).toBeCloseTo((-20 - VU_FLOOR_DB) / -VU_FLOOR_DB, 6);
    expect(meterLevel(new Float32Array(256).fill(0.0001))).toBe(0); // -80 dBFS is below the floor
  });
  it('only same-origin sources are analysed', () => {
    expect(isSameOriginUrl('/output/vox/take_1.mp3', 'http://localhost:5000')).toBe(true);
    expect(isSameOriginUrl('https://github.com/o/r/releases/download/t/a.mp3', 'http://localhost:5000')).toBe(false);
  });
  it('VoxStudio no longer uses Math.random for meter levels', () => {
    const src = fs.readFileSync(path.resolve('components/VoxStudio.tsx'), 'utf8');
    expect(src).not.toMatch(/setVu(Left|Right)\([^)]*Math\.random/);
    expect(src).toContain('useAudioLevelMeter');
  });
});

describe('Copilot model dropdown', () => {
  it('labels contain the exact model id that is sent', () => {
    for (const o of COPILOT_MODEL_OPTIONS) expect(o.label).toContain(`(${o.id})`);
    expect(COPILOT_MODEL_OPTIONS.map(o => o.id)).not.toContain('claude-3-5-haiku');
    expect(COPILOT_MODEL_OPTIONS.some(o => /3\.5|Claude 3 /.test(o.label))).toBe(false);
  });
  it('resets a stored model that is no longer offered', () => {
    expect(normalizeCopilotModel('claude-3-5-haiku')).toBe(DEFAULT_COPILOT_MODEL);
    expect(normalizeCopilotModel(null)).toBe(DEFAULT_COPILOT_MODEL);
    expect(normalizeCopilotModel('claude-opus-5')).toBe('claude-opus-5');
  });
});

describe('Copilot system prompt describes only what it receives', () => {
  const prompt = buildCopilotSystemPrompt({
    currentEpisode: { title: 'Ep', releaseTag: 't', segmentsSample: [{ speaker: 'A', text: 'hi', start: 0, end: 1 }] },
  });
  it('no longer claims full archive access or forbids admitting limits', () => {
    expect(prompt).not.toMatch(/UNRESTRICTED ACCESS/i);
    expect(prompt).not.toMatch(/NEVER tell the user you don't have access/i);
    expect(prompt).not.toMatch(/NEVER apologize or say you cannot search/i);
    expect(prompt).not.toMatch(/NEVER claim that a timestamp/i);
  });
  it('tells the model to report empty searches and not invent content', () => {
    expect(prompt).toMatch(/If a search returns no matches, say so plainly/);
    expect(prompt).toMatch(/only the preview turns listed below/);
    expect(prompt).not.toContain('Claude 3.5 Sonnet');
  });
});

describe('Gateway model ids of any family', () => {
  it('accepts claude, gpt and gemini ids and rejects malformed ones', () => {
    for (const id of ['claude-haiku-5.5', 'gpt-6-luna', 'gpt-6.1-sol', 'gemini-2.5-flash']) expect(isValidModelId(id)).toBe(true);
    for (const id of ['', 'bad id', 'x\ny', '-lead']) expect(isValidModelId(id)).toBe(false);
  });
});

describe('Hard-exclude phrase is configuration, behaviour unchanged', () => {
  it('keeps the same phrase and case-insensitive matching', () => {
    expect(HARD_EXCLUDE_PHRASE).toBe('defended him relentlessly');
    expect(MONTAGE_EDITORIAL_CONFIG.hardExcludePhrase).toBe(HARD_EXCLUDE_PHRASE);
    expect(containsHardExcludePhrase('She DEFENDED HIM RELENTLESSLY online')).toBe(true);
    expect(containsHardExcludePhrase('defended her')).toBe(false);
    expect(containsHardExcludePhrase('anything', { hardExcludePhrase: '' })).toBe(false);
  });
});

describe('Config and bundle hygiene', () => {
  const cfg = fs.readFileSync(path.resolve('vite.config.ts'), 'utf8');
  it('does not define GEMINI_API_KEY or API_KEY into the client bundle', () => {
    expect(cfg).not.toMatch(/process\.env\.(GEMINI_)?API_KEY/);
    expect(cfg).not.toMatch(/define:\s*\{[^}]*GEMINI/);
  });
  it('ignores the app\'s own write folders in the dev watcher and gitignores .spacepipe-studio', () => {
    expect(cfg).toContain("'**/.spacepipe-studio/**'");
    expect(cfg).toContain("'**/public/output/**'");
    expect(fs.readFileSync(path.resolve('.gitignore'), 'utf8')).toMatch(/^\.spacepipe-studio\/$/m);
  });
  it('no SAPI / System.Speech fallback remains', () => {
    expect(cfg).not.toMatch(/System\.Speech|SpeechSynthesizer/);
    expect(fs.readFileSync(path.resolve('server/voxSynthesize.ts'), 'utf8')).not.toMatch(/System\.Speech|SpeechSynthesizer|powershell/i);
  });
  it('the Investigative Radar has no Qdrant tab', () => {
    expect(fs.readFileSync(path.resolve('components/InvestigativeRadar.tsx'), 'utf8')).not.toMatch(/qdrant/i);
  });
});
