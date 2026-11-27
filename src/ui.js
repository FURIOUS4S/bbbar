// Tum ekranlarin tasarimi. Bot mantigi yok, sadece gorunum.
import { esc } from './telegram.js';
import { money, shortId, stateLabel, when } from './format.js';
import { OFFER_TYPES } from './offers.js';

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
const isActive = (state) => !/paused|inactive|hidden|deleted/i.test(String(state ?? ''));

const LINE = '─────────────────';

export function header(title, subtitle) {
  const out = [`<b>${title}</b>`];
  if (subtitle) out.push(`<i>${esc(subtitle)}</i>`);
  out.push(LINE);
  return out.join('\n');
}

export function truncate(text, max) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ---------------------------------------------------------------- ana menu

export function mainMenu(store) {
  return {
    text: [
      '<b>🛡 ELDORADO SATICI PANELİ</b>',
      LINE,
      `Sipariş izleme: ${store.get('monitor') ? '🟢 açık' : '⚫ kapalı'}   ·   Otomatik teslim: ${store.get('autoDeliver') ? '🟢 açık' : '⚫ kapalı'}`,
      '',
      'Her şey butonlarla. Komut yazmana gerek yok.',
    ].join('\n'),
    keyboard: [
      [{ text: '📊 Panel', callback_data: 'dash:open' }, { text: '🛒 Siparişler', callback_data: 'ord:menu' }],
      [{ text: '🏷 Teklifler', callback_data: 'off:menu' }, { text: '🔔 Bildirimler', callback_data: 'notif:list:0' }],
      [{ text: '⭐ Değerlendirmeler', callback_data: 'rev:list:0' }, { text: '🚀 Boosting', callback_data: 'boost:list' }],
      [{ text: '⚙️ Ayarlar', callback_data: 'set:open' }, { text: '❓ Yardım', callback_data: 'help:open' }],
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
      [{ text: '🔄 Yenile', callback_data: 'dash:refresh' }, { text: '🛒 Siparişler', callback_data: 'ord:menu' }],
      [{ text: '⏳ Bekleyenler', callback_data: 'ord:list:pending:0' }, { text: '🏷 Teklifler', callback_data: 'off:menu' }],
      [{ text: '⚙️ Ayarlar', callback_data: 'set:open' }, { text: '◀️ Menü', callback_data: 'menu:open' }],
    ],
  };
}

// ---------------------------------------------------------------- siparisler

export const PAGE_SIZE = 5;

const ORDER_FILTERS = {
  all: { label: 'Tümü', match: () => true },
  pending: { label: 'Bekleyen', match: (o) => ['Paid', 'Disputed'].includes(o.state?.state) },
  disputed: { label: 'İtirazlı', match: (o) => o.state?.state === 'Disputed' },
  done: { label: 'Tamamlanan', match: (o) => ['Completed', 'Received', 'Delivered'].includes(o.state?.state) },
};

export function ordersMenu() {
  return {
    text: ['<b>🛒 SİPARİŞLER</b>', LINE, 'Hangi listeyi görmek istiyorsun?'].join('\n'),
    keyboard: [
      [{ text: '📄 Tümü', callback_data: 'ord:list:all:0' }, { text: '⏳ Bekleyen', callback_data: 'ord:list:pending:0' }],
      [{ text: '🔴 İtirazlı', callback_data: 'ord:list:disputed:0' }, { text: '✅ Tamamlanan', callback_data: 'ord:list:done:0' }],
      [{ text: '◀️ Menü', callback_data: 'menu:open' }],
    ],
  };
}

export function ordersList(orders, { filter = 'all', page = 0, hasNext = false } = {}) {
  const f = ORDER_FILTERS[filter] || ORDER_FILTERS.all;
  const lines = [`<b>🧾 SİPARİŞLER · ${f.label}</b>`, `<i>Sayfa ${page + 1}</i>`, LINE];
  if (!orders.length) lines.push('Bu listede sipariş yok.');
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
  if (page > 0) nav.push({ text: '◀️', callback_data: `ord:list:${filter}:${page - 1}` });
  nav.push({ text: '🔄', callback_data: `ord:list:${filter}:${page}` });
  if (hasNext) nav.push({ text: '▶️', callback_data: `ord:list:${filter}:${page + 1}` });
  const keyboard = orders.map((o) => [
    { text: `${icon(o.state?.state)} #${shortId(o.id)} · ${money(o.totalPrice)}`, callback_data: `ord:one:${shortId(o.id)}` },
  ]);
  keyboard.push(nav);
  keyboard.push([{ text: '🔎 Filtre', callback_data: 'ord:menu' }, { text: '◀️ Menü', callback_data: 'menu:open' }]);
  return { text: lines.join('\n'), keyboard };
}

export const CANCEL_REASONS = {
  outOfStock: 'Stok yok / tedarik edemiyorum',
  priceMistake: 'Fiyat hatası',
  buyerRequest: 'Alıcı istedi',
  other: 'Diğer',
};

export function orderDetail(o) {
  const st = o.state?.state;
  const lines = [
    `${icon(st)} <b>${esc(o.orderOfferDetails?.offerTitle ?? 'Sipariş')}</b>`,
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
  if (st === 'Paid') {
    keyboard.push([{ text: '✅ Teslim Et', callback_data: `ord:flow:deliver:${shortId(o.id)}` }]);
    keyboard.push([
      { text: '⏱ Süre Uzat', callback_data: `ord:extend:${shortId(o.id)}` },
      { text: '❌ İptal', callback_data: `ord:cancel:${shortId(o.id)}` },
    ]);
  } else if (st === 'Disputed') {
    keyboard.push([{ text: '💬 İtiraz Detayı', callback_data: `ord:one:${shortId(o.id)}` }]);
  }
  keyboard.push([{ text: '🔄 Yenile', callback_data: `ord:one:${shortId(o.id)}` }, { text: '◀️ Siparişler', callback_data: 'ord:list:all:0' }]);
  return { text: lines.join('\n'), keyboard };
}

export function cancelReasons(order) {
  return {
    text: [
      '<b>❌ SİPARİŞ İPTALİ</b>',
      LINE,
      `<code>#${esc(shortId(order.id))}</code> · ${money(order.totalPrice)}`,
      '',
      'İptal sebebini seç:',
    ].join('\n'),
    keyboard: [
      ...Object.entries(CANCEL_REASONS).map(([key, label]) => [
        { text: label, callback_data: `ord:cancel2:${shortId(order.id)}:${key}` },
      ]),
      [{ text: '↩️ Vazgeç', callback_data: `ord:one:${shortId(order.id)}` }],
    ],
  };
}

export function extendMenu(order) {
  return {
    text: [
      '<b>⏱ TESLİM SÜRESİ UZAT</b>',
      LINE,
      `<code>#${esc(shortId(order.id))}</code>`,
      '',
      'Ne kadar uzatılsın?',
    ].join('\n'),
    keyboard: [
      [
        { text: '24 saat', callback_data: `ord:extend2:${shortId(order.id)}:24` },
        { text: '48 saat', callback_data: `ord:extend2:${shortId(order.id)}:48` },
        { text: '72 saat', callback_data: `ord:extend2:${shortId(order.id)}:72` },
      ],
      [{ text: '↩️ Vazgeç', callback_data: `ord:one:${shortId(order.id)}` }],
    ],
  };
}

// ---------------------------------------------------------------- teklifler

export function offersMenu() {
  return {
    text: [
      '<b>🏷 TEKLİFLER</b>',
      LINE,
      'Hangi teklif tipini yönetmek istiyorsun?',
      '',
      '📦 <b>Ürün</b> — anahtarlar, item satışları',
      '👤 <b>Hesap</b> — hesaplar',
      '🎁 <b>Hazır</b> — hazır paketler',
    ].join('\n'),
    keyboard: [
      [
        { text: '📦 Ürün', callback_data: 'off:item:list:0' },
        { text: '👤 Hesap', callback_data: 'off:account:list:0' },
        { text: '🎁 Hazır', callback_data: 'off:predefined:list:0' },
      ],
      [{ text: '🔎 Ara (ürün)', callback_data: 'off:search' }, { text: '◀️ Menü', callback_data: 'menu:open' }],
    ],
  };
}

export function offersList(offers, { type, page = 0, total = 0, totalPages = 1 } = {}) {
  const t = OFFER_TYPES[type];
  const lines = [`<b>${t.emoji} ${t.label.toUpperCase()} TEKLİFLERİ</b>`, `<i>Sayfa ${page + 1} / ${Math.max(1, totalPages)} · ${total} kayıt</i>`, LINE];
  if (!offers.length) lines.push('Teklif yok.');
  for (const o of offers) {
    lines.push(
      `${isActive(o.state) ? '🟢' : '⏸'} <b>${esc(truncate(o.title, 40))}</b>`,
      `   ${money(o.price)}${o.quantity != null ? ` · ${esc(o.quantity)} adet` : ''}${o.subtitle ? ` · ${esc(truncate(o.subtitle, 18))}` : ''}`,
      `<code>#${esc(shortId(o.id))}</code>`,
      '',
    );
  }
  const nav = [];
  if (page > 0) nav.push({ text: '◀️', callback_data: `off:${type}:list:${page - 1}` });
  nav.push({ text: '🔄', callback_data: `off:${type}:list:${page}` });
  if (page + 1 < totalPages) nav.push({ text: '▶️', callback_data: `off:${type}:list:${page + 1}` });
  const keyboard = offers.map((o) => [
    { text: truncate(o.title, 34), callback_data: `off:${type}:one:${shortId(o.id)}` },
  ]);
  keyboard.push(nav);
  keyboard.push([
    { text: '⏸ Tümünü Duraklat', callback_data: `off:${type}:pauseAll` },
    { text: '◀️ Geri', callback_data: 'off:menu' },
  ]);
  return { text: lines.join('\n'), keyboard };
}

export function offerDetail(o, { autoText } = {}) {
  const t = OFFER_TYPES[o.type];
  const active = isActive(o.state);
  const lines = [
    `${active ? '🟢' : '⏸'} <b>${esc(o.title)}</b>`,
    LINE,
  ];
  if (o.subtitle) lines.push(`Kategori: ${esc(o.subtitle)}`);
  lines.push(
    `Fiyat: <b>${money(o.price)}</b>`,
    o.quantity != null ? `Adet: <b>${esc(o.quantity)}</b>` : null,
    `Durum: ${esc(offerStateText(o.state))}`,
    o.deliveryTime ? `Teslim: ${esc(o.deliveryTime)}` : null,
    `Tip: ${t.emoji} ${t.label}`,
    `No: <code>${esc(o.id)}</code>`,
  );
  if (autoText) lines.push('', `🤖 Oto teslim metni: <i>${esc(truncate(autoText, 50))}</i>`);
  const id = shortId(o.id);
  const kb = [
    [{ text: '💰 Fiyat', callback_data: `off:${o.type}:flow:price:${id}` }, { text: '📦 Stok', callback_data: `off:${o.type}:flow:qty:${id}` }],
  ];
  kb.push([
    active
      ? { text: '⏸ Duraklat', callback_data: `off:${o.type}:pause:${id}` }
      : { text: '▶️ Devam Ettir', callback_data: `off:${o.type}:resume:${id}` },
    { text: '🤖 Oto Metin', callback_data: `off:${o.type}:flow:auto:${id}` },
  ]);
  kb.push([
    { text: '🔄 Yenile', callback_data: `off:${o.type}:one:${id}` },
    { text: '🗑 Sil', callback_data: `off:${o.type}:del:${id}` },
  ]);
  kb.push([{ text: `◀️ ${t.label} teklifleri`, callback_data: `off:${o.type}:list:0` }]);
  return { text: lines.filter((l) => l !== null).join('\n'), keyboard: kb };
}

export function offerDeleteConfirm(o) {
  return {
    text: [
      '🗑 <b>TEKLİFİ SİL</b>',
      LINE,
      `<b>${esc(truncate(o.title, 48))}</b>`,
      `${money(o.price)} · ${esc(offerStateText(o.state))}`,
      '',
      '<b>Bu işlem geri alınamaz.</b> Emin misin?',
    ].join('\n'),
    keyboard: [
      [
        { text: '✅ Evet, sil', callback_data: `off:${o.type}:delok:${shortId(o.id)}` },
        { text: '↩️ Vazgeç', callback_data: `off:${o.type}:one:${shortId(o.id)}` },
      ],
    ],
  };
}

// ---------------------------------------------------------------- bildirimler

export function notificationsList(items, page) {
  const lines = ['<b>🔔 BİLDİRİMLER</b>', `<i>Sayfa ${page + 1}</i>`, LINE];
  if (!items.length) lines.push('Bildirim yok.');
  for (const n of items) {
    const title = n.title ?? n.notificationTitle ?? n.subject ?? 'Bildirim';
    const body = n.body ?? n.message ?? n.text ?? '';
    const date = n.createdDate ?? n.createdAt ?? n.date;
    lines.push(`• <b>${esc(truncate(title, 60))}</b>`);
    if (body) lines.push(`   <i>${esc(truncate(String(body).replace(/<[^>]+>/g, ' '), 90))}</i>`);
    if (date) lines.push(`   ${esc(when(date))}`);
    lines.push('');
  }
  const keyboard = [
    [{ text: '🔄 Yenile', callback_data: `notif:list:${page}` }, { text: '✅ Tümünü Okundu', callback_data: 'notif:readall' }],
    [{ text: '◀️ Menü', callback_data: 'menu:open' }],
  ];
  return { text: lines.join('\n'), keyboard };
}

// ---------------------------------------------------------------- degerlendirmeler

const RATING_STAR = { 1: '⭐', 2: '⭐⭐', 3: '⭐⭐⭐', 4: '⭐⭐⭐⭐', 5: '⭐⭐⭐⭐⭐' };

export function reviewsList({ info, reviews }, page) {
  const lines = ['<b>⭐ DEĞERLENDİRMELER</b>', LINE];
  if (info) {
    lines.push(
      `Puan: <b>${Number(info.reviewScore ?? 0).toFixed(2)}</b> · ${esc(info.ratingCount ?? 0)} değerlendirme`,
      `👍 ${esc(info.positiveCount ?? 0)} · 👎 ${esc(info.negativeCount ?? 0)}`,
      '',
    );
  }
  if (!reviews.length) lines.push('Değerlendirme yok.');
  for (const r of reviews) {
    const rating = r.rating ?? r.stars ?? r.score;
    const text = r.comment ?? r.text ?? r.message ?? r.description ?? '';
    lines.push(
      `${RATING_STAR[rating] || '⭐'} <b>${esc(truncate(r.buyerUsername ?? r.username ?? 'Alıcı', 24))}</b>`,
      text ? `   <i>${esc(truncate(String(text), 100))}</i>` : null,
      `   ${esc(when(r.createdDate ?? r.createdAt ?? r.date))}`,
      '',
    );
  }
  return {
    text: lines.filter((l) => l !== null).join('\n'),
    keyboard: [
      [{ text: '🔄 Yenile', callback_data: `rev:list:${page}` }],
      [{ text: '◀️ Menü', callback_data: 'menu:open' }],
    ],
  };
}

// ---------------------------------------------------------------- boosting

export function boostingList(subs) {
  const lines = ['<b>🚀 BOOSTING ABONELİKLERİ</b>', LINE];
  const active = subs.filter((s) => s.isActive || s.isSubscribed);
  if (!subs.length) lines.push('Kayıt yok.');
  for (const s of (active.length ? active : subs).slice(0, 12)) {
    lines.push(
      `${s.isActive || s.isSubscribed ? '🟢' : '⚫'} <b>${esc(s.gameName ?? '-')}</b> · ${esc(s.boostingCategoryName ?? s.gameCategoryTitle ?? '')}`,
    );
  }
  if (!active.length && subs.length) lines.push('', '<i>Aktif abonelik yok — yukarıdakiler mevcut kategoriler.</i>');
  return {
    text: lines.join('\n'),
    keyboard: [[{ text: '🔄 Yenile', callback_data: 'boost:list' }], [{ text: '◀️ Menü', callback_data: 'menu:open' }]],
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
      [{ text: store.get('monitor') ? '🔔 Bildirim: AÇIK' : '🔕 Bildirim: KAPALI', callback_data: 'set:toggleMonitor' }],
      [{ text: store.get('autoDeliver') ? '🤖 Oto teslim: AÇIK' : '💤 Oto teslim: KAPALI', callback_data: 'set:toggleAuto' }],
      [{ text: '🔔 Test bildirimi', callback_data: 'set:test' }, { text: '◀️ Menü', callback_data: 'menu:open' }],
    ],
  };
}

// ---------------------------------------------------------------- yardim

export function helpText() {
  return {
    text: [
      '<b>❓ YARDIM</b>',
      LINE,
      'Her şey butonlarla yapılır — komut yazmak zorunda değilsin.',
      '',
      '<b>Neler yapabilirsin</b>',
      '📊 Panel — puan, bugünün cirosu, sipariş dağılımı',
      '🛒 Siparişler — filtrele, detay, teslim, süre uzat, iptal',
      '🏷 Teklifler — ürün/hesap/hazır: fiyat, stok, duraklat, sil',
      '🔔 Bildirimler — okundu işaretle',
      '⭐ Değerlendirmeler — son yorumlar',
      '🚀 Boosting — abonelikler',
      '',
      '<i>Butonlar eskiyebilir; /panel ile yenile.</i>',
    ].join('\n'),
    keyboard: [[{ text: '◀️ Menü', callback_data: 'menu:open' }]],
  };
}

/** Yeni siparis bildirimi icin butonlu kart. */
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
