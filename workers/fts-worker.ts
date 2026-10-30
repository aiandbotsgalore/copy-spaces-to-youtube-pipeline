import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

export interface TurnRecord {
  turn_id?: string | number;
  id?: string | number;
  episode_id?: string | number;
  episodeId?: string | number;
  speaker?: string;
  text?: string;
  start_time?: number;
  startSec?: number;
  start?: number;
  end_time?: number | null;
  endSec?: number | null;
  end?: number | null;
}

export interface SearchResultItem {
  turn_id: string;
  episode_id: string;
  speaker: string;
  text: string;
  start_time: number;
  end_time: number | null;
  rank: number;
  id: string;
  startSec: number;
  endSec: number | null;
  release_id: number | string;
  release_tag: string;
  segment: {
    speaker: string;
    text: string;
    start: number;
    end: number | null;
  };
}

let db: any = null;
let initPromise: Promise<any> | null = null;

export async function initDB() {
  if (db) return db;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const sqlite3 = await (sqlite3InitModule as any)({
      print: console.log,
      printErr: console.error,
    });

    // Prefer OPFS persistence, fallback gracefully to in-memory if unsupported
    try {
      if ('opfs' in sqlite3) {
        db = new sqlite3.oo1.OpfsDb('/spacepipe_vault.db');
      } else {
        db = new sqlite3.oo1.DB('/spacepipe_vault.db', 'c');
      }
    } catch (err) {
      console.warn('OPFS initialization failed, falling back to in-memory DB:', err);
      db = new sqlite3.oo1.DB(':memory:', 'c');
    }

    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
        turn_id UNINDEXED,
        episode_id UNINDEXED,
        speaker,
        text,
        start_time UNINDEXED,
        end_time UNINDEXED,
        tokenize = 'porter unicode61 remove_diacritics 2'
      );
    `);

    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_episode ON turns_fts(episode_id);`);
    } catch {
      // Virtual tables may not be indexed in standard SQLite; ignore gracefully
    }

    return db;
  })();

  return initPromise;
}

export function sanitizeFTS5Query(raw: string): string {
  // Remove FTS5 operators and punctuation, wrap terms in quotes
  const clean = raw.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  if (!clean) return '';
  return clean.split(/\s+/).map(term => `"${term}"*`).join(' ');
}

export function batchIngest(turns: TurnRecord[], episodeId?: string | number): number {
  if (!db || !turns || turns.length === 0) return 0;
  let count = 0;
  db.exec('BEGIN TRANSACTION;');
  try {
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      const epId = t.episode_id ?? t.episodeId ?? episodeId ?? '';
      const turnId = t.turn_id ?? t.id ?? `${epId}_${i}`;
      const speaker = t.speaker ?? '';
      const text = t.text ?? '';
      const startTime = typeof t.start_time === 'number'
        ? t.start_time
        : (typeof t.startSec === 'number' ? t.startSec : (typeof t.start === 'number' ? t.start : 0));
      const endTime = typeof t.end_time === 'number'
        ? t.end_time
        : (typeof t.endSec === 'number' ? t.endSec : (typeof t.end === 'number' ? t.end : null));

      db.exec({
        sql: 'INSERT INTO turns_fts(turn_id, episode_id, speaker, text, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)',
        bind: [String(turnId), String(epId), String(speaker), String(text), startTime, endTime],
      });
      count++;
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
  return count;
}

export function batchIngestEpisodes(episodes: any[]): number {
  if (!db || !episodes || episodes.length === 0) return 0;
  let count = 0;
  db.exec('BEGIN TRANSACTION;');
  try {
    for (const ep of episodes) {
      const epId = ep.release_id ?? ep.release_tag ?? '';
      const segs = ep.segments || [];
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        const turnId = `${epId}_${i}`;
        const speaker = seg.speaker ?? '';
        const text = seg.text ?? '';
        const startTime = typeof seg.start === 'number' ? seg.start : (typeof seg.startSec === 'number' ? seg.startSec : 0);
        const endTime = typeof seg.end === 'number' ? seg.end : (typeof seg.endSec === 'number' ? seg.endSec : null);

        db.exec({
          sql: 'INSERT INTO turns_fts(turn_id, episode_id, speaker, text, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)',
          bind: [String(turnId), String(epId), String(speaker), String(text), startTime, endTime],
        });
        count++;
      }
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
  return count;
}

export function deleteEpisode(episodeId: string | number): number {
  if (!db || episodeId === undefined || episodeId === null) return 0;
  db.exec({
    sql: 'DELETE FROM turns_fts WHERE episode_id = ?',
    bind: [String(episodeId)],
  });
  return 1;
}

export function searchTurns(params: {
  query: string;
  episodeId?: string | number;
  speaker?: string;
  limit?: number;
}): SearchResultItem[] {
  if (!db) return [];
  const clean = sanitizeFTS5Query(params.query || '');
  const epId = params.episodeId !== undefined && params.episodeId !== null && params.episodeId !== '' && params.episodeId !== 'ALL'
    ? String(params.episodeId)
    : null;
  const speaker = params.speaker && params.speaker !== 'ALL' ? params.speaker : null;
  const limit = Math.min(Math.max(1, params.limit || 50), 500);

  const rawRows: any[] = [];

  if (clean) {
    let sql = 'SELECT turn_id, episode_id, speaker, text, start_time, end_time, rank FROM turns_fts WHERE turns_fts MATCH ?';
    const bind: any[] = [clean];
    if (epId !== null) {
      sql += ' AND episode_id = ?';
      bind.push(epId);
    }
    if (speaker !== null) {
      sql += ' AND speaker = ?';
      bind.push(speaker);
    }
    sql += ' ORDER BY rank ASC LIMIT ?';
    bind.push(limit);

    db.exec({
      sql,
      bind,
      rowMode: 'object',
      callback: (row: any) => rawRows.push(row),
    });
  } else if (epId !== null || speaker !== null) {
    let sql = 'SELECT turn_id, episode_id, speaker, text, start_time, end_time, 0 as rank FROM turns_fts WHERE 1=1';
    const bind: any[] = [];
    if (epId !== null) {
      sql += ' AND episode_id = ?';
      bind.push(epId);
    }
    if (speaker !== null) {
      sql += ' AND speaker = ?';
      bind.push(speaker);
    }
    sql += ' LIMIT ?';
    bind.push(limit);

    db.exec({
      sql,
      bind,
      rowMode: 'object',
      callback: (row: any) => rawRows.push(row),
    });
  }

  return rawRows.map(row => {
    const numericEpId = Number(row.episode_id);
    return {
      turn_id: row.turn_id,
      episode_id: row.episode_id,
      speaker: row.speaker,
      text: row.text,
      start_time: row.start_time,
      end_time: row.end_time,
      rank: row.rank ?? 0,
      id: row.turn_id,
      startSec: row.start_time,
      endSec: row.end_time,
      release_id: Number.isFinite(numericEpId) ? numericEpId : row.episode_id,
      release_tag: String(row.episode_id),
      segment: {
        speaker: row.speaker,
        text: row.text,
        start: row.start_time,
        end: row.end_time,
      },
    };
  });
}

// Worker message listener
if (typeof self !== 'undefined') {
  self.onmessage = async (e: MessageEvent) => {
    const data = e.data;
    if (!data) return;

    switch (data.type) {
      case 'INIT': {
        try {
          await initDB();
          self.postMessage({ type: 'READY' });
        } catch (err: any) {
          self.postMessage({ type: 'ERROR', error: err?.message || String(err) });
        }
        break;
      }

      case 'BATCH_INGEST':
      case 'INDEX': {
        try {
          await initDB();
          let count = 0;
          const targetEpId = data.episodeId ?? data.episode_id;
          if (targetEpId !== undefined && targetEpId !== null) {
            deleteEpisode(targetEpId);
          }

          if (Array.isArray(data.turns)) {
            count = batchIngest(data.turns, targetEpId);
          } else if (Array.isArray(data.episodes)) {
            count = batchIngestEpisodes(data.episodes);
          }
          self.postMessage({
            type: 'BATCH_INGEST_COMPLETE',
            count,
            id: data.id,
          });
          self.postMessage({
            type: 'INDEXED',
            count,
            id: data.id,
          });
        } catch (err: any) {
          self.postMessage({ type: 'ERROR', id: data.id, error: err?.message || String(err) });
        }
        break;
      }

      case 'SEARCH': {
        try {
          await initDB();
          const start = performance.now();
          const results = searchTurns({
            query: data.query || '',
            episodeId: data.episodeId ?? data.episode_id ?? data.tagFilter,
            speaker: data.speaker ?? data.speakerFilter,
            limit: data.limit || 50,
          });
          const durationMs = performance.now() - start;

          self.postMessage({
            type: 'SEARCH_RESULTS',
            id: data.id,
            query: data.query || '',
            results,
            durationMs,
          });
          // Also send RESULTS for backwards compatibility with any existing listener
          self.postMessage({
            type: 'RESULTS',
            id: data.id,
            results,
          });
        } catch (err: any) {
          self.postMessage({ type: 'ERROR', id: data.id, error: err?.message || String(err) });
        }
        break;
      }

      case 'DELETE_EPISODE': {
        try {
          await initDB();
          const epId = data.episodeId ?? data.episode_id;
          deleteEpisode(epId);
          self.postMessage({ type: 'DELETED', episodeId: epId, id: data.id });
        } catch (err: any) {
          self.postMessage({ type: 'ERROR', id: data.id, error: err?.message || String(err) });
        }
        break;
      }

      default:
        console.warn('Unknown message type in fts-worker:', data.type);
    }
  };
}
