#!/bin/bash
set -e

ANDROID_JAR="/home/turan/android-sdk/platforms/android-28/android.jar"
D8_JAR="/home/turan/android-sdk/build-tools/d8.jar"
SRC_DIR="/home/turan/socies"
BUILD_DIR="/tmp/socies_unified_build"
KEYSTORE="$SRC_DIR/debug.keystore"

echo "=== 1. Preparing Build Environment for Unified Socies App ==="
rm -rf $BUILD_DIR
mkdir -p $BUILD_DIR/bin $BUILD_DIR/assets $BUILD_DIR/src/io/socies/app $BUILD_DIR/res/values

# 1.1 Embed app.html as index.html
cp $SRC_DIR/app.html $BUILD_DIR/assets/index.html

# 1.2 Copy drawables, mipmaps & strings
cp -r $SRC_DIR/mobile_app/android/app/src/main/res/* $BUILD_DIR/res/

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
    android:versionCode="33"
    android:versionName="1.0.32">

    <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="28" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
    <uses-permission android:name="android.permission.DOWNLOAD_WITHOUT_NOTIFICATION" />

    <application
        android:label="@string/app_name"
        android:icon="@drawable/ic_launcher"
        android:roundIcon="@drawable/ic_launcher"
        android:allowBackup="true"
        android:hardwareAccelerated="true"
        android:usesCleartextTraffic="true">
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
echo "=== 2. AAPT Compile & DEX Generation ==="
aapt package -f -m -J $BUILD_DIR/src -M $BUILD_DIR/AndroidManifest.xml -S $BUILD_DIR/res -I $ANDROID_JAR
javac -source 8 -target 8 -bootclasspath $ANDROID_JAR -cp $ANDROID_JAR -d $BUILD_DIR/bin $BUILD_DIR/src/io/socies/app/*.java
java -cp $D8_JAR com.android.tools.r8.D8 --lib $ANDROID_JAR --output $BUILD_DIR/bin $(find $BUILD_DIR/bin -name "*.class")

echo "=== 3. AAPT Package Unaligned APK ==="
cd $BUILD_DIR/bin
aapt package -f -M $BUILD_DIR/AndroidManifest.xml -S $BUILD_DIR/res -A $BUILD_DIR/assets -I $ANDROID_JAR -F $BUILD_DIR/unaligned.apk .

echo "=== 4. Zipalign 4-byte ==="
zipalign -f -p 4 $BUILD_DIR/unaligned.apk $BUILD_DIR/aligned.apk

echo "=== 5. APK Sign with apksigner ==="
apksigner sign --ks $KEYSTORE --ks-pass pass:android --key-pass pass:android --out $SRC_DIR/downloads/socies-app.apk $BUILD_DIR/aligned.apk
cp $SRC_DIR/downloads/socies-app.apk $SRC_DIR/downloads/socies-v1.0.31.apk

echo "=== 6. Verify APK Signature & Package Info ==="
apksigner verify -v $SRC_DIR/downloads/socies-app.apk
ls -lh $SRC_DIR/downloads/socies-app.apk
echo "✓ Unified Socies App Built and Verified Successfully!"
