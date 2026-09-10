/**
 * SOCIES SANAL BEBEK & ÇAĞRI CİHAZI (PAGER) - ESP32 FIRMWARE
 * 
 * Donanım Mimarisi:
 *  - Mikrodenetleyici: ESP32-C3 SuperMini (160MHz RISC-V, BLE 5.0, WiFi)
 *  - Ekran (Solda): 0.96" 128x64 I2C OLED (SSD1315/SSD1306, Sarı-Mavi çift bölge)
 *  - Düğmeler (Sağda Dikey 4 Tuş):
 *      Tuş 1 (Yukarı): Kısa -> Menüde Yukarı | Uzun (600ms) -> Ses Aç/Kapat (Mute)
 *      Tuş 2 (Seç):   Kısa -> Aksiyon/Etkileşim | Uzun (600ms) -> BLE Eşleşme Modu
 *      Tuş 3 (Aşağı):  Kısa -> Menüde Aşağı  | Uzun (600ms) -> Titreşim Aç/Kapat
 *      Tuş 4 (Geri):   Kısa -> İptal/Geri    | Uzun (600ms) -> TÜM İHTİYAÇLAR HUD
 *  - Dokunsal Geri Bildirim: Mini 1027 ERM Titreşim Motoru (N-MOSFET sürücülü)
 *  - Ses Geri Bildirimi: Pasif Piezo Buzzer (LEDC PWM Donanımsal Ses)
 *  - Güç: 3.7V Li-Po Pil + TP4056 USB-C Korumalı Şarj Modülü + ADC Gerilim Bölücü
 * 
 * Ana Karakter: SOSİS (Tombiş Gurme Maskot)
 * Sosyal Modül: Pager (Çağrı Cihazı) Kayan Yazı Mesajlaşması & Arkadaş Dürtme (Poke)
 */

#include <Arduino.h>
#include <Wire.h>
#include <U8g2lib.h>
#include <NimBLEDevice.h>
#include <Preferences.h>

// PIN TANIMLARI
#define PIN_OLED_SDA      8
#define PIN_OLED_SCL      9
#define PIN_BTN_UP        0 // En Üst Tuş (Yukarı)
#define PIN_BTN_ACTION    1 // Üst-Orta Tuş (Seç/Aksiyon)
#define PIN_BTN_DOWN      2 // Alt-Orta Tuş (Aşağı)
#define PIN_BTN_BACK      3 // En Alt Tuş (İptal/Durum)
#define PIN_BUZZER        4 // Pasif Buzzer (+)
#define PIN_VIBRO_MOTOR   6 // Titreşim Motoru N-MOSFET Gate
#define PIN_BATTERY_ADC   5 // Pil Gerilim Bölücü (100k/100k)

#define LONG_PRESS_TIME_MS 600

// OLED EKRAN TANIMI (SSD1306 / SSD1315 128x64 I2C)
U8G2_SSD1306_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE, PIN_OLED_SCL, PIN_OLED_SDA);

// BLE GATT TANIMLARI
#define SERVICE_UUID        "180F" // Socies Ana Servis
#define CHAR_TELEMETRY_UUID "2A19" // Canlı İhtiyaç & Durum Bildirimi (Notify)
#define CHAR_PAGER_UUID     "2A21" // Çağrı Cihazı Metin Mesajı (Write)

NimBLEServer* pServer = nullptr;
NimBLECharacteristic* pTelemetryChar = nullptr;
NimBLECharacteristic* pPagerChar = nullptr;
Preferences prefs;

// SİSTEM AYARLARI
struct DeviceSettings {
  bool soundEnabled;
  bool vibrationEnabled;
  bool isSleeping;
};
DeviceSettings settings = { true, true, false };

// SİMS İHTİYAÇLARI & SOSİS DURUMU
struct SausagePet {
  uint8_t stage;        // 0: Yumurta, 1: Bebek Sosis, 2: Çocuk Sosis, 3: Yetişkin Sosis, 4: Pastırma Kozası, 5: Siber Mega Sosis
  uint16_t ageDays;
  uint32_t totalScore;

  // 7 Sims İhtiyacı (0 - 100)
  int hunger;
  int fun;
  int love;
  int sleep;
  int toilet;
  int clean;
  int social; // Madde 8: Sıfırlansa da kitlemez; yüksek olunca bonus verir

  char activePagerMsg[33];
  bool hasNewPagerMsg;
  int pagerScrollPos;
};

SausagePet sosis = { 1, 1, 180, 85, 75, 90, 70, 80, 80, 65, "Hos geldin!", false, 128 };

// BUTON BASMA TAKİP YAPISI
struct ButtonTracker {
  uint8_t pin;
  unsigned long pressStartTime;
  bool isPressed;
  bool longTriggered;
};

ButtonTracker btnUp    = { PIN_BTN_UP, 0, false, false };
ButtonTracker btnOk    = { PIN_BTN_ACTION, 0, false, false };
ButtonTracker btnDown  = { PIN_BTN_DOWN, 0, false, false };
ButtonTracker btnBack  = { PIN_BTN_BACK, 0, false, false };

// ==========================================
// TİTREŞİM VE SES GERİ BİLDİRİM MOTORU
// ==========================================
void triggerVibration(int durationMs) {
  if (!settings.vibrationEnabled) return;
  digitalWrite(PIN_VIBRO_MOTOR, HIGH);
  delay(durationMs);
  digitalWrite(PIN_VIBRO_MOTOR, LOW);
}

void playTone(int freq, int durationMs) {
  if (!settings.soundEnabled) return;
  tone(PIN_BUZZER, freq, durationMs);
}

void soundHappy() {
  playTone(523, 80); delay(90);
  playTone(659, 80); delay(90);
  playTone(784, 120);
  triggerVibration(100);
}

void soundPagerAlert() {
  // 90'lar Çağrı Cihazı Melodisi ve Titreşim Dizisi
  for (int i = 0; i < 3; i++) {
    if (settings.vibrationEnabled) digitalWrite(PIN_VIBRO_MOTOR, HIGH);
    playTone(1200, 70);
    delay(80);
    if (settings.vibrationEnabled) digitalWrite(PIN_VIBRO_MOTOR, LOW);
    delay(60);
  }
}

// ==========================================
// PAGER (ÇAĞRI CİHAZI) BLE CALLBACK
// ==========================================
class PagerCallback: public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* pChar) {
    std::string msg = pChar->getValue();
    if (msg.length() > 0) {
      strncpy(sosis.activePagerMsg, msg.c_str(), 32);
      sosis.activePagerMsg[32] = '\0';
      sosis.hasNewPagerMsg = true;
      sosis.pagerScrollPos = 128; // Ekranın sağından başlat
      soundPagerAlert();
    }
  }
};

// ==========================================
// BUTON KISA VE UZUN BASMA İŞLEYİCİLERİ
// ==========================================
void onUpShort()   { playTone(600, 30); /* Menüde yukarı */ }
void onUpLong()    { settings.soundEnabled = !settings.soundEnabled; triggerVibration(120); }

void onOkShort()   {
  playTone(800, 40);
  sosis.hunger = min(100, sosis.hunger + 25);
  sosis.totalScore += 10;
  triggerVibration(60);
}
void onOkLong()    { playTone(950, 100); triggerVibration(150); /* BLE Eşleşme Modu */ }

void onDownShort() { playTone(600, 30); /* Menüde aşağı */ }
void onDownLong()  { settings.vibrationEnabled = !settings.vibrationEnabled; triggerVibration(150); }

void onBackShort() { playTone(400, 40); sosis.hasNewPagerMsg = false; }
void onBackLong()  { playTone(750, 60); triggerVibration(120); /* TÜM İHTİYAÇLAR HUD */ }

void handleButton(ButtonTracker &btn, void (*shortFn)(), void (*longFn)()) {
  int val = digitalRead(btn.pin);
  if (val == LOW) {
    if (!btn.isPressed) {
      btn.isPressed = true;
      btn.pressStartTime = millis();
      btn.longTriggered = false;
    } else {
      if (!btn.longTriggered && (millis() - btn.pressStartTime >= LONG_PRESS_TIME_MS)) {
        btn.longTriggered = true;
        longFn();
      }
    }
  } else {
    if (btn.isPressed) {
      if (!btn.longTriggered) {
        shortFn();
      }
      btn.isPressed = false;
    }
  }
}

// ==========================================
// EKRAN ÇİZİM MOTORU (128x64 Sarı-Mavi)
// ==========================================
void renderScreen() {
  u8g2.clearBuffer();

  // --- ÜST 16 PİKSEL (SARI ALAN: DURUM ÇUBUĞU) ---
  u8g2.setFont(u8g2_font_profont10_mr);
  u8g2.setCursor(2, 10);
  u8g2.print("SOSIS");

  u8g2.setCursor(45, 10);
  u8g2.print(settings.soundEnabled ? "S" : "-");
  u8g2.setCursor(55, 10);
  u8g2.print(settings.vibrationEnabled ? "V" : "-");

  if (sosis.hasNewPagerMsg) {
    u8g2.setCursor(70, 10);
    u8g2.print("[MSG]");
  }

  u8g2.setCursor(102, 10);
  u8g2.print("85%");

  u8g2.drawHLine(0, 14, 128); // Sarı-Mavi ayırıcı çizgi

  // --- ALT 48 PİKSEL (MAVİ ALAN: OYUN VEYA PAGER) ---
  if (sosis.hasNewPagerMsg) {
    u8g2.setCursor(2, 30);
    u8g2.print("CAGRI:");
    u8g2.setCursor(sosis.pagerScrollPos, 45);
    u8g2.print(sosis.activePagerMsg);
    sosis.pagerScrollPos -= 2;
    if (sosis.pagerScrollPos < -150) sosis.pagerScrollPos = 128;
  } else {
    // Sosis Sprite Çizimi
    u8g2.drawRBox(50, 32, 28, 12, 4); // Kıvrık sosis gövdesi
    u8g2.setCursor(30, 60);
    u8g2.printf("Ac:%d%% Sev:%d%%", sosis.hunger, sosis.love);
  }

  u8g2.sendBuffer();
}

void setup() {
  Serial.begin(115200);

  pinMode(PIN_BTN_UP, INPUT_PULLUP);
  pinMode(PIN_BTN_ACTION, INPUT_PULLUP);
  pinMode(PIN_BTN_DOWN, INPUT_PULLUP);
  pinMode(PIN_BTN_BACK, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_VIBRO_MOTOR, OUTPUT);

  digitalWrite(PIN_VIBRO_MOTOR, LOW);

  u8g2.begin();

  // NimBLE Başlatma
  NimBLEDevice::init("Socies_Pager_C3");
  pServer = NimBLEDevice::createServer();
  NimBLEService* pService = pServer->createService(SERVICE_UUID);
  pTelemetryChar = pService->createCharacteristic(CHAR_TELEMETRY_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  pPagerChar = pService->createCharacteristic(CHAR_PAGER_UUID, NIMBLE_PROPERTY::WRITE);
  pPagerChar->setCallbacks(new PagerCallback());
  pService->start();
  NimBLEDevice::getAdvertising()->start();

  soundHappy();
}

void loop() {
  handleButton(btnUp, onUpShort, onUpLong);
  handleButton(btnOk, onOkShort, onOkLong);
  handleButton(btnDown, onDownShort, onDownLong);
  handleButton(btnBack, onBackShort, onBackLong);

  renderScreen();
  delay(30);
}
