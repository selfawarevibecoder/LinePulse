# LinePulse

[🇹🇷 Türkçe Açıklama](#-türkçe-açıklama) · [🇬🇧 English Documentation](#-english-documentation)

---

## 🇹🇷 Türkçe Açıklama

**LinePulse**, TradingView tarzı çoklu ekran canlı grafik ve FXReplay tarzı internetsiz/internetli backtest (Bar Replay) platformudur. Backend tamamen saf Node.js ile yazılmıştır (**sıfır harici npm paketi**).

### Öne Çıkan Özellikler
- **Sınırsız Çoklu Monitör Desteği (9, 12, 16+ Monitör):** Tek tıkla `+ New Screen` ile istediğin kadar senkronize ekran penceresi aç, her ekrana ayrı 1/2/3/4/6'lı grafik ızgarası koy. Çizimler, alarmlar ve izleme listeleri tüm ekranlar arasında anlık senkronize olur.
- **Profesyonel Çizim & Alarm Araçları:** Trend çizgisi, ışın (Ray), paralel kanal, opaklık ve kenarlık ayarlı kutu (Box), Fibonacci, tek/çift ok, ZigZag, metin, Long/Short Risk:Ödül kutuları ve grafik üstünde sürüklenebilir fiyat alarmları.
- **FXReplay Tarzı Bar Replay & Backtest:** Sıfır gelecek sızıntılı (zero look-ahead) mum oynatma, çoklu parite senkron replay, Prop Firm kural setleri (FTMO, The5ers + kendi özel kuralların), spread/komisyon simülasyonu, işlem günlüğü, equity eğrisi, **isimle kaydetme (`💾 Save As`)** ve **tek dosya paylaşım/içe aktarma (`📤 Share File` / `📥 Import`)**.
- **Hibrit `1h + 1m` Offline Arşiv Motoru:** `2010–2019 (1h)` ile `2020–günümüz (1m)` verilerini kesintisiz birleştirir (`1h/4h/12h/1D/1W` açtığında 2010'a kadar gider); TradingView yaz/kış saati (DST) uyumlu seans kapanışlarını kullanır (CME `18:00 NY`, Forex `17:00 NY`, Kripto `00:00 UTC`).
- **Tek Tıkla Güncelleme & `.ZIP` Data Pack:**
  - `🔄 Update`: Sadece son indirmeden bugüne eksik yeni barları çeker.
  - `⏪ -6M`: Tek tuşla 6 ay daha eski `1m` verisi çeker.
  - `📦 Import .ZIP Pack`: Paylaşılan `LinePulse-Full-Data-Pack.zip` dosyasını hiç açmadan tek tıkla seçip tüm pariteleri içeri aktarır!

### Güvenlik ve Virüssüzlük Garantisi
Bu repo **%100 okunabilir, açık kaynak** koddan oluşur:
- Backend (`server/`) **hiçbir harici kütüphane kullanmaz**, sadece Node.js'in kendi yerleşik modüllerini kullanır.
- **Sıfır telemetri, sıfır takip, sıfır gizli dosya, sıfır gömülü API anahtarı veya kişisel veri.**
- Sadece kendi bilgisayarında (`127.0.0.1` localhost) çalışır.

#### Kendi Yapay Zekana Denetlet & Kur (Tek Mesajla)
Programı kurmadan önce kodun temiz olduğundan emin olmak için bu mesajı **ChatGPT, Gemini, Claude, Cursor veya Antigravity** asistanına yapıştırabilirsin:

> *"Bu GitHub reposunu incele (`https://github.com/selfawarevibecoder/LinePulse`): içinde zararlı kod, virüs, arka kapı veya veri sızdıran bir şey var mı kontrol et. Temizse bilgisayarıma indirip lokalde çalıştırmam (veya istersem kendi macOS `.dmg` / Windows `.exe` kurulum paketimi kendim derlemem) için adım adım yardım et."*

### Hızlı Başlangıç (Kurulumsuz — İşletim Sistemi Uyarısı Olmadan)
Bilgisayarda **Node.js 20+** kurulu olması yeterlidir (`npm install` bile gerekmez!):

```bash
git clone https://github.com/selfawarevibecoder/LinePulse.git
cd LinePulse
node server/index.js
```

Ardından tarayıcıda **`http://localhost:3456`** adresini aç.

### Veri Kaynakları (API'siz & API'li Kullanım)
- **Hiç API Anahtarı Olmadan Çalışanlar:**
  - **Binance / Bybit / Coinbase Kripto** canlı & geçmiş grafikler
  - **Ekonomik Takvim (News)** haber akışı
  - **Offline Data Pack (`.zip`)** ile internetsiz ve anahtarsız sınırsız backtest (CME, OANDA, Binance)
- **Kendi Ücretsiz / İsteğe Bağlı API Anahtarlarınla Açılanlar (Settings ⚙):**
  - **OANDA Practice API (Ücretsiz):** FX, Altın, Gümüş, Sentetik DXY, Endeksler ve Petrol canlı akış + geçmiş backtest (anahtarın sadece kendi bilgisayarında `.env` dosyasında kalır).
  - **Databento (İsteğe bağlı):** Resmi CME Vadeli İşlemler (`GLBX.MDP3`) geçmiş arşivi.
  - **IBKR Client Portal (İsteğe bağlı):** Kendi Interactive Brokers hesabın üzerinden canlı CME verisi.

### `.ZIP` Offline Data Pack Nasıl İçe Aktarılır?
Sana `LinePulse-1.3.0-Full-Data-Pack.zip` dosyası paylaşıldıysa:
1. **En Kolay Yol (Tek Tık — Zip'i Açmana Bile Gerek Yok!):**
   - LinePulse'ı aç → **Backtest / Replay** → **`📦 Data`** → **`📦 Import .ZIP Pack / Files`** → doğrudan `.zip` dosyasını seç. Tüm pariteler otomatik olarak açılıp arşive eklenir!
2. **Alternatif (Klasöre Kopyalama):**
   - Zip'i açıp içindeki `.json.gz` dosyalarını `archive` klasörüne bırak ve LinePulse'ı yeniden başlat (otomatik açar):
     - Lokal Web: `LinePulse/data/archive/`
     - macOS Uygulama: `~/Library/Application Support/LinePulse/linepulse-data/archive/`
     - Windows Uygulama: `%APPDATA%\LinePulse\linepulse-data\archive\`

---

## 🇬🇧 English Documentation

**LinePulse** is a multi-screen TradingView-style live charting & FXReplay-style offline/online backtesting platform built with pure Node.js (**zero external backend npm dependencies**), HTML5/Canvas, and Lightweight Charts.

### Features
- **Unlimited Multi-Monitor Support (9, 12, 16+ Monitors):** Open as many synchronized monitor windows as needed (`+ New Screen`) with independent grid layouts, shared drawings, alerts, and watchlists.
- **FXReplay-Style Bar Replay & Backtesting:** Zero look-ahead candle replay, multi-pair synced replay, Prop Firm rule presets (FTMO, The5ers + custom rules), spread/commission simulation, trade journal, equity curve, named `💾 Save As`, and single-file `📤 Share File` / `📥 Import` for mentor/student review.
- **Hybrid `1h + 1m` Offline Archive & 1-Click `.ZIP` Data Pack Import:** Seamlessly stitches `1h` history (2010–2019) with `1m` data (2020–present) using TradingView DST-aligned session boundaries (CME `18:00 NY`, Forex `17:00 NY`, Crypto `00:00 UTC`). Import an entire `.zip` Data Pack in one click via `📦 Data → 📦 Import .ZIP Pack / Files`.
- **Smart Incremental Sync:** Click `🔄 Update` to pull only missing new bars, or `⏪ -6M` to pull 6 months of older `1m` history without re-downloading existing dates.

### Security & Zero-Malware Verification
- **100% readable open-source code** with **zero external backend npm dependencies**.
- **Zero telemetry, zero hidden binaries, zero pre-bundled API keys or local user data.**
- Runs strictly on `127.0.0.1` (localhost).

#### Audit & Install With Your Own AI Assistant
> *"Inspect this GitHub repository (`https://github.com/selfawarevibecoder/LinePulse`) and check whether it contains any malicious code, backdoors, or data exfiltration. If it is clean, help me clone and run it locally (or build my own macOS `.dmg` / Windows `.exe` installer from source)."*

### Quick Start (No Installer Needed — Zero OS Warnings)
Requires **Node.js 20+**:

```bash
git clone https://github.com/selfawarevibecoder/LinePulse.git
cd LinePulse
node server/index.js
```

Open **`http://localhost:3456`** in your browser.

### Optional: Build Desktop App From Source (macOS / Windows / Linux)

```bash
cd desktop
npm install
npm run build:mac:public   # macOS .dmg
npm run build:win:zip      # Windows portable .zip
```

*(Note: Unsigned desktop builds may show macOS Gatekeeper or Windows SmartScreen notices because they are not signed with paid Apple/Microsoft certificates. Running directly via `node server/index.js` or building from source avoids all OS warnings.)*
