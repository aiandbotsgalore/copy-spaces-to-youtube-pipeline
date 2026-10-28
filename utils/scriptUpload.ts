/**
 * Script and Evidence upload parser for Script Studio.
 * Parses user-uploaded script files (Markdown, Plain Text, JSON) into valid Segments,
 * Scenes, and Blocks (narration, pause, music cues). Also handles evidence context documents.
 */
import type { Block, MusicCue, Scene, Segment, ScriptEvidenceDoc } from './scriptTypes';

export interface ParseScriptOptions {
  idGenerator?: (prefix: string) => string;
  defaultTitle?: string;
}

const defaultIdGen = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;

const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const isSafeId = (id: string) => SAFE_ID_RE.test(id);

/**
 * Parses uploaded script text (Markdown, plain text, or JSON) into validated Segments.
 */
export function parseUploadedScript(scriptText: string, opts: ParseScriptOptions = {}): Segment[] {
  const newId = opts.idGenerator || defaultIdGen;
  const trimmed = scriptText.trim();
  if (!trimmed) {
    return [{
      id: newId('seg'),
      title: opts.defaultTitle || 'Main Segment',
      scenes: [{
        id: newId('sc'),
        title: 'Scene 1',
        purpose: 'Narrative scene',
        blocks: [{
          id: newId('b'),
          kind: 'narration',
          text: 'New narration.',
          mode: 'live',
          claims: [],
        }],
      }],
    }];
  }

  // 1. Try parsing as JSON first
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const rawSegs = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed?.segments) ? parsed.segments : null);

      if (rawSegs && rawSegs.length > 0) {
        const idSet = new Set<string>();
        const ensureId = (rawId: unknown, prefix: string) => {
          let id = typeof rawId === 'string' && isSafeId(rawId) ? rawId : newId(prefix);
          while (idSet.has(id)) {
            id = newId(prefix);
          }
          idSet.add(id);
          return id;
        };

        const result: Segment[] = [];
        for (const rawSeg of rawSegs) {
          const segId = ensureId(rawSeg?.id, 'seg');
          const scenes: Scene[] = [];
          const rawScenes = Array.isArray(rawSeg?.scenes) ? rawSeg.scenes : [];
          for (const rawSc of rawScenes) {
            const scId = ensureId(rawSc?.id, 'sc');
            const blocks: Block[] = [];
            const rawBlocks = Array.isArray(rawSc?.blocks) ? rawSc.blocks : [];
            for (const rawB of rawBlocks) {
              const bId = ensureId(rawB?.id, 'b');
              if (rawB?.kind === 'narration') {
                blocks.push({
                  id: bId,
                  kind: 'narration',
                  type: rawB.type || (rawB.readEvidence ? 'QUOTE_READ' : 'NARRATION'),
                  text: String(rawB.text || '').trim() || 'Narration.',
                  mode: rawB.mode === 'polished' ? 'polished' : 'live',
                  claims: Array.isArray(rawB.claims) ? rawB.claims : [],
                  locked: !!rawB.locked,
                  takeUrl: rawB.takeUrl,
                  takeSec: rawB.takeSec,
                  takeTextHash: rawB.takeTextHash,
                  readEvidence: !!rawB.readEvidence,
                  quoteSpeaker: rawB.quoteSpeaker,
                  quoteMeta: rawB.quoteMeta,
                });
              } else if (rawB?.kind === 'pause') {
                blocks.push({
                  id: bId,
                  kind: 'pause',
                  type: rawB.type || 'CUE',
                  sec: Math.min(30, Math.max(0.3, Number(rawB.sec) || 1)),
                  locked: !!rawB.locked,
                  cueType: rawB.cueType || 'silence',
                  label: rawB.label,
                });
              } else if (rawB?.kind === 'music') {
                const cue: MusicCue = ['sting', 'bed_in', 'bed_out', 'transition'].includes(rawB.cue)
                  ? rawB.cue
                  : 'sting';
                blocks.push({
                  id: bId,
                  kind: 'music',
                  type: rawB.type || 'CUE',
                  cue,
                  note: String(rawB.note || '').slice(0, 200),
                  locked: !!rawB.locked,
                  cueType: 'music',
                });
              } else if (rawB?.kind === 'cue') {
                blocks.push({
                  id: bId,
                  kind: 'cue',
                  type: 'CUE',
                  cueType: rawB.cueType || 'sfx',
                  text: String(rawB.text || rawB.note || '').trim(),
                  note: String(rawB.note || rawB.text || '').trim(),
                  sec: Number.isFinite(rawB.sec) ? Number(rawB.sec) : 0,
                  locked: !!rawB.locked,
                });
              } else if (rawB?.kind === 'heading') {
                blocks.push({
                  id: bId,
                  kind: 'heading',
                  type: 'HEADING',
                  text: String(rawB.text || '').trim() || 'Heading',
                  sec: 0,
                  locked: !!rawB.locked,
                });
              } else if (rawB?.kind === 'clip' && (rawB.clipId || rawB.clipNumber)) {
                blocks.push({
                  id: bId,
                  kind: 'clip',
                  type: rawB.type || 'ARCHIVAL_CLIP',
                  clipId: String(rawB.clipId || `clip_${rawB.clipNumber}`),
                  clipNumber: rawB.clipNumber ? String(rawB.clipNumber) : undefined,
                  spaceTitle: rawB.spaceTitle,
                  date: rawB.date,
                  time: rawB.time,
                  speaker: rawB.speaker,
                  keptText: String(rawB.keptText || rawB.quote || ''),
                  inSec: Number(rawB.inSec) || 0,
                  outSec: Number(rawB.outSec) || 1,
                  trimBasis: rawB.trimBasis || 'full',
                  fn: rawB.fn || 'evidence',
                  rationale: String(rawB.rationale || ''),
                  locked: !!rawB.locked,
                });
              }
            }
            if (blocks.length === 0) {
              blocks.push({
                id: ensureId(null, 'b'),
                kind: 'narration',
                text: 'Scene narration.',
                mode: 'live',
                claims: [],
              });
            }
            scenes.push({
              id: scId,
              title: String(rawSc?.title || 'Scene').trim(),
              purpose: String(rawSc?.purpose || 'Narrative scene').trim(),
              blocks,
              suggestedClipIds: Array.isArray(rawSc?.suggestedClipIds) ? rawSc.suggestedClipIds : [],
              momentIds: Array.isArray(rawSc?.momentIds) ? rawSc.momentIds : [],
            });
          }
          if (scenes.length === 0) {
            scenes.push({
              id: ensureId(null, 'sc'),
              title: 'Scene 1',
              purpose: 'Narrative scene',
              blocks: [{
                id: ensureId(null, 'b'),
                kind: 'narration',
                text: 'Narration.',
                mode: 'live',
                claims: [],
              }],
            });
          }
          result.push({
            id: segId,
            title: String(rawSeg?.title || 'Segment').trim(),
            scenes,
          });
        }
        if (result.length > 0) return result;
      }
    } catch {
      // Fall through to plain text / markdown parsing
    }
  }

  // 2. Parse as Markdown or plain text
  const lines = scriptText.split(/\r?\n/);
  const segments: Segment[] = [];
  let curSeg: { id: string; title: string; scenes: Scene[] } | null = null;
  let curScene: { id: string; title: string; purpose: string; blocks: Block[] } | null = null;
  let paragraphBuffer: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;
    const text = paragraphBuffer.join('\n').trim();
    paragraphBuffer = [];
    if (!text) return;

    if (!curSeg) {
      curSeg = { id: newId('seg'), title: opts.defaultTitle || 'Act 1', scenes: [] };
    }
    if (!curScene) {
      curScene = { id: newId('sc'), title: `Scene ${curSeg.scenes.length + 1}`, purpose: 'Narrative scene', blocks: [] };
    }

    curScene.blocks.push({
      id: newId('b'),
      kind: 'narration',
      type: 'NARRATION',
      text,
      mode: 'live',
      claims: [],
    });
  };

  const flushScene = () => {
    flushParagraph();
    if (!curScene) return;
    if (curScene.blocks.length === 0) {
      curScene.blocks.push({
        id: newId('b'),
        kind: 'narration',
        type: 'NARRATION',
        text: 'Narration.',
        mode: 'live',
        claims: [],
      });
    }
    if (!curSeg) {
      curSeg = { id: newId('seg'), title: opts.defaultTitle || 'Act 1', scenes: [] };
    }
    curSeg.scenes.push(curScene);
    curScene = null;
  };

  const flushSegment = () => {
    flushScene();
    if (!curSeg) return;
    if (curSeg.scenes.length === 0) {
      curSeg.scenes.push({
        id: newId('sc'),
        title: 'Scene 1',
        purpose: 'Narrative scene',
        blocks: [{
          id: newId('b'),
          kind: 'narration',
          type: 'NARRATION',
          text: 'Narration.',
          mode: 'live',
          claims: [],
        }],
      });
    }
    segments.push(curSeg);
    curSeg = null;
  };

  const ensureContext = () => {
    if (!curSeg) curSeg = { id: newId('seg'), title: opts.defaultTitle || 'Act 1', scenes: [] };
    if (!curScene) curScene = { id: newId('sc'), title: `Scene ${curSeg.scenes.length + 1}`, purpose: 'Narrative scene', blocks: [] };
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Empty line separates paragraphs
    if (!line) {
      flushParagraph();
      continue;
    }

    // 1. Act / Segment Heading (e.g., "# Act 1: The Hook", "ACT I: THE HOOK", "ACT 1: ...", "PART 1: ...")
    const actMatch =
      /^#\s+(.+)$/.exec(line) ||
      /^((?:ACT|PART|SEGMENT)\s+[IVXLCDM\d]+[:\s-]*.+)$/i.exec(line) ||
      /^((?:ACT|PART|SEGMENT)\s+[IVXLCDM\d]+)$/i.exec(line);
    if (actMatch) {
      flushSegment();
      curSeg = {
        id: newId('seg'),
        title: actMatch[1].trim(),
        scenes: [],
      };
      continue;
    }

    // 2. Scene Container Headings (e.g., "## Scene 1: The Revelation", "SCENE 1", "PROLOGUE", "EPILOGUE", or "### SCENE...")
    const prologueMatch = /^PROLOGUE(?:\s*[:\s-]\s*(.*))?$/i.exec(line);
    const epilogueMatch = /^EPILOGUE(?:\s*[:\s-]\s*(.*))?$/i.exec(line);
    const h3SceneMatch = /^###\s+(?:SCENE|ACT|PROLOGUE|EPILOGUE)\b\s*(.*)$/i.exec(line);
    const sceneMatch =
      prologueMatch ? ['PROLOGUE', prologueMatch[1]?.trim() ? `Prologue: ${prologueMatch[1].trim()}` : 'Prologue'] :
      epilogueMatch ? ['EPILOGUE', epilogueMatch[1]?.trim() ? `Epilogue: ${epilogueMatch[1].trim()}` : 'Epilogue'] :
      h3SceneMatch ? ['H3SCENE', line.replace(/^###\s*/, '').trim()] :
      /^##\s+(.+)$/.exec(line) ||
      /^(SCENE\s+\d+[:\s-]*.+)$/i.exec(line) ||
      /^(SCENE\s+\d+)$/i.exec(line) ||
      /^\[Scene:?\s*(.+)\]$/i.exec(line);

    if (sceneMatch) {
      flushScene();
      if (!curSeg) {
        curSeg = { id: newId('seg'), title: opts.defaultTitle || 'Act 1', scenes: [] };
      }
      const sceneTitle = sceneMatch[1].trim();
      curScene = {
        id: newId('sc'),
        title: sceneTitle,
        purpose: 'Narrative scene',
        blocks: [],
      };
      continue;
    }

    // 2b. Section / Scene In-line Heading (`type: "HEADING"`, lines starting with ###)
    const h3Match = /^###\s+(.+)$/.exec(line);
    if (h3Match) {
      flushParagraph();
      // If curScene has no blocks yet, name the scene after this heading; otherwise add as HEADING block
      if (!curSeg) curSeg = { id: newId('seg'), title: opts.defaultTitle || 'Act 1', scenes: [] };
      if (!curScene) {
        curScene = { id: newId('sc'), title: h3Match[1].trim(), purpose: 'Narrative scene', blocks: [] };
      }
      curScene.blocks.push({
        id: newId('b'),
        kind: 'heading',
        type: 'HEADING',
        text: h3Match[1].trim(),
        sec: 0,
      });
      continue;
    }

    // 3. Archival Tape / Broadcast Clips (`type: "ARCHIVAL_CLIP"`)
    // Match: ^\[CLIP #(?<id>\d+)\s*\|\s*\*(?<space>[^*]+)\*,\s*(?<date>[^,]+),\s*(?<time>[^:]+):\s*(?<speaker>[^-]+)-\s*"(?<quote>[^"]+)"\]
    const clipMatch =
      /^\[CLIP\s*#?(?<id>\d+)\s*\|\s*\*(?<space>[^*]+)\*,\s*(?<date>[^,]+),\s*(?<time>[\d:]+(?:\s*[ap]m)?)\s*:\s*(?<speaker>[^-]+)-\s*"(?<quote>[^"]+)"\]/i.exec(line) ||
      /^\[CLIP\s*#?(?<id>\d+)\s*\|\s*\*(?<space>[^*]+)\*,\s*(?<date>[^,]+),\s*(?<time>[^:]+):\s*(?<speaker>[^-]+)-\s*"(?<quote>[^"]+)"\]/i.exec(line) ||
      /^\[CLIP\s*#?(?<id>\d+)\s*\|\s*(?<space>[^,]+),\s*(?<date>[^,]+),\s*(?<time>[^:]+):\s*(?<speaker>[^-]+)-\s*"(?<quote>[^"]+)"\]/i.exec(line);

    if (clipMatch) {
      flushParagraph();
      ensureContext();
      const g = clipMatch.groups || {};
      const id = g.id || '1';
      const space = (g.space || '').replace(/^\*|\*$/g, '').trim();
      const date = (g.date || '').trim();
      const time = (g.time || '').trim();
      const speaker = (g.speaker || '').trim();
      const quote = (g.quote || '').trim();
      const wordsCount = quote.split(/\s+/).filter(Boolean).length;
      const durSec = Math.max(1.5, Math.round(((wordsCount / 155) * 60) * 10) / 10);
      curScene!.blocks.push({
        id: newId('b'),
        kind: 'clip',
        type: 'ARCHIVAL_CLIP',
        clipId: `clip_${id}`,
        clipNumber: id,
        spaceTitle: space,
        date,
        time,
        speaker,
        keptText: quote,
        inSec: 0,
        outSec: durSec,
        trimBasis: 'full',
        fn: 'evidence',
        rationale: `Archival tape clip from ${space || 'catalog'}`,
        locked: false,
      });
      continue;
    }

    // 4. SFX, Score, & Stage Direction (`type: "CUE"`)
    // Match: ^\[SFX:.*\]$, ^\[THEME.*\]$, ^\[beat\]$, ^\[Silence:.*\]$, or production notes like NARRATOR:, FORMAT:, AUDIO DNA:.
    const sfxMatch = /^\[SFX:?\s*(.*)\]$/i.exec(line);
    if (sfxMatch) {
      flushParagraph();
      ensureContext();
      curScene!.blocks.push({
        id: newId('b'),
        kind: 'cue',
        type: 'CUE',
        cueType: 'sfx',
        text: sfxMatch[1].trim(),
        note: sfxMatch[1].trim(),
        sec: 0,
      });
      continue;
    }

    const themeMatch = /^\[THEME:?\s*(.*)\]$/i.exec(line);
    if (themeMatch) {
      flushParagraph();
      ensureContext();
      curScene!.blocks.push({
        id: newId('b'),
        kind: 'cue',
        type: 'CUE',
        cueType: 'theme',
        text: themeMatch[1].trim(),
        note: themeMatch[1].trim(),
        sec: 0,
      });
      continue;
    }

    const beatMatch = /^\[beat\]$/i.exec(line);
    if (beatMatch) {
      flushParagraph();
      ensureContext();
      curScene!.blocks.push({
        id: newId('b'),
        kind: 'cue',
        type: 'CUE',
        cueType: 'beat',
        text: 'beat',
        note: '[beat]',
        sec: 0.5,
      });
      continue;
    }

    const silenceMatch = /^\[Silence:?\s*(.*)\]$/i.exec(line);
    if (silenceMatch) {
      flushParagraph();
      ensureContext();
      const raw = silenceMatch[1].trim();
      let pauseSec = 1.2;
      const beatsM = /^(\d+(?:\.\d+)?)\s*beats?$/i.exec(raw);
      const secM = /^(\d+(?:\.\d+)?)\s*s(?:ec)?$/i.exec(raw);
      if (beatsM) {
        pauseSec = Math.min(30, Math.max(0.3, parseFloat(beatsM[1]) * 0.6));
      } else if (secM) {
        pauseSec = Math.min(30, Math.max(0.3, parseFloat(secM[1])));
      } else {
        const num = parseFloat(raw);
        if (Number.isFinite(num) && num > 0) pauseSec = Math.min(30, Math.max(0.3, num));
      }
      curScene!.blocks.push({
        id: newId('b'),
        kind: 'cue',
        type: 'CUE',
        cueType: 'silence',
        text: line,
        note: `[Silence: ${pauseSec.toFixed(1)}s]`,
        sec: Math.round(pauseSec * 10) / 10,
      });
      continue;
    }

    // Pause tag: [Pause: 1.5s]
    const pauseMatch = /^\[Pause:\s*(\d+(?:\.\d+)?)\s*s?\]$/i.exec(line);
    if (pauseMatch) {
      flushParagraph();
      ensureContext();
      curScene!.blocks.push({
        id: newId('b'),
        kind: 'pause',
        type: 'CUE',
        cueType: 'silence',
        sec: Math.min(30, Math.max(0.3, parseFloat(pauseMatch[1]))),
      });
      continue;
    }

    // Music cue tag: [Music: sting - dramatic drum]
    const musicMatch = /^\[Music:\s*(sting|bed_in|bed_out|transition)\s*(?:[-–:]\s*(.*))?\]$/i.exec(line);
    if (musicMatch) {
      flushParagraph();
      ensureContext();
      const cue = musicMatch[1].toLowerCase() as MusicCue;
      curScene!.blocks.push({
        id: newId('b'),
        kind: 'music',
        type: 'CUE',
        cueType: 'music',
        cue,
        note: (musicMatch[2] || '').trim(),
      });
      continue;
    }

    // Production notes: NARRATOR:, FORMAT:, AUDIO DNA:
    const prodNoteMatch = /^(?:NARRATOR|FORMAT|AUDIO\s+DNA)\s*:\s*(.*)$/i.exec(line);
    if (prodNoteMatch) {
      flushParagraph();
      ensureContext();
      curScene!.blocks.push({
        id: newId('b'),
        kind: 'cue',
        type: 'CUE',
        cueType: 'production_note',
        text: line,
        note: line,
        sec: 0,
      });
      continue;
    }

    // 5. Quoted Transcripts / Evidence Reads (`type: "QUOTE_READ"`)
    // Match: Lines prefixed with LOGAN (READING DM..., LOGAN (READING GROUP CHAT..., etc.
    const quoteReadMatch = /^LOGAN\s*\(\s*READING\b[^)]*\)\s*:?\s*(.*)$/i.exec(line) || /^LOGAN\s*\(\s*READING\b.*$/i.exec(line);
    if (quoteReadMatch) {
      flushParagraph();
      ensureContext();
      curScene!.blocks.push({
        id: newId('b'),
        kind: 'narration',
        type: 'QUOTE_READ',
        text: line,
        mode: 'live',
        claims: [],
        readEvidence: true,
      });
      continue;
    }

    // 6. Standard Narration (`type: "NARRATION"`)
    paragraphBuffer.push(line);
  }

  flushSegment();

  if (segments.length === 0) {
    segments.push({
      id: newId('seg'),
      title: opts.defaultTitle || 'Main Segment',
      scenes: [{
        id: newId('sc'),
        title: 'Scene 1',
        purpose: 'Narrative scene',
        blocks: [{
          id: newId('b'),
          kind: 'narration',
          text: trimmed,
          mode: 'live',
          claims: [],
        }],
      }],
    });
  }

  return segments;
}

/**
 * Creates a valid ScriptEvidenceDoc from text and name.
 */
export function createEvidenceDoc(
  name: string,
  content: string,
  type: ScriptEvidenceDoc['type'] = 'text',
  idGenerator?: (prefix: string) => string
): ScriptEvidenceDoc {
  const newId = idGenerator || defaultIdGen;
  return {
    id: newId('doc'),
    name: name.trim().slice(0, 100) || 'Evidence Document',
    type,
    content: content.trim(),
    addedAt: Date.now(),
    sizeBytes: new TextEncoder().encode(content).length,
  };
}
