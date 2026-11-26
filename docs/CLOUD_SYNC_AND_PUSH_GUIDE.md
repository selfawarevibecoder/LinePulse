# Velox Charts — Kişisel 7/24 Bulut Senkronizasyonu & Mobil Push Kurulum Rehberi
*(Optional Self-Hosted 24/7 Cloud Sync & Lock-Screen Mobile Push Guide — AI-Agent Ready)*

Bu rehber **tamamen isteğe bağlıdır**. Velox Charts normalde hiçbir sunucu kurmadan doğrudan bilgisayarınızda veya telefonunuzda bağımsız olarak çalışır.

Ancak aşağıdaki 3 özelliği **%100 ücretsiz** ve **tamamen kendi özel ağınızda** (dış dünyaya port açmadan) kurmak isterseniz bu dosyayı kendi yapay zeka asistanınıza (**Antigravity, Claude Code, Cursor, Gemini CLI veya ChatGPT**) vererek ~15 dakikada kurabilirsiniz:
1. **Bilgisayar ↔ Telefon Canlı Senkronizasyon:** Mac/Windows'ta çizdiğiniz çizimler, watchlist ve alarmlar anında telefonda görünür (ve tam tersi).
2. **7/24 Kilit Ekranı Fiyat Alarmları (Firebase FCM Push):** Bilgisayarınız, telefonunuzdaki uygulama ve VPN tamamen kapalıyken bile kurduğunuz fiyat alarmları kilit ekranınıza sesli bildirim olarak düşer.
3. **iPhone (iOS) ve Android Desteği:** Android için native `.apk` (Firebase FCM Push destekli), iPhone için Safari PWA ("Ana Ekrana Ekle") veya macOS Xcode ile Capacitor iOS uygulaması.

---

## 🤖 Yapay Zekanıza Doğrudan Verebileceğiniz Hazır Komut (Prompt)

Kendi yapay zeka asistanınıza bu dosyayı gösterip şunu yazmanız yeterlidir:

> *"Bu `docs/CLOUD_SYNC_AND_PUSH_GUIDE.md` dosyasındaki mimariyi takip ederek benim kişisel Velox Charts 7/24 bulut senkronizasyonumu kurmama adım adım yardım et: (1) Oracle Cloud Always Free Ubuntu 24.04 VM'e `velox-charts` systemd servisini kur, (2) Tailscale özel mesh ağıyla bilgisayarımı ve telefonumu birbirine bağla (hiçbir dış port açma), (3) kendi Firebase projemden alacağım `firebase-service-account.json` ve `google-services.json` dosyalarıyla Android/iOS kilit ekranı push bildirimlerini aktif et."*

---

## Mimari Özeti (Sıfır Aylık Maliyet · Sıfır Açık Port)

```
┌──────────────────────┐      Özel Şifreli Tailscale Ağı       ┌──────────────────────────────────┐
│  Mac / Windows App   │◄─────────────────────────────────────►│  Oracle Cloud Always Free VM     │
│  (remote-server.json)│                                       │  Ubuntu 24.04 + Node.js 22       │
└──────────────────────┘                                       │  velox-charts.service (7/24)     │
                                                               │  • Live OANDA / CME / BIST / BTC │
┌──────────────────────┐      Özel Şifreli Tailscale Ağı       │  • SSE Canlı Çizim & Watchlist   │
│  Android / iOS App   │◄─────────────────────────────────────►│  • 7/24 Fiyat Alarm Motoru       │
│  (Capacitor / PWA)   │                                       └───────────────┬──────────────────┘
└──────────▲───────────┘                                                       │
           │  Uygulama & Tailscale KAPALIYKEN bile anlık kilit ekranı alarmı   │ HTTPS (FCM HTTP v1)
           └────────────────────── Google Firebase Cloud Messaging ◄───────────┘
```

---

## Adım 1 — Ücretsiz 7/24 Sunucu (Oracle Cloud Always Free)

1. [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/) hesabı açın (Always Free **VM.Standard.E2.1.Micro** veya **Ampere A1** — kredi kartı sadece doğrulama içindir, Always Free şekilleri ömür boyu ücretsizdir).
2. **Compute → Instances → Create Instance**:
   - **Image:** Ubuntu 24.04 Minimal/Standard
   - **Shape:** Always Free Eligible (`VM.Standard.E2.1.Micro` veya `VM.Standard.A1.Flex`)
   - **SSH Keys:** "Generate a key pair for me" → `.key` dosyasını kaydedin (`chmod 600`).
   - **Public IPv4:** Assign a public IPv4 address (sadece ilk SSH bağlantısı için).
3. **Güvenlik:** Oracle Security List'te `3456` portunu **KESİNLİKLE AÇMAYIN**. Uygulama sadece şifreli Tailscale ağınızdan erişilebilir olacak.

---

## Adım 2 — Sunucuya Node.js, Tailscale ve Velox Charts Kurulumu

SSH ile sunucunuza bağlanın ve şunları çalıştırın:

```bash
# 1. 2 GB Swap ekle (1 GB RAM'li Micro VM için önerilir)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 2. Node.js 22 ve Tailscale kur
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale ip -4   # Örnek: 100.x.y.z — bu sizin özel sunucu IP'niz!

# 3. Velox Charts'ı klonla ve .env ayarla
git clone https://github.com/selfawarevibecoder/LinePulse.git ~/velox-charts
cd ~/velox-charts
cp .env.example .env
nano .env   # Kendi ücretsiz OANDA_API_KEY ve OANDA_ACCOUNT_ID değerlerinizi girin (HOST=0.0.0.0)
```

Ardından 7/24 otomatik çalışan `systemd` servisi oluşturun (`/etc/systemd/system/velox-charts.service`):

```ini
[Unit]
Description=Velox Charts 24/7 Live Market, Alert & Push Server
After=network-online.target tailscaled.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/velox-charts
Environment=HOST=0.0.0.0
Environment=PORT=3456
ExecStart=/usr/bin/node /home/ubuntu/velox-charts/server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now velox-charts
```

---

## Adım 3 — Bilgisayar Uygulamasını (Mac / Windows) Sunucunuza Bağlama

Bilgisayarınızda da **Tailscale** kurulu ve giriş yapılmış olsun. Aşağıdaki konuma `remote-server.json` dosyasını oluşturun:

- **macOS:** `~/Library/Application Support/Velox Charts/linepulse-data/remote-server.json`
- **Windows:** `%APPDATA%\Velox Charts\linepulse-data\remote-server.json`

İçeriği (`100.x.y.z` yerine kendi Tailscale IP'nizi yazın):

```json
{
  "enabled": true,
  "url": "http://100.x.y.z:3456"
}
```

Artık masaüstü uygulaması açılırken 2.5 sn içinde kendi sunucunuza bağlanır; sunucu veya Tailscale kapalıysa otomatik olarak yerel yerleşik sunucuya düşer.

---

## Adım 4 — 7/24 Kilit Ekranı Mobil Push (Firebase Cloud Messaging — Ücretsiz)

1. [Firebase Console](https://console.firebase.google.com/) → **Create a Project** (Google Analytics ve Gemini'yi kapatabilirsiniz — gerek yok).
2. **Sunucu Anahtarı (Admin SDK):**
   - **Project Settings → Service Accounts → Generate new private key** → inen `.json` dosyasını sunucunuza kopyalayın:
     `~/velox-charts/data/firebase-service-account.json` (`chmod 600`)
   - Servisi yeniden başlatın: `sudo systemctl restart velox-charts`
   - Kontrol edin: `curl http://100.x.y.z:3456/api/push/status` → `"configured": true` dönmelidir.
3. **Android Uygulaması (Native FCM Push):**
   - Firebase Console'da **Add App → Android** ekleyin (Package name: `com.veloxcharts.mobile`), `google-services.json` dosyasını `mobile/android/app/google-services.json` içine koyun.
   - `mobile/capacitor.config.json` içindeki `server.allowNavigation` alanına kendi Tailscale IP'nizi ekleyin ve `MainActivity.java` içinde `FirebaseMessaging.getInstance().getToken()` ile token'ı `POST http://100.x.y.z:3456/api/push/register` adresine gönderin.
   - Tek seferlik olarak telefonda Tailscale açıkken uygulamayı 1 kez açtığınızda cihazınız sunucuya kaydedilir. Sonrasında **hem uygulamayı hem Tailscale'i kapatsanız bile** tüm fiyat alarmları Google Firebase üzerinden kilit ekranınıza anında düşer!

---

## Adım 5 — iPhone (iOS) Seçenekleri

- **En Kolay Yol (Xcode / Ücret Gerekmez):** iPhone'da Tailscale'i açın → Safari'de `http://100.x.y.z:3456` adresini açın → **Paylaş → Ana Ekrana Ekle (Add to Home Screen)**. Tam ekran mobil uygulama gibi çalışır.
- **Native iOS `.ipa` Derlemek İsteyenler (macOS + Xcode):**
  ```bash
  cd mobile
  npm install
  npm install @capacitor/ios
  npx cap add ios
  npx cap sync ios
  npx cap open ios
  ```
  Xcode'da kendi Apple ID'nizle (ücretsiz kişisel imzalama ile 7 günlük, veya yıllık \$99 Apple Developer hesabıyla TestFlight/App Store) doğrudan iPhone'unuza yükleyebilirsiniz.
