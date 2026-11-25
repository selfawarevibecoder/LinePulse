# LinePulse Desktop App (macOS / Windows / Linux)

Bağımsız Electron masaüstü uygulaması — Node.js kurulumu gerektirmez, kendi yerel veri sunucusunu uygulama içinde çalıştırır ve çoklu monitör için bağımsız pencereler açar (`Cmd/Ctrl + N` veya `+ New Screen`).

## 1. Kendi Bilgisayarınızda Deneme (Kendi OANDA API Anahtarınızla)
```bash
cd desktop
npm run dev
```
Bu mod, kök klasördeki kişisel `.env` dosyanızı kullanır; OANDA canlı akışınız ve kayıtlarınız doğrudan açılır.

## 2. Arkadaşlarınızla Paylaşacağınız Temiz Sürümü Test Etme (API Anahtarsız)
```bash
cd desktop
npm run dev:clean
```
Bu modda hiçbir kişisel API anahtarı yüklenmez; ilk açılışta **4 ücretsiz CME grafiği** ile açılır ve kullanıcı kendi OANDA anahtarını `Settings` içinden girip OS kullanıcı klasörüne kaydeder.

## 3. Platform Bazlı Masaüstü Paketi Üretme (`dist-desktop/`)
Paketleme sırasında `sync-assets.mjs` her zaman **sıfır API anahtarlı** temiz `app-bundle/` kopyası üretir:

- **macOS (`.dmg` ve `.zip`):**
  ```bash
  cd desktop && npm run build:mac
  ```
- **Windows (`.exe` Portable ve Kurulum):**
  ```bash
  cd desktop && npm run build:win
  ```
- **Linux (`.AppImage`):**
  ```bash
  cd desktop && npm run build:linux
  ```

> **Not:** Windows `.exe` ve Linux `.AppImage` derlemelerini en temiz şekilde ilgili işletim sisteminde veya GitHub Actions üzerinden alabilirsiniz (`macOS` üzerinden `build:mac` doğrudan çalışır).
