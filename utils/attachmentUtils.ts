import type { CopilotAttachment, AttachmentType } from './copilotTypes';

export const ACCEPTED_FILE_TYPES = 'image/*,.txt,.md,.markdown,.json,.csv,.log,.js,.ts,.tsx,.jsx,.py,.html,.htm,.css,.scss,.yaml,.yml,.xml,.pdf,.doc,.docx,.rtf,.sh,.sql';

export function isImageFile(file: { type?: string; name?: string }): boolean {
  if (file.type && file.type.startsWith('image/')) {
    return true;
  }
  const name = (file.name || '').toLowerCase();
  return /\.(png|jpe?g|webp|gif|svg|bmp|ico|avif)$/i.test(name);
}

export function isDocumentFile(file: { type?: string; name?: string }): boolean {
  if (isImageFile(file)) return false;
  if (file.type && (
    file.type.startsWith('text/') ||
    file.type.includes('json') ||
    file.type.includes('pdf') ||
    file.type.includes('document') ||
    file.type.includes('sheet') ||
    file.type.includes('csv') ||
    file.type.includes('xml')
  )) {
    return true;
  }
  const name = (file.name || '').toLowerCase();
  return /\.(txt|md|markdown|json|csv|log|js|ts|tsx|jsx|py|html|htm|css|scss|yaml|yml|xml|pdf|doc|docx|rtf|sh|sql)$/i.test(name);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Downscale image if it exceeds max dimension (e.g. 1600px) to conserve browser memory / storage.
 */
async function optimizeImageDataUrl(dataUrl: string, maxDim = 1600, quality = 0.85): Promise<string> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return dataUrl;
  }
  try {
    return await new Promise<string>((resolve) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width <= maxDim && height <= maxDim) {
          resolve(dataUrl);
          return;
        }
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  } catch {
    return dataUrl;
  }
}

/**
 * Reads a File and produces a CopilotAttachment object.
 */
export async function readFileAsAttachment(file: File): Promise<CopilotAttachment> {
  const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const isImg = isImageFile(file);
  const type: AttachmentType = isImg ? 'image' : 'document';
  const mimeType = file.type || (isImg ? 'image/png' : 'text/plain');

  if (isImg) {
    const rawDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error || new Error('Failed to read image file'));
      reader.readAsDataURL(file);
    });
    const optimized = await optimizeImageDataUrl(rawDataUrl);
    return {
      id,
      name: file.name,
      size: file.size,
      type: 'image',
      mimeType,
      dataUrl: optimized,
    };
  }

  // Document or text file
  const textContent = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      // Limit to 100k characters for safe prompt inclusion
      resolve(result.slice(0, 100000));
    };
    reader.onerror = () => resolve(`[Error reading file contents: ${file.name}]`);
    reader.readAsText(file);
  });

  return {
    id,
    name: file.name,
    size: file.size,
    type: 'document',
    mimeType,
    textContent,
  };
}

/**
 * Extracts File items from clipboard data (for copy/paste).
 */
export function extractFilesFromClipboard(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) return [];
  const files: File[] = [];

  // Check items first (handles copied images from browsers/screenshots)
  if (clipboardData.items && clipboardData.items.length > 0) {
    for (let i = 0; i < clipboardData.items.length; i++) {
      const item = clipboardData.items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          // If pasted image without filename, generate a friendly name
          const finalFile = !file.name || file.name === 'image.png'
            ? new File([file], `pasted_image_${Date.now()}.png`, { type: file.type || 'image/png' })
            : file;
          files.push(finalFile);
        }
      }
    }
  }

  // If no items extracted, fallback to files list
  if (files.length === 0 && clipboardData.files && clipboardData.files.length > 0) {
    for (let i = 0; i < clipboardData.files.length; i++) {
      files.push(clipboardData.files[i]);
    }
  }

  return files;
}

/**
 * Extracts File items from drag & drop dataTransfer.
 */
export function extractFilesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return [];
  const files: File[] = [];

  if (dataTransfer.files && dataTransfer.files.length > 0) {
    for (let i = 0; i < dataTransfer.files.length; i++) {
      files.push(dataTransfer.files[i]);
    }
  } else if (dataTransfer.items && dataTransfer.items.length > 0) {
    for (let i = 0; i < dataTransfer.items.length; i++) {
      const item = dataTransfer.items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
  }

  return files;
}

/**
 * Format attachments for inclusion into the prompt sent to the LLM.
 */
export function formatAttachmentsForPrompt(attachments?: CopilotAttachment[]): string {
  if (!attachments || attachments.length === 0) return '';

  const blocks: string[] = [];

  for (const att of attachments) {
    if (att.type === 'document' && att.textContent) {
      blocks.push(
        `--- ATTACHED DOCUMENT: ${att.name} (${formatFileSize(att.size)}) ---\n\`\`\`\n${att.textContent.slice(0, 30000)}\n\`\`\``
      );
    } else if (att.type === 'image') {
      blocks.push(`[Attached Image: ${att.name} (${formatFileSize(att.size)})]`);
    } else {
      blocks.push(`[Attached File: ${att.name} (${formatFileSize(att.size)})]`);
    }
  }

  return blocks.join('\n\n');
}
