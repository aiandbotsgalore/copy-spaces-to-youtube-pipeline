export interface EpisodeDateInfo {
  dateObj: Date;
  timestampMs: number;
  displayDate: string; // e.g. "Aug 26, 2026"
  rawDateStr: string;   // e.g. "2026-08-26"
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Extracts the true live recorded date for an episode/release.
 * Prioritizes:
 *  1. METADATA::EPISODE_DATE:: in release body
 *  2. **Recorded:** field in release body
 *  3. YYYYMMDD prefix in release tag_name (e.g. 20260826_1AxRnZYBVdrxl)
 *  4. YYYY-MM-DD date found in release title/name
 *  5. Fallback to GitHub release published_at / created_at timestamp
 */
export function getEpisodeRecordedDate(release: {
  body?: string | null;
  tag_name?: string;
  name?: string;
  published_at?: string;
  created_at?: string;
}): EpisodeDateInfo {
  // 1. Check body METADATA or Recorded field
  if (release.body) {
    const metaMatch = release.body.match(/METADATA::EPISODE_DATE::(\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
    if (metaMatch) {
      const year = parseInt(metaMatch[1], 10);
      const month = parseInt(metaMatch[2], 10) - 1;
      const day = parseInt(metaMatch[3], 10);
      if (year >= 2000 && year <= 2099 && month >= 0 && month < 12 && day >= 1 && day <= 31) {
        const dateObj = new Date(Date.UTC(year, month, day, 12, 0, 0));
        return {
          dateObj,
          timestampMs: dateObj.getTime(),
          displayDate: `${MONTH_NAMES[month] ?? '???'} ${day}, ${year}`,
          rawDateStr: `${metaMatch[1]}-${metaMatch[2]}-${metaMatch[3]}`,
        };
      }
    }

    const recMatch = release.body.match(/\*\*Recorded:\*\*\s*(\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
    if (recMatch) {
      const year = parseInt(recMatch[1], 10);
      const month = parseInt(recMatch[2], 10) - 1;
      const day = parseInt(recMatch[3], 10);
      if (year >= 2000 && year <= 2099 && month >= 0 && month < 12 && day >= 1 && day <= 31) {
        const dateObj = new Date(Date.UTC(year, month, day, 12, 0, 0));
        return {
          dateObj,
          timestampMs: dateObj.getTime(),
          displayDate: `${MONTH_NAMES[month] ?? '???'} ${day}, ${year}`,
          rawDateStr: `${recMatch[1]}-${recMatch[2]}-${recMatch[3]}`,
        };
      }
    }
  }

  // 2. Check tag_name (e.g. 20260826_1AxRnZYBVdrxl)
  if (release.tag_name) {
    const tagMatch = release.tag_name.match(/^(?:v)?(\d{4})[-_]?(\d{2})[-_]?(\d{2})/);
    if (tagMatch) {
      const year = parseInt(tagMatch[1], 10);
      const month = parseInt(tagMatch[2], 10) - 1;
      const day = parseInt(tagMatch[3], 10);
      if (year >= 2000 && year <= 2099 && month >= 0 && month < 12 && day >= 1 && day <= 31) {
        const dateObj = new Date(Date.UTC(year, month, day, 12, 0, 0));
        return {
          dateObj,
          timestampMs: dateObj.getTime(),
          displayDate: `${MONTH_NAMES[month] ?? '???'} ${day}, ${year}`,
          rawDateStr: `${tagMatch[1]}-${tagMatch[2]}-${tagMatch[3]}`,
        };
      }
    }
  }

  // 3. Check release title/name for date
  if (release.name) {
    const nameMatch = release.name.match(/\b(\d{4})[-/](\d{2})[-/](\d{2})\b/);
    if (nameMatch) {
      const year = parseInt(nameMatch[1], 10);
      const month = parseInt(nameMatch[2], 10) - 1;
      const day = parseInt(nameMatch[3], 10);
      if (year >= 2000 && year <= 2099 && month >= 0 && month < 12 && day >= 1 && day <= 31) {
        const dateObj = new Date(Date.UTC(year, month, day, 12, 0, 0));
        return {
          dateObj,
          timestampMs: dateObj.getTime(),
          displayDate: `${MONTH_NAMES[month] ?? '???'} ${day}, ${year}`,
          rawDateStr: `${nameMatch[1]}-${nameMatch[2]}-${nameMatch[3]}`,
        };
      }
    }
  }

  // 4. Fallback to GitHub published_at / created_at timestamp
  const fallbackStr = release.published_at || (release as any).created_at || new Date().toISOString();
  const parsed = new Date(fallbackStr);
  const valid = !isNaN(parsed.getTime());
  const dateObj = valid ? parsed : new Date();
  const y = dateObj.getUTCFullYear();
  const m = dateObj.getUTCMonth();
  const d = dateObj.getUTCDate();
  return {
    dateObj,
    timestampMs: dateObj.getTime(),
    displayDate: `${MONTH_NAMES[m] ?? '???'} ${d}, ${y}`,
    rawDateStr: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
  };
}

/**
 * Sorts an array of releases by true recorded air date (newest first by default).
 */
export function sortReleasesByRecordedDate<T extends {
  body?: string | null;
  tag_name?: string;
  name?: string;
  published_at?: string;
  created_at?: string;
}>(releases: T[], order: 'desc' | 'asc' = 'desc'): T[] {
  return [...releases].sort((a, b) => {
    const diff = getEpisodeRecordedDate(b).timestampMs - getEpisodeRecordedDate(a).timestampMs;
    return order === 'desc' ? diff : -diff;
  });
}
