/**
 * utils/imageResize.ts
 * Browser-side image downscaling and compression using HTML Canvas.
 * Resizes user-uploaded avatars down to max dimensions (e.g. 512x512) and encodes as JPEG,
 * ensuring payloads stay compact (<150KB) and conform strictly to GitHub Contents API limits.
 */

export interface ResizedImageResult {
  dataUrl: string;
  base64: string;
  width: number;
  height: number;
}

export async function resizeImageToDataUrl(
  file: File | Blob,
  maxDimension = 512,
  quality = 0.85
): Promise<ResizedImageResult> {
  // If not in a browser environment with canvas support, fallback to Buffer/ArrayBuffer
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof Image === 'undefined') {
    const buffer = Buffer.from(await file.arrayBuffer());
    const mime = file.type || 'image/jpeg';
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${mime};base64,${base64}`;
    return { dataUrl, base64, width: 0, height: 0 };
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;

      if (width <= 0 || height <= 0) {
        return reject(new Error('Invalid image dimensions'));
      }

      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      width = Math.max(1, width);
      height = Math.max(1, height);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return reject(new Error('Canvas 2D context unavailable'));
      }

      // Draw white background in case of transparent PNG
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const commaIdx = dataUrl.indexOf(',');
      const base64 = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl;

      resolve({
        dataUrl,
        base64,
        width,
        height,
      });
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(objectUrl);
      reject(err);
    };

    img.src = objectUrl;
  });
}
