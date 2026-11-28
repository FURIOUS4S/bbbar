// Siparis izleyici: yeni siparisi yakalar, Telegram'a bildirir, gerekirse teslim eder.
import { orderTitle, shortId } from './format.js';
import { orderAlert, missedSummary } from './ui.js';

const PENDING_STATES = new Set(['Paid']);
// Bot kapaliyken bu sayidan fazla siparis biriktiyse tek ozet gonderilir.
const CATCHUP_LIMIT = 3;

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
    this.firstTick = true; // surec basladiktan sonraki ilk kontrol
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

  /** Odeme bekleyen siparisi, teklif icin metin tanimliysa teslim eder. */
  async autoDeliver(order) {
    if (!PENDING_STATES.has(order.state?.state)) return null;
    if (!this.store.get('autoDeliver')) return null;
    const text = this.store.get('autoDeliveryTexts')?.[order.offerId];
    if (!text) return null;
    try {
      await this.api.deliverOrder(order.id, text);
      this.log(`[monitor] otomatik teslimat OK ${shortId(order.id)}`);
      return '✅ Otomatik teslimat yapıldı.';
    } catch (err) {
      this.log(`[monitor] otomatik teslimat HATA ${shortId(order.id)}: ${err.message}`);
      return `⚠️ Otomatik teslimat başarısız: ${err.message}`;
    }
  }

  async sendAlert(chatId, order, autoNote = null) {
    if (!chatId) return; // henuz /start yapilmamis
    try {
      const view = orderAlert(order, { autoNote });
      await this.notify(chatId, view.text, { keyboard: view.keyboard });
    } catch (err) {
      this.log('[monitor] bildirim gonderilemedi:', err.message);
    }
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
        this.firstTick = false;
        this.log(`[monitor] baslangic: ${orders.length} mevcut siparis kaydedildi, yeni siparisler bildirilecek.`);
        return;
      }

      const fresh = orders.filter((o) => !this.store.hasSeen(o.id)).reverse(); // eskiden yeniye

      // Uzun sure kapali kaldiysa: tek ozet gonder, 20 ayri bildirim yagmuru olmasin.
      if (this.firstTick && fresh.length > CATCHUP_LIMIT) {
        this.firstTick = false;
        let delivered = 0;
        for (const order of fresh) {
          this.store.markSeen(order.id);
          if (await this.autoDeliver(order)) delivered += 1;
        }
        this.store.set('lastOrderAt', new Date().toISOString());
        this.log(`[monitor] bot kapaliyken ${fresh.length} siparis gelmis (${delivered} oto teslim); ozet gonderiliyor.`);
        if (chatId) {
          try {
            const view = missedSummary(fresh, { delivered });
            await this.notify(chatId, view.text, { keyboard: view.keyboard });
          } catch (err) {
            this.log('[monitor] ozet gonderilemedi:', err.message);
          }
        }
        return;
      }
      this.firstTick = false;

      for (const order of fresh) {
        this.store.markSeen(order.id);
        this.store.set('lastOrderAt', new Date().toISOString());
        this.log(`[monitor] yeni siparis ${shortId(order.id)} | ${orderTitle(order)} | ${order.state?.state}`);

        const autoNote = await this.autoDeliver(order);
        await this.sendAlert(chatId, order, autoNote);
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
