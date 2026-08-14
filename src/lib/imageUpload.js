/** Normalize image files for upload (HEIC/HEIF from iPhone → JPEG when possible). */

function isHeicFile(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  return type.includes('heic') || type.includes('heif') || /\.heic$/.test(name) || /\.heif$/.test(name);
}

async function heicToJpeg(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) return null;
      const baseName = String(file.name || 'photo').replace(/\.(heic|heif)$/i, '');
      return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
    } catch {
      return null;
    }
  }
  return null;
}

export async function normalizeImageUploadFile(file) {
  if (!file) return null;
  if (isHeicFile(file)) {
    const converted = await heicToJpeg(file);
    if (converted) return converted;
  }
  return file;
}

export function isAcceptedImageFile(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|heic|heif)$/i.test(name);
}
