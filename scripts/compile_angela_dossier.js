import fs from 'fs';
import path from 'path';

const masterPath = path.resolve(process.cwd(), 'docs/documentary/data/angela_quotes_master.json');
const quotes = JSON.parse(fs.readFileSync(masterPath, 'utf8'));

// Filter quotes from Angela that target Logan or contain accusations/threats/doxxing/law enforcement
const targets = quotes.filter(q => {
  if (q.speaker !== 'Angela') return false;
  const t = (q.target || '').toLowerCase();
  const c = (q.category || '').toLowerCase();
  const qText = (q.exact_quote || '').toLowerCase();
  return (
    t.includes('logan') ||
    c.includes('accusation') ||
    c.includes('threat') ||
    c.includes('doxx') ||
    c.includes('predator') ||
    c.includes('police') ||
    c.includes('legal') ||
    c.includes('retaliation') ||
    c.includes('porn') ||
    c.includes('fbi')
  );
});

function categorize(q) {
  const c = (q.category || '').toLowerCase();
  const txt = (q.exact_quote || '').toLowerCase();
  if (c.includes('predator') || c.includes('minor') || c.includes('porn') || c.includes('rape') || txt.includes('predator') || txt.includes('porn') || txt.includes('minor')) {
    return '1. Predator, AI Porn & Severe Defamation';
  }
  if (c.includes('doxx') || c.includes('surveillance') || c.includes('address') || c.includes('infiltrat') || txt.includes('dox') || txt.includes('front door')) {
    return '2. Doxxing Admissions, Surveillance & Infiltration';
  }
  if (c.includes('legal') || c.includes('lawsuit') || c.includes('bankrupt') || txt.includes('lawsuit') || txt.includes('bankrupt') || txt.includes('sue')) {
    return '3. Legal Threats, Financial Ruin & Lawsuit Machinery';
  }
  if (c.includes('police') || c.includes('fbi') || c.includes('ic3') || c.includes('cps') || txt.includes('police') || txt.includes('fbi') || txt.includes('ic3')) {
    return '4. Police, FBI IC3 & CPS Weaponization';
  }
  if (c.includes('threat') || c.includes('violence') || c.includes('tannerite') || txt.includes('tannerite') || txt.includes('destroy') || c.includes('scorched earth')) {
    return '5. Violent Retaliation & Scorched-Earth Declarations';
  }
  return '6. Abuse Accusations, Triangulation & Smear Narratives';
}

const groups = {};
for (const q of targets) {
  const g = categorize(q);
  if (!groups[g]) groups[g] = [];
  groups[g].push(q);
}

let md = `# The Paper Trail: Angela Maggard Accusations & Statements Dossier\n\n`;
md += `**Document Type:** Evidentiary Compilation & Accusation Index  \n`;
md += `**Primary Subject:** Angela Maggard statements targeting Logan Black / Logan  \n`;
md += `**Source Archive:** Canonical transcripts & \`docs/documentary/data/angela_quotes_master.json\`  \n`;
md += `**Total Verified Accusation Quotes:** ${targets.length}  \n`;
md += `**Generated At:** ${new Date().toISOString()}  \n\n`;
md += `This dossier compiles all primary verified verbatim statements, accusations, legal threats, doxxing admissions, and smear narratives spoken by Angela Maggard across recorded Twitter Spaces, organized by severity category.\n\n`;

for (const groupName of Object.keys(groups).sort()) {
  const list = groups[groupName];
  md += `---\n\n## ${groupName} (${list.length} Verified Statements)\n\n`;

  for (const item of list) {
    md += `### [${item.quote_id}] ${item.category}\n`;
    md += `- **Date:** ${item.date || 'Undated'} | **Episode:** \`${item.episode_title || item.release_tag}\`\n`;
    md += `- **Target:** ${item.target || 'Logan'} | **Recommendation Tier:** ${item.recommendation || 'STANDARD'}\n`;
    if (item.transcript_search_window) {
      md += `- **Timestamp Window:** \`${item.transcript_search_window}\`\n`;
    }
    md += `\n> "${item.exact_quote.replace(/\n/g, ' ')}"\n\n`;
    if (item.why_it_matters) {
      md += `* **Evidentiary Impact:** ${item.why_it_matters}\n`;
    }
    if (item.context_before || item.context_after) {
      md += `* **Context:** ${[item.context_before, item.context_after].filter(Boolean).join(' → ')}\n`;
    }
    if (item.notes) {
      md += `* **Notes:** ${item.notes}\n`;
    }
    md += `\n`;
  }
}

const outPath = path.resolve(process.cwd(), 'docs/documentary/research/ANGELA_ACCUSATIONS_DOSSIER.md');
fs.writeFileSync(outPath, md, 'utf8');
console.log(`Successfully compiled dossier to ${outPath} with ${targets.length} statements.`);
