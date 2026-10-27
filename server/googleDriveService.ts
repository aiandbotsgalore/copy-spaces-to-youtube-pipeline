/**
 * Google Drive integration service for fetching and extracting evidence documents
 * from Google Drive folders and Google Docs for AI context ingestion.
 */

export interface GoogleDriveFileResult {
  id: string;
  name: string;
  content: string;
  type: 'text' | 'markdown';
  sizeBytes: number;
  sourceUrl: string;
  mimeType?: string;
}

export interface GoogleDriveFetchResult {
  ok: boolean;
  folderId: string | null;
  folderUrl: string;
  folderName?: string;
  files: GoogleDriveFileResult[];
  code?: string;
  message?: string;
}

export interface ParseDriveUrlResult {
  type: 'folder' | 'doc' | 'sheet' | 'file';
  id: string;
}

/**
 * Parses a Google Drive folder, document, spreadsheet, or file URL into its constituent type and ID.
 */
export function parseGoogleDriveUrl(urlOrId: string): ParseDriveUrlResult | null {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  const trimmed = urlOrId.trim();

  // Google Docs: https://docs.google.com/document/d/{id}/edit...
  const docMatch = /(?:docs\.google\.com\/document\/d\/)([a-zA-Z0-9_-]{15,})/.exec(trimmed);
  if (docMatch) return { type: 'doc', id: docMatch[1] };

  // Google Sheets: https://docs.google.com/spreadsheets/d/{id}/edit...
  const sheetMatch = /(?:docs\.google\.com\/spreadsheets\/d\/)([a-zA-Z0-9_-]{15,})/.exec(trimmed);
  if (sheetMatch) return { type: 'sheet', id: sheetMatch[1] };

  // Google Drive Folder: https://drive.google.com/drive/(?:u/\d+/)?folders/{id}...
  const folderMatch = /(?:drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/)([a-zA-Z0-9_-]{15,})/.exec(trimmed);
  if (folderMatch) return { type: 'folder', id: folderMatch[1] };

  // Google Drive open?id={id}
  const openIdMatch = /(?:drive\.google\.com\/open\?[^#]*\bid=)([a-zA-Z0-9_-]{15,})/.exec(trimmed);
  if (openIdMatch) return { type: 'folder', id: openIdMatch[1] };

  // Google Drive File: https://drive.google.com/file/d/{id}/view...
  const fileMatch = /(?:drive\.google\.com\/file\/d\/)([a-zA-Z0-9_-]{15,})/.exec(trimmed);
  if (fileMatch) return { type: 'file', id: fileMatch[1] };

  // Raw folder/file ID (standard Google Drive IDs are 20-44 characters base64url-like)
  if (/^[a-zA-Z0-9_-]{20,50}$/.test(trimmed)) {
    return { type: 'folder', id: trimmed };
  }

  return null;
}

export interface FetchDriveEvidenceOptions {
  urlOrId: string;
  apiKey?: string;
  accessToken?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  maxFiles?: number;
  maxTotalBytes?: number;
}

/**
 * Fetches evidence documents from a Google Drive folder or Google Doc.
 */
export async function fetchGoogleDriveEvidence(opts: FetchDriveEvidenceOptions): Promise<GoogleDriveFetchResult> {
  const fetchFn = opts.fetchImpl || fetch;
  const parsed = parseGoogleDriveUrl(opts.urlOrId);

  if (!parsed) {
    return {
      ok: false,
      folderId: null,
      folderUrl: opts.urlOrId,
      files: [],
      code: 'INVALID_URL',
      message: 'Could not parse a valid Google Drive folder or document URL/ID. Please check the link.',
    };
  }

  const env = opts.env || {};
  const effectiveApiKey = (opts.apiKey || env.GOOGLE_DRIVE_API_KEY || env.GOOGLE_API_KEY || env.GEMINI_API_KEY || '').trim();
  const effectiveToken = (opts.accessToken || '').trim();
  const maxFiles = opts.maxFiles ?? 40;
  const maxTotalBytes = opts.maxTotalBytes ?? 5_000_000; // 5 MB ceiling

  // Direct Google Doc public or authenticated fetch
  if (parsed.type === 'doc') {
    return fetchSingleGoogleDoc(parsed.id, opts.urlOrId, effectiveApiKey, effectiveToken, fetchFn);
  }

  // Google Drive Folder
  const folderId = parsed.id;
  const canonicalFolderUrl = `https://drive.google.com/drive/folders/${folderId}`;

  if (!effectiveApiKey && !effectiveToken) {
    return {
      ok: false,
      folderId,
      folderUrl: canonicalFolderUrl,
      files: [],
      code: 'AUTH_REQUIRED',
      message: 'Google Drive requires an API key or access token to read folder contents. Please provide a Google Drive API Key or OAuth token, or add GOOGLE_DRIVE_API_KEY to your .env.local file.',
    };
  }

  try {
    const listParams = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id,name,mimeType,size,description)',
      pageSize: String(Math.min(maxFiles, 100)),
    });
    if (effectiveApiKey) {
      listParams.set('key', effectiveApiKey);
    }

    const headers: Record<string, string> = {};
    if (effectiveToken) {
      headers['Authorization'] = `Bearer ${effectiveToken}`;
    }

    const listRes = await fetchFn(`https://www.googleapis.com/drive/v3/files?${listParams.toString()}`, { headers });
    if (!listRes.ok) {
      let errDetail = `HTTP ${listRes.status}`;
      try {
        const j = await listRes.json();
        if (j?.error?.message) errDetail = j.error.message;
      } catch {
        // ignore
      }
      return {
        ok: false,
        folderId,
        folderUrl: canonicalFolderUrl,
        files: [],
        code: `DRIVE_API_${listRes.status}`,
        message: `Google Drive API error (${listRes.status}): ${errDetail}. Ensure the folder is shared (Anyone with the link can view) and your API key has Google Drive API enabled.`,
      };
    }

    const listData = await listRes.json();
    const driveFiles: any[] = Array.isArray(listData?.files) ? listData.files : [];

    if (!driveFiles.length) {
      return {
        ok: true,
        folderId,
        folderUrl: canonicalFolderUrl,
        files: [],
        message: 'Google Drive folder was accessed successfully, but contains no files or only empty subfolders.',
      };
    }

    const results: GoogleDriveFileResult[] = [];
    let totalBytesAccumulated = 0;

    for (const file of driveFiles) {
      if (results.length >= maxFiles || totalBytesAccumulated >= maxTotalBytes) break;
      const mime = String(file.mimeType || '');
      // Skip subfolders
      if (mime === 'application/vnd.google-apps.folder') continue;

      try {
        let content = '';
        let docType: 'text' | 'markdown' = 'text';

        if (mime === 'application/vnd.google-apps.document') {
          // Export Google Doc as text/plain
          const exportUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain${effectiveApiKey ? `&key=${encodeURIComponent(effectiveApiKey)}` : ''}`;
          const expRes = await fetchFn(exportUrl, { headers });
          if (expRes.ok) {
            content = await expRes.text();
            docType = 'markdown';
          }
        } else if (mime === 'application/vnd.google-apps.spreadsheet') {
          // Export Google Sheet as CSV
          const exportUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/csv${effectiveApiKey ? `&key=${encodeURIComponent(effectiveApiKey)}` : ''}`;
          const expRes = await fetchFn(exportUrl, { headers });
          if (expRes.ok) {
            content = await expRes.text();
          }
        } else if (mime === 'application/vnd.google-apps.presentation') {
          // Export Google Presentation as plain text
          const exportUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain${effectiveApiKey ? `&key=${encodeURIComponent(effectiveApiKey)}` : ''}`;
          const expRes = await fetchFn(exportUrl, { headers });
          if (expRes.ok) {
            content = await expRes.text();
          }
        } else {
          // Standard file download (text, md, json, csv, etc.)
          const dlUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media${effectiveApiKey ? `&key=${encodeURIComponent(effectiveApiKey)}` : ''}`;
          const dlRes = await fetchFn(dlUrl, { headers });
          if (dlRes.ok) {
            content = await dlRes.text();
            if (file.name.endsWith('.md') || file.name.endsWith('.markdown')) {
              docType = 'markdown';
            }
          }
        }

        if (content.trim()) {
          const bytes = Buffer.byteLength(content, 'utf8');
          totalBytesAccumulated += bytes;
          results.push({
            id: file.id,
            name: file.name,
            content: content.slice(0, 500_000), // Max 500KB per single document
            type: docType,
            sizeBytes: bytes,
            sourceUrl: `https://drive.google.com/file/d/${file.id}/view`,
            mimeType: mime,
          });
        }
      } catch {
        // Skip individual unreadable files gracefully
      }
    }

    return {
      ok: true,
      folderId,
      folderUrl: canonicalFolderUrl,
      files: results,
      message: results.length
        ? `Successfully imported ${results.length} evidence file(s) from Google Drive folder.`
        : 'Google Drive folder contains files, but none could be exported as text documents.',
    };
  } catch (err: any) {
    return {
      ok: false,
      folderId,
      folderUrl: canonicalFolderUrl,
      files: [],
      code: 'NETWORK_ERROR',
      message: `Failed to fetch Google Drive folder: ${err?.message || String(err)}`,
    };
  }
}

/**
 * Helper to fetch a single Google Doc by ID.
 */
async function fetchSingleGoogleDoc(
  docId: string,
  rawUrl: string,
  apiKey: string,
  token: string,
  fetchFn: typeof fetch
): Promise<GoogleDriveFetchResult> {
  const canonicalUrl = `https://docs.google.com/document/d/${docId}/edit`;

  // First try public export (works without API key if shared to anyone with link)
  try {
    const publicExportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
    const res = await fetchFn(publicExportUrl);
    if (res.ok) {
      const text = await res.text();
      if (text.trim() && !text.includes('accounts.google.com/ServiceLogin')) {
        return {
          ok: true,
          folderId: null,
          folderUrl: canonicalUrl,
          files: [
            {
              id: docId,
              name: 'Google Document',
              content: text.slice(0, 500_000),
              type: 'markdown',
              sizeBytes: Buffer.byteLength(text, 'utf8'),
              sourceUrl: canonicalUrl,
            },
          ],
          message: 'Successfully imported Google Document content.',
        };
      }
    }
  } catch {
    // Fall back to API
  }

  // If public export was not accessible, try Google Drive API
  if (apiKey || token) {
    try {
      const exportUrl = `https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/plain${apiKey ? `&key=${encodeURIComponent(apiKey)}` : ''}`;
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetchFn(exportUrl, { headers });
      if (res.ok) {
        const text = await res.text();
        return {
          ok: true,
          folderId: null,
          folderUrl: canonicalUrl,
          files: [
            {
              id: docId,
              name: 'Google Document',
              content: text.slice(0, 500_000),
              type: 'markdown',
              sizeBytes: Buffer.byteLength(text, 'utf8'),
              sourceUrl: canonicalUrl,
            },
          ],
          message: 'Successfully imported Google Document via Drive API.',
        };
      }
    } catch {
      // ignore
    }
  }

  return {
    ok: false,
    folderId: null,
    folderUrl: canonicalUrl,
    files: [],
    code: 'ACCESS_DENIED',
    message: 'Could not access Google Document. Make sure the document sharing is set to "Anyone with the link can view", or provide a Google API key.',
  };
}
