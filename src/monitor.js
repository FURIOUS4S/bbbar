// Siparis izleyici: yeni siparisi yakalar, Telegram'a bildirir, gerekirse teslim eder.
import { orderTitle, shortId } from './format.js';
import { orderAlert } from './ui.js';

const PENDING_STATES = new Set(['Paid']);

export class Monitor {
  constructor({ api, store, notify, log = console.log, pollSeconds = 45 }) {
    this.api = api;
    this.store = store;
    this.notify = notify; // async (chatId, html, opts) => void
    this.log = log;
    this.pollSeconds = Math.max(20, Number(pollSeconds) || 45);
    this.timer = null;
    this.busy = false;
    this.failures = 0;
  }

  start() {
    this.stop();
    this.tick();
    this.timer = setInterval(() => this.tick(), this.pollSeconds * 1000);
    // Ilk calistirmada mevcut siparisleri "gorulmus" say: eski siparisler icin bildirim yagmuru olmasin.
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.busy) return;
    if (!this.store.get('monitor')) return;
    this.busy = true;
    try {
      const orders = await this.api.listOrders({ pageIndex: 1, pageSize: 20 });
      this.failures = 0;
      const chatId = this.store.get('chatId');
      const baseline = this.store.get('baselineSet');

      // Ilk tur: mevcut siparisleri kaydet, sadece bundan sonrakileri bildir.
      if (!baseline) {
        for (const order of orders) this.store.markSeen(order.id);
        this.store.set('baselineSet', true);
        this.log(`[monitor] baslangic: ${orders.length} mevcut siparis kaydedildi, yeni siparisler bildirilecek.`);
        return;
      }

      const fresh = orders.filter((o) => !this.store.hasSeen(o.id)).reverse(); // eskiden yeniye
      for (const order of fresh) {
        this.store.markSeen(order.id);
        this.store.set('lastOrderAt', new Date().toISOString());
        this.log(`[monitor] yeni siparis ${shortId(order.id)} | ${orderTitle(order)} | ${order.state?.state}`);

        // Otomatik teslimat
        let autoNote = null;
        const state = order.state?.state;
        if (PENDING_STATES.has(state) && this.store.get('autoDeliver')) {
          const text = this.store.get('autoDeliveryTexts')?.[order.offerId];
          if (text) {
            try {
              await this.api.deliverOrder(order.id, text);
              autoNote = '✅ Otomatik teslimat yapıldı.';
              this.log(`[monitor] otomatik teslimat OK ${shortId(order.id)}`);
            } catch (err) {
              autoNote = `⚠️ Otomatik teslimat başarısız: ${err.message}`;
              this.log(`[monitor] otomatik teslimat HATA ${shortId(order.id)}: ${err.message}`);
            }
          }
        }

        if (!chatId) continue; // henuz /start yapilmamis
        try {
          const view = orderAlert(order, { autoNote });
          await this.notify(chatId, view.text, { keyboard: view.keyboard });
        } catch (err) {
          this.log('[monitor] bildirim gonderilemedi:', err.message);
        }
      }
    } catch (err) {
      this.failures += 1;
      this.log(`[monitor] kontrol hatasi (${this.failures}):`, err.message);
      // 3 ardısık hatadan sonra kullaniciyi bir kez uyar.
      if (this.failures === 3 && this.store.get('chatId')) {
        try {
          await this.notify(
            this.store.get('chatId'),
            `⚠️ <b>API hatası</b>\nSipariş kontrolü üst üste başarısız oluyor:\n<code>${err.message}</code>`,
          );
        } catch {
          /* sessiz */
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
