const WINDOWS_1252_BYTES = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

/** Canonical chat icons — one consistent style across the app. */
export const CHAT_ICONS = {
  sale: '💰',
  expense: '💸',
  stock: '📦',
  product: '📋',
  client: '👤',
  debt: '💳',
  summary: '📊',
  success: '✅',
  warning: '⚠️',
  error: '❌',
};

const HAS_EMOJI = /\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u2600-\u27BF]/u;
const MOJIBAKE_HINT = /(?:Ã.|Â.|â.|ðŸ|ð.|ï¸)/u;

function encodingErrorCount(value) {
  return (value.match(/\uFFFD|Ã.|Â.|â.|ð.|ï¸/gu) || []).length;
}

function windows1252ToUtf8(value) {
  const bytes = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0xff) {
      bytes.push(codePoint);
      continue;
    }
    const mapped = WINDOWS_1252_BYTES.get(codePoint);
    if (mapped === undefined) return value;
    bytes.push(mapped);
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return value;
  }
}

export function cleanUtf8Text(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);

  // Never run latin1 "repair" on text that already has valid emojis.
  if (!HAS_EMOJI.test(text) && MOJIBAKE_HINT.test(text)) {
    for (let pass = 0; pass < 2; pass += 1) {
      const repaired = windows1252ToUtf8(text);
      if (encodingErrorCount(repaired) >= encodingErrorCount(text)) break;
      text = repaired;
      if (!MOJIBAKE_HINT.test(text)) break;
    }
  }

  return text
    .normalize('NFC')
    .replace(/[\u0000\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '');
}

function replacementFor(amount, currency) {
  const normalizedAmount = amount.trim();
  return currency === 'CDF' ? `${normalizedAmount} FC` : `$${normalizedAmount}`;
}

/**
 * n8n templates currently emit U+FFFD (+ leftover 0x85) instead of emojis.
 * Recover the intended icon from the following keyword.
 */
function repairBrokenLeadingIcons(text) {
  const rules = [
    [/\uFFFD[\u0085\u00A0\s]*?(Vente\b)/gi, `${CHAT_ICONS.sale} $1`],
    [/\uFFFD[\u0085\u00A0\s]*?(D[ée]pense\b)/gi, `${CHAT_ICONS.expense} $1`],
    [/\uFFFD[\u0085\u00A0\s]*?(Stock\b)/gi, `${CHAT_ICONS.stock} $1`],
    [/\uFFFD[\u0085\u00A0\s]*?(Produit\b)/gi, `${CHAT_ICONS.product} $1`],
    [/\uFFFD[\u0085\u00A0\s]*?(Client\b)/gi, `${CHAT_ICONS.client} $1`],
    [/\uFFFD[\u0085\u00A0\s]*?(Paiement\b)/gi, `${CHAT_ICONS.debt} $1`],
    [/\uFFFD[\u0085\u00A0\s]*?(Dette\b)/gi, `${CHAT_ICONS.debt} $1`],
    [/\uFFFD[\u0085\u00A0\s]*?(Bilan|Synth[eè]se|Rapport)\b/gi, `${CHAT_ICONS.summary} $1`],
    [/\uFFFD[\u0085\u00A0\s]*?(Abonnement\b)/gi, `${CHAT_ICONS.success} $1`],
    [/\uFFFD[\u0085\u00A0\s]*?(Succ[eè]s|Bravo|Parfait)\b/gi, `${CHAT_ICONS.success} $1`],
    [/\uFFFD[\u0085\u00A0\s]*?(Erreur|Impossible)\b/gi, `${CHAT_ICONS.error} $1`],
    [/\uFFFD[\u0085\u00A0\s]*?(Attention|Avertissement)\b/gi, `${CHAT_ICONS.warning} $1`],
  ];
  let out = text;
  for (const [re, repl] of rules) out = out.replace(re, repl);
  // Trailing broken icon marks (e.g. "... 300€ .")
  out = out.replace(/\s*\uFFFD[\u0085\u00A0\s]*\.?\s*$/gm, '');
  out = out.replace(/\uFFFD+/gu, '');
  return out;
}

function topicIconForText(text) {
  if (/introuvable|impossible|échec|echec|\berreur\b/i.test(text)) return CHAT_ICONS.error;
  if (/^(attention|avertissement|warning)\b/i.test(text) || /\balerte\b/i.test(text)) {
    return CHAT_ICONS.warning;
  }
  if (
    /^(succ[eè]s|bravo|parfait|super|f[ée]licitations)\b/i.test(text)
    || /enregistr[ée]e?\s+avec\s+succ[eè]s/i.test(text)
  ) {
    return CHAT_ICONS.success;
  }
  if (/(paiement\s+de\s+dette|dette\s+pay|remboursement\s+de\s+dette)/i.test(text)) {
    return CHAT_ICONS.debt;
  }
  if (/(synth[eè]se\s+mensuelle|bilan\s+mensuel|r[ée]sum[ée]\s+mensuel|rapport\s+mensuel)/i.test(text)) {
    return CHAT_ICONS.summary;
  }
  if (/^(d[ée]pense|j['']ai\s+pay[ée])\b/i.test(text)) return CHAT_ICONS.expense;
  if (/^(vente|vendu)\b/i.test(text)) return CHAT_ICONS.sale;
  if (/^(stock|quantit[ée]|inventaire)\b/i.test(text)) return CHAT_ICONS.stock;
  if (/^(produit|article)\b/i.test(text)) return CHAT_ICONS.product;
  if (/^(client)\b/i.test(text)) return CHAT_ICONS.client;
  if (/^(dette|paiement)\b/i.test(text)) return CHAT_ICONS.debt;
  if (/^(bilan|synth[eè]se|rapport)\b/i.test(text)) return CHAT_ICONS.summary;
  return null;
}

function ensureTopicEmoji(line) {
  if (!line.trim()) return line;
  // Keep lines that already have a real emoji.
  if (HAS_EMOJI.test(line)) return line;

  const match = line.match(/^(\s*)(?:[-*•]\s*)?(.*)$/u);
  if (!match) return line;
  const indent = match[1] || '';
  const rest = (match[2] || '').trimStart();
  const icon = topicIconForText(rest);
  if (!icon) return line;
  return `${indent}${icon} ${rest}`;
}

/**
 * Replace broken / inconsistent icons with the Ash Ledger emoji set.
 */
export function normalizeChatIcons(value) {
  let text = cleanUtf8Text(value);
  if (!text) return '';

  text = repairBrokenLeadingIcons(text);

  const shortcodes = [
    [/:(?:moneybag|money|sale|vente):/gi, CHAT_ICONS.sale],
    [/:(?:money_with_wings|expense|depense|dépense):/gi, CHAT_ICONS.expense],
    [/:(?:package|stock|box):/gi, CHAT_ICONS.stock],
    [/:(?:clipboard|product|produit):/gi, CHAT_ICONS.product],
    [/:(?:bust_in_silhouette|user|client):/gi, CHAT_ICONS.client],
    [/:(?:credit_card|debt|dette|paiement):/gi, CHAT_ICONS.debt],
    [/:(?:bar_chart|chart|summary|synthese|synthèse|bilan):/gi, CHAT_ICONS.summary],
    [/:(?:white_check_mark|check|success|ok):/gi, CHAT_ICONS.success],
    [/:(?:warning|alert):/gi, CHAT_ICONS.warning],
    [/:(?:x|cross_mark|error|erreur):/gi, CHAT_ICONS.error],
  ];
  for (const [re, icon] of shortcodes) text = text.replace(re, icon);

  // Alternate emoji → canonical (do not touch already-correct icons)
  text = text
    .replace(/🧾/gu, CHAT_ICONS.expense)
    .replace(/[💵💴💶💷💲🤑]/gu, CHAT_ICONS.sale)
    .replace(/[📤📥🛍️🛒]/gu, CHAT_ICONS.stock)
    .replace(/[📝🏷️]/gu, CHAT_ICONS.product)
    .replace(/[👥🧑]/gu, CHAT_ICONS.client)
    .replace(/[📈📉📑]/gu, CHAT_ICONS.summary)
    .replace(/[✔️✓☑️]/gu, CHAT_ICONS.success)
    .replace(/[✖️✗✕🚫]/gu, CHAT_ICONS.error);

  text = text
    .split('\n')
    .map((line) => ensureTopicEmoji(line))
    .join('\n');

  return text.normalize('NFC');
}

export function normalizeMessageText(value, currencySettings = {}) {
  const currency = currencySettings.displayCurrency === 'CDF' ? 'CDF' : 'USD';
  const amountPattern = '[+-]?\\d+(?:[\\s\\u00A0.,]\\d+)*';
  let text = normalizeChatIcons(value);

  text = text.replace(
    new RegExp(`€\\s*(${amountPattern})`, 'gu'),
    (_match, amount) => replacementFor(amount, currency),
  );
  text = text.replace(
    new RegExp(`(${amountPattern})\\s*€`, 'gu'),
    (_match, amount) => replacementFor(amount, currency),
  );
  text = text.replace(/\bEUR\b|€/gu, currency === 'CDF' ? 'CDF' : '$');
  return text;
}

export function compactSpacedDigits(value) {
  return cleanUtf8Text(value).replace(
    /\b\d(?:[ \u00A0]+\d){2,}\b/gu,
    (digits) => digits.replace(/[ \u00A0]+/gu, ''),
  );
}
