import { describe, expect, it } from 'vitest';
import { fetchGoogleDriveEvidence, parseGoogleDriveUrl } from '../../server/googleDriveService';

describe('Google Drive Service', () => {
  describe('parseGoogleDriveUrl', () => {
    it('parses standard folder URL', () => {
      const res = parseGoogleDriveUrl('https://drive.google.com/drive/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs');
      expect(res).toEqual({ type: 'folder', id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs' });
    });

    it('parses user-indexed folder URL with query params', () => {
      const res = parseGoogleDriveUrl('https://drive.google.com/drive/u/1/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs?usp=sharing');
      expect(res).toEqual({ type: 'folder', id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs' });
    });

    it('parses open?id= folder URL', () => {
      const res = parseGoogleDriveUrl('https://drive.google.com/open?id=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs');
      expect(res).toEqual({ type: 'folder', id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs' });
    });

    it('parses Google Doc URL', () => {
      const res = parseGoogleDriveUrl('https://docs.google.com/document/d/1wXkY7z9a_LmnopqrstuVWXYZ-1234567890/edit#heading=h.abc');
      expect(res).toEqual({ type: 'doc', id: '1wXkY7z9a_LmnopqrstuVWXYZ-1234567890' });
    });

    it('parses Google Sheet URL', () => {
      const res = parseGoogleDriveUrl('https://docs.google.com/spreadsheets/d/1wXkY7z9a_LmnopqrstuVWXYZ-1234567890/edit');
      expect(res).toEqual({ type: 'sheet', id: '1wXkY7z9a_LmnopqrstuVWXYZ-1234567890' });
    });

    it('parses raw folder ID string', () => {
      const res = parseGoogleDriveUrl('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs');
      expect(res).toEqual({ type: 'folder', id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs' });
    });

    it('returns null for invalid inputs', () => {
      expect(parseGoogleDriveUrl('')).toBeNull();
      expect(parseGoogleDriveUrl('https://example.com/not-drive')).toBeNull();
      expect(parseGoogleDriveUrl('short')).toBeNull();
    });
  });

  describe('fetchGoogleDriveEvidence', () => {
    it('returns AUTH_REQUIRED if no API key or token is provided for a folder', async () => {
      const res = await fetchGoogleDriveEvidence({
        urlOrId: 'https://drive.google.com/drive/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs',
        env: {},
      });

      expect(res.ok).toBe(false);
      expect(res.code).toBe('AUTH_REQUIRED');
      expect(res.folderId).toBe('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs');
      expect(res.message).toMatch(/API key or access token/);
    });

    it('fetches files in folder and downloads content using mock fetch', async () => {
      const mockFetch = async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('/drive/v3/files?')) {
          return new Response(
            JSON.stringify({
              files: [
                { id: 'f1', name: 'Leaked_Doc.docx', mimeType: 'application/vnd.google-apps.document' },
                { id: 'f2', name: 'Evidence_Notes.txt', mimeType: 'text/plain' },
                { id: 'f3', name: 'Subfolder', mimeType: 'application/vnd.google-apps.folder' },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (urlStr.includes('/f1/export')) {
          return new Response('Text of the leaked document from Google Docs.', { status: 200 });
        }
        if (urlStr.includes('/f2?alt=media')) {
          return new Response('Notes from the primary source witness.', { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      };

      const res = await fetchGoogleDriveEvidence({
        urlOrId: 'https://drive.google.com/drive/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs',
        apiKey: 'test-api-key',
        fetchImpl: mockFetch as any,
      });

      expect(res.ok).toBe(true);
      expect(res.folderId).toBe('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs');
      expect(res.files).toHaveLength(2);
      expect(res.files[0].name).toBe('Leaked_Doc.docx');
      expect(res.files[0].content).toBe('Text of the leaked document from Google Docs.');
      expect(res.files[0].type).toBe('markdown');
      expect(res.files[1].name).toBe('Evidence_Notes.txt');
      expect(res.files[1].content).toBe('Notes from the primary source witness.');
    });

    it('handles Google Drive API errors gracefully', async () => {
      const mockFetch = async () => {
        return new Response(
          JSON.stringify({
            error: {
              code: 403,
              message: 'The caller does not have permission',
            },
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const res = await fetchGoogleDriveEvidence({
        urlOrId: 'https://drive.google.com/drive/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs',
        apiKey: 'test-api-key',
        fetchImpl: mockFetch as any,
      });

      expect(res.ok).toBe(false);
      expect(res.code).toBe('DRIVE_API_403');
      expect(res.message).toMatch(/The caller does not have permission/);
    });

    it('fetches a public Google Doc without requiring an API key', async () => {
      const mockFetch = async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('/document/d/1234567890abcdefghij/export?format=txt')) {
          return new Response('# Investigative Report\nDetailed background notes.', { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      };

      const res = await fetchGoogleDriveEvidence({
        urlOrId: 'https://docs.google.com/document/d/1234567890abcdefghij/edit',
        fetchImpl: mockFetch as any,
      });

      expect(res.ok).toBe(true);
      expect(res.files).toHaveLength(1);
      expect(res.files[0].content).toContain('Investigative Report');
    });
  });
});
