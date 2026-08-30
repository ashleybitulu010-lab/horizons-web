/**
 * Phase 3.7 + 3.9 — shared chat response parsing for n8n and Ashy routes.
 */

import { isAshyWriteSuccessResponse } from './chatAshyWrite.js';

function looksLikeUpstreamReconnect(text) {
  const t = String(text || '');
  return /reconnect(er|e|ion)?[\s']*(openai|l['’]?api|api|la conversation|conversation)|clé\s*api|api\s*key|fournir.*(clé|key)|nouvelle conversation(\s+ia)?|connecte[rz]?\s*(openai|l['’]?api)|session\s+openai|openai\s+(session|key|api)/i.test(t);
}

export function extractUpstreamError(data) {
  if (!data || typeof data !== 'object') return '';
  if (typeof data.error === 'string') return data.error;
  if (data.error?.message) return String(data.error.message);
  if (typeof data.message === 'string') return data.message;
  return '';
}

/**
 * @param {{ ok: boolean, rawText: string, data: object, route?: string }} response
 */
export function parseChatReplyResponse(response) {
  const { ok, rawText, data, route = 'n8n', ashyFallback = false } = response;
  const emptyUpstream = ok && !String(rawText || '').trim();
  const upstreamError = extractUpstreamError(data);
  const looksLikeEmptyN8n = route === 'n8n' && /n8n vide|json attendu/i.test(upstreamError);

  let rawReplyText;

  if (!ok) {
    rawReplyText = looksLikeUpstreamReconnect(upstreamError)
      ? "Je t'écoute 😊 Reformule simplement ta demande et on continue."
      : (upstreamError || 'Une erreur est survenue. Veuillez réessayer.');
  } else if (emptyUpstream || looksLikeEmptyN8n) {
    rawReplyText = "Ashy n'a pas pu formuler de réponse (erreur technique côté serveur). Ton message est bien reçu — réessaie dans un instant ou reformule ta demande.";
  } else {
    rawReplyText = data.reply || data.output || data.message || data.text
      || (upstreamError && !looksLikeEmptyN8n ? upstreamError : null)
      || "Je n'ai pas reçu de réponse.";
  }

  const toolResults = route === 'ashy' && Array.isArray(data.toolResults)
    ? data.toolResults
    : null;

  const hasPdf = Boolean(ok && (data.type === 'pdf' || data.filename || data.pdf_base64));

  return {
    rawReplyText,
    toolResults,
    hasPdf,
    pdfPayload: hasPdf ? {
      filename: data.filename || 'bilan-ash-ledger.pdf',
      pdf_base64: data.pdf_base64,
      mime_type: data.mime_type,
    } : null,
    shouldRefreshDashboard: (
      (ok && route === 'n8n' && !ashyFallback)
      || isAshyWriteSuccessResponse(response)
    ),
  };
}

export { looksLikeUpstreamReconnect };
