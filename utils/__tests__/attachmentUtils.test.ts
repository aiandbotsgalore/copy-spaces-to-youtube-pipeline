import { describe, it, expect } from 'vitest';
import {
  isImageFile,
  isDocumentFile,
  formatFileSize,
  formatAttachmentsForPrompt,
  extractFilesFromClipboard,
  extractFilesFromDataTransfer,
} from '../attachmentUtils';
import type { CopilotAttachment } from '../copilotTypes';

describe('attachmentUtils', () => {
  describe('isImageFile', () => {
    it('identifies image mime types correctly', () => {
      expect(isImageFile({ type: 'image/png', name: 'photo' })).toBe(true);
      expect(isImageFile({ type: 'image/jpeg', name: 'photo' })).toBe(true);
      expect(isImageFile({ type: 'image/webp', name: 'photo' })).toBe(true);
      expect(isImageFile({ type: 'image/gif', name: 'photo' })).toBe(true);
    });

    it('identifies image file extensions correctly when mime is missing or generic', () => {
      expect(isImageFile({ type: '', name: 'screenshot.PNG' })).toBe(true);
      expect(isImageFile({ type: 'application/octet-stream', name: 'avatar.jpg' })).toBe(true);
      expect(isImageFile({ type: '', name: 'banner.webp' })).toBe(true);
      expect(isImageFile({ type: '', name: 'icon.svg' })).toBe(true);
    });

    it('rejects non-image files', () => {
      expect(isImageFile({ type: 'text/plain', name: 'doc.txt' })).toBe(false);
      expect(isImageFile({ type: 'application/pdf', name: 'report.pdf' })).toBe(false);
      expect(isImageFile({ type: 'application/json', name: 'data.json' })).toBe(false);
    });
  });

  describe('isDocumentFile', () => {
    it('identifies document mime types correctly', () => {
      expect(isDocumentFile({ type: 'text/plain', name: 'notes.txt' })).toBe(true);
      expect(isDocumentFile({ type: 'text/markdown', name: 'readme.md' })).toBe(true);
      expect(isDocumentFile({ type: 'application/json', name: 'config.json' })).toBe(true);
      expect(isDocumentFile({ type: 'text/csv', name: 'data.csv' })).toBe(true);
      expect(isDocumentFile({ type: 'application/pdf', name: 'invoice.pdf' })).toBe(true);
    });

    it('identifies document file extensions correctly', () => {
      expect(isDocumentFile({ type: '', name: 'workflow.yml' })).toBe(true);
      expect(isDocumentFile({ type: '', name: 'script.py' })).toBe(true);
      expect(isDocumentFile({ type: '', name: 'Component.tsx' })).toBe(true);
      expect(isDocumentFile({ type: '', name: 'server.log' })).toBe(true);
      expect(isDocumentFile({ type: '', name: 'contract.docx' })).toBe(true);
    });

    it('rejects image files', () => {
      expect(isDocumentFile({ type: 'image/png', name: 'pic.png' })).toBe(false);
      expect(isDocumentFile({ type: 'image/jpeg', name: 'photo.jpg' })).toBe(false);
    });
  });

  describe('formatFileSize', () => {
    it('formats bytes, kilobytes, and megabytes cleanly', () => {
      expect(formatFileSize(512)).toBe('512 B');
      expect(formatFileSize(2048)).toBe('2.0 KB');
      expect(formatFileSize(15000)).toBe('14.6 KB');
      expect(formatFileSize(2500000)).toBe('2.4 MB');
    });
  });

  describe('formatAttachmentsForPrompt', () => {
    it('returns empty string when attachments are absent or empty', () => {
      expect(formatAttachmentsForPrompt()).toBe('');
      expect(formatAttachmentsForPrompt([])).toBe('');
    });

    it('formats document text content into fenced block', () => {
      const attachments: CopilotAttachment[] = [
        {
          id: 'att_1',
          name: 'pipeline_config.json',
          size: 1024,
          type: 'document',
          mimeType: 'application/json',
          textContent: '{\n  "name": "twitter-pipeline"\n}',
        },
      ];
      const result = formatAttachmentsForPrompt(attachments);
      expect(result).toContain('ATTACHED DOCUMENT: pipeline_config.json (1.0 KB)');
      expect(result).toContain('{\n  "name": "twitter-pipeline"\n}');
    });

    it('formats image metadata into image block', () => {
      const attachments: CopilotAttachment[] = [
        {
          id: 'att_img',
          name: 'waveform_screenshot.png',
          size: 250000,
          type: 'image',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,iVBORw0KGgo...',
        },
      ];
      const result = formatAttachmentsForPrompt(attachments);
      expect(result).toContain('[Attached Image: waveform_screenshot.png (244.1 KB)]');
    });
  });

  describe('extractFilesFromClipboard', () => {
    it('returns empty array when clipboard data is null', () => {
      expect(extractFilesFromClipboard(null)).toEqual([]);
    });

    it('extracts files from clipboard items', () => {
      const mockFile = new File(['content'], 'pasted.png', { type: 'image/png' });
      const mockItem = {
        kind: 'file',
        type: 'image/png',
        getAsFile: () => mockFile,
      };
      const mockClipboard = {
        items: [mockItem] as any,
        files: [] as any,
      } as DataTransfer;

      const files = extractFilesFromClipboard(mockClipboard);
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('pasted.png');
    });

    it('falls back to clipboard.files if items has no files', () => {
      const mockFile = new File(['data'], 'doc.pdf', { type: 'application/pdf' });
      const mockClipboard = {
        items: [] as any,
        files: [mockFile] as any,
      } as DataTransfer;

      const files = extractFilesFromClipboard(mockClipboard);
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('doc.pdf');
    });
  });

  describe('extractFilesFromDataTransfer', () => {
    it('returns empty array when dataTransfer is null', () => {
      expect(extractFilesFromDataTransfer(null)).toEqual([]);
    });

    it('extracts files from dataTransfer.files', () => {
      const mockFile1 = new File(['1'], 'screen1.png', { type: 'image/png' });
      const mockFile2 = new File(['2'], 'screen2.png', { type: 'image/png' });
      const mockDt = {
        files: [mockFile1, mockFile2] as any,
      } as DataTransfer;

      const files = extractFilesFromDataTransfer(mockDt);
      expect(files).toHaveLength(2);
      expect(files[0].name).toBe('screen1.png');
      expect(files[1].name).toBe('screen2.png');
    });
  });
});
