/** Download / convert PDF payloads (n8n / PDFShift). */

export function isUsablePdfBase64(value) {
  if (typeof value !== 'string' || value.length < 200) return false;
  if (value === 'filesystem-v2' || value.startsWith('filesystem-v2:')) return false;
  return true;
}

export function base64ToUint8Array(base64) {
  const cleaned = base64.includes(',') ? base64.split(',').pop() : base64;
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function base64ToBlob(base64, mimeType = 'application/pdf') {
  return new Blob([base64ToUint8Array(base64)], { type: mimeType });
}

/** iOS Safari blocks programmatic downloads without a user gesture. */
export function requiresUserGestureForPdfDownload() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return isIOS;
}

export function createPdfBlobUrl(base64, mimeType = 'application/pdf') {
  if (!isUsablePdfBase64(base64)) {
    throw new Error('PDF indisponible (données binaires manquantes).');
  }
  const blob = base64ToBlob(base64, mimeType);
  return URL.createObjectURL(blob);
}

export function downloadPdfFromBlobUrl(url, filename = 'bilan-ash-ledger.pdf') {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename || 'bilan-ash-ledger.pdf';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function downloadPdfFromBase64(base64, filename = 'bilan-ash-ledger.pdf') {
  const url = createPdfBlobUrl(base64);
  downloadPdfFromBlobUrl(url, filename);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return url;
}

/** User-gesture handler: download, or Share API on iOS when available. */
export async function openPdfFromMeta(pdfMeta) {
  if (!pdfMeta?.url) return false;
  const filename = pdfMeta.filename || 'bilan-ash-ledger.pdf';

  if (typeof navigator !== 'undefined' && navigator.share && pdfMeta.base64 && isUsablePdfBase64(pdfMeta.base64)) {
    try {
      const blob = base64ToBlob(pdfMeta.base64, pdfMeta.mimeType || 'application/pdf');
      const file = new File([blob], filename, { type: pdfMeta.mimeType || 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return true;
      }
    } catch {
      /* fall through to anchor download / open */
    }
  }

  if (requiresUserGestureForPdfDownload()) {
    window.open(pdfMeta.url, '_blank', 'noopener,noreferrer');
    return true;
  }

  downloadPdfFromBlobUrl(pdfMeta.url, filename);
  return true;
}
