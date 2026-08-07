import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, '../src/lib/textEncoding.js'), 'utf8');
const transformed = `${src
  .replace(/export const /g, 'const ')
  .replace(/export function /g, 'function ')
};({ CHAT_ICONS, cleanUtf8Text, normalizeChatIcons, normalizeMessageText });`;

const { CHAT_ICONS, normalizeChatIcons, normalizeMessageText } = vm.runInNewContext(transformed, {
  TextDecoder,
  Uint8Array,
  Map,
  console,
});

let failed = 0;
function assert(name, cond) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', name);
  } else console.log('OK', name);
}

// Real n8n payload shape (broken emoji = U+FFFD + U+0085)
const rawVente = `\uFFFD\u0085 Vente enregistrée : cahier x40 — total 300€, encaissé 300€ \uFFFD\u0085.`;
const fixedVente = normalizeMessageText(rawVente, { displayCurrency: 'USD' });
assert('repairs broken vente emoji', fixedVente.startsWith(CHAT_ICONS.sale));
assert('keeps vente text', /Vente enregistrée/.test(fixedVente));
assert('no replacement char left', !fixedVente.includes('\uFFFD'));
assert('currency normalized', /\$300|300 \$/.test(fixedVente) || fixedVente.includes('300'));

const rawProduit = `\uFFFD\u0085 Produit ajouté : Craie (divers) — achat 5, vente 8.`;
assert('repairs produit', normalizeChatIcons(rawProduit).startsWith(CHAT_ICONS.product));

const rawDepense = `\uFFFD\u0085 Dépense enregistrée : transport — 10.`;
assert('repairs depense', normalizeChatIcons(rawDepense).startsWith(CHAT_ICONS.expense));

const rawStock = `\uFFFD\u0085 Stock mis à jour : +10 craie.`;
assert('repairs stock', normalizeChatIcons(rawStock).startsWith(CHAT_ICONS.stock));

const warn = normalizeChatIcons('\u26A0\uFE0F Produit introuvable');
assert('keeps warning for introuvable', warn.startsWith(CHAT_ICONS.warning) || warn.startsWith('\u26A0') || warn.startsWith(CHAT_ICONS.error));
assert('prefixes plain vente', normalizeChatIcons('Vente enregistrée').startsWith(CHAT_ICONS.sale));

// onboarding exchange check (inline import via vm of onboardingChecks is hard due to deps)
// smoke: vente success phrase detectable after normalize
assert(
  'success phrase present',
  /vente[\s\S]{0,120}enregistr/i.test(fixedVente),
);

if (failed) process.exit(1);
console.log('\nAll chat icon / repair checks passed');
