// Komut + buton yonlendiricisi ve adim adim giris akislari.
import { esc } from './telegram.js';
import * as ui from './ui.js';
import { money, shortId } from './format.js';

const PAGE = ui.ORDERS_PAGE_SIZE;
const INPUT_TIMEOUT_MS = 5 * 60 * 1000;

export function createBot({ api, store, tg, monitor, log = console.log }) {
  /** chatId -> { type, id, at } — butonla baslatilan adim adim giris */
  const inputs = new Map();

  const isOld = (entry) => !entry || Date.now() - entry.at > INPUT_TIMEOUT_MS;

  function setInput(chatId, entry) {
    inputs.set(chatId, { ...entry, at: Date.now() });
  }

  function clearInput(chatId) {
    inputs.delete(chatId);
  }

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
        return;
      } catch (err) {
        // "message is not modified" gibi durumlar sorun degil; yeni mesaj gonder.
        if (!/not modified/i.test(err.message)) log('[bot] duzenleme basarisiz:', err.message);
        if (/not modified/i.test(err.message)) return;
      }
    }
    return send(chatId, view.text, { keyboard: view.keyboard });
  }

  // ---------------------------------------------------------------- veri

  async function findOrder(ref) {
    const direct = await api.getOrder(ref).catch(() => null);
    if (direct?.id) return direct;
    const orders = await api.listOrders({ pageIndex: 1, pageSize: 50 });
    const needle = String(ref).toLowerCase();
    return orders.find((o) => String(o.id).toLowerCase().startsWith(needle)) || null;
  }

  async function findOffer(ref) {
    const needle = String(ref).toLowerCase();
    for (let page = 1; page <= 6; page += 1) {
      const { offers } = await api.listOffers({ pageIndex: page, pageSize: 50 });
      if (!offers.length) break;
      const hit = offers.find((o) => String(o.id).toLowerCase().startsWith(needle));
      if (hit) return hit;
      if (offers.length < 50) break;
    }
    return null;
  }

  const localDay = (value) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

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
    const today = {
      count: todays.length,
      revenue: todays.reduce((sum, o) => sum + Number(o.totalPrice?.amount ?? 0), 0),
    };
    return ui.dashboard({ overview, states, pending, unread, store, today });
  }

  async function ordersView(page) {
    const orders = await api.listOrders({ pageIndex: page + 1, pageSize: PAGE });
    return ui.ordersList(orders, page, orders.length === PAGE);
  }

  async function offersView(page) {
    const { offers, recordCount, totalPages } = await api.listOffers({ pageIndex: page + 1, pageSize: PAGE });
    const total = recordCount || offers.length;
    const clampedPage = Math.min(page, Math.max(0, (totalPages || 1) - 1));
    return ui.offersList(offers, clampedPage, total);
  }

  async function pendingView() {
    const orders = await api.listOrders({ pageIndex: 1, pageSize: 50 });
    return ui.pendingList(orders.filter((o) => ['Paid', 'Disputed'].includes(o.state?.state)));
  }

  async function orderView(ref) {
    const order = await findOrder(ref);
    if (!order) return { text: `❌ Sipariş bulunamadı: <code>${esc(ref)}</code>`, keyboard: [[{ text: '◀️ Siparişler', callback_data: 'ord:list:0' }]] };
    return ui.orderDetail(order);
  }

  async function offerView(ref) {
    const offer = await findOffer(ref);
    if (!offer) return { text: `❌ Teklif bulunamadı: <code>${esc(ref)}</code>`, keyboard: [[{ text: '◀️ Teklifler', callback_data: 'off:list:0' }]] };
    const autoText = store.get('autoDeliveryTexts')?.[offer.id];
    return ui.offerDetail(offer, { autoText });
  }

  // ---------------------------------------------------------------- giris akislari

  const PROMPTS = {
    price: (o) => `💰 <b>${esc(o?.offerTitle ?? 'Teklif')}</b>\n\nYeni fiyatı USD olarak yaz.\nÖrnek: <code>1.25</code>\n\n<i>İptal için /iptal</i>`,
    qty: (o) => `📦 <b>${esc(o?.offerTitle ?? 'Teklif')}</b>\n\nYeni adet sayısını yaz.\nÖrnek: <code>25</code>\n\n<i>İptal için /iptal</i>`,
    autoText: (o) => `🤖 <b>${esc(o?.offerTitle ?? 'Teklif')}</b>\n\nBu teklif için otomatik teslim metnini yaz.\nSipariş "Paid" durumunda geldiğinde bu metinle teslim edilir.\n\n<i>İptal için /iptal</i>`,
    deliver: (o) => `✅ <b>${esc(o?.orderOfferDetails?.offerTitle ?? 'Sipariş')}</b>\n\nAlıcıya gönderilecek teslim metnini yaz.\n\n<i>İptal için /iptal</i>`,
  };

  async function askInput(chatId, type, ref, { messageId = null } = {}) {
    const isOrder = type === 'deliver';
    const item = isOrder ? await findOrder(ref) : await findOffer(ref);
    if (!item) {
      return render(chatId, { text: `❌ Kayıt bulunamadı: <code>${esc(ref)}</code>`, keyboard: [[{ text: '◀️ Menü', callback_data: 'dash:open' }]] }, { messageId });
    }
    setInput(chatId, { type, id: item.id });
    await send(chatId, PROMPTS[type](item));
    return null;
  }

  async function handleInput(chatId, text) {
    const entry = inputs.get(chatId);
    if (isOld(entry)) {
      clearInput(chatId);
      return false;
    }
    const value = text.trim();
    try {
      if (entry.type === 'price') {
        const amount = Number(value.replace(',', '.'));
        if (!Number.isFinite(amount) || amount <= 0) return send(chatId, '⚠️ Geçerli bir sayı yaz. Örnek: <code>1.25</code>'), true;
        await api.setOfferPrice(entry.id, amount);
        clearInput(chatId);
        await send(chatId, `✅ Fiyat güncellendi: <b>${money({ amount, currency: 'USD' })}</b>`);
        await render(chatId, await offerView(entry.id));
        return true;
      }
      if (entry.type === 'qty') {
        const qty = Number(value);
        if (!Number.isInteger(qty) || qty < 0) return send(chatId, '⚠️ Geçerli bir tam sayı yaz. Örnek: <code>25</code>'), true;
        await api.setOfferQuantity(entry.id, qty);
        clearInput(chatId);
        await send(chatId, `✅ Adet güncellendi: <b>${qty}</b>`);
        await render(chatId, await offerView(entry.id));
        return true;
      }
      if (entry.type === 'autoText') {
        const map = { ...(store.get('autoDeliveryTexts') || {}), [entry.id]: value };
        store.set('autoDeliveryTexts', map);
        clearInput(chatId);
        await send(chatId, '✅ Otomatik teslim metni kaydedildi.');
        await render(chatId, await offerView(entry.id));
        return true;
      }
      if (entry.type === 'deliver') {
        await api.deliverOrder(entry.id, value);
        clearInput(chatId);
        await send(chatId, `✅ Sipariş teslim edildi: <code>#${esc(shortId(entry.id))}</code>`);
        return true;
      }
    } catch (err) {
      clearInput(chatId);
      await send(chatId, `❌ İşlem başarısız.\n<code>${esc(err.message)}</code>`);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- yonlendirme

  async function handleCallback(cq) {
    const chatId = cq.message?.chat?.id;
    const messageId = cq.message?.message_id;
    const data = String(cq.data || '');
    if (!chatId || !data) return;
    const [ns, action, arg] = data.split(':');
    Promise.resolve(tg.answerCallback(cq.id)).catch(() => null);

    try {
      switch (`${ns}:${action}`) {
        case 'dash:open':
          return render(chatId, ui.mainMenu(store), { messageId });
        case 'dash:refresh':
          return render(chatId, await dashboardView(), { messageId });
        case 'ord:list':
          return render(chatId, await ordersView(Number(arg) || 0), { messageId });
        case 'ord:pending':
          return render(chatId, await pendingView(), { messageId });
        case 'ord:one':
          return render(chatId, await orderView(arg), { messageId });
        case 'ord:deliver':
          return askInput(chatId, 'deliver', arg, { messageId });
        case 'off:list':
          return render(chatId, await offersView(Number(arg) || 0), { messageId });
        case 'off:one':
          return render(chatId, await offerView(arg), { messageId });
        case 'off:price':
          return askInput(chatId, 'price', arg, { messageId });
        case 'off:qty':
          return askInput(chatId, 'qty', arg, { messageId });
        case 'off:auto':
          return askInput(chatId, 'autoText', arg, { messageId });
        case 'off:pause':
        case 'off:resume': {
          const offer = await findOffer(arg);
          if (!offer) return render(chatId, { text: '❌ Teklif bulunamadı.', keyboard: [[{ text: '◀️ Teklifler', callback_data: 'off:list:0' }]] }, { messageId });
          if (action === 'pause') await api.pauseOffer(offer.id);
          else await api.resumeOffer(offer.id);
          Promise.resolve(tg.answerCallback(cq.id, action === 'pause' ? 'Duraklatıldı' : 'Devam ettirildi')).catch(() => null);
          return render(chatId, await offerView(offer.id), { messageId });
        }
        case 'set:open':
          return render(chatId, ui.settings(store), { messageId });
        case 'set:toggleMonitor': {
          const next = !store.get('monitor');
          store.set('monitor', next);
          if (next) monitor.start();
          return render(chatId, ui.settings(store), { messageId });
        }
        case 'set:toggleAuto':
          store.set('autoDeliver', !store.get('autoDeliver'));
          return render(chatId, ui.settings(store), { messageId });
        case 'set:test': {
          return send(
            chatId,
            [
              '🔔 <b>TEST BİLDİRİMİ</b>',
              '─────────────────',
              'Bu bir deneme mesajıdır — <b>gerçek sipariş değildir</b>.',
              'Gerçek sipariş geldiğinde bunun gibi bir kart alacaksın.',
              '',
              '<i>Bildirimler çalışıyor.</i>',
            ].join('\n'),
          );
        }
        case 'help:open':
          return render(chatId, ui.helpText(), { messageId });
        default:
          return null;
      }
    } catch (err) {
      log('[bot] callback hatasi:', err.message);
      await send(chatId, `❌ Hata: <code>${esc(err.message)}</code>`);
    }
    return null;
  }

  async function handleMessage(msg) {
    const chatId = msg.chat?.id;
    const text = (msg.text || '').trim();
    if (!chatId || !text) return;

    if (store.get('chatId') !== chatId) {
      store.set('chatId', chatId);
      log(`[bot] chat id kaydedildi: ${chatId}`);
    }

    // Butonla baslatilan giris akisi (komut degilse)
    if (!text.startsWith('/')) {
      if (await handleInput(chatId, text)) return;
      return;
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
          return render(chatId, await ordersView(0));
        case '/bekleyen':
          return render(chatId, await pendingView());
        case '/teklifler':
          return render(chatId, await offersView(0));
        case '/ayarlar':
          return render(chatId, ui.settings(store));
        case '/yardim':
        case '/help':
          return render(chatId, ui.helpText());
        case '/id':
          return send(chatId, `Chat ID: <code>${esc(chatId)}</code>`);

        // Komut kisayollari (menude olmayanlar)
        case '/fiyat': {
          if (args.length < 2) return send(chatId, 'Kullanım: /fiyat &lt;teklifNo&gt; &lt;tutar&gt;');
          const offer = await findOffer(args[0]);
          if (!offer) return send(chatId, `❌ Teklif bulunamadı: <code>${esc(args[0])}</code>`);
          const amount = Number(args[1].replace(',', '.'));
          if (!Number.isFinite(amount) || amount <= 0) return send(chatId, '⚠️ Geçerli bir tutar yaz. Örnek: /fiyat 468632 1.25');
          await api.setOfferPrice(offer.id, amount);
          clearInput(chatId);
          return send(chatId, `✅ <b>${esc(offer.offerTitle ?? '')}</b>\nYeni fiyat: <b>${money({ amount, currency: 'USD' })}</b>`);
        }
        case '/stok': {
          if (args.length < 2) return send(chatId, 'Kullanım: /stok &lt;teklifNo&gt; &lt;adet&gt;');
          const offer = await findOffer(args[0]);
          if (!offer) return send(chatId, `❌ Teklif bulunamadı: <code>${esc(args[0])}</code>`);
          const qty = Number(args[1]);
          if (!Number.isInteger(qty) || qty < 0) return send(chatId, '⚠️ Geçerli bir tam sayı yaz. Örnek: /stok 468632 5');
          await api.setOfferQuantity(offer.id, qty);
          clearInput(chatId);
          return send(chatId, `✅ <b>${esc(offer.offerTitle ?? '')}</b>\nYeni adet: <b>${qty}</b>`);
        }
        case '/teslim': {
          if (!args[0]) return send(chatId, 'Kullanım: /teslim &lt;siparişNo&gt; &lt;metin&gt;');
          const order = await findOrder(args[0]);
          if (!order) return send(chatId, `❌ Sipariş bulunamadı: <code>${esc(args[0])}</code>`);
          const detail = args.slice(1).join(' ');
          if (!detail) {
            setInput(chatId, { type: 'deliver', id: order.id });
            return send(chatId, PROMPTS.deliver(order));
          }
          await api.deliverOrder(order.id, detail);
          clearInput(chatId);
          return send(chatId, `✅ Sipariş teslim edildi: <code>#${esc(shortId(order.id))}</code>`);
        }
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
        default:
          return send(chatId, `Bilinmeyen komut: <code>${esc(cmd)}</code>\n/menu için /start`);
      }
    } catch (err) {
      log(`[bot] ${cmd} hatasi:`, err.message);
      await send(chatId, `❌ Hata: <code>${esc(err.message)}</code>`);
    }
    return null;
  }

  return { handleMessage, handleCallback, send };
}
