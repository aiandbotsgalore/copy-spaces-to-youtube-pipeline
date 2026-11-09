import { zip, strToU8, AsyncZippable } from 'fflate';
import { PipelineFile, EnhancedConfig } from '../types';
import { normalizeLineEndings as normalizeLf, toPosixPath } from './posixUtils';

export function normalizeLineEndings(content: string, _language?: string): string {
  return normalizeLf(content);
}

export function buildPipelineZipData(files: PipelineFile[], config: EnhancedConfig): AsyncZippable {
  const zipData: AsyncZippable = {};

  for (const file of files) {
    const rawContent = file.content(config);
    const cleanContent = normalizeLineEndings(rawContent, file.language);
    const isExecutable = file.path.endsWith('.sh') || file.language === 'bash';
    const filePath = toPosixPath(file.path);

    // os: 3 (UNIX), attrs: 0o100755 << 16 for executable, 0o100644 << 16 for regular files
    const mode = isExecutable ? 0o100755 : 0o100644;
    zipData[filePath] = [
      strToU8(cleanContent),
      {
        os: 3,
        attrs: mode << 16,
      },
    ];
  }

  return zipData;
}

export async function generatePipelineZipBytes(files: PipelineFile[], config: EnhancedConfig): Promise<Uint8Array> {
  const zipData = buildPipelineZipData(files, config);
  return new Promise<Uint8Array>((resolve, reject) => {
    zip(zipData, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

export async function exportPipelineZip(files: PipelineFile[], config: EnhancedConfig): Promise<void> {
  const bytes = await generatePipelineZipBytes(files, config);
  const blob = new Blob([bytes], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const repoName = config.repoName.trim() || 'pipeline-bundle';
  a.download = `${repoName}-pipeline.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
