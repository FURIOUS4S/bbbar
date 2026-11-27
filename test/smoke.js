// Canli API'ye karsi salt-okunur dumani testi (komutlar + butonlar).
// Yazma islemleri (fiyat/stok/duraklat/teslim) KASITLI olarak test edilmez.
// Calistirma:  node test/smoke.js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../src/env.js';
import { Eldorado } from '../src/eldorado.js';
import { createBot } from '../src/bot.js';
import { Store } from '../src/store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(ROOT);

const api = new Eldorado({
  clientId: process.env.ELDORADO_CLIENT_ID,
  clientSecret: process.env.ELDORADO_CLIENT_SECRET,
});

const store = new Store(path.join(ROOT, 'data', 'test-state'));
store.load();
store.set('pollSeconds', 45);

const sent = [];
const tg = {
  async send(chatId, text, opts) {
    sent.push({ chatId, text, keyboard: opts?.keyboard ?? null });
    return { message_id: sent.length };
  },
  async edit(chatId, messageId, text, opts) {
    sent.push({ chatId, text, keyboard: opts?.keyboard ?? null, edited: true });
    return { message_id: messageId };
  },
  answerCallback() {},
};

const monitor = { start() {}, stop() {} };
const bot = createBot({ api, store, tg, monitor, log: () => {} });

const CHAT = 1;
const msgs = [];
const cbs = [];

async function run(kind, arg) {
  const before = sent.length;
  if (kind === 'msg') await bot.handleMessage({ chat: { id: CHAT }, text: arg });
  else await bot.handleCallback({ id: 1, data: arg, message: { chat: { id: CHAT }, message_id: 1 } });
  const out = sent.slice(before);
  const first = out[0]?.text?.split('\n')[0] ?? '(yanıt yok)';
  return { out, first, ok: out.length > 0 && !first.startsWith('❌') };
}

for (const text of ['/start', '/panel', '/siparisler', '/bekleyen', '/teklifler', '/ayarlar', '/yardim']) {
  const r = await run('msg', text);
  (r.ok ? msgs : cbs).push([text, r]);
  console.log(`${r.ok ? '✅' : '❌'} ${text} -> ${r.first.slice(0, 60)}`);
}

const { offers } = await api.listOffers({ pageSize: 1 });
const offerRef = offers[0]?.id ?? '';
const { results: orders } = { results: await api.listOrders({ pageSize: 1 }) };
const orderRef = orders[0]?.id ?? '';

for (const data of ['dash:open', 'dash:refresh', 'ord:list:0', 'off:list:0', `off:one:${offerRef}`, `ord:one:${orderRef}`, 'help:open', 'set:open']) {
  const r = await run('cb', data);
  if (!r.ok) cbs.push([data, r]);
  console.log(`${r.ok ? '✅' : '❌'} [${data}] -> ${r.first.slice(0, 60)}`);
}

// Buton bulunan ekranlar gercekten buton uretiyor mu?
const withButtons = sent.filter((m) => Array.isArray(m.keyboard) && m.keyboard.length > 0).length;
console.log(`\n🔘 Butonlu ekran: ${withButtons}/${sent.length}`);

if (cbs.length) {
  console.log(`\n${cbs.length} test başarısız:`);
  for (const [name, r] of cbs) console.log(`  • ${name}: ${r.first}`);
  process.exit(1);
}
console.log('\nTüm salt-okunur komutlar ve butonlar çalışıyor.');
