import { zip, strToU8, AsyncZippable } from 'fflate';

/**
 * Creates a downloadable ZIP blob from a record of file paths to string/Uint8Array contents.
 */
export async function createZipBlob(
  files: Record<string, string | Uint8Array>
): Promise<Blob> {
  const zipData: AsyncZippable = {};

  for (const [filePath, content] of Object.entries(files)) {
    if (typeof content === 'string') {
      zipData[filePath] = strToU8(content);
    } else {
      zipData[filePath] = content;
    }
  }

  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    zip(zipData, (err, out) => {
      if (err) reject(err);
      else resolve(out);
    });
  });

  return new Blob([bytes], { type: 'application/zip' });
}

/**
 * Triggers an immediate browser download for a Blob with the given filename.
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
