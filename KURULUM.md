# LinePulse — Çoklu Ekran Canlı Grafik Takibi (OANDA & CME)

Kurulum (`npm install`) gerektirmez — tek tıkla çalışır!

## Gereksinim
- Bilgisayarınızda **Node.js 18 veya üzeri** yüklü olması yeterlidir: https://nodejs.org (LTS sürümü)

## Nasıl Çalıştırılır?
- **Mac:** `Baslat-Mac.command` dosyasına çift tıklayın (ilk açılışta macOS izin sorarsa sağ tık -> *Aç* deyin).
- **Windows:** `Baslat-Windows.bat` dosyasına çift tıklayın.
- **Linux:** `./Baslat-Linux.sh` veya terminalden `node server/index.js` çalıştırın.

Tarayıcı otomatik olarak **http://127.0.0.1:3456** adresinde açılır.

> **Neden tek HTML dosyası değil?** Tarayıcı güvenlik kuralları (CORS), düz `file://` HTML dosyalarının OANDA ve CME veri sunucularına bağlanmasını engeller. İçindeki hafif yerel sunucu (`server/`) hem CORS engelini aşar hem de birden fazla monitörde açtığınız ekranlara veriyi tek noktadan gecikmesiz dağıtır.

---

## Ücretsiz Veri Kaynakları
1. **CME Vadeli İşlemler (Anında Hazır — Anahtar Gerekmez):**
   - İlk açılışta hiçbir ayar yapmadan `NQ1!`, `ES1!`, `GC1!`, `6E1!`, `CL1!`, `YM1!`, `BTC1!`, `DXY` vb. CME verileri otomatik çalışır.
2. **OANDA Gerçek Zamanlı Canlı Akış (Ücretsiz Practice Hesabı):**
   - Ücretsiz OANDA Demo/Practice hesabı açın (https://www.oanda.com).
   - Hesap panelinde *Manage API Access* bölümünden kendi **API Token** ve **Account ID** bilginizi kopyalayın.
   - Uygulamada sağ üstteki **Ayarlar (⚙)** simgesine tıklayıp OANDA bilgilerinizi girin ve **Kaydet ve Uygula** deyin.
   - Bilgileriniz yalnızca kendi bilgisayarınızdaki `.env` dosyasına kaydedilir, hiçbir yere gönderilmez.

---

## Kısayollar
- **`1`, `2`, `3`, `4`, `6`, `9`:** Tek pencerede çoklu grafik düzenleri
- **`+ Yeni Ekran`:** 2. / 3. monitör için bağımsız işlemcili yeni pencere
- **`/`:** Sembol arama
- **`M`** (veya geçici **`Alt`**): Mıknatıs modu (mum fitil/gövde yakalama)
- **`Shift` basılı tutarak çizim:** Tam yatay (0°), dikey (90°) veya 45° düz çizgi
- **Çizgiye çift tık:** Çizgi üstü yazı (etiket) ekleme/düzenleme
- **`Cmd/Ctrl + S`:** Ekranı Kaydet / Yükle (düzen + çizimler + renkler + kategoriler)
- **`Cmd/Ctrl + Z` / `Delete`:** Son çizimi geri al / seçili çizimi sil
- **`F`:** Aktif grafiği tam ekran yap / geri al
