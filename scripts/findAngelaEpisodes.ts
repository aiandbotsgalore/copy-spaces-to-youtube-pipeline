import fs from 'fs';
import path from 'path';

const summaryPath = path.resolve('public/transcripts/transcripts_summary_index.json');
const epDir = path.resolve('public/transcripts/episodes');
const cacheDir = path.resolve('.cache/transcripts');

let summaries: any[] = [];
if (fs.existsSync(summaryPath)) {
  summaries = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
}

const summaryMap = new Map<string, any>();
summaries.forEach(s => {
  if (s.release_tag) summaryMap.set(s.release_tag, s);
});

const files = fs.readdirSync(epDir).filter(f => f.endsWith('.json'));
interface AngelaEpisode {
  tag: string;
  title: string;
  hasSpeaker: boolean;
  mentionCount: number;
  turnCount: number;
  isAlreadyEmbedded: boolean;
}

const angelaEpisodes: AngelaEpisode[] = [];

for (const f of files) {
  const tag = f.replace('.json', '');
  const fullPath = path.join(epDir, f);
  const sum = summaryMap.get(tag);

  let hasSpeaker = false;
  let mentionsInSummary = false;

  if (sum) {
    if (sum.speakers && sum.speakers.some((sp: string) => /angela/i.test(sp))) hasSpeaker = true;
    if (sum.title && /angela/i.test(sum.title)) mentionsInSummary = true;
    if (sum.summary && /angela/i.test(sum.summary)) mentionsInSummary = true;
  }

  let mentionsInText = false;
  let speakerInTranscript = false;
  let mentionCount = 0;
  let turnCount = 0;

  try {
    const raw = fs.readFileSync(fullPath, 'utf8');
    const data = JSON.parse(raw);
    const segs = Array.isArray(data.segments) ? data.segments : (Array.isArray(data) ? data : []);
    turnCount = segs.length;

    for (const seg of segs) {
      if (seg.speaker && /angela/i.test(seg.speaker)) speakerInTranscript = true;
      if (seg.text && /\bangela\b/i.test(seg.text)) {
        mentionsInText = true;
        mentionCount++;
      }
    }
  } catch (e) {}

  if (hasSpeaker || speakerInTranscript || mentionsInSummary || mentionsInText) {
    const isAlreadyEmbedded =
      fs.existsSync(path.join(cacheDir, `${tag}.embeddings.json`)) &&
      fs.existsSync(path.join(cacheDir, `${tag}.embeddings.bin`));

    angelaEpisodes.push({
      tag,
      title: sum?.title || tag,
      hasSpeaker: hasSpeaker || speakerInTranscript,
      mentionCount,
      turnCount,
      isAlreadyEmbedded,
    });
  }
}

// Sort: direct speaker first, then by mention count descending
angelaEpisodes.sort((a, b) => {
  if (a.hasSpeaker !== b.hasSpeaker) return a.hasSpeaker ? -1 : 1;
  return b.mentionCount - a.mentionCount;
});

console.log(`\n=== Angela Episode Audit ===`);
console.log(`Total episodes matching Angela (speaker OR mentioned in dialogue/title): ${angelaEpisodes.length}`);
const alreadyDone = angelaEpisodes.filter(e => e.isAlreadyEmbedded).length;
const directSpeakerCount = angelaEpisodes.filter(e => e.hasSpeaker).length;
const discussedCount = angelaEpisodes.filter(e => !e.hasSpeaker && e.mentionCount > 0).length;
const totalTurns = angelaEpisodes.reduce((acc, e) => acc + e.turnCount, 0);
const remainingTurns = angelaEpisodes.filter(e => !e.isAlreadyEmbedded).reduce((acc, e) => acc + e.turnCount, 0);
const remainingEpisodes = angelaEpisodes.filter(e => !e.isAlreadyEmbedded).length;

console.log(`- Direct Angela as Speaker: ${directSpeakerCount}`);
console.log(`- Angela Discussed/Mentioned in Dialogue: ${discussedCount}`);
console.log(`- Already Embedded: ${alreadyDone} / ${angelaEpisodes.length}`);
console.log(`- Remaining to Embed: ${remainingEpisodes} episodes (${remainingTurns.toLocaleString()} turns)`);

const estSeconds = remainingTurns / 25; // 25 turns/sec on CPU
const estMinutes = (estSeconds / 60).toFixed(1);
console.log(`- Estimated Run Time at 25 t/s: ~${estMinutes} minutes`);

console.log(`\nTop 15 Angela Episodes:`);
angelaEpisodes.slice(0, 15).forEach((e, idx) => {
  console.log(`  ${idx + 1}. [${e.hasSpeaker ? 'SPEAKER' : 'MENTIONED x' + e.mentionCount}] ${e.tag} | ${e.turnCount} turns | Embedded: ${e.isAlreadyEmbedded} | "${e.title.slice(0, 60)}"`);
});

// Write tags list to .cache/transcripts/angela_episode_tags.json
fs.mkdirSync(cacheDir, { recursive: true });
fs.writeFileSync(
  path.join(cacheDir, 'angela_episode_tags.json'),
  JSON.stringify(angelaEpisodes.map(e => e.tag), null, 2),
  'utf8'
);
console.log(`\nSaved ${angelaEpisodes.length} tags to .cache/transcripts/angela_episode_tags.json`);
