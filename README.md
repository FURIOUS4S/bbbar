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
   - **Arka plan (önerilen):** `arka-plan.vbs` dosyasına çift tıkla — pencere açılmaz, bot
     görünmez çalışır; kapanırsa 15 sn içinde kendini yeniden başlatır.
   - Ön plan: `baslat.bat` (pencereyi kapatırsan bot durur)
   - veya terminalde: `npm start`

4. Telegram'da bota `/start` yaz. Chat ID otomatik kaydedilir ve bildirimler gelmeye başlar.

> Durdurmak için `durdur.bat` dosyasına çift tıkla.
> Botun ne yaptığını görmek için `data/bot.log` dosyasına bak (son 2 MB tutulur).
> Node.js 20 veya üzeri gerekir. Ek paket kurulumu yoktur (`npm install` gerekmez).

## 7/24 çalıştırma (Render.com — ücretsiz plan)

PC kapalıyken de bildirim gelsin istiyorsan botu Render'a koy. Ücretsiz plan 15 dk
gelen istek olmazsa uykuya geçer; bot bunu iki şekilde engeller:

- **Kendi kendini uyanık tutma (birincil):** süreç, Render'ın verdiği
  `RENDER_EXTERNAL_URL` adresine **5 dakikada bir** `/health` isteği atar.
- **GitHub Actions yedeği:** `.github/workflows/keepalive.yml` de 5 dakikada bir aynı
  ucu dışarıdan yoklar. Not: repo 60+ gün hareketsiz kaldıysa GitHub zamanlanmış
  işleri kapatır; Actions sekmesinden yeniden etkinleştirmek gerekebilir (bu repoda
  zamanlayıcı hiç tetiklenmedi — birincil mekanizma bu yüzden var).

1. Depoyu GitHub'a gönder (`FURIOUS4S/bbbar`).
2. Render → **New → Blueprint** → depoyu seç → `render.yaml` otomatik okunur → **Apply**.
3. Gizli değerleri gir:
   - `ELDORADO_CLIENT_ID`, `ELDORADO_CLIENT_SECRET`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID=6459948462` (kalıcı disk olmadığı için şart)
4. Deploy bitince verilen `https://....onrender.com` adresini kopyala.
5. GitHub → depo → **Settings → Secrets and variables → Actions → Variables →
   New repository variable** → ad `RENDER_URL`, değer o adres.
6. Yerel kopyayı kapat: `yerel-kaldir.bat` çift tık. Aynı anda iki kopya çalışırsa
   Telegram uzun anketi çakışır (çift/eksik bildirim).

Sınırlar (dürüst):

- Ücretsiz plan ayda **750 saat** verir; 7/24 açık kalmak ~720 saat.
- Kalıcı disk yok: her yeniden başlatmada `data/state.json` sıfırlanır. Bot mevcut
  siparişleri "görülmüş" sayıp devam eder; kısa restart aralığında gelen siparişin
  bildirimi kaçabilir.
- GitHub zamanlanmış işleri bazen 5–15 dk gecikebilir; uykuya dalarsa ilk istek
  botu ~1 dk içinde uyandırır.
- Kesintisiz garanti istersen `render.yaml` içinde `plan: free` → `starter` yap
  (ücretli) veya küçük bir VPS kullan.

## Kullanım

Her şey **butonlarla** yapılır — komut ezberlemek gerekmez. `/start` yaz, menü gelir.

```
🛡 ELDORADO SATICI PANELİ
─────────────────
[📊 Panel]            [🛒 Siparişler]
[🏷 Teklifler]        [🔔 Bildirimler]
[⭐ Değerlendirmeler] [🚀 Boosting]
[⚙️ Ayarlar]          [❓ Yardım]
```

- **Panel** — puan, bugünün sipariş/cirosu, sipariş durum dağılımı, bekleyen tutar, izleme durumu.
- **Siparişler** — Tümü / Bekleyen / İtirazlı / Tamamlanan filtreleri, sayfalama.
  Sipariş detayında **✅ Teslim Et**, **⏱ Süre Uzat** (24/48/72 saat), **❌ İptal** (sebep seçmeli).
- **Teklifler** — üç tip ayrı ayrı yönetilir: 📦 Ürün, 👤 Hesap, 🎁 Hazır.
  Her teklifte **💰 Fiyat**, **📦 Stok**, **⏸ Duraklat / ▶️ Devam**, **🤖 Oto Metin**, **🗑 Sil**;
  ayrıca tipe göre **Tümünü Duraklat** ve ürün araması.
- **Bildirimler** — liste ve **Tümünü Okundu**.
- **Değerlendirmeler** — puan özeti ve son yorumlar.
- **Boosting** — abonelik durumları.
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
| `/bildirimler` | Bildirimler |
| `/yorumlar` | Değerlendirmeler |
| `/izle on\|off` · `/oto on\|off` | Bildirim / oto teslim aç-kapat |
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
- Bot kapalıyken 4+ sipariş biriktiyse açılışta tek **özet kartı** gönderilir (20 ayrı bildirim yerine).
- Durum `data/state.json` dosyasında tutulur (görülen siparişler, ayarlar).
- API hata verirse bot 3. ardışık hatada Telegram'dan uyarır.
- `.env` dosyasını asla git'e eklemeyin (`.gitignore`'da).
