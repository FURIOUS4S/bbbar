// Giris noktasi.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnv, required, envNumber, envBool } from './env.js';
import { Eldorado } from './eldorado.js';
import { Telegram } from './telegram.js';
import { Store } from './store.js';
import { Monitor } from './monitor.js';
import { createBot } from './bot.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(ROOT);

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...args) => console.log(`[${stamp()}]`, ...args);

function acquireLock(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Bot zaten calisiyor gibi gorunuyor (port ${port} dolu). Diger pencereyi kapat.`));
      } else {
        reject(err);
      }
    });
    server.once('listening', () => resolve(server));
    server.listen(port, '127.0.0.1');
  });
}

async function main() {
  const clientId = required('ELDORADO_CLIENT_ID');
  const clientSecret = required('ELDORADO_CLIENT_SECRET');
  const botToken = required('TELEGRAM_BOT_TOKEN');
  const pollSeconds = envNumber('POLL_SECONDS', 45);
  const lockPort = envNumber('LOCK_PORT', 7788);

  const lock = await acquireLock(lockPort).catch((err) => {
    console.error('❌', err.message);
    process.exit(1);
  });

  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });

  const store = new Store(path.join(ROOT, 'data'));
  store.load();
  if (process.env.TELEGRAM_CHAT_ID && !store.get('chatId')) {
    store.set('chatId', process.env.TELEGRAM_CHAT_ID);
  }
  if (envBool('AUTO_DELIVER', false)) store.set('autoDeliver', true);

  store.set('pollSeconds', Math.max(20, pollSeconds));

  const api = new Eldorado({ clientId, clientSecret, log: (...a) => log('[api]', ...a) });
  const tg = new Telegram(botToken, { log: (...a) => log(...a) });

  log('Eldorado token aliniyor...');
  await api.getToken(true);
  log('✅ Eldorado baglantisi kuruldu.');

  const me = await tg.me();
  log(`✅ Telegram: @${me.username}`);

  await tg
    .api('setMyCommands', {
      commands: [
        { command: 'panel', description: 'Gösterge paneli' },
        { command: 'siparisler', description: 'Siparişler' },
        { command: 'bekleyen', description: 'İşlem bekleyen siparişler' },
        { command: 'teklifler', description: 'Teklif yönetimi' },
        { command: 'bildirimler', description: 'Bildirimler' },
        { command: 'yorumlar', description: 'Değerlendirmeler' },
        { command: 'ayarlar', description: 'Ayarlar' },
        { command: 'yardim', description: 'Yardım' },
      ],
    })
    .catch(() => null);

  const notify = (chatId, text, opts) => tg.send(chatId, text, opts);
  const monitor = new Monitor({ api, store, notify, log, pollSeconds });
  const bot = createBot({ api, store, tg, monitor, log });

  if (store.get('chatId')) {
    await tg
      .send(store.get('chatId'), '🟢 <b>Bot başlatıldı.</b>\nSiparişler izleniyor. /panel ile panele bakabilirsin.')
      .catch(() => null);
  } else {
    log('ℹ️  Henüz chat id yok. Telegram\'da bota /start yaz, otomatik kaydedilecek.');
  }

  monitor.start();
  log(`▶️  İzleme ${store.get('monitor') ? 'açık' : 'kapalı'}, kontrol aralığı ${Math.max(20, pollSeconds)} sn.`);

  const shutdown = async (signal) => {
    log(`${signal} alindi, kapatiliyor...`);
    monitor.stop();
    tg.stop();
    store.save();
    lock.close();
    setTimeout(() => process.exit(0), 300);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await tg.start({ onMessage: bot.handleMessage, onCallback: bot.handleCallback });
}

main().catch((err) => {
  console.error('❌ Başlatılamadı:', err.message);
  process.exit(1);
});
