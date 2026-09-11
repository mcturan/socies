#!/bin/bash
set -e

ANDROID_JAR="/home/turan/android-sdk/platforms/android-28/android.jar"
D8_JAR="/home/turan/android-sdk/build-tools/d8.jar"
SRC_DIR="/home/turan/socies"
KEYSTORE="$SRC_DIR/debug.keystore"

if [ ! -f "$KEYSTORE" ]; then
  keytool -genkey -v -keystore $KEYSTORE -alias androiddebugkey -storepass android -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Socies,OU=Mobile,O=Socies,C=TR"
fi

mkdir -p $SRC_DIR/downloads

# ==============================================================================
# 1. BUILD SOCIES COMPANION APP (LIGHT TEMA ÇOCUK UYGULAMASI)
# ==============================================================================
echo "=================================================="
echo "▶ 1/2: BUILDING SOCIES COMPANION (socies-companion.apk)"
echo "=================================================="
BUILD_DIR="/tmp/socies_companion_build"
rm -rf $BUILD_DIR
mkdir -p $BUILD_DIR/bin $BUILD_DIR/assets $BUILD_DIR/src/io/socies/app $BUILD_DIR/res/values

# 1.1 Embed companion.html as index.html
cp $SRC_DIR/companion.html $BUILD_DIR/assets/index.html

# 1.2 Strings & Manifest
cat << 'EOS' > $BUILD_DIR/res/values/strings.xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">Socies</string>
</resources>
EOS

cat << 'EOM' > $BUILD_DIR/AndroidManifest.xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="io.socies.app"
    android:versionCode="6"
    android:versionName="1.0.5">

    <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="28" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.READ_CONTACTS" />
    <uses-permission android:name="android.permission.WRITE_CONTACTS" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.BODY_SENSORS" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.BLUETOOTH" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />

    <application
        android:label="@string/app_name"
        android:allowBackup="true"
        android:hardwareAccelerated="true">
        <activity
            android:name="io.socies.app.MainActivity"
            android:label="@string/app_name"
            android:exported="true"
            android:theme="@android:style/Theme.NoTitleBar.Fullscreen"
            android:configChanges="orientation|keyboardHidden|screenSize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
EOM

# 1.3 Java Source
cp $SRC_DIR/mobile_app/android/app/src/main/java/io/socies/app/MainActivity.java $BUILD_DIR/src/io/socies/app/MainActivity.java

# 1.4 Compile & Package
aapt package -f -m -J $BUILD_DIR/src -M $BUILD_DIR/AndroidManifest.xml -S $BUILD_DIR/res -I $ANDROID_JAR
javac -source 8 -target 8 -bootclasspath $ANDROID_JAR -cp $ANDROID_JAR -d $BUILD_DIR/bin $BUILD_DIR/src/io/socies/app/*.java
java -cp $D8_JAR com.android.tools.r8.D8 --lib $ANDROID_JAR --output $BUILD_DIR/bin $(find $BUILD_DIR/bin -name "*.class")
cd $BUILD_DIR/bin
aapt package -f -M $BUILD_DIR/AndroidManifest.xml -S $BUILD_DIR/res -A $BUILD_DIR/assets -I $ANDROID_JAR -F $BUILD_DIR/unaligned.apk .
zipalign -f -p 4 $BUILD_DIR/unaligned.apk $BUILD_DIR/aligned.apk
apksigner sign --ks $KEYSTORE --ks-pass pass:android --key-pass pass:android --out $SRC_DIR/downloads/socies-companion.apk $BUILD_DIR/aligned.apk
cp $SRC_DIR/downloads/socies-companion.apk $SRC_DIR/downloads/socies-app.apk
apksigner verify -v $SRC_DIR/downloads/socies-companion.apk
echo "✓ Socies Companion APK Built Successfully!"

# ==============================================================================
# 2. BUILD SOCIES POCKET APP (RETRO EL KONSOLU EMÜLATÖRÜ)
# ==============================================================================
echo "=================================================="
echo "▶ 2/2: BUILDING SOCIES POCKET (socies-pocket.apk)"
echo "=================================================="
BUILD_DIR_POCKET="/tmp/socies_pocket_build"
rm -rf $BUILD_DIR_POCKET
mkdir -p $BUILD_DIR_POCKET/bin $BUILD_DIR_POCKET/assets $BUILD_DIR_POCKET/src/io/socies/pocket $BUILD_DIR_POCKET/res/values

# 2.1 Embed pocket.html as index.html
cp $SRC_DIR/pocket.html $BUILD_DIR_POCKET/assets/index.html

# 2.2 Strings & Manifest
cat << 'EOS2' > $BUILD_DIR_POCKET/res/values/strings.xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">Socies Pocket</string>
</resources>
EOS2

cat << 'EOM2' > $BUILD_DIR_POCKET/AndroidManifest.xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="io.socies.pocket"
    android:versionCode="1"
    android:versionName="1.0.0">

    <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="28" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.BLUETOOTH" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />

    <application
        android:label="@string/app_name"
        android:allowBackup="true"
        android:hardwareAccelerated="true">
        <activity
            android:name="io.socies.pocket.MainActivity"
            android:label="@string/app_name"
            android:exported="true"
            android:screenOrientation="portrait"
            android:theme="@android:style/Theme.NoTitleBar.Fullscreen"
            android:configChanges="orientation|keyboardHidden|screenSize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
EOM2

# 2.3 Pocket MainActivity.java
cat << 'EOJ' > $BUILD_DIR_POCKET/src/io/socies/pocket/MainActivity.java
package io.socies.pocket;

import android.app.Activity;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Keep screen on for retro console gaming experience
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());

        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onBackPressed() {
        // Prevent accidental exits during gameplay
    }
}
EOJ

# 2.4 Compile & Package Pocket Console
aapt package -f -m -J $BUILD_DIR_POCKET/src -M $BUILD_DIR_POCKET/AndroidManifest.xml -S $BUILD_DIR_POCKET/res -I $ANDROID_JAR
javac -source 8 -target 8 -bootclasspath $ANDROID_JAR -cp $ANDROID_JAR -d $BUILD_DIR_POCKET/bin $BUILD_DIR_POCKET/src/io/socies/pocket/*.java
java -cp $D8_JAR com.android.tools.r8.D8 --lib $ANDROID_JAR --output $BUILD_DIR_POCKET/bin $(find $BUILD_DIR_POCKET/bin -name "*.class")
cd $BUILD_DIR_POCKET/bin
aapt package -f -M $BUILD_DIR_POCKET/AndroidManifest.xml -S $BUILD_DIR_POCKET/res -A $BUILD_DIR_POCKET/assets -I $ANDROID_JAR -F $BUILD_DIR_POCKET/unaligned.apk .
zipalign -f -p 4 $BUILD_DIR_POCKET/unaligned.apk $BUILD_DIR_POCKET/aligned.apk
apksigner sign --ks $KEYSTORE --ks-pass pass:android --key-pass pass:android --out $SRC_DIR/downloads/socies-pocket.apk $BUILD_DIR_POCKET/aligned.apk
apksigner verify -v $SRC_DIR/downloads/socies-pocket.apk
echo "✓ Socies Pocket APK Built Successfully!"

echo "=================================================="
echo "🎉 ALL DUAL APKS BUILT AND VERIFIED SUCCESSFULLY!"
echo "=================================================="
ls -lh $SRC_DIR/downloads/*.apk
