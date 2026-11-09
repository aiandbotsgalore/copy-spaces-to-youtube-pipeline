/**
 * Phase 5.1: deterministic evidence pairing. No speaker-name inference, model calls,
 * text-based quote-ID guessing, or invented transcript provenance.
 */
import type {
  AqLink, Block, EvidenceBoard, EvidenceRef, LibraryQuote, RecordingLibrary,
  ScriptProject, Segment, StudioClip,
} from './scriptTypes';
import { normalizeText } from './directorValidate';

export type ProvenanceStatus = 'verified' | 'unresolved' | 'hash_mismatch' | 'needs_review';

export interface GroundedEvidenceRef {
  releaseTag?: string; segStart?: number; segEnd?: number; speakerRaw?: string;
  speakerName?: string; speakerConfirmed: boolean; verbatim?: string; quoteId?: string;
  sourceDocId?: string; sourceDocExcerpt?: string;
  boardClaimId?: string; supportRefs?: string[]; contradictRefs?: string[];
  provenanceStatus: ProvenanceStatus; statusNote?: string;
}
export interface GroundedTapeBlock {
  blockId: string; sceneId: string; sceneTitle: string;
  segmentId: string; segmentTitle: string; clipId: string;
  quoteId?: string; releaseTag?: string; utteranceIds: string[];
  speakerRaw: string; speakerName?: string; speakerConfirmed: boolean;
  exactTapeText: string; sourceTranscriptHash?: string; projectTranscriptHash?: string;
  audioBoundary?: LibraryQuote['audio']; provenanceStatus: ProvenanceStatus;
  warnings: string[];
}
export interface EvidencePairing {
  narrationBlockId: string; narrationText: string;
  sceneId: string; segmentId: string;
  claims: GroundedEvidenceRef[]; tapeBlock?: GroundedTapeBlock;
  pairingStatus: 'paired' | 'unpaired' | 'needs_review'; pairingNote?: string;
}
export interface PairingOptions {
  project: ScriptProject; segments?: Segment[]; board?: EvidenceBoard | null;
  libraries?: Record<string, RecordingLibrary>;
  clipsById?: Record<string, StudioClip>;
}
export interface PairingResult {
  pairings: EvidencePairing[]; unpairedTapeBlocks: GroundedTapeBlock[]; warnings: string[];
}
type LocatedQuote = {
  ref: string; lib: RecordingLibrary; quote?: LibraryQuote; aq?: AqLink;
};
const canonicalClipId = (ref: string) => 'bq_' + ref.replace(/[^a-zA-Z0-9_-]/g, '_');

/** Exact ID matching only. Similar transcript wording never identifies a quote. */
function findCanonical(
  block: Extract<Block, { kind: 'clip' }>, clip: StudioClip | undefined,
  libraries: Record<string, RecordingLibrary>
): LocatedQuote | undefined {
  const refs = [block.clipId, clip?.quote, block.clipNumber].filter((x): x is string => !!x);
  const matches: LocatedQuote[] = [];
  for (const lib of Object.values(libraries)) {
    if (clip?.releaseTag && clip.releaseTag !== lib.releaseTag) continue;
    for (const q of lib.quotes || []) {
      if (refs.includes(q.id) || refs.includes(canonicalClipId(q.id))) matches.push({ ref: q.id, lib, quote: q });
    }
    for (const a of lib.aqLinks || []) {
      const ref = 'aq:' + a.aqId;
      if (refs.includes(ref) || refs.includes(canonicalClipId(ref))) matches.push({ ref, lib, aq: a });
    }
  }
  const exactClipMatches = matches.filter(m => block.clipId === m.ref || block.clipId === canonicalClipId(m.ref));
  if (exactClipMatches.length === 1) return exactClipMatches[0];
  if (exactClipMatches.length > 1) return undefined;
  return matches.length === 1 ? matches[0] : undefined;
}
function textIsExcerpt(quoteText: string | undefined, actualText: string): boolean {
  if (!quoteText || !actualText) return false;
  const source = normalizeText(quoteText);
  const actual = normalizeText(actualText);
  return !!source && !!actual && source.includes(actual);
}
function quoteProvenance(
  located: LocatedQuote | undefined, project: ScriptProject, actualText?: string
): { status: ProvenanceStatus; note?: string } {
  if (!located) return { status: 'unresolved', note: 'No unique canonical quote reference' };
  const tag = located.lib.releaseTag;
  const projectHash = project.transcriptHashes[tag];
  const libHash = located.lib.transcriptHash;
  const text = located.quote?.text || located.aq?.text;
  if (projectHash && (projectHash !== libHash || (text?.transcriptHash && text.transcriptHash !== projectHash))) {
    return { status: 'hash_mismatch', note: 'Transcript hash mismatch: source differs from project' };
  }
  if (!projectHash || !libHash || !text?.transcriptHash || text.status !== 'exact') {
    return { status: 'needs_review', note: 'Transcript hash or exact-text verification unavailable' };
  }
  const verifiedText = located.quote?.verbatim || located.aq?.text.transcriptSpan;
  if (actualText && !textIsExcerpt(verifiedText, actualText)) {
    return { status: 'needs_review', note: 'Clip/claim wording is not an excerpt of the canonical transcript text' };
  }
  return { status: 'verified' };
}

export function groundTapeBlock(
  block: Extract<Block, { kind: 'clip' }>,
  scene: { id: string; title: string },
  segment: { id: string; title: string }, opts: PairingOptions
): GroundedTapeBlock {
  const clip = opts.clipsById?.[block.clipId] ||
    opts.project.clips.find(c => c.clipId === block.clipId);
  const exactTapeText = block.keptText || clip?.text || '';
  const located = findCanonical(block, clip, opts.libraries || {});
  const releaseTag = located?.lib.releaseTag || clip?.releaseTag;
  const prov = quoteProvenance(located, opts.project, exactTapeText);
  const rawLabel = located?.quote?.speakerLabel || located?.aq?.speakerLabels[0] ||
    clip?.speaker || block.speaker || 'Unknown';
  const speakerName = (located?.quote?.speakerConfirmed && located.quote.speakerName) ||
    (located?.aq?.speakerConfirmed && located.aq.speakerName) ||
    opts.project.speakerNames[releaseTag + '::' + rawLabel] ||
    opts.project.speakerNames[rawLabel] || undefined;
  const confirmed = !!((located?.quote?.speakerConfirmed && located.quote.speakerName) ||
    (located?.aq?.speakerConfirmed && located.aq.speakerName));
  const warnings = prov.note ? [prov.status === 'unresolved' ? 'Unresolved tape clip: ' + prov.note : prov.note] : [];
  const tape = {
    blockId: block.id, sceneId: scene.id, sceneTitle: scene.title,
    segmentId: segment.id, segmentTitle: segment.title, clipId: block.clipId,
    quoteId: located?.ref, releaseTag, utteranceIds: located?.quote?.utteranceIds ||
      located?.aq?.utteranceIds || [], speakerRaw: rawLabel,
    speakerName, speakerConfirmed: confirmed, exactTapeText,
    sourceTranscriptHash: located?.lib.transcriptHash,
    projectTranscriptHash: releaseTag ? opts.project.transcriptHashes[releaseTag] : undefined,
    audioBoundary: located?.quote?.audio || located?.aq?.audio,
    provenanceStatus: prov.status, warnings,
  };
  return tape;
}

/** A document source or BoardClaim is not itself a verified transcript citation. */
export function groundClaims(claims: EvidenceRef[], opts: PairingOptions): GroundedEvidenceRef[] {
  return claims.map(c => {
    const boardClaim = opts.board?.claims.find(x => x.id === c.quoteId);
    if (boardClaim) {
      return {
        boardClaimId: boardClaim.id, quoteId: c.quoteId,
        supportRefs: [...boardClaim.supportRefs], contradictRefs: [...boardClaim.contradictRefs],
        verbatim: c.verbatim, speakerConfirmed: false, provenanceStatus: 'needs_review' as const,
        statusNote: 'Board claim; source support requires editorial evaluation',
      };
    }
    const doc = opts.board?.sources.find(x => x.id === c.quoteId);
    if (doc) {
      const sourceDocument = opts.project.evidenceDocs?.find(x => x.id === doc.docId);
      const excerptAvailable = !!sourceDocument?.content.includes(doc.excerpt);
      return {
        quoteId: c.quoteId, sourceDocId: doc.docId, sourceDocExcerpt: excerptAvailable ? doc.excerpt : undefined,
        verbatim: c.verbatim, speakerConfirmed: false, provenanceStatus: 'needs_review' as const,
        statusNote: excerptAvailable ? 'Exact document excerpt located; claim not semantically verified'
          : 'Document source excerpt not available in loaded project documents',
      };
    }
    const located = c.quoteId
      ? Object.values(opts.libraries || {}).flatMap(lib => [
          ...lib.quotes.filter(q => q.id === c.quoteId).map(quote => ({ ref: quote.id, lib, quote })),
          ...lib.aqLinks.filter(q => 'aq:' + q.aqId === c.quoteId)
            .map(aq => ({ ref: 'aq:' + aq.aqId, lib, aq })),
        ]).filter(x => !c.releaseTag || x.lib.releaseTag === c.releaseTag)
      : [];
    const found: LocatedQuote | undefined = located.length === 1 ? located[0] : undefined;
    const prov = quoteProvenance(found, opts.project, c.verbatim);
    const raw = found?.quote?.speakerLabel || found?.aq?.speakerLabels[0] || c.speaker;
    const name = (found?.quote?.speakerConfirmed && found.quote.speakerName) ||
      (found?.aq?.speakerConfirmed && found.aq.speakerName) || undefined;
    return {
      releaseTag: c.releaseTag, segStart: c.segStart, segEnd: c.segEnd,
      speakerRaw: raw, speakerName: name, speakerConfirmed: !!name,
      verbatim: c.verbatim, quoteId: c.quoteId,
      provenanceStatus: found ? prov.status : 'needs_review', statusNote: prov.note,
    };
  });
}

/** Only a directly following archival clip is structurally paired to a narration setup. */
export function pairEvidenceAndTape(opts: PairingOptions): PairingResult {
  const pairings: EvidencePairing[] = [];
  const clips: GroundedTapeBlock[] = [];
  const paired = new Set<string>();
  for (const segment of opts.segments || []) {
    for (const scene of segment.scenes) {
      const blocks = scene.blocks;
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (b.kind !== 'narration') continue;
        const claims = groundClaims(b.claims || [], opts);
        let following: Extract<Block, { kind: 'clip' }> | undefined;
        for (let j = i + 1; j < blocks.length && blocks[j].kind !== 'narration'; j++) {
          if (blocks[j].kind === 'clip') { following = blocks[j] as Extract<Block, { kind: 'clip' }>; break; }
        }
        const tape = following
          ? groundTapeBlock(following, scene, segment, opts) : undefined;
        if (tape && !paired.has(tape.blockId)) { clips.push(tape); paired.add(tape.blockId); }
        const mismatchedClaim = claims.some(c => c.quoteId && tape?.quoteId &&
          c.quoteId !== tape.quoteId && !c.boardClaimId && !c.sourceDocId);
        const doubtfulClaim = claims.some(c => c.provenanceStatus !== 'verified');
        const doubtfulTape = !!tape && (tape.provenanceStatus !== 'verified' ||
          (tape.audioBoundary?.status !== 'verified' && tape.audioBoundary?.status !== 'aligned'));
        const review = mismatchedClaim || doubtfulClaim || doubtfulTape;
        const pairingStatus: EvidencePairing['pairingStatus'] =
          review || (!tape && (claims.length > 0 || b.readEvidence)) ? 'needs_review' :
          tape ? 'paired' : 'unpaired';
        pairings.push({
          narrationBlockId: b.id, narrationText: b.text,
          sceneId: scene.id, segmentId: segment.id, claims, tapeBlock: tape,
          pairingStatus,
          pairingNote: mismatchedClaim ? 'Claim cites a different quote from the adjacent tape'
            : review ? 'Some claim, audio, or tape provenance remains unverified'
            : (!tape && (claims.length || b.readEvidence)) ? 'No directly associated tape' : undefined,
        });
      }
      for (const b of blocks) if (b.kind === 'clip' && !clips.some(c => c.blockId === b.id)) {
        clips.push(groundTapeBlock(b, scene, segment, opts));
      }
    }
  }
  const warnings = clips.flatMap(c => c.warnings);
  return { pairings, unpairedTapeBlocks: clips.filter(c => !paired.has(c.blockId)), warnings };
}
