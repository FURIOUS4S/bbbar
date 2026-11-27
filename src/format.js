// Telegram mesajlari icin bicimlendirme yardimcilari.
import { esc } from './telegram.js';

export const STATE_TR = {
  Initialized: 'Başlatıldı',
  Paid: 'Ödeme alındı — teslim bekliyor',
  Delivered: 'Teslim edildi',
  Received: 'Alıcı onayladı',
  Completed: 'Tamamlandı',
  Canceled: 'İptal edildi',
  Disputed: 'İtiraz var',
};

export function money(obj) {
  if (!obj) return '-';
  const amount = Number(obj.amount ?? obj);
  const currency = obj.currency || 'USD';
  if (!Number.isFinite(amount)) return '-';
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'TRY' ? '₺' : `${currency} `;
  return `${symbol}${amount.toFixed(2)}`;
}

export function when(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function shortId(id) {
  return String(id ?? '').split('-')[0] || '-';
}

export function orderTitle(order) {
  return (
    order?.orderOfferDetails?.offerTitle ||
    order?.orderOfferDetails?.gameCategoryTitle ||
    order?.offerTitle ||
    'Sipariş'
  );
}

export function stateLabel(order) {
  const raw = order?.state?.state ?? order?.state ?? '';
  return STATE_TR[raw] || raw || '-';
}

export function formatOrder(order, { header = '🛒 <b>Sipariş</b>' } = {}) {
  const lines = [
    header,
    '',
    `<b>${esc(orderTitle(order))}</b>`,
    `Alıcı: <code>${esc(order.buyerUsername ?? '-')}</code>`,
    `Tutar: <b>${money(order.totalPrice)}</b>  (${esc(order.purchaseQuantity ?? 1)} adet)`,
    `Durum: ${esc(stateLabel(order))}`,
    `Tarih: ${esc(when(order.state?.createdDate ?? order.createdDate))}`,
    `No: <code>${esc(shortId(order.id))}</code>`,
  ];
  return lines.join('\n');
}

export function formatOffer(offer) {
  const price = offer.price?.amount ?? offer.price ?? offer.pricePerUnit?.amount;
  const currency = offer.price?.currency ?? offer.currency ?? offer.pricePerUnit?.currency ?? 'USD';
  const amount = typeof price === 'object' ? price?.amount : price;
  const qty = offer.quantity ?? offer.maxPurchaseQuantity ?? offer.purchaseQuantity;
  const state = offer.state ?? offer.offerState;
  const lines = [
    `<b>${esc(offer.offerTitle ?? offer.title ?? 'Teklif')}</b>`,
    `Fiyat: <b>${money({ amount, currency })}</b>${qty != null ? `  •  Adet: ${esc(qty)}` : ''}`,
    state ? `Durum: ${esc(state)}` : null,
    `No: <code>${esc(shortId(offer.id))}</code>`,
  ].filter(Boolean);
  return lines.join('\n');
}
