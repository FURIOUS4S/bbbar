// Kalici durum dosyasi. Bot yeniden baslayinca gorulen siparisler kaybolmasin.
import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = {
  chatId: null,
  monitor: true,
  autoDeliver: false,
  seenOrders: [], // en yeni 500 siparis id'si
  autoDeliveryTexts: {}, // offerId -> teslim metni
  lastOrderAt: null,
  startedAt: null,
};

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'state.json');
    this.data = { ...DEFAULTS };
    this.timer = null;
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = { ...DEFAULTS, ...parsed };
      }
    } catch (err) {
      console.error('[store] state.json okunamadi, sifirdan baslaniyor:', err.message);
    }
    if (!Array.isArray(this.data.seenOrders)) this.data.seenOrders = [];
    if (typeof this.data.autoDeliveryTexts !== 'object' || !this.data.autoDeliveryTexts) {
      this.data.autoDeliveryTexts = {};
    }
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.saveSoon();
  }

  /** Siparis id'si daha once goruldu mu? */
  hasSeen(orderId) {
    return this.data.seenOrders.includes(orderId);
  }

  markSeen(orderId) {
    if (this.hasSeen(orderId)) return;
    this.data.seenOrders.unshift(orderId);
    if (this.data.seenOrders.length > 500) this.data.seenOrders.length = 500;
    this.saveSoon();
  }

  saveSoon() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.save();
    }, 300);
  }

  save() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[store] state.json yazilamadi:', err.message);
    }
  }
}
