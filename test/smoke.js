// Canli API'ye karsi salt-okunur komut dumani testi.
// Yazma islemleri (fiyat/stok/duraklat) KASITLI olarak test edilmez.
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

const sent = [];
const tg = {
  async send(chatId, text) {
    sent.push({ chatId, text });
    return { message_id: sent.length };
  },
};

const monitor = { start() {}, stop() {} };
const bot = createBot({ api, store, tg, monitor, log: () => {} });

const CHAT = 1;
const commands = ['/yardim', '/durum', '/ozet', '/siparisler', '/bekleyen', '/teklifler', '/teklifler steam'];

let failed = 0;
for (const text of commands) {
  const before = sent.length;
  await bot.handleMessage({ chat: { id: CHAT }, text });
  const out = sent.slice(before);
  const ok = out.length > 0 && !out[0].text.startsWith('❌');
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${text}${out[0] ? ` -> ${out[0].text.split('\n')[0].slice(0, 60)}` : ' (yanıt yok)'}`);
}

if (failed) {
  console.log(`\n${failed} komut başarısız.`);
  process.exit(1);
}
console.log('\nTüm salt-okunur komutlar çalışıyor.');
