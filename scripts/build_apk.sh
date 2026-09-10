#!/bin/bash
set -e

ANDROID_JAR="/home/turan/android-sdk/platforms/android-28/android.jar"
D8_JAR="/home/turan/android-sdk/build-tools/d8.jar"
BUILD_DIR="/tmp/socies_apk_build"
SRC_DIR="/home/turan/socies"

echo "=== 1. Preparing Build Environment ==="
rm -rf $BUILD_DIR
mkdir -p $BUILD_DIR/bin $BUILD_DIR/assets $BUILD_DIR/src/io/socies/app $BUILD_DIR/res/values

# Assets & Resources
cp $SRC_DIR/index.html $BUILD_DIR/assets/index.html
cp $SRC_DIR/mobile_app/android/app/src/main/res/values/strings.xml $BUILD_DIR/res/values/strings.xml
cp $SRC_DIR/mobile_app/android/app/src/main/AndroidManifest.xml $BUILD_DIR/AndroidManifest.xml
cp $SRC_DIR/mobile_app/android/app/src/main/java/io/socies/app/MainActivity.java $BUILD_DIR/src/io/socies/app/MainActivity.java

echo "=== 2. AAPT Generate R.java ==="
aapt package -f -m -J $BUILD_DIR/src -M $BUILD_DIR/AndroidManifest.xml -S $BUILD_DIR/res -I $ANDROID_JAR

echo "=== 3. Compile Java Source with javac ==="
javac -source 8 -target 8 -bootclasspath $ANDROID_JAR -cp $ANDROID_JAR -d $BUILD_DIR/bin $BUILD_DIR/src/io/socies/app/*.java

echo "=== 4. D8 Compile .class to classes.dex ==="
java -cp $D8_JAR com.android.tools.r8.D8 --lib $ANDROID_JAR --output $BUILD_DIR/bin $(find $BUILD_DIR/bin -name "*.class")
ls -lh $BUILD_DIR/bin/classes.dex

echo "=== 5. AAPT Package Unaligned APK with compiled AndroidManifest and assets ==="
cd $BUILD_DIR/bin
aapt package -f -M $BUILD_DIR/AndroidManifest.xml -S $BUILD_DIR/res -A $BUILD_DIR/assets -I $ANDROID_JAR -F $BUILD_DIR/unaligned.apk .

echo "=== 6. Zipalign 4-byte ==="
zipalign -f -p 4 $BUILD_DIR/unaligned.apk $BUILD_DIR/aligned.apk

echo "=== 7. APK Sign with apksigner ==="
KEYSTORE="$SRC_DIR/debug.keystore"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkey -v -keystore $KEYSTORE -alias androiddebugkey -storepass android -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Socies,OU=Mobile,O=Socies,C=TR"
fi

mkdir -p $SRC_DIR/downloads
apksigner sign --ks $KEYSTORE --ks-pass pass:android --key-pass pass:android --out $SRC_DIR/downloads/socies-app.apk $BUILD_DIR/aligned.apk
cp $SRC_DIR/downloads/socies-app.apk $SRC_DIR/downloads/socies-v1.0.5.apk

echo "=== 8. Verify APK Signature & Package Info ==="
apksigner verify -v $SRC_DIR/downloads/socies-app.apk
aapt dump badging $SRC_DIR/downloads/socies-app.apk | head -n 30
ls -lh $SRC_DIR/downloads/*.apk

echo "=== Build Complete Successfully! ==="
