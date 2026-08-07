import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, '../src/lib/textEncoding.js'), 'utf8');
const transformed = src
  .replace(/export const /g, 'const ')
  .replace(/export function /g, 'function ')
  + '\n;({ CHAT_ICONS, cleanUtf8Text, normalizeChatIcons, normalizeMessageText });\n';

const result = vm.runInNewContext(transformed, {
  TextDecoder,
  Uint8Array,
  Map,
  console,
});
const { CHAT_ICONS, cleanUtf8Text, normalizeChatIcons } = result;

let failed = 0;
function assert(name, cond) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', name);
  } else {
    console.log('OK', name);
  }
}

assert('strips replacement char', !cleanUtf8Text('Hello\uFFFDWorld').includes('\uFFFD'));
assert('sale shortcode', normalizeChatIcons(':vente: OK').includes(CHAT_ICONS.sale));
assert('expense line', normalizeChatIcons('Dépense transport 10$').startsWith(CHAT_ICONS.expense));
assert('stock line', normalizeChatIcons('Stock ajouté').startsWith(CHAT_ICONS.stock));
assert('product line', normalizeChatIcons('Produit créé').startsWith(CHAT_ICONS.product));
assert('success line', normalizeChatIcons('Bravo ! produit ok').startsWith(CHAT_ICONS.success));
assert('error line', normalizeChatIcons('Impossible de vendre').startsWith(CHAT_ICONS.error));
assert('alias dollar to sale', normalizeChatIcons('💵 Vente').includes(CHAT_ICONS.sale));
assert('no mid-sentence force', !normalizeChatIcons('Ensemble ventes et stock').startsWith(CHAT_ICONS.sale));

if (failed) process.exit(1);
console.log('\nAll chat icon checks passed');
