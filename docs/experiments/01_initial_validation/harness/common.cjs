// Shared helpers for the experiment: text normalisation, reference location, overlap scoring.
const fs = require('fs');
const path = require('path');
const EXP = __dirname;
const ROOT = path.join(EXP, 'root');
const APP = 'C:/Users/Logan/copy-spaces-to-youtube-pipeline';
const TAGS = ['20260908_1wxWjlrwXokJQ', '20260908_1nGeLMjONkAKX', '20260913_1lJQRWAWpvVxE', '20260903_1dKrPrbywDkJX'];
const DRAFT_TAG = TAGS[0];

const QUESTION = 'What has Angela said publicly about Logan: what she accuses him of, what evidence she claims to hold, what she says her motives are, and what she threatens or plans to do next?';
const SCOPE = 'Scope for this test: a three-scene sequence of about 5 minutes. Structure it as three segments with exactly one scene each.';

const norm = s => String(s).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);

function loadSegs(tag) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/transcripts/episodes', tag + '.json'), 'utf8'));
  return j.segments.map((s, i) => ({ id: 'u' + i, i, ...s }));
}

// Longest run of consecutive shared words between token arrays a and b.
function longestRun(a, b) {
  let best = 0;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
      if (prev[j] > best) best = prev[j];
      diag = tmp;
    }
  }
  return best;
}

// A retrieved text "hits" a reference quote if it shares a run of >= min(8, shortest part) words with any part.
function hits(refParts, text) {
  const t = norm(text);
  return refParts.some(p => longestRun(p, t) >= Math.min(8, p.length));
}

module.exports = { fs, path, EXP, ROOT, APP, TAGS, DRAFT_TAG, QUESTION, SCOPE, norm, loadSegs, longestRun, hits };
