// Eldorado Seller API istemcisi.
// Auth: OAuth 2.0 client credentials -> POST /api/authentication/seller/token
// Token 15 dakika yasar; suresi dolmadan otomatik yenilenir.

const BASE_URL = 'https://www.eldorado.gg';
const TOKEN_PATH = '/api/authentication/seller/token';
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

export class ApiError extends Error {
  constructor(message, info = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = info.status ?? 0;
    this.code = info.code ?? null;
    this.messages = info.messages ?? [];
    this.method = info.method ?? null;
    this.path = info.path ?? null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Eldorado {
  constructor({ clientId, clientSecret, baseUrl = BASE_URL, minIntervalMs = 400, log = console.log } = {}) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.baseUrl = baseUrl;
    this.minIntervalMs = minIntervalMs;
    this.log = log;
    this.token = null;
    this.tokenExpiresAt = 0;
    this._queue = Promise.resolve();
    this._lastCallAt = 0;
  }

  // ---------------------------------------------------------------- token

  async getToken(force = false) {
    if (!force && this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;
    const res = await fetch(this.baseUrl + TOKEN_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ clientId: this.clientId, clientSecret: this.clientSecret }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* JSON degil */
    }
    if (!res.ok || !body?.accessToken) {
      const msgs = body?.messages?.join(', ') || text.slice(0, 200) || 'bilinmeyen hata';
      throw new ApiError(`Token alinamadi (HTTP ${res.status}): ${msgs}`, {
        status: res.status,
        messages: body?.messages ?? [],
        method: 'POST',
        path: TOKEN_PATH,
      });
    }
    this.token = body.accessToken;
    const ttlSec = Number(body.expiresIn) > 0 ? Number(body.expiresIn) : 900;
    this.tokenExpiresAt = Date.now() + ttlSec * 1000;
    return this.token;
  }

  // ---------------------------------------------------------------- istek

  /** Istekleri siraya koyar, arada minIntervalMs bekler (rate limit nezaketi). */
  request(method, path, { query, body, retries = 2 } = {}) {
    const run = async () => {
      const wait = this._lastCallAt + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        return await this._requestOnce(method, path, { query, body, retries });
      } finally {
        this._lastCallAt = Date.now();
      }
    };
    const next = this._queue.then(run, run);
    this._queue = next.catch(() => {});
    return next;
  }

  async _requestOnce(method, path, { query, body, retries }) {
    let url = this.baseUrl + path;
    if (query && Object.keys(query).length) {
      const qs = new URLSearchParams(
        Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''),
      ).toString();
      if (qs) url += `?${qs}`;
    }
    const token = await this.getToken();
    const init = {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const res = await fetch(url, init);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (res.status === 401 && retries > 0) {
      this.token = null;
      await this.getToken(true);
      return this._requestOnce(method, path, { query, body, retries: retries - 1 });
    }
    if (RETRY_STATUS.has(res.status) && retries > 0) {
      await sleep(1200 * (3 - retries));
      return this._requestOnce(method, path, { query, body, retries: retries - 1 });
    }
    if (!res.ok) {
      const messages = Array.isArray(data?.messages) ? data.messages : [];
      const msg = messages.join('; ') || (typeof data === 'string' ? data.slice(0, 200) : '') || res.statusText;
      throw new ApiError(`${method} ${path} -> HTTP ${res.status}: ${msg}`, {
        status: res.status,
        code: data?.code ?? null,
        messages,
        method,
        path,
      });
    }
    return data;
  }

  // ---------------------------------------------------------------- siparisler

  /** Satis siparislerini yeniden eskiye dogru sayfalar. */
  async listOrders({ pageIndex = 1, pageSize = 20 } = {}) {
    const data = await this.request('GET', '/api/v1/orders/me/seller/orders', {
      query: { pageIndex, pageSize },
    });
    return Array.isArray(data?.results) ? data.results : [];
  }

  async getOrder(orderId) {
    return this.request('GET', `/api/v1/orders/me/${orderId}`);
  }

  async statesCount() {
    return this.request('GET', '/api/v1/orders/me/states-count');
  }

  async overview() {
    return this.request('GET', '/api/v1/orders/me/overview');
  }

  async pendingOrdersSum() {
    return this.request('GET', '/api/v1/orders/me/pending-orders-sum');
  }

  /**
   * Siparisi teslim edildi olarak isaretler.
   * Not: Hesabin teklifleri Eldorado tarafindan zaten otomatik teslim ediliyorsa
   * bu cagri gerekmez. Govde sekli API'de belgelenmedigi icin aday sekiller sirayla denenir.
   */
  async deliverOrder(orderId, text) {
    const shapes = [
      (t) => ({ deliveryDetails: [{ value: t }] }),
      (t) => ({ deliveryDetails: [{ detailValue: t }] }),
      (t) => ({ deliveryDetail: t }),
      (t) => ({ details: t }),
      (t) => ({ message: t }),
      (t) => ({ deliveryMessage: t }),
    ];
    let lastErr = null;
    for (const build of shapes) {
      try {
        return await this.request('PUT', `/api/v1/orders/me/${orderId}/deliver`, { body: build(text), retries: 0 });
      } catch (err) {
        lastErr = err;
        // Siparis gercekten yoksa / yetki yoksa diger sekilleri denemek anlamsiz.
        if (err.status !== 400) break;
      }
    }
    throw lastErr;
  }

  // ---------------------------------------------------------------- bildirimler

  async unreadCount() {
    const data = await this.request('GET', '/api/notifications/me/unreadCount');
    return Number(data?.unreadNotificationCount ?? 0);
  }

  async listNotifications({ pageIndex = 1, pageSize = 10 } = {}) {
    const data = await this.request('GET', '/api/notifications/me', { query: { pageIndex, pageSize } });
    return Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
  }

  // ---------------------------------------------------------------- teklifler

  async listOffers({ pageIndex = 1, pageSize = 20 } = {}) {
    const data = await this.request('GET', '/api/v1/item-management/me/offers', {
      query: { pageIndex, pageSize },
    });
    return {
      offers: Array.isArray(data?.results) ? data.results : [],
      totalPages: data?.totalPages ?? 1,
      recordCount: data?.recordCount ?? 0,
    };
  }

  async searchOffers(term) {
    const data = await this.request('GET', '/api/v1/item-management/me/offers/me/search', {
      query: { pageIndex: 1, pageSize: 20, searchTerm: term },
    }).catch(() => null);
    if (data) return Array.isArray(data?.results) ? data.results : [];
    return [];
  }

  /** Teklif fiyatini degistirir. Govde sekli denenerek bulunur. */
  async setOfferPrice(offerId, amount, currency = 'USD') {
    // Teklif nesnesinde fiyat `pricePerUnit: {amount, currency}` olarak geliyor;
    // bu yuzden en olasi govde sekli once denenir.
    const shapes = [
      { pricePerUnit: { amount: Number(amount), currency } },
      { pricePerUnit: Number(amount) },
      { price: { amount: Number(amount), currency } },
      { price: Number(amount) },
      { price: Number(amount), currency },
      { amount: Number(amount) },
      { newPrice: Number(amount) },
    ];
    let lastErr = null;
    for (const body of shapes) {
      try {
        return await this.request('PUT', `/api/v1/item-management/me/offers/${offerId}/price`, { body, retries: 0 });
      } catch (err) {
        lastErr = err;
        if (err.status !== 400) break;
        if (!/price/i.test(err.message)) break; // sebep fiyat degilse sekil denemesi anlamsiz
      }
    }
    throw lastErr;
  }

  async setOfferQuantity(offerId, quantity) {
    const shapes = [{ quantity: Number(quantity) }, { newQuantity: Number(quantity) }, { amount: Number(quantity) }, { stock: Number(quantity) }];
    let lastErr = null;
    for (const body of shapes) {
      try {
        return await this.request('PUT', `/api/v1/item-management/me/offers/${offerId}/quantity`, { body, retries: 0 });
      } catch (err) {
        lastErr = err;
        if (err.status !== 400) break;
      }
    }
    throw lastErr;
  }

  async pauseOffer(offerId) {
    return this.request('POST', `/api/v1/item-management/me/offers/${offerId}/pause`);
  }

  async resumeOffer(offerId) {
    return this.request('POST', `/api/v1/item-management/me/offers/${offerId}/resume`);
  }
}
