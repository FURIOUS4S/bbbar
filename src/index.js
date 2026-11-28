// Giris noktasi.
import fs from 'node:fs';
import http from 'node:http';
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

const LOG_FILE = path.join(ROOT, 'data', 'bot.log');
const LOG_MAX_BYTES = 2 * 1024 * 1024;

/** Konsola yazar ve ayni satiri data/bot.log'a ekler (bot neden durdu hep gorulebilsin). */
function log(...args) {
  const text = args
    .map((a) => (typeof a === 'string' ? a : a instanceof Error ? (a.stack ?? a.message) : JSON.stringify(a)))
    .join(' ');
  const line = `[${new Date().toISOString().slice(11, 19)}] ${text}`;
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    try {
      if (fs.statSync(LOG_FILE).size > LOG_MAX_BYTES) fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
    } catch {
      /* dosya henuz yok */
    }
    fs.appendFileSync(LOG_FILE, `${line}\n`);
  } catch {
    /* log yazilamazsa bot calismaya devam etsin */
  }
}

process.on('unhandledRejection', (err) => log('[hata] islenmeyen promise reddi:', err?.message ?? err));
process.on('uncaughtException', (err) => {
  log('[hata] yakalanmayan istisna:', err?.stack ?? err);
  process.exit(1);
});

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

  // Render/Railway gibi platformlar PORT ister: saglik ucu (sir icermez).
  let health = null;
  if (process.env.PORT) {
    health = http.createServer((req, res) => {
      if (req.url === '/' || req.url.startsWith('/health')) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            ok: true,
            uptimeSec: Math.round(process.uptime()),
            monitor: store.get('monitor'),
            chatConfigured: Boolean(store.get('chatId')),
            lastOrderAt: store.get('lastOrderAt'),
            now: new Date().toISOString(),
          }),
        );
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
    });
    health.on('error', (err) => log('[server] saglik ucu hatasi:', err.message));
    health.listen(Number(process.env.PORT), '0.0.0.0', () =>
      log(`[server] saglik ucu dinleniyor (port ${process.env.PORT})`),
    );

    // Render ucretsiz plan: disaridan istek gelmezse 15 dk sonra uykuya gecer.
    // Kendi saglik ucumuza periyodik istek atarak uyanik kal (RENDER_EXTERNAL_URL
    // Render tarafindan otomatik verilir).
    if (process.env.RENDER_EXTERNAL_URL) {
      const selfUrl = `${process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, '')}/health`;
      setInterval(
        () => fetch(selfUrl, { signal: AbortSignal.timeout(15_000) }).catch(() => {}),
        5 * 60 * 1000,
      ).unref?.();
      log(`[server] kendini uyanik tutma acik: ${selfUrl} (5 dk)`);
    }
  }

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
    health?.close();
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
