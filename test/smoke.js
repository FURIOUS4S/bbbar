// Canli API'ye karsi salt-okunur dumani testi (komutlar + butonlar).
// Yazma islemleri (fiyat/stok/duraklat/sil/teslim/iptal) KASITLI olarak test edilmez.
// Calistirma:  node test/smoke.js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../src/env.js';
import { Eldorado } from '../src/eldorado.js';
import { createBot } from '../src/bot.js';
import { Store } from '../src/store.js';
import * as offersApi from '../src/offers.js';

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
  answerCallback() {
    return Promise.resolve();
  },
};

const bot = createBot({ api, store, tg, monitor: { start() {}, stop() {} }, log: () => {} });
const CHAT = 1;

let failures = 0;
async function run(label, fn) {
  const before = sent.length;
  await fn();
  const out = sent.slice(before);
  const first = out[0]?.text?.split('\n')[0] ?? '(yanıt yok)';
  const ok = out.length > 0 && !first.startsWith('❌');
  if (!ok) failures += 1;
  console.log(`${ok ? '✅' : '❌'} ${label} -> ${first.slice(0, 58)}`);
}
const msg = (text) => () => bot.handleMessage({ chat: { id: CHAT }, text });
const cb = (data) => () => bot.handleCallback({ id: 1, data, message: { chat: { id: CHAT }, message_id: 1 } });

for (const text of ['/start', '/panel', '/siparisler', '/bekleyen', '/teklifler', '/bildirimler', '/yorumlar', '/ayarlar', '/yardim']) {
  await run(text, msg(text));
}

for (const data of [
  'menu:open', 'dash:open', 'ord:menu', 'ord:list:all:0', 'ord:list:pending:0',
  'off:menu', 'off:item:list:0', 'off:account:list:0', 'off:predefined:list:0',
  'notif:list:0', 'rev:list:0', 'boost:list', 'set:open', 'help:open',
]) {
  await run(`[${data}]`, cb(data));
}

// Her tipten bir teklif detayi
for (const type of offersApi.TYPE_KEYS) {
  const { offers } = await offersApi.listOffers(api, type, 0, 1);
  if (!offers[0]) {
    console.log(`⏭ [off:${type}:one] teklif yok, atlandi`);
    continue;
  }
  await run(`[off:${type}:one]`, cb(`off:${type}:one:${offers[0].id.slice(0, 8)}`));
}

// Siparis detayi
const orders = await api.listOrders({ pageIndex: 1, pageSize: 1 });
if (orders[0]) await run('[ord:one]', cb(`ord:one:${orders[0].id.slice(0, 8)}`));

const withButtons = sent.filter((m) => Array.isArray(m.keyboard) && m.keyboard.length > 0).length;
console.log(`\n🔘 Butonlu ekran: ${withButtons}/${sent.length}`);

if (failures) {
  console.log(`\n${failures} test başarısız.`);
  process.exit(1);
}
console.log('\nTüm salt-okunur komutlar ve butonlar çalışıyor.');
