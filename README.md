# Eldorado Satıcı Telegram Botu

Eldorado.gg **Seller API** (OAuth 2.0 client credentials) üzerinden çalışan, sıfır bağımlılıklı
Node.js Telegram botu. Sahte bildirim yok — bot gerçekten Eldorado hesabını okur.

## Ne yapar

- 🛒 **Yeni sipariş bildirimi** — gerçek sipariş geldiğinde Telegram'a oyun, alıcı, tutar, durum bilgisiyle mesaj atar.
- 📊 **Durum/özet** — puan, teslim bekleyen, itirazlı, bekleyen tutar, okunmamış bildirim.
- 🏷 **Teklif yönetimi** — fiyat değiştirme, adet (stok) değiştirme, duraklat/devam.
- 📦 **Teslim** — siparişi teslim edildi olarak işaretleme; istenirse teklif başına metin tanımlayıp otomatik teslimat.
- 🔔 Okunmamış bildirim sayısı, sipariş durum dağılımı.

## Kurulum

1. [Eldorado Seller API](https://www.eldorado.gg) sayfasından **Client ID / Client Secret** üret.
2. `.env.example` dosyasını `.env` olarak kopyala ve doldur:

```ini
ELDORADO_CLIENT_ID=...
ELDORADO_CLIENT_SECRET=...
TELEGRAM_BOT_TOKEN=...      # BotFather'dan
TELEGRAM_CHAT_ID=           # boş bırak, bottan /start yazınca otomatik kaydedilir
POLL_SECONDS=45
```

3. Çalıştır:
   - Windows: `baslat.bat` dosyasına çift tıkla
   - veya terminalde: `npm start`

4. Telegram'da bota `/start` yaz. Chat ID otomatik kaydedilir ve bildirimler gelmeye başlar.

> Node.js 20 veya üzeri gerekir. Ek paket kurulumu yoktur (`npm install` gerekmez).

## Kullanım

Her şey **butonlarla** yapılır — komut ezberlemek gerekmez. `/start` yaz, menü gelir.

```
🛡 ELDORADO SATICI PANELİ
─────────────────
[📊 Panel]      [🛒 Siparişler]
[🏷 Teklifler]  [⚙️ Ayarlar]
[❓ Yardım]
```

- **Panel** — puan, bugünün cirosu, sipariş durum dağılımı, bekleyen tutar, izleme durumu.
- **Siparişler** — sayfalı liste; her siparişe dokununca detay kartı ve **✅ Teslim Et** butonu.
- **Teklifler** — sayfalı liste; her teklifte **💰 Fiyat**, **📦 Stok**, **⏸ Duraklat**, **🤖 Oto Metin**.
- **Ayarlar** — bildirim aç/kapat, otomatik teslimat aç/kapat, test bildirimi.

Yeni sipariş geldiğinde butonlu bir kart düşer:

```
🛒 YENİ SİPARİŞ
─────────────────
Fresh USA PSN Account | Full Access
Alıcı: BoldGust-DGRo
Tutar: $0.05 · 1 adet
Durum: Teslim edildi
─────────────────
[👁 Detay]
```

### Komutlar (kısayol)

| Komut | Açıklama |
|---|---|
| `/panel` | Gösterge paneli |
| `/siparisler` | Siparişler (sayfalı) |
| `/bekleyen` | Teslim/itiraz bekleyen siparişler |
| `/teklifler` | Teklifler (sayfalı) |
| `/ayarlar` | Bildirim / otomatik teslimat |
| `/fiyat <teklifNo> <tutar>` | Fiyat değiştir |
| `/stok <teklifNo> <adet>` | Adet değiştir |
| `/teslim <siparişNo> <metin>` | Siparişi teslim et |
| `/izle on\|off` · `/oto on\|off` | Hızlı aç/kapat |
| `/iptal` | Yarım kalan girişi iptal et |

Teklif/sipariş numarası olarak listede görünen kısa kodun ilk birkaç karakteri yeterlidir.

## Otomatik teslimat

Eldorado, gizli bilgileri (secret details) tanımlanmış teklifleri **kendisi** otomatik teslim eder.
Bu botun otomatik teslimatı, elde teslim edilen (Paid durumunda bekleyen) siparişler içindir:

```
/oto on
/oto metin 468632 mail@sifre
```

Sipariş geldiğinde teklif için metin tanımlıysa bot `PUT /api/v1/orders/me/{orderId}/deliver`
çağrısını yapar. Varsayılan olarak **kapalıdır**.

## Notlar

- Access token 15 dakikalık; bot otomatik yeniler.
- İlk çalıştırmada mevcut siparişler "görülmüş" sayılır — eski siparişler için bildirim yağmuru olmaz.
- Durum `data/state.json` dosyasında tutulur (görülen siparişler, ayarlar).
- API hata verirse bot 3. ardışık hatada Telegram'dan uyarır.
- `.env` dosyasını asla git'e eklemeyin (`.gitignore`'da).
