import JSZip from 'jszip';
import { PipelineFile, EnhancedConfig } from '../types';
import { normalizeLineEndings as normalizeLf, toPosixPath } from './posixUtils';

export function normalizeLineEndings(content: string, _language?: string): string {
  return normalizeLf(content);
}

export async function exportPipelineZip(files: PipelineFile[], config: EnhancedConfig): Promise<void> {
  const zip = new JSZip();

  for (const file of files) {
    const rawContent = file.content(config);
    const cleanContent = normalizeLineEndings(rawContent, file.language);
    const isExecutable = file.path.endsWith('.sh') || file.language === 'bash';

    zip.file(toPosixPath(file.path), cleanContent, {
      unixPermissions: isExecutable ? 0o755 : 0o644,
    });
  }

  const content = await zip.generateAsync({
    type: 'blob',
    platform: 'UNIX',
  });
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  const repoName = config.repoName.trim() || 'pipeline-bundle';
  a.download = `${repoName}-pipeline.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
