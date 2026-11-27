// Telegram komutlari.
import { esc } from './telegram.js';
import { formatOffer, formatOrder, money, shortId, stateLabel, when } from './format.js';

const HELP = [
  '🤖 <b>Eldorado Satıcı Botu</b>',
  '',
  '<b>Bilgi</b>',
  '/durum — bağlantı, puan, bekleyen sipariş özeti',
  '/ozet — sipariş durum sayıları',
  '/siparisler — son 10 sipariş',
  '/bekleyen — teslim/İtiraz bekleyen siparişler',
  '/teklifler [arama] — tekliflerini listele',
  '',
  '<b>Yönetim</b>',
  '/fiyat &lt;teklifNo&gt; &lt;tutar&gt; — fiyat değiştir',
  '/stok &lt;teklifNo&gt; &lt;adet&gt; — adet değiştir',
  '/duraklat &lt;teklifNo&gt; • /devam &lt;teklifNo&gt;',
  '/teslim &lt;siparişNo&gt; &lt;metin&gt; — siparişi teslim et',
  '',
  '<b>Ayarlar</b>',
  '/izle on|off — yeni sipariş bildirimi',
  '/oto on|off — otomatik teslimat',
  '/oto metin &lt;teklifNo&gt; &lt;metin&gt; — teklif için otomatik teslim metni',
  '/oto liste — kayıtlı metinler',
  '',
  'İpucu: teklif/sipariş numarası olarak listede görünen kısa kodun ilk birkaç harfi yeter.',
].join('\n');

export function createBot({ api, store, tg, monitor, log = console.log }) {
  async function send(chatId, text, opts) {
    try {
      return await tg.send(chatId, text, opts);
    } catch (err) {
      log('[bot] mesaj gonderilemedi:', err.message);
      return null;
    }
  }

  async function resolveOrder(ref) {
    const needle = String(ref || '').toLowerCase();
    if (!needle) return null;
    const orders = await api.listOrders({ pageIndex: 1, pageSize: 50 });
    return orders.find((o) => String(o.id).toLowerCase().startsWith(needle)) || null;
  }

  async function resolveOffer(ref) {
    const needle = String(ref || '').toLowerCase();
    if (!needle) return null;
    const { offers } = await api.listOffers({ pageIndex: 1, pageSize: 50 });
    return (
      offers.find((o) => String(o.id).toLowerCase().startsWith(needle)) ||
      offers.find((o) => String(o.offerTitle ?? '').toLowerCase().includes(needle)) ||
      null
    );
  }

  async function cmdDurum(chatId) {
    const [overview, states, pending, unread] = await Promise.all([
      api.overview().catch(() => null),
      api.statesCount().catch(() => null),
      api.pendingOrdersSum().catch(() => null),
      api.unreadCount().catch(() => null),
    ]);
    const lines = ['📊 <b>Durum</b>', ''];
    if (overview) {
      lines.push(`Puan: <b>${Number(overview.reviewScore ?? 0).toFixed(2)}</b> (${overview.ratingCount ?? 0} değerlendirme)`);
    }
    if (states) {
      lines.push(`Teslim bekleyen: <b>${states.paid ?? 0}</b>`);
      lines.push(`İtirazlı: <b>${states.disputed ?? 0}</b>`);
      lines.push(`Teslim edilmiş: ${states.delivered ?? 0} • Tamamlanan: ${states.completed ?? 0}`);
    }
    if (pending) lines.push(`Bekleyen sipariş tutarı: <b>${money(pending)}</b>`);
    if (unread != null) lines.push(`Okunmamış bildirim: ${unread}`);
    lines.push('', `İzleme: ${store.get('monitor') ? '✅ açık' : '⛔ kapalı'}`);
    lines.push(`Otomatik teslimat: ${store.get('autoDeliver') ? '✅ açık' : '⛔ kapalı'}`);
    const last = store.get('lastOrderAt');
    lines.push(`Son yakalanan sipariş: ${last ? when(last) : '-'}`);
    await send(chatId, lines.join('\n'));
  }

  async function cmdOzet(chatId) {
    const states = await api.statesCount();
    const rows = Object.entries(states || {}).map(([k, v]) => `• ${esc(k)}: <b>${esc(v)}</b>`);
    await send(chatId, ['📦 <b>Sipariş durumları</b>', '', ...rows].join('\n'));
  }

  async function cmdSiparisler(chatId) {
    const orders = await api.listOrders({ pageIndex: 1, pageSize: 10 });
    if (!orders.length) return send(chatId, 'Sipariş bulunamadı.');
    const blocks = orders.map((o) => formatOrder(o, { header: '—' }).replace(/^—\n\n/, ''));
    await send(chatId, ['🧾 <b>Son siparişler</b>', '', ...blocks.map((b) => `<blockquote>${b}</blockquote>`)].join('\n'));
  }

  async function cmdBekleyen(chatId) {
    const orders = await api.listOrders({ pageIndex: 1, pageSize: 50 });
    const waiting = orders.filter((o) => ['Paid', 'Disputed'].includes(o.state?.state));
    if (!waiting.length) return send(chatId, '✅ Bekleyen sipariş yok.');
    const lines = ['⏳ <b>İşlem bekleyen siparişler</b>', ''];
    for (const o of waiting) {
      lines.push(`• <b>${esc(o.orderOfferDetails?.offerTitle ?? 'Sipariş')}</b>`);
      lines.push(`  ${money(o.totalPrice)} • ${esc(stateLabel(o))} • <code>${esc(shortId(o.id))}</code>`);
    }
    await send(chatId, lines.join('\n'));
  }

  async function cmdTeklifler(chatId, term) {
    let offers;
    let total;
    if (term) {
      offers = await api.searchOffers(term);
      const page = offers.length ? { offers } : await api.listOffers({ pageIndex: 1, pageSize: 50 });
      offers = page.offers ?? [];
      offers = offers.filter((o) => String(o.offerTitle ?? '').toLowerCase().includes(term.toLowerCase()));
      total = offers.length;
    } else {
      const page = await api.listOffers({ pageIndex: 1, pageSize: 15 });
      offers = page.offers;
      total = page.recordCount;
    }
    if (!offers.length) return send(chatId, 'Teklif bulunamadı.');
    const lines = [`🏷 <b>Teklifler</b> (${total} kayıt, ilk ${offers.length})`, ''];
    for (const o of offers) lines.push(formatOffer(o));
    await send(chatId, lines.join('\n'));
  }

  async function cmdFiyat(chatId, ref, amount) {
    const offer = await resolveOffer(ref);
    if (!offer) return send(chatId, `Teklif bulunamadı: <code>${esc(ref)}</code>\nÖnce /teklifler ile listeye bak.`);
    const value = Number(String(amount).replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) return send(chatId, 'Geçerli bir tutar yaz. Örnek: /fiyat 468632 1.25');
    await api.setOfferPrice(offer.id, value);
    await send(chatId, `✅ Fiyat güncellendi.\n<b>${esc(offer.offerTitle ?? '')}</b>\nYeni fiyat: <b>${money({ amount: value, currency: 'USD' })}</b>`);
  }

  async function cmdStok(chatId, ref, qty) {
    const offer = await resolveOffer(ref);
    if (!offer) return send(chatId, `Teklif bulunamadı: <code>${esc(ref)}</code>`);
    const value = Number(qty);
    if (!Number.isInteger(value) || value < 0) return send(chatId, 'Geçerli bir adet yaz. Örnek: /stok 468632 5');
    await api.setOfferQuantity(offer.id, value);
    await send(chatId, `✅ Adet güncellendi.\n<b>${esc(offer.offerTitle ?? '')}</b> → <b>${value}</b>`);
  }

  async function cmdDurumDegistir(chatId, ref, action) {
    const offer = await resolveOffer(ref);
    if (!offer) return send(chatId, `Teklif bulunamadı: <code>${esc(ref)}</code>`);
    if (action === 'pause') await api.pauseOffer(offer.id);
    else await api.resumeOffer(offer.id);
    await send(chatId, `${action === 'pause' ? '⏸ Duraklatıldı' : '▶️ Devam ettirildi'}.\n<b>${esc(offer.offerTitle ?? '')}</b>`);
  }

  async function cmdTeslim(chatId, ref, text) {
    const order = await resolveOrder(ref);
    if (!order) return send(chatId, `Sipariş bulunamadı: <code>${esc(ref)}</code>`);
    if (!text) return send(chatId, 'Teslim metni gerekli.\nÖrnek: /teslim 4f3ff5 <code>mail:sifre</code>');
    await api.deliverOrder(order.id, text);
    await send(chatId, `✅ Teslim edildi olarak işaretlendi.\nSipariş: <code>${esc(shortId(order.id))}</code>`);
  }

  async function cmdOto(chatId, args) {
    const sub = (args[0] || '').toLowerCase();
    if (sub === 'on' || sub === 'off') {
      store.set('autoDeliver', sub === 'on');
      return send(
        chatId,
        sub === 'on'
          ? '✅ Otomatik teslimat açık. Metin tanımlanmış tekliflerde "Paid" sipariş gelince bot teslim eder.\nMetin ekle: /oto metin &lt;teklifNo&gt; &lt;metin&gt;'
          : '⛔ Otomatik teslimat kapalı.',
      );
    }
    if (sub === 'liste') {
      const map = store.get('autoDeliveryTexts') || {};
      const entries = Object.entries(map);
      if (!entries.length) return send(chatId, 'Kayıtlı otomatik teslim metni yok.');
      return send(chatId, ['📝 <b>Otomatik teslim metinleri</b>', '', ...entries.map(([id, t]) => `<code>${esc(shortId(id))}</code> — ${esc(t.slice(0, 60))}`)].join('\n'));
    }
    if (sub === 'metin') {
      const [, ref, ...rest] = args;
      const text = rest.join(' ');
      if (!ref || !text) return send(chatId, 'Kullanım: /oto metin &lt;teklifNo&gt; &lt;metin&gt;');
      const offer = await resolveOffer(ref);
      const id = offer?.id ?? ref;
      const map = { ...(store.get('autoDeliveryTexts') || {}), [id]: text };
      store.set('autoDeliveryTexts', map);
      return send(chatId, `✅ Metin kaydedildi: <code>${esc(shortId(id))}</code>\n${esc(text.slice(0, 120))}`);
    }
    return send(chatId, 'Kullanım: /oto on | /oto off | /oto metin &lt;teklifNo&gt; &lt;metin&gt; | /oto liste');
  }

  async function handleMessage(msg) {
    const chatId = msg.chat?.id;
    const text = (msg.text || '').trim();
    if (!chatId || !text.startsWith('/')) return;

    const [rawCmd, ...args] = text.split(/\s+/);
    const cmd = rawCmd.replace(/@\w+$/, '').toLowerCase();

    // Sohbet kimligini kaydet (ilk mesaj atan kisi botun sahibi kabul edilir).
    if (store.get('chatId') !== chatId) {
      store.set('chatId', chatId);
      log(`[bot] chat id kaydedildi: ${chatId}`);
    }

    try {
      switch (cmd) {
        case '/start':
        case '/yardim':
        case '/help':
          await send(chatId, HELP);
          if (cmd === '/start') await cmdDurum(chatId);
          break;
        case '/id':
          await send(chatId, `Chat ID: <code>${esc(chatId)}</code>`);
          break;
        case '/durum':
          await cmdDurum(chatId);
          break;
        case '/ozet':
          await cmdOzet(chatId);
          break;
        case '/siparisler':
          await cmdSiparisler(chatId);
          break;
        case '/bekleyen':
          await cmdBekleyen(chatId);
          break;
        case '/teklifler':
          await cmdTeklifler(chatId, args.join(' ').trim());
          break;
        case '/fiyat':
          if (args.length < 2) await send(chatId, 'Kullanım: /fiyat &lt;teklifNo&gt; &lt;tutar&gt;');
          else await cmdFiyat(chatId, args[0], args[1]);
          break;
        case '/stok':
          if (args.length < 2) await send(chatId, 'Kullanım: /stok &lt;teklifNo&gt; &lt;adet&gt;');
          else await cmdStok(chatId, args[0], args[1]);
          break;
        case '/duraklat':
          if (!args[0]) await send(chatId, 'Kullanım: /duraklat &lt;teklifNo&gt;');
          else await cmdDurumDegistir(chatId, args[0], 'pause');
          break;
        case '/devam':
          if (!args[0]) await send(chatId, 'Kullanım: /devam &lt;teklifNo&gt;');
          else await cmdDurumDegistir(chatId, args[0], 'resume');
          break;
        case '/teslim':
          await cmdTeslim(chatId, args[0], args.slice(1).join(' '));
          break;
        case '/izle': {
          const sub = (args[0] || '').toLowerCase();
          if (sub === 'on' || sub === 'off') {
            store.set('monitor', sub === 'on');
            if (sub === 'on') monitor.start();
            await send(chatId, sub === 'on' ? '✅ Sipariş bildirimleri açık.' : '⛔ Sipariş bildirimleri kapalı.');
          } else {
            await send(chatId, 'Kullanım: /izle on | /izle off');
          }
          break;
        }
        case '/oto':
          await cmdOto(chatId, args);
          break;
        default:
          await send(chatId, `Bilinmeyen komut: ${esc(cmd)}\n/yardim yaz.`);
      }
    } catch (err) {
      log(`[bot] ${cmd} hatasi:`, err.message);
      await send(chatId, `❌ Hata: <code>${esc(err.message)}</code>`);
    }
  }

  return { handleMessage, send, resolveOffer, resolveOrder };
}
