#!/usr/bin/env bash
# ==============================================================================
# Build CLEAN PUBLIC Standalone Android APK for Velox Charts (v1.4.1)
# - ZERO personal API keys, ZERO personal IPs, ZERO tracking, ZERO Firebase credentials!
# - Lightweight (~10 MB) — works out-of-the-box with free Crypto, CME, FX Spot TRY & BIST!
# - Users can enter their OWN free OANDA Practice API key in Settings (stored locally only).
# - For iOS (iPhone): run `npm install && npx cap add ios && npx cap sync ios && npx cap open ios` on macOS with Xcode!
# ==============================================================================
set -euo pipefail
cd "$(dirname "$0")"

if [ -z "${JAVA_HOME:-}" ]; then
  for jdk in /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
             /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
             /opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home; do
    if [ -d "$jdk" ]; then
      export JAVA_HOME="$jdk"
      export PATH="$JAVA_HOME/bin:$PATH"
      break
    fi
  done
fi

if [ -z "${ANDROID_HOME:-}" ]; then
  if [ -d "$HOME/Library/Android/sdk" ]; then
    export ANDROID_HOME="$HOME/Library/Android/sdk"
  elif [ -d "/opt/homebrew/share/android-commandlinetools" ]; then
    export ANDROID_HOME="/opt/homebrew/share/android-commandlinetools"
  fi
fi
export ANDROID_SDK_ROOT="${ANDROID_HOME:-}"

echo ">>> Staging clean PUBLIC Velox Charts web bundle (zero secrets)..."
mkdir -p www/vendor
cp -R ../public/* www/
cp ../node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.mjs www/vendor/lightweight-charts.mjs 2>/dev/null || cp ../public/vendor/lightweight-charts.mjs www/vendor/lightweight-charts.mjs

node -e "
const fs = require('fs');
let html = fs.readFileSync('www/index.html', 'utf8');
if (!html.includes('standalone-public.js')) {
  html = html.replace('</head>', '  <script src=\"/standalone-public.js\"></script>\n</head>');
  fs.writeFileSync('www/index.html', html, 'utf8');
}
"

if [ ! -d node_modules ]; then
  npm install
fi
if [ ! -d android ]; then
  npx cap add android
fi

# Patch AndroidManifest, styles.xml (cutout + dark bars), and version 1.4.1
node -e "
const fs = require('fs');
const mp = 'android/app/src/main/AndroidManifest.xml';
if (fs.existsSync(mp)) {
  let m = fs.readFileSync(mp, 'utf8');
  if (!m.includes('usesCleartextTraffic')) {
    m = m.replace('<application', '<application\n        android:usesCleartextTraffic=\"true\"');
  }
  fs.writeFileSync(mp, m, 'utf8');
}
const p = 'android/app/build.gradle';
if (fs.existsSync(p)) {
  let g = fs.readFileSync(p, 'utf8');
  g = g.replace(/versionCode\s+\d+/, 'versionCode 141').replace(/versionName\s+\"[^\"]+\"/, 'versionName \"1.4.1\"');
  fs.writeFileSync(p, g, 'utf8');
}
const stPath = 'android/app/src/main/res/values/styles.xml';
if (fs.existsSync(stPath)) {
  let st = fs.readFileSync(stPath, 'utf8');
  if (!st.includes('windowLayoutInDisplayCutoutMode')) {
    st = st.replace(
      /<style name=\"AppTheme\.NoActionBar\"[^>]*>/,
      (m) => m + '\n        <item name=\"android:windowLayoutInDisplayCutoutMode\">shortEdges</item>\n        <item name=\"android:windowBackground\">#0a0f1d</item>\n        <item name=\"android:windowOptOutEdgeToEdgeEnforcement\">true</item>\n        <item name=\"android:statusBarColor\">#0a0f1d</item>\n        <item name=\"android:navigationBarColor\">#0a0f1d</item>\n        <item name=\"android:windowLightStatusBar\">false</item>'
    );
    fs.writeFileSync(stPath, st, 'utf8');
  }
}
"

# Copy Velox Charts icons
for spec in "mdpi:48" "hdpi:72" "xhdpi:96" "xxhdpi:144" "xxxhdpi:192"; do
  density="${spec%%:*}"
  size="${spec##*:}"
  dir="android/app/src/main/res/mipmap-${density}"
  mkdir -p "$dir"
  sips -z "$size" "$size" ../desktop/build/icon.png --out "$dir/ic_launcher.png" >/dev/null 2>&1 || true
  sips -z "$size" "$size" ../desktop/build/icon.png --out "$dir/ic_launcher_round.png" >/dev/null 2>&1 || true
  sips -z "$size" "$size" ../desktop/build/icon.png --out "$dir/ic_launcher_foreground.png" >/dev/null 2>&1 || true
done

npx cap sync android
cd android
./gradlew assembleDebug --max-workers=2
mkdir -p ../../dist-desktop
cp app/build/outputs/apk/debug/app-debug.apk ../../dist-desktop/VeloxCharts-1.4.1-Public-Android.apk
echo "✅ Built Clean Public APK: dist-desktop/VeloxCharts-1.4.1-Public-Android.apk"
