// Uc teklif tipinin (urun / hesap / hazir) ortak yonetimi.
// Her tipin uclari ve govde sekilleri farkli; asagida tek yerde toplanir.

export const OFFER_TYPES = {
  item: {
    key: 'item',
    label: 'Ürün',
    emoji: '📦',
    list: '/api/v1/item-management/me/offers',
    price: (id) => ({ method: 'PUT', path: `/api/v1/item-management/me/offers/${id}/price` }),
    qty: (id) => ({ method: 'PUT', path: `/api/v1/item-management/me/offers/${id}/quantity` }),
    pause: (id) => ({ method: 'POST', path: `/api/v1/item-management/me/offers/${id}/pause` }),
    resume: (id) => ({ method: 'POST', path: `/api/v1/item-management/me/offers/${id}/resume` }),
    remove: (id) => ({ method: 'DELETE', path: `/api/v1/item-management/me/offers/${id}` }),
    pauseAll: () => ({ method: 'POST', path: '/api/v1/item-management/me/offers/pause' }),
    resumeGame: (gameId) => ({ method: 'POST', path: `/api/v1/item-management/me/offers/game/${gameId}/resume` }),
  },
  account: {
    key: 'account',
    label: 'Hesap',
    emoji: '👤',
    list: '/api/v1/account-management/me/offers',
    price: (id) => ({ method: 'PUT', path: `/api/v1/account-management/me/offers/${id}/price` }),
    qty: null,
    pause: (id) => ({ method: 'PUT', path: `/api/v1/account-management/me/offers/${id}/pause` }),
    resume: (id) => ({ method: 'PUT', path: `/api/v1/account-management/me/offers/${id}/resume` }),
    remove: (id) => ({ method: 'DELETE', path: `/api/v1/account-management/me/offers/${id}` }),
    pauseAll: () => ({ method: 'POST', path: '/api/v1/account-management/me/offers/pause' }),
    resumeGame: (gameId) => ({ method: 'POST', path: `/api/v1/account-management/me/offers/game/${gameId}/resume` }),
  },
  predefined: {
    key: 'predefined',
    label: 'Hazır',
    emoji: '🎁',
    list: '/api/predefinedOffers/me',
    price: (id) => ({ method: 'PUT', path: `/api/predefinedOffersUser/me/${id}/changePrice` }),
    qty: (id) => ({ method: 'PUT', path: `/api/predefinedOffersUser/me/${id}/changeQuantity` }),
    pause: (id) => ({ method: 'PUT', path: `/api/predefinedOffersUser/me/${id}/pause` }),
    resume: (id) => ({ method: 'PUT', path: `/api/predefinedOffersUser/me/${id}/resume` }),
    remove: (id) => ({ method: 'DELETE', path: `/api/predefinedOffersUser/me/${id}` }),
    pauseAll: () => ({ method: 'PUT', path: '/api/predefinedOffersUser/me/pauseAllActive' }),
    resumeGame: (gameId) => ({ method: 'PUT', path: `/api/predefinedOffersUser/me/resumeLatestPaused/${gameId}` }),
  },
};

export const TYPE_KEYS = Object.keys(OFFER_TYPES);

export function typeOf(key) {
  return OFFER_TYPES[key] || null;
}

/** Ham teklif nesnesini tek bicime cevirir. */
export function normalizeOffer(raw, typeKey) {
  const type = OFFER_TYPES[typeKey];
  const attributes = Array.isArray(raw.attributes)
    ? raw.attributes.flatMap((a) => (Array.isArray(a.values) ? a.values.map((v) => v.name) : [])).filter(Boolean)
    : [];
  const title =
    raw.offerTitle ||
    attributes.join(' · ') ||
    raw.gameCategoryTitle ||
    'Teklif';
  return {
    id: raw.id,
    type: typeKey,
    emoji: type.emoji,
    title,
    subtitle: raw.gameCategoryTitle || raw.category || '',
    price: raw.pricePerUnitWithDiscount ?? raw.pricePerUnit ?? raw.price ?? null,
    quantity: raw.quantity ?? raw.maxPurchaseQuantity ?? null,
    state: raw.offerState ?? raw.state ?? null,
    deliveryTime: raw.guaranteedDeliveryTime ?? null,
    gameId: raw.gameId ?? null,
    image: raw.mainOfferImage?.largeImage ?? null,
    raw,
  };
}

/** Sayfali liste. */
export async function listOffers(api, typeKey, page = 0, pageSize = 5) {
  const type = typeOf(typeKey);
  if (!type) throw new Error('Geçersiz teklif tipi');
  const data = await api.request('GET', type.list, { query: { pageIndex: page + 1, pageSize } });
  const results = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
  return {
    offers: results.map((r) => normalizeOffer(r, typeKey)),
    total: data?.recordCount ?? results.length,
    totalPages: data?.totalPages ?? 1,
  };
}

/** Tek kayit (kisa id oneki veya tam id). */
export async function findOffer(api, typeKey, ref) {
  const needle = String(ref).toLowerCase();
  for (let page = 0; page < 8; page += 1) {
    const { offers, totalPages } = await listOffers(api, typeKey, page, 50);
    const hit = offers.find((o) => String(o.id).toLowerCase().startsWith(needle));
    if (hit) return hit;
    if (!offers.length || page + 1 >= totalPages) break;
  }
  return null;
}

// ---------------------------------------------------------------- yazma

const PRICE_SHAPES = (amount, currency) => [
  { pricePerUnit: { amount, currency } },
  { pricePerUnit: amount },
  { price: { amount, currency } },
  { price: amount },
  { price: amount, currency },
  { amount },
  { newPrice: amount },
];

const QTY_SHAPES = (quantity) => [{ quantity }, { newQuantity: quantity }, { amount: quantity }, { stock: quantity }];

async function tryShapes(api, { method, path }, shapes) {
  let lastErr = null;
  for (const body of shapes) {
    try {
      return await api.request(method, path, { body, retries: 0 });
    } catch (err) {
      lastErr = err;
      if (err.status !== 400) break; // 400 disi hata: sekil sorunu degil
    }
  }
  throw lastErr;
}

export async function setPrice(api, typeKey, offerId, amount, currency = 'USD') {
  const target = typeOf(typeKey).price(offerId);
  return tryShapes(api, target, PRICE_SHAPES(Number(amount), currency));
}

export async function setQuantity(api, typeKey, offerId, quantity) {
  const fn = typeOf(typeKey).qty;
  if (!fn) throw new Error('Bu teklif tipinde adet değiştirilemez.');
  return tryShapes(api, fn(offerId), QTY_SHAPES(Number(quantity)));
}

export async function pauseOffer(api, typeKey, offerId) {
  const t = typeOf(typeKey).pause(offerId);
  return api.request(t.method, t.path);
}

export async function resumeOffer(api, typeKey, offerId) {
  const t = typeOf(typeKey).resume(offerId);
  return api.request(t.method, t.path);
}

export async function deleteOffer(api, typeKey, offerId) {
  const t = typeOf(typeKey).remove(offerId);
  return api.request(t.method, t.path);
}

export async function pauseAllOffers(api, typeKey) {
  const t = typeOf(typeKey).pauseAll();
  return api.request(t.method, t.path);
}

export async function resumeGameOffers(api, typeKey, gameId) {
  const t = typeOf(typeKey).resumeGame(gameId);
  return api.request(t.method, t.path);
}

/** Urun tekliflerinde arama. */
export async function searchOffers(api, term) {
  const data = await api.request('GET', '/api/v1/item-management/me/offers/me/search', {
    query: { pageIndex: 1, pageSize: 20, searchTerm: term },
  });
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.map((r) => normalizeOffer(r, 'item'));
}
