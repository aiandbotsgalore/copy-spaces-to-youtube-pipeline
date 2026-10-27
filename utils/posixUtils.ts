/**
 * utils/posixUtils.ts
 * Cross-platform path normalization, strict POSIX line endings, filename sanitization,
 * and XML 1.0 safe escaping utilities.
 */

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;
const XML_DISALLOWED_CTRL = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g;

/**
 * Guarantees strict POSIX \n line endings across all platforms,
 * removing both \r\n (CRLF) and standalone \r.
 */
export function normalizeLineEndings(content: string): string {
  if (!content) return '';
  return content.replace(/\r\n|\r/g, '\n');
}

/**
 * Converts Windows backslashes into standard web/POSIX forward slashes.
 */
export function toPosixPath(filePath: string): string {
  if (!filePath) return '';
  return filePath.replace(/\\/g, '/');
}

/**
 * Generates a cross-platform safe filename compliant with Windows NTFS, Linux, and URLs.
 * Strips reserved characters, disallows Windows device names (CON, NUL, AUX, etc.),
 * and removes trailing dots/spaces.
 */
export function sanitizeSafeFilename(name: string, fallback = 'file'): string {
  if (!name) return fallback;
  let cleaned = name.trim().replace(ILLEGAL_FILENAME_CHARS, '_');
  // Strip trailing dots and spaces (NTFS forbids trailing dots and spaces)
  cleaned = cleaned.replace(/[\.\s]+$/, '').trim();
  if (!cleaned || /^_+$/.test(cleaned)) {
    return `${fallback}_safe`;
  }
  if (WINDOWS_RESERVED_NAMES.test(cleaned)) {
    cleaned = `${cleaned}_safe`;
  }
  return cleaned.slice(0, 120);
}

/**
 * Strips XML 1.0 invalid control codes and escapes XML characters for text nodes.
 */
export function xmlSafeText(val: unknown): string {
  const str = String(val ?? '').replace(XML_DISALLOWED_CTRL, '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escapes XML attribute values including quotes and ampersands after removing disallowed control codes.
 */
export function xmlSafeAttr(val: unknown): string {
  return xmlSafeText(val)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
