const fs = require('fs');
const path = require('path');

const charter = fs.readFileSync('docs/documentary/research/ANGELA_EDITORIAL_CHARTER.md', 'utf8');
const timeline = fs.readFileSync('docs/documentary/research/ANGELA_NEUTRAL_TIMELINE.md', 'utf8');
const matrix = fs.readFileSync('docs/documentary/research/ANGELA_CONTRADICTION_CALLBACK_MATRIX.md', 'utf8');
const testimony = fs.readFileSync('docs/documentary/research/Sav Testimony.txt', 'utf8');
const cueSheet = fs.readFileSync('docs/documentary/data/ANGELA_AUDIO_CUE_SHEET.md', 'utf8');
const quotes = fs.readFileSync('docs/documentary/data/angela_quotes_master.md', 'utf8');

const header = `# THE PAPER TRAIL: MASTER INVESTIGATIVE EVIDENCE DOSSIER
## The Unified Evidentiary Knowledge Base for AI Editorial & Broadcast Synthesis

**Project:** THE PAPER TRAIL (*The Friendship, the Files, and the People in Between*)  
**Lead Investigator / Host:** Logan Black  
**Governing Standard:** Primary Evidentiary Audio-First Architecture  
**Corpus Coverage:** 283 Verified Primary Audio Quotes, 35 Recorded Spaces, Direct Message Logs, Sworn Testimony & Chronological Ledger  

---

## TABLE OF CONTENTS
1. [SECTION 1: MASTER EDITORIAL CHARTER & GOVERNING PRINCIPLES](#section-1-master-editorial-charter--governing-principles)
2. [SECTION 2: CHRONOLOGICAL NEUTRAL TIMELINE (FEBRUARY – OCTOBER 2026)](#section-2-chronological-neutral-timeline)
3. [SECTION 3: CONTRADICTION & CALLBACK JUXTAPOSITION MATRIX](#section-3-contradiction--callback-juxtaposition-matrix)
4. [SECTION 4: PRIMARY WITNESS TESTIMONY (SAV'S VERIFIED RECORD)](#section-4-primary-witness-testimony-savs-verified-record)
5. [SECTION 5: MASTER AUDIO CUE SHEET & TIMING DIRECTORY](#section-5-master-audio-cue-sheet--timing-directory)
6. [SECTION 6: THE 283 VERIFIED ARCHIVAL QUOTES DATABASE](#section-6-the-283-verified-archival-quotes-database)

---

## SECTION 1: MASTER EDITORIAL CHARTER & GOVERNING PRINCIPLES
`;

const sec2 = `
---

## SECTION 2: CHRONOLOGICAL NEUTRAL TIMELINE
`;

const sec3 = `
---

## SECTION 3: CONTRADICTION & CALLBACK JUXTAPOSITION MATRIX
`;

const sec4 = `
---

## SECTION 4: PRIMARY WITNESS TESTIMONY (SAV'S VERIFIED RECORD)
`;

const sec5 = `
---

## SECTION 5: MASTER AUDIO CUE SHEET & TIMING DIRECTORY
`;

const sec6 = `
---

## SECTION 6: THE 283 VERIFIED ARCHIVAL QUOTES DATABASE
`;

const fullDossier = [
  header,
  charter,
  sec2,
  timeline,
  sec3,
  matrix,
  sec4,
  testimony,
  sec5,
  cueSheet,
  sec6,
  quotes
].join('\n\n');

const outPath1 = path.join('docs', 'documentary', 'research', 'THE_PAPER_TRAIL_MASTER_EVIDENCE_DOSSIER.md');
fs.writeFileSync(outPath1, fullDossier, 'utf8');

const outPath2 = path.join('C:', 'Users', 'Logan', '.gemini', 'antigravity', 'brain', 'd3ed527d-809c-4730-9f40-5eafb4a7a274', 'THE_PAPER_TRAIL_MASTER_EVIDENCE_DOSSIER.md');
fs.writeFileSync(outPath2, fullDossier, 'utf8');

const stats = fs.statSync(outPath1);
console.log('Successfully generated master evidence dossier:');
console.log('Path 1:', outPath1);
console.log('Path 2:', outPath2);
console.log('Size:', (stats.size / 1024).toFixed(1), 'KB');
console.log('Estimated Token Count (~4 chars/token):', Math.round(stats.size / 4));
