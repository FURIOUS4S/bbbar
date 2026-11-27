// Tum mesaj ve buton tasarimlari burada. Bot mantigi degil, sadece gorunum.
import { esc } from './telegram.js';
import { money, shortId, stateLabel, when } from './format.js';

export const STATE_ICON = {
  Initialized: '⚪',
  Paid: '🟡',
  Delivered: '🟢',
  Received: '🔵',
  Completed: '✅',
  Canceled: '⚫',
  Disputed: '🔴',
};

export const icon = (state) => STATE_ICON[state] || '⚪';

export const OFFER_STATE_TR = {
  Active: 'Aktif',
  Paused: 'Duraklatıldı',
  Inactive: 'Pasif',
  Hidden: 'Gizli',
  Deleted: 'Silinmiş',
};

const offerStateText = (s) => OFFER_STATE_TR[s] || s || '-';
const isActive = (o) => !/paused|inactive|hidden|deleted/i.test(String(o.offerState ?? ''));

const LINE = '─────────────────';

export function header(title, subtitle) {
  const out = [`<b>${title}</b>`];
  if (subtitle) out.push(`<i>${esc(subtitle)}</i>`);
  out.push(LINE);
  return out.join('\n');
}

// ---------------------------------------------------------------- ana menu

export function mainMenu(store) {
  return {
    text: [
      '<b>🛡 ELDORADO SATICI PANELİ</b>',
      LINE,
      `Sipariş izleme: ${store.get('monitor') ? '🟢 açık' : '⚫ kapalı'}`,
      `Otomatik teslim: ${store.get('autoDeliver') ? '🟢 açık' : '⚫ kapalı'}`,
      '',
      'Aşağıdaki menüden devam et.',
    ].join('\n'),
    keyboard: [
      [{ text: '📊 Panel', callback_data: 'dash:open' }, { text: '🛒 Siparişler', callback_data: 'ord:list:0' }],
      [{ text: '🏷 Teklifler', callback_data: 'off:list:0' }, { text: '⚙️ Ayarlar', callback_data: 'set:open' }],
      [{ text: '❓ Yardım', callback_data: 'help:open' }],
    ],
  };
}

// ---------------------------------------------------------------- panel

export function dashboard({ overview, states, pending, unread, store, today }) {
  const score = overview ? Number(overview.reviewScore ?? 0).toFixed(2) : '-';
  const reviews = overview?.ratingCount ?? '-';
  const s = states || {};
  const lines = [
    '<b>📊 PANEL</b>',
    LINE,
    `⭐ Puan: <b>${score}</b>  <i>(${esc(reviews)} değerlendirme)</i>`,
    today ? `📈 Bugün: <b>${today.count}</b> sipariş · <b>${money({ amount: today.revenue, currency: 'USD' })}</b>` : null,
    '',
    '<b>Siparişler</b>',
    `🟡 Teslim bekleyen   <b>${esc(s.paid ?? 0)}</b>`,
    `🔴 İtirazlı          <b>${esc(s.disputed ?? 0)}</b>`,
    `🟢 Teslim edilmiş    ${esc(s.delivered ?? 0)}`,
    `✅ Tamamlanan        ${esc(s.completed ?? 0)}`,
    `⚫ İptal             ${esc(s.canceled ?? 0)}`,
    '',
    `💰 Bekleyen tutar: <b>${money(pending)}</b>`,
    `🔔 Okunmamış bildirim: <b>${esc(unread ?? 0)}</b>`,
    '',
    LINE,
    `⚙️ İzleme ${store.get('monitor') ? '🟢 açık' : '⚫ kapalı'} · ${store.get('pollSeconds')} sn`,
    `🕒 Son yakalanan sipariş: ${esc(store.get('lastOrderAt') ? when(store.get('lastOrderAt')) : 'henüz yok')}`,
  ].filter((l) => l !== null);
  return {
    text: lines.join('\n'),
    keyboard: [
      [{ text: '🔄 Yenile', callback_data: 'dash:refresh' }, { text: '🛒 Siparişler', callback_data: 'ord:list:0' }],
      [{ text: '⏳ Bekleyenler', callback_data: 'ord:pending' }, { text: '🏷 Teklifler', callback_data: 'off:list:0' }],
      [{ text: '⚙️ Ayarlar', callback_data: 'set:open' }],
    ],
  };
}

// ---------------------------------------------------------------- siparisler

const PAGE_SIZE = 5;
export const ORDERS_PAGE_SIZE = PAGE_SIZE;

export function ordersList(orders, page, hasNext = false) {
  const lines = [`<b>🧾 SİPARİŞLER</b>`, `<i>Sayfa ${page + 1}</i>`, LINE];
  if (!orders.length) lines.push('Sipariş yok.');
  for (const o of orders) {
    const st = o.state?.state;
    lines.push(
      `${icon(st)} <b>${esc(truncate(o.orderOfferDetails?.offerTitle ?? 'Sipariş', 38))}</b>`,
      `   ${money(o.totalPrice)} · ${esc(stateLabel(o))} · ${esc(when(o.state?.createdDate))}`,
      `<code>#${esc(shortId(o.id))}</code>`,
      '',
    );
  }
  const nav = [];
  if (page > 0) nav.push({ text: '◀️', callback_data: `ord:list:${page - 1}` });
  nav.push({ text: '🔄', callback_data: `ord:list:${page}` });
  if (hasNext) nav.push({ text: '▶️', callback_data: `ord:list:${page + 1}` });
  const keyboard = orders.slice(0, PAGE_SIZE).map((o) => [
    { text: `${icon(o.state?.state)} #${shortId(o.id)} · ${money(o.totalPrice)}`, callback_data: `ord:one:${shortId(o.id)}` },
  ]);
  keyboard.push(nav);
  keyboard.push([{ text: '◀️ Menü', callback_data: 'dash:open' }]);
  return { text: lines.join('\n'), keyboard };
}

export function orderDetail(o) {
  const lines = [
    `${icon(o.state?.state)} <b>${esc(o.orderOfferDetails?.offerTitle ?? 'Sipariş')}</b>`,
    LINE,
    `Alıcı: <code>${esc(o.buyerUsername ?? '-')}</code>`,
    `Tutar: <b>${money(o.totalPrice)}</b> · ${esc(o.purchaseQuantity ?? 1)} adet`,
    `Durum: ${esc(stateLabel(o))}`,
    `Tarih: ${esc(when(o.state?.createdDate))}`,
    `No: <code>${esc(o.id)}</code>`,
  ];
  if (o.orderOfferDetails?.gameCategoryTitle) lines.push(`Kategori: ${esc(o.orderOfferDetails.gameCategoryTitle)}`);
  if (o.orderOfferDetails?.guaranteedDeliveryTime) lines.push(`Teslim süresi: ${esc(o.orderOfferDetails.guaranteedDeliveryTime)}`);
  const keyboard = [];
  if (o.state?.state === 'Paid') {
    keyboard.push([{ text: '✅ Teslim Et', callback_data: `ord:deliver:${shortId(o.id)}` }]);
  }
  keyboard.push([{ text: '🔄 Yenile', callback_data: `ord:one:${shortId(o.id)}` }]);
  keyboard.push([{ text: '◀️ Siparişler', callback_data: 'ord:list:0' }]);
  return { text: lines.join('\n'), keyboard };
}

export function pendingList(orders) {
  if (!orders.length) {
    return {
      text: '✅ <b>Bekleyen sipariş yok.</b>\nHer şey teslim edilmiş.',
      keyboard: [[{ text: '◀️ Menü', callback_data: 'dash:open' }]],
    };
  }
  const lines = ['<b>⏳ İŞLEM BEKLEYENLER</b>', LINE];
  for (const o of orders) {
    lines.push(
      `${icon(o.state?.state)} <b>${esc(truncate(o.orderOfferDetails?.offerTitle ?? 'Sipariş', 38))}</b>`,
      `   ${money(o.totalPrice)} · ${esc(stateLabel(o))}`,
      `<code>#${esc(shortId(o.id))}</code>`,
      '',
    );
  }
  const keyboard = orders.slice(0, PAGE_SIZE).map((o) => [
    { text: `${icon(o.state?.state)} #${shortId(o.id)} · ${money(o.totalPrice)}`, callback_data: `ord:one:${shortId(o.id)}` },
  ]);
  keyboard.push([{ text: '◀️ Menü', callback_data: 'dash:open' }]);
  return { text: lines.join('\n'), keyboard };
}

// ---------------------------------------------------------------- teklifler

export function offersList(offers, page, total) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const lines = ['<b>🏷 TEKLİFLER</b>', `<i>Sayfa ${page + 1} / ${totalPages} · ${total} kayıt</i>`, LINE];
  if (!offers.length) lines.push('Teklif yok.');
  for (const o of offers) {
    const active = isActive(o);
    lines.push(
      `${active ? '🟢' : '⏸'} <b>${esc(truncate(o.offerTitle ?? 'Teklif', 40))}</b>`,
      `   ${money(o.pricePerUnit)} · ${esc(o.quantity ?? '-')} adet`,
      `<code>#${esc(shortId(o.id))}</code>`,
      '',
    );
  }
  const nav = [];
  if (page > 0) nav.push({ text: '◀️', callback_data: `off:list:${page - 1}` });
  nav.push({ text: '🔄', callback_data: `off:list:${page}` });
  if (page + 1 < totalPages) nav.push({ text: '▶️', callback_data: `off:list:${page + 1}` });
  const keyboard = offers.slice(0, PAGE_SIZE).map((o) => [
    { text: truncate(o.offerTitle ?? 'Teklif', 34), callback_data: `off:one:${shortId(o.id)}` },
  ]);
  keyboard.push(nav);
  keyboard.push([{ text: '◀️ Menü', callback_data: 'dash:open' }]);
  return { text: lines.join('\n'), keyboard };
}

export function offerDetail(o, { autoText } = {}) {
  const active = isActive(o);
  const lines = [
    `${active ? '🟢' : '⏸'} <b>${esc(o.offerTitle ?? 'Teklif')}</b>`,
    LINE,
    `Fiyat: <b>${money(o.pricePerUnit)}</b>`,
    `Adet: <b>${esc(o.quantity ?? '-')}</b>`,
    `Durum: ${esc(offerStateText(o.offerState))}`,
    `No: <code>${esc(o.id)}</code>`,
  ];
  if (autoText) lines.push('', `🤖 Oto teslim metni: <i>${esc(truncate(autoText, 50))}</i>`);
  return {
    text: lines.join('\n'),
    keyboard: [
      [
        { text: '💰 Fiyat', callback_data: `off:price:${shortId(o.id)}` },
        { text: '📦 Stok', callback_data: `off:qty:${shortId(o.id)}` },
      ],
      [
        active
          ? { text: '⏸ Duraklat', callback_data: `off:pause:${shortId(o.id)}` }
          : { text: '▶️ Devam Ettir', callback_data: `off:resume:${shortId(o.id)}` },
        { text: '🤖 Oto Metin', callback_data: `off:auto:${shortId(o.id)}` },
      ],
      [{ text: '🔄 Yenile', callback_data: `off:one:${shortId(o.id)}` }, { text: '◀️ Teklifler', callback_data: 'off:list:0' }],
    ],
  };
}

// ---------------------------------------------------------------- ayarlar

export function settings(store) {
  return {
    text: [
      '<b>⚙️ AYARLAR</b>',
      LINE,
      `🔔 Sipariş bildirimi: <b>${store.get('monitor') ? 'AÇIK' : 'KAPALI'}</b>`,
      `🤖 Otomatik teslimat: <b>${store.get('autoDeliver') ? 'AÇIK' : 'KAPALI'}</b>`,
      `⏱ Kontrol aralığı: <b>${store.get('pollSeconds')} sn</b>`,
      '',
      '<i>Otomatik teslimat yalnızca teklif için metin tanımlıysa çalışır.</i>',
    ].join('\n'),
    keyboard: [
      [
        { text: `${store.get('monitor') ? '🔔 Bildirim: AÇIK' : '🔕 Bildirim: KAPALI'}`, callback_data: 'set:toggleMonitor' },
      ],
      [{ text: `${store.get('autoDeliver') ? '🤖 Oto teslim: AÇIK' : '💤 Oto teslim: KAPALI'}`, callback_data: 'set:toggleAuto' }],
      [{ text: '🔔 Test bildirimi', callback_data: 'set:test' }],
      [{ text: '◀️ Menü', callback_data: 'dash:open' }],
    ],
  };
}

// ---------------------------------------------------------------- yardim

export function helpText() {
  return {
    text: [
      '<b>❓ YARDIM</b>',
      LINE,
      '<b>Menü</b> — her şey butonlarla yapılabilir, komut ezberlemek gerekmez.',
      '',
      '<b>Komutlar</b>',
      '/panel — gösterge paneli',
      '/siparisler — son siparişler',
      '/bekleyen — işlem bekleyen siparişler',
      '/teklifler — teklifler',
      '/ayarlar — bildirim ve otomatik teslimat',
      '/yardim — bu ekran',
      '',
      '<i>Butonlar bir süre sonra eskiyebilir; /panel ile yenile.</i>',
    ].join('\n'),
    keyboard: [[{ text: '◀️ Menü', callback_data: 'dash:open' }]],
  };
}

// ---------------------------------------------------------------- yardimcilar

export function truncate(text, max) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Siparis bildirimi icin butonlu kart. */
export function orderAlert(o, { autoNote = null } = {}) {
  const lines = [
    '🛒 <b>YENİ SİPARİŞ</b>',
    LINE,
    `<b>${esc(o.orderOfferDetails?.offerTitle ?? 'Sipariş')}</b>`,
    `Alıcı: <code>${esc(o.buyerUsername ?? '-')}</code>`,
    `Tutar: <b>${money(o.totalPrice)}</b> · ${esc(o.purchaseQuantity ?? 1)} adet`,
    `Durum: ${esc(stateLabel(o))}`,
    `No: <code>#${esc(shortId(o.id))}</code>`,
  ];
  if (autoNote) lines.push('', autoNote);
  return {
    text: lines.join('\n'),
    keyboard: [[{ text: '👁 Detay', callback_data: `ord:one:${shortId(o.id)}` }]],
  };
}
