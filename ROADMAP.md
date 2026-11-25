# LinePulse — Gelecek Yol Haritası & Tercihler

Bu dosya, uygulamanın ilerideki canlı veri, mobil ve bulut senkronizasyon aşamaları için kaydedilen mimari kararları ve alternatifleri içerir.

## 1. Bulut Hesap & Çoklu Cihaz Senkronizasyonu (Web + Mobil)

### Birincil Tercih: Firebase (Spark — Ücretsiz Plan)
- **Kimlik Doğrulama:** Firebase Authentication (Google / E-posta ile giriş — ücretsiz).
- **Veritabanı:** Cloud Firestore (günlük 50.000 okuma, 20.000 yazma, 1 GB depolama ücretsiz).
- **Veri Modeli (Mevcut JSON Snapshot ile %100 Uyumlu):**
  - `users/{uid}/settings/prefs` -> Tema, 8'li renk paleti, saat dilimi, mıknatıs/çizgi ayarları
  - `users/{uid}/watchlists/default` -> İzleme listesi + özel kategoriler
  - `users/{uid}/drawings/{source_symbol}` -> Sembol bazlı çizimler, bölgeler ve çizgi üstü yazılar
  - `users/{uid}/layouts/{layoutId}` -> Kayıtlı ekran düzenleri (Save/Load)
- **Avantaj:** Firestore `onSnapshot` ile bilgisayar, ikinci monitör ve mobil cihazda çizilen her çizgi ve liste değişikliği anlık eşitlenir. Mevcut `/api/layouts` ve `localStorage` katmanı tek bir storage adaptörü ile Firebase'e bağlanabilir.

### Alternatif: Supabase (Free Tier)
- Postgres + Auth + Realtime dahil (500 MB veritabanı, 50.000 aylık aktif kullanıcı ücretsiz).
- SQL tabanlı raporlama veya ticaret günlüğü (trade journal) gerekirse alternatif olarak değerlendirilebilir.

---

## 2. Mobil Uygulama Stratejisi

1. **Aşama 1 — PWA (Progressive Web App, Sıfır Mağaza Maliyeti):**
   - Mevcut web uygulamasına `manifest.json` + Service Worker ekleyerek iOS/Android'de ana ekrana tam ekran uygulama gibi kurulabilir.
2. **Aşama 2 — Capacitor (Mevcut Kodla Native iOS / Android):**
   - Aynı HTML/JS/Lightweight Charts arayüzünü doğrudan App Store / Google Play paketine sarar; ek bir frontend yazımı gerektirmez.
3. **Aşama 3 — Native (React Native / Flutter):**
   - İleride tam native mobil performans ve push bildirim/alarm gerekirse aynı Firebase + veri sunucusu üzerine inşa edilebilir.

---

## 3. Canlı CME Vadeli Veri Kaynakları (Maliyet Karşılaştırması)

### Birincil Tercih: Interactive Brokers (IBKR) — Non-Professional
- **Maliyet:** Bireysel (Non-Pro) hesapta tek CME borsası Level 1 (Top-of-Book) ~\$1.25/ay; 4 borsa CME Bundle (CME + CBOT + NYMEX + COMEX) ~\$4.50/ay civarı.
- **Entegrasyon:** Yerel TWS / IB Gateway veya Client Portal WebSocket API üzerinden `server/ibkr.js` sağlayıcısı eklenerek mevcut SSE (`SharedWorker`) mimarisine doğrudan bağlanabilir.

### Diğer Kayıtlı Alternatifler
- **Tradovate / AMP Futures / NinjaTrader (CQG / Rithmic):** Non-Pro CME Top-of-Book tek borsa ~\$4/ay, 4 borsa paketi ~\$12–\$15/ay; doğrudan WebSocket akışı.
- **Databento:** Sabit aylık ücret yerine kullandığın kadar öde + \$125 ücretsiz başlangıç kredisi (az sembolde ekonomik).
- **Mevcut Ücretsiz Katman (Aktif):**
  - **OANDA v20 Practice/Live:** Gerçek zamanlı ücretsiz tick akışı (`XAU_USD`, `EUR_USD`, `GBP_USD`, `USD_CAD`, `NAS100_USD`, `SPX500_USD`, `EUR_GBP` vb.).
  - **CME Ücretsiz (Gecikmeli):** API anahtarı gerektirmeyen CNBC futures akışı (`NQ1!`, `ES1!`, `GC1!`, `6E1!`, `CL1!`, `YM1!`, `BTC1!`, `DXY` vb.).
  - **TwelveData (Opsiyonel):** Ayarlar üzerinden anahtar girilirse desteklenir (ancak vadeli paketleri IBKR/Tradovate'e göre pahalı).

---

## 4. Fiyat Alarmları (Desktop + Mobil Eşzamanlı Ses & Bildirim)

### Mevcut Mimari (Aktif — Yerel Masaüstü)
- Alarmlar sunucu tarafında (`server/alerts.js` -> `data/alerts.json`) değerlendirilir; hedef sembol açık ekranda olmasa bile sunucu OANDA/CME aboneliğini korur.
- Tetiklendiğinde `SharedWorker` üzerinden tek seferlik **Web Audio alarm sesi**, **uygulama içi toast** ve **işletim sistemi masaüstü bildirimi** (`Notification` API) tetiklenir.
- Veri şemasında `sound`, `desktopNotify` ve `mobilePush` alanları şimdiden hazırdır.

### İleride Uygulama (Desktop App + Mobil App) Aşaması
1. **Tek Merkezi Bulut Tetikleyici:**
   - Alarmlar Firestore `users/{uid}/alerts/{alertId}` koleksiyonunda tutulur; hafif bir sunucu/Cloud Run servisi canlı OANDA/IBKR fiyat akışını izleyip geçiş (crossing) anında alarmı tetikler.
2. **Eşzamanlı Çoklu Cihaz Bildirimi (Firebase Cloud Messaging — Ücretsiz):**
   - **Mobil App (iOS APNs / Android FCM):** Uygulama kapalı veya kilit ekranında olsa bile FCM üzerinden yüksek öncelikli push + özel alarm sesi çalar.
   - **Desktop App (Electron / Tauri / PWA):** Hem Firestore `onSnapshot` üzerinden anlık özel alarm sesi hem de native macOS/Windows bildirim merkezi uyarısı verir.
   - Tek tıkla susturma/okundu işaretleme tüm cihazlarda anında eşitlenir.

