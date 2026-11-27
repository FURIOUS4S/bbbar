// Kucuk Telegram Bot API istemcisi (long polling, sifir bagimlilik).

export class Telegram {
  constructor(token, { log = console.log } = {}) {
    this.token = token;
    this.base = `https://api.telegram.org/bot${token}`;
    this.log = log;
    this.offset = 0;
    this.running = false;
    this.onMessage = null;
    this.onCallback = null;
  }

  async api(method, payload, { timeoutMs = 35_000 } = {}) {
    const res = await fetch(`${this.base}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => null);
    if (!data?.ok) {
      const desc = data?.description || `HTTP ${res.status}`;
      const err = new Error(`Telegram ${method}: ${desc}`);
      err.status = res.status;
      err.description = desc;
      throw err;
    }
    return data.result;
  }

  me() {
    return this.api('getMe', {}, { timeoutMs: 15_000 });
  }

  send(chatId, text, { keyboard = null, preview = false } = {}) {
    const payload = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: !preview,
    };
    if (keyboard) payload.reply_markup = { inline_keyboard: keyboard };
    return this.api('sendMessage', payload);
  }

  edit(chatId, messageId, text, { keyboard = null } = {}) {
    const payload = {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (keyboard) payload.reply_markup = { inline_keyboard: keyboard };
    return this.api('editMessageText', payload);
  }

  answerCallback(id, text = '') {
    return this.api('answerCallbackQuery', { callback_query_id: id, text, show_alert: false }).catch(() => null);
  }

  /** Long polling dongusu. */
  async start({ onMessage, onCallback } = {}) {
    this.onMessage = onMessage;
    this.onCallback = onCallback;
    this.running = true;
    while (this.running) {
      try {
        const updates = await this.api(
          'getUpdates',
          { offset: this.offset, timeout: 30, allowed_updates: ['message', 'callback_query'] },
          { timeoutMs: 45_000 },
        );
        for (const update of updates ?? []) {
          this.offset = update.update_id + 1;
          try {
            if (update.message) await this.onMessage?.(update.message);
            else if (update.callback_query) await this.onCallback?.(update.callback_query);
          } catch (err) {
            this.log('[telegram] guncelleme islenemedi:', err.message);
          }
        }
      } catch (err) {
        if (!this.running) break;
        this.log('[telegram] baglanti hatasi, 5 sn sonra tekrar:', err.message);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  stop() {
    this.running = false;
  }
}

/** HTML parse_mode icin kullanici kaynakli metinleri guvenli hale getirir. */
export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
