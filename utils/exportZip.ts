import JSZip from 'jszip';
import { PipelineFile, EnhancedConfig } from '../types';

export function normalizeLineEndings(content: string, language: string): string {
  if (language === 'bash' || language === 'yaml' || language === 'text') {
    return content.replace(/\r\n/g, '\n');
  }
  return content;
}

export async function exportPipelineZip(files: PipelineFile[], config: EnhancedConfig): Promise<void> {
  const zip = new JSZip();

  for (const file of files) {
    const rawContent = file.content(config);
    const cleanContent = normalizeLineEndings(rawContent, file.language);
    zip.file(file.path, cleanContent);
  }

  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  const repoName = config.repoName.trim() || 'pipeline-bundle';
  a.download = `${repoName}-pipeline.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
