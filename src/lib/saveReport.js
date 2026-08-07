import pb from '@/lib/pocketbaseClient';
import { base64ToBlob, isUsablePdfBase64 } from '@/lib/pdfDownload';

const DB_NAME = 'ash-ledger-reports';
const STORE = 'reports';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

async function idbPut(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error || new Error('IndexedDB put failed'));
  });
}

async function idbGetAllForOwner(ownerId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const rows = (req.result || []).filter((r) => r.owner === ownerId);
      rows.sort((a, b) => String(b.created).localeCompare(String(a.created)));
      resolve(rows);
    };
    req.onerror = () => reject(req.error || new Error('IndexedDB getAll failed'));
  });
}

function monthTitle(date = new Date()) {
  const label = date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return `Bilan Ash Ledger — ${label}`;
}

/**
 * Persist a generated PDF so it appears on /reports.
 * Tries PocketBase first, always mirrors into IndexedDB as a reliable fallback.
 */
export async function saveGeneratedReport({
  userId,
  base64,
  filename = 'bilan-ash-ledger.pdf',
  type = 'monthly',
  title,
}) {
  if (!userId || !isUsablePdfBase64(base64)) {
    throw new Error('Impossible d’enregistrer le rapport.');
  }

  const blob = base64ToBlob(base64);
  const reportTitle = title || monthTitle();
  const created = new Date().toISOString();
  const localId = `local_${Date.now()}`;

  let pbReport = null;
  try {
    const form = new FormData();
    form.append('owner', userId);
    form.append('title', reportTitle);
    form.append('type', type);
    form.append('file', blob, filename);
    pbReport = await pb.collection('reports').create(form);
  } catch {
    try {
      // Some PB schemas use pdf_url instead of file — store a placeholder title only.
      pbReport = await pb.collection('reports').create({
        owner: userId,
        title: reportTitle,
        type,
      });
    } catch {
      pbReport = null;
    }
  }

  const record = {
    id: pbReport?.id || localId,
    owner: userId,
    title: reportTitle,
    type,
    created: pbReport?.created || created,
    filename,
    source: pbReport ? 'pocketbase+local' : 'local',
    blob,
    file: pbReport?.file || null,
    pdf_url: pbReport?.pdf_url || null,
  };

  await idbPut(record);
  return record;
}

/** Local reports for the Reports page (includes blob for download). */
export async function listLocalReports(userId) {
  if (!userId) return [];
  try {
    return await idbGetAllForOwner(userId);
  } catch {
    return [];
  }
}

export function downloadLocalReport(report) {
  if (!report?.blob) return false;
  const url = URL.createObjectURL(report.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = report.filename || 'bilan-ash-ledger.pdf';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
