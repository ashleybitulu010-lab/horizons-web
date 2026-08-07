/** Download a PDF from a base64 payload (n8n / PDFShift). */

export function isUsablePdfBase64(value) {
  if (typeof value !== 'string' || value.length < 200) return false;
  if (value === 'filesystem-v2' || value.startsWith('filesystem-v2:')) return false;
  return true;
}

export function downloadPdfFromBase64(base64, filename = 'bilan-ash-ledger.pdf') {
  if (!isUsablePdfBase64(base64)) {
    throw new Error('PDF indisponible (données binaires manquantes).');
  }
  const cleaned = base64.includes(',') ? base64.split(',').pop() : base64;
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename || 'bilan-ash-ledger.pdf';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Keep blob URL briefly so the chat button can re-download.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return url;
}
