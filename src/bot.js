// Komut + buton yonlendiricisi ve adim adim giris akislari.
import { esc } from './telegram.js';
import * as ui from './ui.js';
import * as offersApi from './offers.js';
import { money, shortId } from './format.js';
import { OFFER_TYPES } from './offers.js';

const INPUT_TIMEOUT_MS = 5 * 60 * 1000;

export function createBot({ api, store, tg, monitor, log = console.log }) {
  /** chatId -> { type, ... } — butonla baslatilan adim adim giris */
  const inputs = new Map();
  const isOld = (e) => !e || Date.now() - e.at > INPUT_TIMEOUT_MS;
  const setInput = (chatId, entry) => inputs.set(chatId, { ...entry, at: Date.now() });
  const clearInput = (chatId) => inputs.delete(chatId);

  // ---------------------------------------------------------------- gonderim

  async function send(chatId, text, opts) {
    try {
      return await tg.send(chatId, text, opts);
    } catch (err) {
      log('[bot] mesaj gonderilemedi:', err.message);
      return null;
    }
  }

  async function render(chatId, view, { messageId = null } = {}) {
    if (messageId) {
      try {
        await tg.edit(chatId, messageId, view.text, { keyboard: view.keyboard });
        return null;
      } catch (err) {
        if (/not modified/i.test(err.message)) return null;
        log('[bot] duzenleme basarisiz:', err.message);
      }
    }
    return send(chatId, view.text, { keyboard: view.keyboard });
  }

  // ---------------------------------------------------------------- veri

  const localDay = (value) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  async function findOrder(ref) {
    const direct = await api.getOrder(ref).catch(() => null);
    if (direct?.id) return direct;
    const orders = await api.listOrders({ pageIndex: 1, pageSize: 50 });
    const needle = String(ref).toLowerCase();
    return orders.find((o) => String(o.id).toLowerCase().startsWith(needle)) || null;
  }

  async function dashboardView() {
    const [overview, states, pending, unread, recent] = await Promise.all([
      api.overview().catch(() => null),
      api.statesCount().catch(() => null),
      api.pendingOrdersSum().catch(() => null),
      api.unreadCount().catch(() => null),
      api.listOrders({ pageIndex: 1, pageSize: 50 }).catch(() => []),
    ]);
    const todayKey = localDay(new Date());
    const todays = recent.filter((o) => localDay(o.createdDate ?? o.state?.createdDate) === todayKey);
    const today = { count: todays.length, revenue: todays.reduce((s, o) => s + Number(o.totalPrice?.amount ?? 0), 0) };
    return ui.dashboard({ overview, states, pending, unread, store, today });
  }

  async function ordersView(filter = 'all', page = 0) {
    const orders = await api.listOrders({ pageIndex: page + 1, pageSize: ui.PAGE_SIZE });
    return ui.ordersList(orders, { filter, page, hasNext: orders.length === ui.PAGE_SIZE });
  }

  async function orderView(ref) {
    const order = await findOrder(ref);
    if (!order) {
      return { text: `❌ Sipariş bulunamadı: <code>${esc(ref)}</code>`, keyboard: [[{ text: '◀️ Siparişler', callback_data: 'ord:menu' }]] };
    }
    return ui.orderDetail(order);
  }

  async function offersView(type, page = 0) {
    const { offers, total, totalPages } = await offersApi.listOffers(api, type, page, ui.PAGE_SIZE);
    const clamped = Math.min(page, Math.max(0, totalPages - 1));
    return ui.offersList(offers, { type, page: clamped, total, totalPages });
  }

  async function offerView(type, ref) {
    const offer = await offersApi.findOffer(api, type, ref);
    if (!offer) {
      return {
        view: { text: `❌ Teklif bulunamadı: <code>${esc(ref)}</code>`, keyboard: [[{ text: '◀️ Teklifler', callback_data: 'off:menu' }]] },
        offer: null,
      };
    }
    const autoText = store.get('autoDeliveryTexts')?.[offer.id];
    return { view: ui.offerDetail(offer, { autoText }), offer };
  }

  async function notificationsView(page = 0) {
    const items = await api.listNotifications({ pageIndex: page + 1, pageSize: ui.PAGE_SIZE });
    return ui.notificationsList(items, page);
  }

  async function reviewsView(page = 0) {
    const data = await api.reviews({ pageIndex: page + 1, pageSize: ui.PAGE_SIZE });
    return ui.reviewsList(data, page);
  }

  // ---------------------------------------------------------------- giris akislari

  const PROMPTS = {
    price: (o) => [`💰 <b>${esc(o.title)}</b>`, '', 'Yeni fiyatı USD olarak yaz.', 'Örnek: <code>1.25</code>', '', '<i>İptal için /iptal</i>'].join('\n'),
    qty: (o) => [`📦 <b>${esc(o.title)}</b>`, '', 'Yeni adet sayısını yaz.', 'Örnek: <code>25</code>', '', '<i>İptal için /iptal</i>'].join('\n'),
    autoText: (o) => [`🤖 <b>${esc(o.title)}</b>`, '', 'Bu teklif için otomatik teslim metnini yaz.', 'Sipariş "ödeme alındı" durumunda gelirse bu metinle teslim edilir.', '', '<i>İptal için /iptal</i>'].join('\n'),
    deliver: (o) => [`✅ <b>${esc(o.orderOfferDetails?.offerTitle ?? 'Sipariş')}</b>`, '', 'Alıcıya gönderilecek teslim metnini yaz.', '', '<i>İptal için /iptal</i>'].join('\n'),
    search: () => ['🔎 <b>ÜRÜN TEKLİFİ ARA</b>', '', 'Aramak istediğin kelimeyi yaz.', 'Örnek: <code>steam</code>', '', '<i>İptal için /iptal</i>'].join('\n'),
  };

  async function askInput(chatId, kind, ref, { offerType } = {}) {
    if (kind === 'search') {
      setInput(chatId, { kind: 'search' });
      return send(chatId, PROMPTS.search());
    }
    if (kind === 'deliver') {
      const order = await findOrder(ref);
      if (!order) return send(chatId, `❌ Sipariş bulunamadı: <code>${esc(ref)}</code>`);
      setInput(chatId, { kind: 'deliver', orderId: order.id });
      return send(chatId, PROMPTS.deliver(order));
    }
    const offer = await offersApi.findOffer(api, offerType, ref);
    if (!offer) return send(chatId, `❌ Teklif bulunamadı: <code>${esc(ref)}</code>`);
    setInput(chatId, { kind, offerId: offer.id, offerType });
    return send(chatId, PROMPTS[kind](offer));
  }

  async function handleInput(chatId, text) {
    const entry = inputs.get(chatId);
    if (isOld(entry)) {
      clearInput(chatId);
      return false;
    }
    const value = text.trim();
    try {
      if (entry.kind === 'price') {
        const amount = Number(value.replace(',', '.'));
        if (!Number.isFinite(amount) || amount <= 0) {
          await send(chatId, '⚠️ Geçerli bir sayı yaz. Örnek: <code>1.25</code>');
          return true;
        }
        await offersApi.setPrice(api, entry.offerType, entry.offerId, amount);
        clearInput(chatId);
        await send(chatId, `✅ Fiyat güncellendi: <b>${money({ amount, currency: 'USD' })}</b>`);
        await render(chatId, (await offerView(entry.offerType, entry.offerId)).view);
        return true;
      }
      if (entry.kind === 'qty') {
        const qty = Number(value);
        if (!Number.isInteger(qty) || qty < 0) {
          await send(chatId, '⚠️ Geçerli bir tam sayı yaz. Örnek: <code>25</code>');
          return true;
        }
        await offersApi.setQuantity(api, entry.offerType, entry.offerId, qty);
        clearInput(chatId);
        await send(chatId, `✅ Adet güncellendi: <b>${qty}</b>`);
        await render(chatId, (await offerView(entry.offerType, entry.offerId)).view);
        return true;
      }
      if (entry.kind === 'autoText') {
        const map = { ...(store.get('autoDeliveryTexts') || {}), [entry.offerId]: value };
        store.set('autoDeliveryTexts', map);
        clearInput(chatId);
        await send(chatId, '✅ Otomatik teslim metni kaydedildi.');
        await render(chatId, (await offerView(entry.offerType, entry.offerId)).view);
        return true;
      }
      if (entry.kind === 'deliver') {
        await api.deliverOrder(entry.orderId, value);
        clearInput(chatId);
        await send(chatId, `✅ Sipariş teslim edildi: <code>#${esc(shortId(entry.orderId))}</code>`);
        return true;
      }
      if (entry.kind === 'search') {
        clearInput(chatId);
        const found = await offersApi.searchOffers(api, value);
        if (!found.length) {
          await send(chatId, `🔎 "<b>${esc(value)}</b>" için sonuç yok.`);
          return true;
        }
        const blocks = found.slice(0, 8).map((o) => `• <b>${esc(ui.truncate(o.title, 40))}</b>\n  ${money(o.price)} · <code>#${esc(shortId(o.id))}</code>`);
        await send(chatId, [`🔎 <b>ARAMA: ${esc(value)}</b>`, '─────────────────', ...blocks].join('\n'), {
          keyboard: found.slice(0, 5).map((o) => [{ text: ui.truncate(o.title, 34), callback_data: `off:item:one:${shortId(o.id)}` }]).concat([[{ text: '◀️ Teklifler', callback_data: 'off:menu' }]]),
        });
        return true;
      }
    } catch (err) {
      clearInput(chatId);
      await send(chatId, `❌ İşlem başarısız.\n<code>${esc(err.message)}</code>`);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- butonlar

  async function handleCallback(cq) {
    const chatId = cq.message?.chat?.id;
    const messageId = cq.message?.message_id;
    const data = String(cq.data || '');
    if (!chatId || !data) return;

    const parts = data.split(':');
    const ns = parts[0];
    Promise.resolve(tg.answerCallback(cq.id)).catch(() => null);

    try {
      // menu
      if (ns === 'menu') return render(chatId, ui.mainMenu(store), { messageId });

      // panel
      if (ns === 'dash') {
        return render(chatId, await dashboardView(), { messageId });
      }

      // siparisler
      if (ns === 'ord') {
        const action = parts[1];
        if (action === 'menu') return render(chatId, ui.ordersMenu(), { messageId });
        if (action === 'list') {
          const filter = parts[2] || 'all';
          const page = Number(parts[3]) || 0;
          return render(chatId, await ordersView(filter, page), { messageId });
        }
        if (action === 'one') return render(chatId, await orderView(parts[2]), { messageId });
        if (action === 'flow' && parts[2] === 'deliver') return askInput(chatId, 'deliver', parts[3]).then(() => null);
        if (action === 'extend') {
          const order = await findOrder(parts[2]);
          if (!order) return send(chatId, '❌ Sipariş bulunamadı.');
          return render(chatId, ui.extendMenu(order), { messageId });
        }
        if (action === 'extend2') {
          const hours = Number(parts[3]) || 24;
          const order = await findOrder(parts[2]);
          if (!order) return send(chatId, '❌ Sipariş bulunamadı.');
          await api.extendDelivery(order.id, hours);
          await send(chatId, `✅ Teslim süresi <b>${hours} saat</b> uzatıldı.`);
          return render(chatId, await orderView(order.id), { messageId });
        }
        if (action === 'cancel') {
          const order = await findOrder(parts[2]);
          if (!order) return send(chatId, '❌ Sipariş bulunamadı.');
          return render(chatId, ui.cancelReasons(order), { messageId });
        }
        if (action === 'cancel2') {
          const order = await findOrder(parts[2]);
          const reasonKey = parts[3];
          if (!order) return send(chatId, '❌ Sipariş bulunamadı.');
          const reason = ui.CANCEL_REASONS[reasonKey] || ui.CANCEL_REASONS.other;
          await api.cancelOrder(order.id, reason);
          await send(chatId, `✅ Sipariş iptal edildi: <code>#${esc(shortId(order.id))}</code>\nSebep: ${esc(reason)}`);
          return render(chatId, await orderView(order.id), { messageId });
        }
        return null;
      }

      // teklifler
      if (ns === 'off') {
        const type = parts[1];
        if (type === 'menu') return render(chatId, ui.offersMenu(), { messageId });
        if (type === 'search') return askInput(chatId, 'search').then(() => null);

        const action = parts[2];
        const ref = parts[3];
        if (!OFFER_TYPES[type]) return send(chatId, '❌ Bilinmeyen teklif tipi.');

        if (action === 'list') return render(chatId, await offersView(type, Number(ref) || 0), { messageId });
        if (action === 'one') return render(chatId, (await offerView(type, ref)).view, { messageId });

        if (action === 'flow') {
          const kind = parts[3];
          return askInput(chatId, kind, parts[4], { offerType: type }).then(() => null);
        }

        const offer = await offersApi.findOffer(api, type, ref);
        if (!offer) return send(chatId, `❌ Teklif bulunamadı: <code>${esc(ref)}</code>`);

        if (action === 'pause') {
          await offersApi.pauseOffer(api, type, offer.id);
          await send(chatId, '⏸ Duraklatıldı.');
          return render(chatId, (await offerView(type, offer.id)).view, { messageId });
        }
        if (action === 'resume') {
          await offersApi.resumeOffer(api, type, offer.id);
          await send(chatId, '▶️ Devam ettirildi.');
          return render(chatId, (await offerView(type, offer.id)).view, { messageId });
        }
        if (action === 'del') return render(chatId, ui.offerDeleteConfirm(offer), { messageId });
        if (action === 'delok') {
          await offersApi.deleteOffer(api, type, offer.id);
          await send(chatId, `🗑 Teklif silindi: <b>${esc(ui.truncate(offer.title, 40))}</b>`);
          return render(chatId, await offersView(type, 0), { messageId });
        }
        if (action === 'pauseAll') {
          await offersApi.pauseAllOffers(api, type);
          await send(chatId, `⏸ ${OFFER_TYPES[type].label} tekliflerinin tümü duraklatıldı.`);
          return render(chatId, await offersView(type, 0), { messageId });
        }
        return null;
      }

      // bildirimler
      if (ns === 'notif') {
        if (parts[1] === 'list') return render(chatId, await notificationsView(Number(parts[2]) || 0), { messageId });
        if (parts[1] === 'readall') {
          await api.markAllNotificationsRead();
          return render(chatId, await notificationsView(0), { messageId });
        }
        return null;
      }

      // degerlendirmeler
      if (ns === 'rev') return render(chatId, await reviewsView(Number(parts[2]) || 0), { messageId });

      // boosting
      if (ns === 'boost') return render(chatId, ui.boostingList(await api.boostingSubscriptions()), { messageId });

      // ayarlar
      if (ns === 'set') {
        const action = parts[1];
        if (action === 'toggleMonitor') {
          const next = !store.get('monitor');
          store.set('monitor', next);
          if (next) monitor.start();
          return render(chatId, ui.settings(store), { messageId });
        }
        if (action === 'toggleAuto') {
          store.set('autoDeliver', !store.get('autoDeliver'));
          return render(chatId, ui.settings(store), { messageId });
        }
        if (action === 'test') {
          return send(
            chatId,
            [
              '🔔 <b>TEST BİLDİRİMİ</b>',
              '─────────────────',
              'Bu bir deneme mesajıdır — <b>gerçek sipariş değildir</b>.',
              'Gerçek sipariş geldiğinde benzer bir kart alacaksın.',
            ].join('\n'),
          );
        }
        return render(chatId, ui.settings(store), { messageId });
      }

      if (ns === 'help') return render(chatId, ui.helpText(), { messageId });
      return null;
    } catch (err) {
      log('[bot] callback hatasi:', err.message);
      await send(chatId, `❌ Hata: <code>${esc(err.message)}</code>`);
    }
    return null;
  }

  // ---------------------------------------------------------------- komutlar

  async function handleMessage(msg) {
    const chatId = msg.chat?.id;
    const text = (msg.text || '').trim();
    if (!chatId || !text) return;

    if (store.get('chatId') !== chatId) {
      store.set('chatId', chatId);
      log(`[bot] chat id kaydedildi: ${chatId}`);
    }

    if (!text.startsWith('/')) {
      if (await handleInput(chatId, text)) return;
      // Serbest metin: ana menu goster
      const menu = ui.mainMenu(store);
      return send(chatId, menu.text, { keyboard: menu.keyboard });
    }

    const [rawCmd, ...args] = text.split(/\s+/);
    const cmd = rawCmd.replace(/@\w+$/, '').toLowerCase();

    if (cmd === '/iptal') {
      clearInput(chatId);
      return send(chatId, '↩️ İptal edildi.');
    }

    try {
      switch (cmd) {
        case '/start': {
          const menu = ui.mainMenu(store);
          return send(chatId, menu.text, { keyboard: menu.keyboard });
        }
        case '/panel':
        case '/durum':
          return render(chatId, await dashboardView());
        case '/siparisler':
          return render(chatId, await ordersView('all', 0));
        case '/bekleyen':
          return render(chatId, await ordersView('pending', 0));
        case '/teklifler':
          return render(chatId, ui.offersMenu());
        case '/bildirimler':
          return render(chatId, await notificationsView(0));
        case '/yorumlar':
          return render(chatId, await reviewsView(0));
        case '/ayarlar':
          return render(chatId, ui.settings(store));
        case '/yardim':
        case '/help':
          return render(chatId, ui.helpText());
        case '/id':
          return send(chatId, `Chat ID: <code>${esc(chatId)}</code>`);
        case '/izle': {
          const sub = (args[0] || '').toLowerCase();
          if (sub !== 'on' && sub !== 'off') return send(chatId, 'Kullanım: /izle on | /izle off');
          store.set('monitor', sub === 'on');
          if (sub === 'on') monitor.start();
          return send(chatId, sub === 'on' ? '✅ Sipariş bildirimleri açık.' : '⛔ Sipariş bildirimleri kapalı.');
        }
        case '/oto': {
          const sub = (args[0] || '').toLowerCase();
          if (sub !== 'on' && sub !== 'off') return send(chatId, 'Kullanım: /oto on | /oto off');
          store.set('autoDeliver', sub === 'on');
          return send(chatId, sub === 'on' ? '✅ Otomatik teslimat açık.' : '⛔ Otomatik teslimat kapalı.');
        }
        default: {
          const menu = ui.mainMenu(store);
          return send(chatId, `Bilinmeyen komut: <code>${esc(cmd)}</code>\nMenüden devam edebilirsin.`, { keyboard: menu.keyboard });
        }
      }
    } catch (err) {
      log(`[bot] ${cmd} hatasi:`, err.message);
      await send(chatId, `❌ Hata: <code>${esc(err.message)}</code>`);
    }
    return null;
  }

  return { handleMessage, handleCallback, send };
}
