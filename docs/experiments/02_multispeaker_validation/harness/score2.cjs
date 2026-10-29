// Deterministic scoring for experiment 2. No model calls. Called from run2.cjs with the app's own modules.
module.exports = async ({ G, t, TAG, OUT, fs, path }) => {
  const WPS = 2.6;
  const norm = s => String(s).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const words = s => norm(s).length;
  const longestRun = (a, b) => { let best = 0; const prev = new Array(b.length + 1).fill(0); for (let i = 1; i <= a.length; i++) { let diag = 0; for (let j = 1; j <= b.length; j++) { const tmp = prev[j]; prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0; if (prev[j] > best) best = prev[j]; diag = tmp; } } return best; };
  const utts = t.utterances;
  const idx = new Map(utts.map((u, i) => [u.id, i]));
  const fullNorm = ' ' + norm(utts.map(u => u.text).join(' ')).join(' ') + ' ';
  const NAMED = [...new Set(utts.map(u => u.speaker).filter(s => !/^Speaker \d+$/.test(s)))];
  const hh = s => { s = Math.floor(s); return `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const clipInfo = id => { const m = /_(u\d+)_(u\d+)$/.exec(id || ''); if (!m) return null; const a = idx.get(m[1]), z = idx.get(m[2]); const us = utts.slice(a, z + 1); return { speaker: us[0].speaker, start: us[0].start, dur: us[us.length - 1].end - us[0].start, text: us.map(u => u.text).join(' '), from: m[1] }; };
  const whoSaid = q => { const n = norm(q).join(' '); for (let i = 0; i < utts.length; i++) { const win = norm(utts.slice(i, i + 3).map(u => u.text).join(' ')).join(' '); if (win.includes(n)) { const first = norm(utts[i].text).join(' '); const sp = first.includes(n.split(' ').slice(0, 4).join(' ')) || i + 1 >= utts.length ? utts[i].speaker : utts[i + 1].speaker; return { speaker: sp, at: utts[i].start, id: utts[i].id }; } } return null; };
  const quotedSpans = text => [...String(text).matchAll(/[“"]([^”"]+)[”"]/g)].map(m => m[1].trim()).filter(s => words(s) >= 4);
  const sentences = text => String(text).split(/(?<=[.!?])\s+/);
  const CUE = /\b(says?|said|asks?|asked|tells?|told|replies|replied|answers?|puts it|in (her|his|their) (own )?words|here is|here's|listen|responds?|pushes back|warns?|admits?)\b/i;

  function analyse(arm) {
    const d = JSON.parse(fs.readFileSync(path.join(OUT, `${arm}.json`), 'utf8'));
    const scenes = d.version.segments.map(s => s.scenes[0]);
    const md = [];
    const uses = []; // quotations: { scene, kind, text, ref }
    const narrSentences = []; // { scene, sentence }
    const attribution = [];
    let narrSec = 0, tapeSec = 0, pauseSec = 0, tapeBlocks = 0;
    const verb = { tapeOk: 0, tapeTotal: 0, narratedOk: 0, narratedTotal: 0, claimOk: 0, claimTotal: 0, failures: [] };
    d.intended.forEach((sc, si) => {
      const vScene = scenes[si];
      md.push(`\n## Scene ${si + 1}: ${vScene.title}`);
      let lastNarr = '';
      sc.blocks.forEach(b => {
        if (b.kind === 'narration') {
          const text = String(b.text || '');
          md.push(`NARRATOR: ${text}`);
          narrSec += words(text) / WPS;
          sentences(text).forEach(s => narrSentences.push({ scene: si + 1, sentence: s }));
          for (const q of quotedSpans(text)) {
            verb.narratedTotal++;
            const ok = fullNorm.includes(' ' + norm(q).join(' ') + ' ');
            if (ok) verb.narratedOk++; else verb.failures.push({ scene: si + 1, kind: 'narrated quote not in transcript', text: q });
            uses.push({ scene: si + 1, kind: 'narrated', text: q });
            if (ok) {
              const who = whoSaid(q);
              const sent = sentences(text).find(s => s.includes(q.slice(0, 30))) || '';
              const before = sent.slice(0, Math.max(0, sent.indexOf(q.slice(0, 10))));
              const named = NAMED.filter(n => new RegExp(`\\b${n}\\b`).test(before));
              if (who && named.length === 1 && named[0] !== who.speaker) attribution.push({ scene: si + 1, kind: 'narrated quote', said: `${who.speaker} at ${hh(who.at)} (${who.id})`, script: sent.trim().slice(0, 220) });
            }
          }
          if (/\bSpeaker \d+\b/.test(text)) attribution.push({ scene: si + 1, kind: 'raw label in narration', said: '', script: text.match(/[^.]*\bSpeaker \d+\b[^.]*\./)?.[0]?.slice(0, 220) || '' });
          lastNarr = text;
        } else if (b.kind === 'clip') {
          tapeBlocks++;
          const c = clipInfo(b.clipId);
          const kept = String(b.keptText || '');
          verb.tapeTotal++;
          const ok = c && (' ' + norm(c.text).join(' ') + ' ').includes(' ' + norm(kept).join(' ') + ' ');
          if (ok) verb.tapeOk++; else verb.failures.push({ scene: si + 1, kind: 'tape excerpt not in clip', text: kept.slice(0, 120) });
          const sec = c ? Math.min(c.dur, c.dur * words(kept) / Math.max(1, words(c.text))) : words(kept) / WPS;
          tapeSec += sec;
          md.push(`[TAPE ${c ? `${c.speaker}, ${hh(c.start)}, ${c.from}` : b.clipId}, ~${Math.round(sec)}s] "${kept}"`);
          uses.push({ scene: si + 1, kind: 'tape', text: kept, ref: c ? `${c.speaker} ${hh(c.start)}` : '' });
          const last = sentences(lastNarr).slice(-1)[0] || '';
          const named = NAMED.filter(n => new RegExp(`\\b${n}\\b`).test(last));
          if (c && CUE.test(last) && named.length === 1 && named[0] !== c.speaker) attribution.push({ scene: si + 1, kind: 'tape intro names another speaker', said: `${c.speaker} at ${hh(c.start)} (${c.from})`, script: last.trim().slice(0, 220) });
          lastNarr = '';
        } else if (b.kind === 'pause') { pauseSec += Number(b.sec) || 0; md.push(`[pause ${b.sec}s]`); }
        else if (b.kind === 'music') md.push(`[music ${b.cue}: ${b.note || ''}]`);
      });
    });
    // claims (evidence behind narration), checked by the app's own verbatim gate
    const segs = (() => { const out = []; for (const u of utts) out.push({ start: u.start, end: u.end, speaker: u.speaker, text: u.text }); return out; })();
    for (const sc of scenes) for (const b of sc.blocks) if (b.kind === 'narration') for (const c of b.claims) {
      verb.claimTotal++;
      if (G.verifyVerbatim(c, segs).ok) verb.claimOk++; else verb.failures.push({ kind: 'claim not verbatim', text: c.verbatim.slice(0, 120) });
    }
    // duplicate quotations (>= 8 shared consecutive words between two quotation uses)
    const dups = [];
    for (let i = 0; i < uses.length; i++) for (let j = i + 1; j < uses.length; j++) {
      const r = longestRun(norm(uses[i].text), norm(uses[j].text));
      if (r >= Math.min(8, words(uses[i].text), words(uses[j].text))) dups.push({ scenes: `${uses[i].scene}->${uses[j].scene}`, kinds: `${uses[i].kind}/${uses[j].kind}`, shared: r, text: uses[i].text.slice(0, 110) });
    }
    // repeated narration across scenes (>= 8 shared consecutive words): repeated set-ups
    const repeats = [];
    for (let i = 0; i < narrSentences.length; i++) for (let j = i + 1; j < narrSentences.length; j++) {
      if (narrSentences[i].scene === narrSentences[j].scene) continue;
      const r = longestRun(norm(narrSentences[i].sentence), norm(narrSentences[j].sentence));
      if (r >= 8) repeats.push({ scenes: `${narrSentences[i].scene}->${narrSentences[j].scene}`, a: narrSentences[i].sentence.slice(0, 160), b: narrSentences[j].sentence.slice(0, 160) });
    }
    fs.writeFileSync(path.join(OUT, `${arm}_readable.md`), `# Arm ${arm}\n` + md.join('\n') + '\n');
    const runtime = narrSec + tapeSec + pauseSec;
    return {
      calls: d.calls, seconds: Math.round(d.ms / 1000), tapeBlocks, tapeSec: Math.round(tapeSec), narrationSec: Math.round(narrSec), pauseSec: Math.round(pauseSec),
      originalAudioPct: Math.round(100 * tapeSec / (runtime || 1)), runtimeSec: Math.round(runtime),
      verbatim: { tape: `${verb.tapeOk}/${verb.tapeTotal}`, narratedQuotes: `${verb.narratedOk}/${verb.narratedTotal}`, claims: `${verb.claimOk}/${verb.claimTotal}`, failures: verb.failures },
      attributionFlags: attribution, duplicates: dups, crossSceneRepeats: repeats, appGateFailures: d.gates.failures,
    };
  }
  const board = JSON.parse(fs.readFileSync(path.join(OUT, 'board.json'), 'utf8'));
  const report = { namedLabels: NAMED, board: { quotes: board.total, verified: board.verifiedCount }, A: analyse('A'), C: analyse('C') };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
};
