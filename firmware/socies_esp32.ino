/**
 * SOCIES SANAL BEBEK (VIRTUAL PET) - ESP32 FIRMWARE
 * 
 * Donanım:
 *  - ESP32-C3 SuperMini (veya ESP32 WROOM/PICO)
 *  - 0.96" 128x64 I2C OLED (SSD1315 / SSD1306, Sarı-Mavi çift renk)
 *  - 4x Taktil Buton (Sol, Seç/Aksiyon, Sağ, İptal/Geri)
 *  - 1x Pasif Piezo Buzzer (8-bit ses ve uyarılar)
 *  - TP4056 USB-C Li-Po Şarj Modülü + Batarya Gerilim Bölücü
 * 
 * Kütüphaneler:
 *  - U8g2lib (OLED ekran kontrolü)
 *  - NimBLE-Arduino (Düşük enerji Bluetooth sunucusu)
 *  - Preferences (ESP32 Dahili NVS Flash hafıza kayıt sistemi)
 */

#include <Arduino.h>
#include <Wire.h>
#include <U8g2lib.h>
#include <NimBLEDevice.h>
#include <Preferences.h>

// PIN TANIMLARI
#define PIN_OLED_SDA  8
#define PIN_OLED_SCL  9
#define PIN_BTN_LEFT  0
#define PIN_BTN_OK    1
#define PIN_BTN_RIGHT 2
#define PIN_BTN_BACK  3
#define PIN_BUZZER    4
#define PIN_BATTERY   5

// OLED EKRAN TANIMI (SSD1306 / SSD1315 I2C)
U8G2_SSD1306_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, /* reset=*/ U8X8_PIN_NONE, /* clock=*/ PIN_OLED_SCL, /* data=*/ PIN_OLED_SDA);

// BLE GATT TANIMLARI
#define SERVICE_UUID        "180F" // Socies Ana Servis
#define CHAR_TELEMETRY_UUID "2A19" // Canlı İhtiyaç & Durum Bildirimi (Notify)
#define CHAR_COMMAND_UUID   "2A20" // Mobil Uygulama Komutları (Write)

NimBLEServer* pServer = nullptr;
NimBLECharacteristic* pTelemetryChar = nullptr;
Preferences prefs;

// HAYVAN TÜRLERİ & EVRELER
enum PetBreed { BREED_CAT=0, BREED_DOG=1, BREED_BIRD=2, BREED_FISH=3, BREED_SAUSAGE=4, BREED_PACMAN=5, BREED_CRAB=6 };
enum LifeStage { STAGE_EGG=0, STAGE_BABY=1, STAGE_CHILD=2, STAGE_ADULT=3, STAGE_COCOON=4, STAGE_MEGA=5 };

struct PetState {
  uint8_t breed;
  uint8_t stage;
  uint16_t ageDays;
  uint32_t score;

  // 7 Sims İhtiyacı (0 - 100)
  int hunger;
  int fun;
  int love;
  int sleep;
  int toilet;
  int clean;
  int social;

  uint8_t zeroNeedsDays;
  bool isSleeping;
};

PetState pet = { BREED_CAT, STAGE_BABY, 1, 100, 85, 70, 90, 65, 80, 75, 60, 0, false };

// 8-BIT RETRO SES ÇALICI
void playTone(int freq, int durationMs) {
  tone(PIN_BUZZER, freq, durationMs);
}

void soundHappy() {
  playTone(523, 100); delay(110);
  playTone(659, 100); delay(110);
  playTone(784, 150);
}

void soundWarning() {
  for (int i = 0; i < 3; i++) {
    playTone(880, 70); delay(90);
    playTone(440, 70); delay(90);
  }
}

// SİMS İHTİYAÇ TÜKETİM MATRİSİ
void updateNeedsDecay() {
  if (pet.stage == STAGE_EGG || pet.stage == STAGE_COCOON) return;

  // Hayvana özgü metabolizma hızları
  int hungerDecay = (pet.breed == BREED_BIRD) ? 3 : 2;  // Kuş hızlı acıkır
  int cleanDecay  = (pet.breed == BREED_FISH) ? 3 : 1;  // Balık temiz su ister

  pet.hunger = max(0, pet.hunger - hungerDecay);
  pet.fun    = max(0, pet.fun - 2);
  pet.love   = max(0, pet.love - 1);
  pet.toilet = max(0, pet.toilet - 2);
  pet.clean  = max(0, pet.clean - cleanDecay);
  pet.social = max(0, pet.social - 1);
  if (!pet.isSleeping) pet.sleep = max(0, pet.sleep - 1);

  // %50 Altı Uyarı
  if (pet.hunger < 50 || pet.fun < 50 || pet.love < 50 || 
      pet.toilet < 50 || pet.clean < 50 || pet.social < 50) {
    soundWarning();
  }

  // 5 Gün Tüm İhtiyaçlar Sıfır Cezası
  if (pet.hunger == 0 && pet.fun == 0 && pet.love == 0 &&
      pet.toilet == 0 && pet.clean == 0 && pet.social == 0) {
    pet.zeroNeedsDays++;
    if (pet.zeroNeedsDays >= 5) {
      if (pet.stage > STAGE_BABY) {
        pet.stage--; // Bir önceki evreye geriler
      } else {
        pet.stage = STAGE_EGG; // Yumurtaya döner!
      }
      pet.zeroNeedsDays = 0;
    }
  } else {
    pet.zeroNeedsDays = 0;
  }
}

void drawScreen() {
  u8g2.clearBuffer();

  // === ÜST 16 PİKSEL SARI ALAN (STATUS) ===
  u8g2.setFont(u8g2_font_profont10_mr);
  u8g2.setCursor(2, 10);
  u8g2.print("SOCIES");
  u8g2.setCursor(55, 10);
  u8g2.printf("G:%d", pet.ageDays);
  u8g2.setCursor(95, 10);
  u8g2.print("85%");

  u8g2.drawHLine(0, 14, 128); // Sarı-Mavi ayırıcı çizgi

  // === ALT 48 PİKSEL MAVİ ALAN (OYUN ALANI) ===
  if (pet.stage == STAGE_EGG) {
    u8g2.drawDisc(64, 40, 12);
    u8g2.setCursor(40, 60);
    u8g2.print("CATLAT!");
  } else if (pet.stage == STAGE_COCOON) {
    u8g2.drawFrame(52, 22, 24, 34);
    u8g2.setCursor(30, 62);
    u8g2.print("KOZA EVRESI");
  } else {
    // Karakter çizimi & temel istatistikler
    u8g2.drawDisc(64, 38, 10); // Kafa
    u8g2.setCursor(20, 60);
    u8g2.printf("Ac:%d%% Sev:%d%%", pet.hunger, pet.love);
  }

  u8g2.sendBuffer();
}

void setup() {
  Serial.begin(115200);

  pinMode(PIN_BTN_LEFT, INPUT_PULLUP);
  pinMode(PIN_BTN_OK, INPUT_PULLUP);
  pinMode(PIN_BTN_RIGHT, INPUT_PULLUP);
  pinMode(PIN_BTN_BACK, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);

  u8g2.begin();

  // NimBLE BLE Server Başlatma
  NimBLEDevice::init("Socies_ESP32_C3");
  pServer = NimBLEDevice::createServer();
  NimBLEService* pService = pServer->createService(SERVICE_UUID);
  pTelemetryChar = pService->createCharacteristic(
    CHAR_TELEMETRY_UUID,
    NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY
  );
  pService->start();
  NimBLEDevice::getAdvertising()->start();

  soundHappy();
}

void loop() {
  static unsigned long lastTick = 0;
  if (millis() - lastTick > 30000) { // 30 saniyede bir ihtiyaç azalır
    lastTick = millis();
    updateNeedsDecay();
  }

  // Buton kontrolü (Örnek: Aksiyon butonu)
  if (digitalRead(PIN_BTN_OK) == LOW) {
    playTone(1000, 40);
    pet.hunger = min(100, pet.hunger + 25);
    pet.score += 10;
    delay(200);
  }

  drawScreen();
  delay(50);
}
