/**
 * LinePulse Bilingual Internationalization Engine (English / Türkçe)
 * - Instant live switching with zero reload, persisted in localStorage & synced across monitor windows.
 */

const STORAGE_KEY = 'linepulse_lang_v1';

const DICT = {
  en: {
    // Dynamic confirmations & toasts
    'confirm.databento':
      '⚠️ PAID DATA WARNING (Databento)\n\nDownloading Databento CME data ({display} — {action}) will use your Databento credit / billing balance!\n(Only missing dates will be requested.)\n\nAre you sure you want to proceed?',
    'confirm.free':
      'ℹ️ Free Download Notice ({source})\n\n{display} ({action}) is free, but downloading large date ranges may take 30 seconds to several minutes.\n\nStart downloading now?',
    'action.extend6m': 'Extend 6 months older (1m)',
    'action.updateMissing': 'Update missing latest bars',
    'tf.replayMinTitle': '1m Minimum in Replay Mode',
    'tf.replayMinBody': 'Offline backtest archives are stored at 1m resolution — "{tf}" is not available in Replay Mode.',
    'tf.notAvailTitle': '{tf} Data Not Available',
    'tf.notAvailBody': '{source} feed does not provide sub-minute ({tf}) candles — minimum timeframe is 1m.',
    'tf.oandaMinTitle': 'OANDA Minimum is 5s',
    'tf.oandaMinBody': 'OANDA does not provide {tf} candles — the lowest live timeframe on OANDA is 5s.',
    'tf.cryptoMinTitle': '1m Minimum on {source}',
    'tf.cryptoMinBody': '{source} starts at 1m — use Binance for live 1s crypto candles.',
    'tf.switchedNotice': 'Switched {display} to {fallback} ({reason})',

    // Backtest dropdown groups
    'grp.offlineCme': '📦 Offline Ready — CME Futures (Databento)',
    'grp.offlineOanda': '📦 Offline Ready — OANDA (FX / Gold / DXY / Indices / Oil)',
    'grp.offlineBinance': '📦 Offline Ready — Binance Crypto',
    'grp.offlineCustom': '📦 Offline Ready — Custom / Imported',
    'grp.online': '🌐 Online Fetch (Requires Internet / API Key)',
    'arc.empty': 'No offline archives yet. Download from OANDA, Binance, Databento CME, or import a .ZIP Data Pack above!',
    'arc.olderBtn': '⏪ -6M',
    'arc.updateBtn': '🔄 Update',
    'arc.backtestBtn': '▶ Backtest',
    'arc.deleteBtn': 'Delete',
    'arc.pulling': 'Pulling...',
    'arc.syncing': 'Syncing...',
    'arc.downloadBtn': '⬇ Download Range',
    'arc.downloading': 'Downloading...',
    'arc.resumeBtn': 'Resume',
    'lang.switchedTitle': 'Language: English',
    'lang.switchedBody': 'Interface switched to English.',

    // Drawing edit bar & FXReplay position tool execution
    'dbar.labelPlaceholder': 'Add label...',
    'dbar.notePlaceholder': 'Edit note...',
    'dbar.close': 'Close (Esc)',
    'dbar.ctxEdit': '✎ Style & Label',
    'dbar.ctxDelete': '🗑 Delete Drawing',
    'pos.marketBtn': 'Market',
    'pos.deleteTool': 'Delete tool box',
    'pos.capital': 'Capital',
    'pos.risk': 'Risk',
    'pos.lotSize': 'Lot Size',
    'pos.target': 'Target',
    'pos.wrongSymTitle': 'Wrong Replay Pair',
    'pos.wrongSymBody': 'Replay orders execute on the active session pair ({display}). Draw this tool on a {display} chart to place an order.',
    'pos.invalidLevelsTitle': 'Invalid SL / TP Levels',
    'pos.invalidBuyLevels': 'For a LONG order, SL must be below Entry and TP must be above Entry.',
    'pos.invalidSellLevels': 'For a SHORT order, SL must be above Entry and TP must be below Entry.',
    'pos.placedLimitTitle': '⚡ {side} {type} Placed',
    'pos.placedMarketTitle': '⚡ {side} Market Filled',
    'pos.placedBody': '{lots} lots @ {entry} · SL {sl} · TP {tp}',

    // Mentor Review bar
    'rev.badge': '👨‍🏫 MENTOR REVIEW',
    'rev.play': '▶ Play',
    'rev.pause': '⏸ Pause',
    'rev.replay': '↻ Replay',
    'rev.noteBtn': '💬 Note',
    'rev.showAll': '👁 Show All',
    'rev.complete': 'Review complete — click 👁 Show All or ↻ Replay',
  },
  tr: {
    // Dynamic confirmations & toasts
    'confirm.databento':
      '⚠️ ÜCRETLİ VERİ UYARISI (Databento)\n\nDatabento CME verisi indirmek ({display} — {action}) Databento kredinizden / bakiyenizden düşecektir!\n(Yalnızca eksik tarihler indirilecektir.)\n\nDevam etmek istediğinize emin misiniz?',
    'confirm.free':
      'ℹ️ Ücretsiz İndirme Bilgisi ({source})\n\n{display} ({action}) ücretsizdir ancak geniş tarih aralıklarını indirmek 30 saniye ile birkaç dakika arası sürebilir.\n\nİndirme başlatılsın mı?',
    'action.extend6m': '6 ay daha eski 1m geçmişi çek',
    'action.updateMissing': 'Sadece eksik yeni barları güncelle',
    'tf.replayMinTitle': 'Replay Modunda En Düşük 1m',
    'tf.replayMinBody': 'Offline backtest arşivleri 1 dakikalık çözünürlüktedir — "{tf}" Replay modunda kullanılamaz.',
    'tf.notAvailTitle': '{tf} Verisi Mevcut Değil',
    'tf.notAvailBody': '{source} akışı saniyelik ({tf}) mum verisi sağlamıyor — en düşük zaman dilimi 1m.',
    'tf.oandaMinTitle': 'OANDA En Düşük 5s',
    'tf.oandaMinBody': 'OANDA {tf} mumu sağlamaz — OANDA canlı akışında en düşük zaman dilimi 5s\'tir.',
    'tf.cryptoMinTitle': '{source} En Düşük 1m',
    'tf.cryptoMinBody': '{source} 1m ile başlar — canlı 1s kripto mumları için Binance kullanın.',
    'tf.switchedNotice': '{display} otomatik olarak {fallback} yapıldı ({reason})',

    // Backtest dropdown groups
    'grp.offlineCme': '📦 İnternetsiz Hazır — CME Vadeli (Databento)',
    'grp.offlineOanda': '📦 İnternetsiz Hazır — OANDA (FX / Altın / DXY / Endeks / Petrol)',
    'grp.offlineBinance': '📦 İnternetsiz Hazır — Binance Kripto',
    'grp.offlineCustom': '📦 İnternetsiz Hazır — Özel / İçe Aktarılan',
    'grp.online': '🌐 İnternetten Çek (İnternet / API Anahtarı Gerekli)',
    'arc.empty': 'Henüz offline arşiv yok. Yukarıdan OANDA, Binance, Databento indirebilir veya .ZIP Veri Paketi içe aktarabilirsiniz!',
    'arc.olderBtn': '⏪ -6 Ay',
    'arc.updateBtn': '🔄 Güncelle',
    'arc.backtestBtn': '▶ Test Et',
    'arc.deleteBtn': 'Sil',
    'arc.pulling': 'Çekiliyor...',
    'arc.syncing': 'Güncelleniyor...',
    'arc.downloadBtn': '⬇ Aralığı İndir',
    'arc.downloading': 'İndiriliyor...',
    'arc.resumeBtn': 'Devam Et',
    'lang.switchedTitle': 'Dil: Türkçe',
    'lang.switchedBody': 'Arayüz Türkçe olarak güncellendi.',

    // Drawing edit bar & FXReplay position tool execution
    'dbar.labelPlaceholder': 'Etiket yaz...',
    'dbar.notePlaceholder': 'Notu düzenle...',
    'dbar.close': 'Kapat (Esc)',
    'dbar.ctxEdit': '✎ Stil & Yazı Düzenle',
    'dbar.ctxDelete': '🗑 Çizimi Sil',
    'pos.marketBtn': 'Piyasa',
    'pos.deleteTool': 'Aracı sil',
    'pos.capital': 'Bakiye',
    'pos.risk': 'Risk',
    'pos.lotSize': 'Lot',
    'pos.target': 'Hedef',
    'pos.wrongSymTitle': 'Farklı Parite',
    'pos.wrongSymBody': 'Backtest emirleri aktif oturum paritesinde ({display}) açılır. Emir vermek için aracı {display} grafiğine çizin.',
    'pos.invalidLevelsTitle': 'Geçersiz SL / TP Seviyeleri',
    'pos.invalidBuyLevels': 'LONG işlemde SL girişin altında, TP girişin üstünde olmalıdır.',
    'pos.invalidSellLevels': 'SHORT işlemde SL girişin üstünde, TP girişin altında olmalıdır.',
    'pos.placedLimitTitle': '⚡ {side} {type} Emri Verildi',
    'pos.placedMarketTitle': '⚡ {side} Piyasa Emri Açıldı',
    'pos.placedBody': '{lots} lot @ {entry} · SL {sl} · TP {tp}',

    // Mentor Review bar
    'rev.badge': '👨‍🏫 MENTOR İZLEME',
    'rev.play': '▶ Oynat',
    'rev.pause': '⏸ Durdur',
    'rev.replay': '↻ Baştan',
    'rev.noteBtn': '💬 Yorum',
    'rev.showAll': '👁 Tümünü Göster',
    'rev.complete': 'İnceleme tamamlandı — 👁 Tümünü Göster veya ↻ Baştan',
  },
};

// Direct element ID -> [English, Turkish] static UI translations
const ID_TEXT_MAP = {
  'mode-live-btn': ['Live', 'Canlı'],
  'mode-replay-btn': ['Replay', 'Backtest'],
  'open-next-screen-btn': ['+ New Screen', '+ Yeni Ekran'],
  'sidebar-tab-watchlist': ['Watchlist', 'İzleme'],
  'sidebar-tab-trade': ['Trade', 'İşlem'],
  'rp-save-as-btn': ['💾 Save As', '💾 Farklı Kaydet'],
  'rp-share-dock-btn': ['📤 Export File', '📤 Dosya Aktar'],
  'rp-analytics-btn': ['📊 Stats', '📊 İstatistik'],
  'rp-goto-date-btn': ['Date', 'Tarih'],
  'rp-side-buy': ['BUY / LONG', 'AL / LONG'],
  'rp-side-sell': ['SELL / SHORT', 'SAT / SHORT'],
  'rp-open-journal-mini': ['Journal', 'Günlük'],
  'rps-open-archive-btn': ['📦 Data Archive', '📦 Veri Arşivi'],
  'rps-toggle-custom-rule-btn': ['+ Custom Prop Rule', '+ Özel Kural'],
  'rp-session-dialog-title': ['Backtest Sessions & Prop Firm Rules', 'Backtest Oturumları & Prop Firm Kuralları'],
  'archive-dialog-title': ['Offline Backtest Data Archive & Delta Sync', 'Offline Backtest Veri Arşivi & Güncelleme'],
  'rp-analytics-title': ['Backtest Analytics, Journal & Mentor Review', 'Backtest İstatistikleri, Günlük & Mentor İncelemesi'],
  'settings-dialog-title': ['Settings, Global Theme & API Keys', 'Ayarlar, Genel Tema & API Anahtarları'],
  'layouts-dialog-title': ['Save / Load Workspace', 'Çalışma Alanı Kaydet / Yükle'],
  'style-dialog-title': ['Chart Style & Templates', 'Grafik Stili & Şablonlar'],
  'alerts-dialog-title': ['Price Alerts', 'Fiyat Alarmları'],
  'symbol-dialog-title': ['Select Symbol', 'Sembol Seç'],
  'tf-dialog-title': ['Manage Timeframes', 'Zaman Dilimlerini Yönet'],
  'timezone-dialog-title': ['Select Timezone', 'Saat Dilimi Seç'],
  'arc-download-btn': ['⬇ Download Range', '⬇ Aralığı İndir'],
  'rp-export-pack-btn': ['📤 Share File', '📤 Dosya Paylaş'],
  'rpa-tab-journal': ['Trade Journal', 'İşlem Günlüğü'],
  'style-reset-pane-btn': ['Reset', 'Sıfırla'],
  'style-apply-one-btn': ['Apply to This Chart', 'Bu Grafiğe Uygula'],
  'style-apply-all-btn': ['Apply to All Charts', 'Tüm Grafiklere Uygula'],
  'export-json-btn': ['Export JSON', 'JSON Dışa Aktar'],
  'tf-reset-btn': ['Reset Defaults', 'Varsayılana Sıfırla'],
  'prompt-cancel-btn': ['Cancel', 'İptal'],
};

// Exact textContent replacement map for buttons/labels/headings without unique IDs
const TEXT_PAIRS = [
  ['Alerts', 'Alarmlar'],
  ['Style', 'Stil'],
  ['Save', 'Kaydet'],
  ['Sync', 'Senkron'],
  ['Screens', 'Ekranlar'],
  ['Monitor Screens', 'Monitör Ekranları'],
  ['Closed screens keep their saved charts — click any screen to reopen it.', 'Kapalı ekranlar grafiklerini saklar — tekrar açmak için üzerine tıklayın.'],
  ['Global Colors (All Charts)', 'Genel Renkler (Tüm Grafikler)'],
  ['Chart Background', 'Grafik Arka Planı'],
  ['App Shell / Frame', 'Uygulama Çerçevesi'],
  ['Grid Lines', 'Izgara Çizgileri'],
  ['Grid Lines Color', 'Izgara Rengi'],
  ['Axis & Text', 'Eksen & Yazılar'],
  ['Line Color', 'Çizgi Rengi'],
  ['Line Series', 'Çizgi Serisi'],
  ['Bullish Candle / Bar', 'Yükseliş Mumu'],
  ['Bearish Candle / Bar', 'Düşüş Mumu'],
  ['Default Drawing', 'Varsayılan Çizim'],
  ['Base Theme', 'Ana Tema'],
  ['Timezone', 'Saat Dilimi'],
  ['Line Width', 'Çizgi Kalınlığı'],
  ['Line Thickness', 'Çizgi Kalınlığı'],
  ['Show background grid lines', 'Arka plan ızgara çizgilerini göster'],
  ['Show Grid Lines', 'Izgara Çizgilerini Göster'],
  ['Interface Language', 'Uygulama Dili'],
  ['Environment', 'Ortam'],
  ['Account ID', 'Hesap ID'],
  ['API Token (enter to set or replace)', 'API Anahtarı (eklemek veya değiştirmek için girin)'],
  ['Save & Apply', 'Kaydet ve Uygula'],
  ['New Backtest Session', 'Yeni Backtest Oturumu'],
  ['Session Name', 'Oturum Adı'],
  ['Start Date & Time (UTC)', 'Başlangıç Tarihi & Saati (UTC)'],
  ['Duration / End Date', 'Süre / Bitiş Tarihi'],
  ['Starting Balance ($)', 'Başlangıç Bakiyesi ($)'],
  ['Prop Firm Ruleset', 'Prop Firm Kural Seti'],
  ['Spread (Pips)', 'Spread (Pip)'],
  ['Commission ($/lot)', 'Komisyon ($/lot)'],
  ['Start Backtest Session', 'Backtest Oturumunu Başlat'],
  ['Saved Backtest Sessions', 'Kayıtlı Backtest Oturumları'],
  ['📥 Import File', '📥 Dosya İçe Aktar'],
  ['Save Custom Prop Firm Rule', 'Özel Prop Firm Kuralı Kaydet'],
  ['Rule Name', 'Kural Adı'],
  ['Daily Loss %', 'Günlük Kayıp %'],
  ['Max Loss %', 'Maks. Kayıp %'],
  ['Profit Target %', 'Kâr Hedefi %'],
  ['Min Days', 'Min. Gün'],
  ['Default Spread', 'Varsayılan Spread'],
  ['Comm ($/lot)', 'Komisyon ($/lot)'],
  ['Trailing Max Drawdown (follows equity high)', 'Takip Eden Drawdown (zirve bakiyeyi izler)'],
  ['Save Rule', 'Kuralı Kaydet'],
  ['Download 1m Historical Archive (Smart — Skips Already Downloaded Dates)', '1m Geçmiş Arşiv İndir (Akıllı — İndirilen Tarihleri Atlar)'],
  ['Data Source', 'Veri Kaynağı'],
  ['Instrument', 'Enstrüman'],
  ['From Date (UTC)', 'Başlangıç Tarihi (UTC)'],
  ['To Date (UTC)', 'Bitiş Tarihi (UTC)'],
  ['Import Full Data Pack (.zip) or CSV / JSON Files', 'Tam Veri Paketi (.zip) veya CSV / JSON İçe Aktar'],
  ['📦 Import .ZIP Pack / Files', '📦 .ZIP Paketi / Dosya İçe Aktar'],
  ['Local Offline Archives', 'Lokal Offline Arşivler'],
  ['Equity Curve', 'Bakiye Eğrisi'],
  ['Order Type', 'Emir Tipi'],
  ['Risk Sizing', 'Risk Hesabı'],
  ['Risk (%)', 'Risk (%)'],
  ['SL (Pips)', 'SL (Pip)'],
  ['TP Mode', 'TP Modu'],
  ['Target (R)', 'Hedef (R)'],
  ['OPEN POSITIONS & ORDERS', 'AÇIK POZİSYONLAR & EMİRLER'],
  ['RECENT TRADES', 'SON İŞLEMLER'],
  ['Save Template', 'Şablon Kaydet'],
  ['Background, Grid & Candles', 'Arka Plan, Izgara & Mumlar'],
  ['Import JSON', 'JSON İçe Aktar'],
  ['Add', 'Ekle'],
  ['OK', 'Tamam'],
];

const EN_TO_TR = new Map(TEXT_PAIRS);
const TR_TO_EN = new Map(TEXT_PAIRS.map(([en, tr]) => [tr, en]));

let currentLang = 'en';
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'tr' || saved === 'en') currentLang = saved;
} catch {
  // ignore
}

const listeners = new Set();

export function getLang() {
  return currentLang;
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key, vars = {}) {
  const table = DICT[currentLang] || DICT.en;
  let str = table[key] ?? DICT.en[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replaceAll(`{${k}}`, String(v ?? ''));
  }
  return str;
}

export function applyDomTranslations(root = document) {
  const lang = currentLang;
  const idx = lang === 'tr' ? 1 : 0;

  // 1. Direct ID mappings
  for (const [id, pair] of Object.entries(ID_TEXT_MAP)) {
    const el = root.getElementById ? root.getElementById(id) : root.querySelector(`#${CSS.escape(id)}`);
    if (!el) continue;
    // Preserve child pills/icons if element has .btn-label
    const lbl = el.querySelector?.('.btn-label');
    if (lbl) lbl.textContent = pair[idx];
    else el.textContent = pair[idx];
  }

  // 2. Clean text-node replacement on buttons, labels, headings, notes, spans inside UI chrome (never touches chart canvas or symbol names!)
  const lookup = lang === 'tr' ? EN_TO_TR : TR_TO_EN;
  const selector =
    '.topbar .btn-label, .popover-title-row span, .popover-hint, dialog h1, dialog h2, dialog label, dialog button, dialog .checkbox-row span, .trade-panel label, .trade-panel .rp-section-hdr span';
  for (const el of root.querySelectorAll(selector)) {
    // Only translate leaf elements or elements whose first text node matches cleanly
    if (el.children.length === 0) {
      const txt = el.textContent.trim();
      const mapped = lookup.get(txt);
      if (mapped) el.textContent = mapped;
    } else {
      for (const node of el.childNodes) {
        if (node.nodeType === 3) {
          const trimmed = node.textContent.trim();
          const mapped = lookup.get(trimmed);
          if (mapped) node.textContent = mapped;
        }
      }
    }
  }

  // 3. Sync language toggle pills & Settings select
  const toggleBtn = document.getElementById('lang-toggle-btn');
  if (toggleBtn) {
    toggleBtn.textContent = lang === 'tr' ? 'TR' : 'EN';
    toggleBtn.title = lang === 'tr' ? 'Dili değiştir: Türkçe → English' : 'Switch language: English → Türkçe';
  }
  const cfgLang = document.getElementById('cfg-lang');
  if (cfgLang) cfgLang.value = lang;
  document.documentElement.lang = lang;
}

export function setLang(nextLang, { broadcast = true } = {}) {
  const normalized = nextLang === 'tr' ? 'tr' : 'en';
  currentLang = normalized;
  try {
    localStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    // ignore
  }
  applyDomTranslations(document);
  for (const fn of listeners) {
    try {
      fn(normalized);
    } catch {
      // ignore
    }
  }
  if (broadcast) {
    try {
      const bc = new BroadcastChannel('linepulse_lang_sync');
      bc.postMessage({ lang: normalized });
      bc.close();
    } catch {
      // ignore
    }
  }
}

// Listen for language changes from other open monitor windows
try {
  const bc = new BroadcastChannel('linepulse_lang_sync');
  bc.onmessage = (ev) => {
    const incoming = ev?.data?.lang;
    if ((incoming === 'en' || incoming === 'tr') && incoming !== currentLang) {
      setLang(incoming, { broadcast: false });
    }
  };
} catch {
  // ignore
}
