# Velox Charts (`v1.4.1`)

[🇹🇷 Türkçe Açıklama](#-türkçe-açıklama) · [🇬🇧 English Documentation](#-english-documentation) · [📘 Görsel Kurulum Rehberi (PDF)](docs/Velox_Charts_Kurulum_Rehberi.pdf) · [☁️ 7/24 Bulut Senkronizasyon & Push Rehberi](docs/CLOUD_SYNC_AND_PUSH_GUIDE.md)

---

## 🇹🇷 Türkçe Açıklama

**Velox Charts**, TradingView tarzı çoklu ekran canlı grafik ve FXReplay tarzı Backtest (Bar Replay) platformudur. Backend tamamen saf Node.js ile yazılmıştır (**sıfır harici npm paketi**).

### Öne Çıkan Özellikler
- **Sınırsız Çoklu Monitör Desteği:** Tek tıkla `+ New Screen` ile istediğin kadar senkronize pencere aç; her pencerede 1/2/3/4/6'lı grafik düzeni kur.
- **Zengin Piyasa Kapsamı:**
  - **OANDA (Ücretsiz Practice API ile):** Forex, Altın (`XAU/USD`), Gümüş (`XAG/USD`), Sentetik DXY, `NAS100`, `SPX500`, Petrol — 0 sn gerçek zamanlı akış.
  - **CME Vadeli İşlemler (API Anahtarsız):** `NQ1!`, `ES1!`, `GC1!`, `CL1!`, `6E1!`, `SI1!` — gerçek borsa fiyatları (~1–2 dk gecikmeli ücretsiz akış).
  - **Borsa İstanbul (`BIST`) & Spot TRY (API Anahtarsız):** `BIST 100`, `BIST 30`, `XBANK`, `THYAO`, `ASELS`, `GARAN` + 20+ BIST hissesi (ve herhangi bir `<KOD>.IS` hissesi), ayrıca gerçek zamanlı çok yıllık `USD/TRY`, `EUR/TRY`, `GBP/TRY`.
  - **Kripto (API Anahtarsız):** Binance, Coinbase, Bybit, Kraken 7/24 gerçek zamanlı WebSocket.
- **Ekonomik Takvim & Piyasa Tatilleri:** ABD/AB makro haberleri, grafik üstü haber ikonları, açılır/kapanır geçmiş haberler ve otomatik hesaplanan ABD/Avrupa/İngiltere piyasa tatilleri (Thanksgiving, Noel, Erken Kapanışlar vb.).
- **Profesyonel Çizim & Fiyat Alarmları:** Trend çizgisi, ışın, paralel kanal, kutu, Fibonacci, ok, ZigZag, serbest çizim, Long/Short Risk:Ödül aracı ve grafikte sürüklenebilir fiyat alarmları.
- **FXReplay Tarzı Bar Replay & Backtest:** Sıfır gelecek sızıntılı mum oynatma, çoklu parite senkron replay, Prop Firm kuralları (FTMO, The5ers + özel kurallar), işlem günlüğü, equity eğrisi, sıfır-RAM ikili (`.bin`) hızlı replay motoru ve tek dosya paylaşım (`📤 Export File`).
- **Masaüstü + Web + Mobil (Android & iOS):** macOS (`.dmg`), Windows (`.zip`), Web (`node server/index.js`) ve Capacitor tabanlı bağımsız mobil uygulama (`mobile/`).

### Güvenlik ve Virüssüzlük Garantisi (Açık Kaynak Denetimi)
Bu repo **%100 okunabilir, açık kaynak** koddan oluşur:
- Backend (`server/`) **hiçbir harici npm kütüphanesi kullanmaz**, sadece Node.js yerleşik modüllerini kullanır.
- **Sıfır telemetri, sıfır takip, sıfır gizli dosya, sıfır gömülü API anahtarı veya kişisel veri.**
- Varsayılan olarak yalnızca kendi bilgisayarınızda (`127.0.0.1` localhost) çalışır.

#### Kendi Yapay Zekana Denetlet & Kur (Tek Mesajla)
Kurmadan önce kodda virüs, veri sızıntısı veya arka kapı olup olmadığını denetlemek için şu mesajı **ChatGPT, Gemini, Claude, Cursor veya Antigravity** asistanına yapıştırabilirsin:

> *"Bu GitHub reposunu incele (`https://github.com/selfawarevibecoder/LinePulse`): içinde zararlı kod, virüs, arka kapı veya veri sızdıran bir şey var mı kontrol et. Temizse bilgisayarıma indirip lokalde çalıştırmam (veya kendi macOS `.dmg` / Windows `.zip` / Android `.apk` paketimi derlemem) için adım adım yardım et."*

### Hızlı Başlangıç (Kurulumsuz — Node.js 20+)
```bash
git clone https://github.com/selfawarevibecoder/LinePulse.git
cd LinePulse
node server/index.js
```
Ardından tarayıcıda **`http://localhost:3456`** adresini açın.

- **Detaylı Adım Adım Görsel Kurulum (OANDA API alma dahil):** [docs/Velox_Charts_Kurulum_Rehberi.pdf](docs/Velox_Charts_Kurulum_Rehberi.pdf)
- **İsteğe Bağlı 7/24 Bulut Senkronizasyonu & Kilit Ekranı Push Kurulumu:** [docs/CLOUD_SYNC_AND_PUSH_GUIDE.md](docs/CLOUD_SYNC_AND_PUSH_GUIDE.md)

### Kaynaktan Kendin Derle (Masaüstü & Mobil)
```bash
# Masaüstü (macOS / Windows)
cd desktop
npm install
npm run build:mac:public   # macOS .dmg
npm run build:win:zip      # Windows portable .zip

# Bağımsız Mobil Uygulama (Android APK — Java 21 + Android SDK)
cd ../mobile
bash build-public-apk.sh

# iPhone / iOS (macOS + Xcode gerekir)
cd mobile
npm install && npm install @capacitor/ios
npx cap add ios && npx cap sync ios && npx cap open ios
```

---

## 🇬🇧 English Documentation

**Velox Charts (`v1.4.1`)** is an open-source, multi-screen TradingView-style live charting and FXReplay-style Bar Replay / Backtesting platform built with pure Node.js (**zero external backend npm dependencies**), HTML5 Canvas, and Lightweight Charts.

### Key Features
- **Unlimited Multi-Monitor Support:** Spawn synchronized monitor windows (`+ New Screen`) with independent grid layouts, shared drawings, watchlists, and alerts.
- **Multi-Asset Feeds:** Free live Crypto (Binance, Coinbase, Bybit, Kraken), CME Futures (`NQ1!`, `ES1!`, `GC1!`, `CL1!`, `6E1!`), US Stocks & Borsa Istanbul (`BIST 100`, `BIST 30`, `XBANK`, Turkish equities), real-time FX Spot TRY pairs (`USD/TRY`, `EUR/TRY`, `GBP/TRY`), and optional zero-latency OANDA Practice/Live FX & Metals via your own free API key.
- **Economic Calendar & Market Holidays:** Macro releases with Actual/Forecast/Previous, collapsible past events, and automatic US/EU/UK Market Holidays & Early Close alerts.
- **FXReplay-Style Bar Replay:** Zero look-ahead replay, multi-pair sync, Prop Firm rules (FTMO, The5ers, custom), trade journal, equity curve, and zero-RAM binary `.bin` replay indexing.
- **Desktop, Web & Standalone Mobile (Android & iOS):** Run locally via `node server/index.js`, build desktop installers in `desktop/`, or build standalone mobile apps in `mobile/`. Optional self-hosted 24/7 Cloud Sync & Push setup is documented in [docs/CLOUD_SYNC_AND_PUSH_GUIDE.md](docs/CLOUD_SYNC_AND_PUSH_GUIDE.md).

### Security & Quick Start
- **100% readable open-source code**, zero external backend dependencies, zero telemetry, zero bundled keys.
- Requires **Node.js 20+**:
```bash
git clone https://github.com/selfawarevibecoder/LinePulse.git
cd LinePulse
node server/index.js
```
Open **`http://localhost:3456`** in your browser.
