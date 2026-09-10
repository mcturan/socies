# Socies Donanım & Bağlantı Şeması

Bu belge, Socies taşınabilir cihazının fiziksel bileşen bağlantılarını ve devre şemasını açıklar.

## 1. Kullanılan Temel Modüller
- **Mikrodenetleyici:** ESP32-C3 SuperMini (Dahili WiFi + BLE 5.0, 160MHz RISC-V)
- **Ekran:** 0.96" SSD1315 / SSD1306 I2C 128x64 OLED Ekran (Üst 16 Sarı, Alt 48 Mavi)
- **Şarj Modülü:** TP4056 Type-C Korumalı Lityum Pil Şarj Kartı
- **Batarya:** 3.7V 500mAh - 800mAh Lityum Polimer (Li-Po) Pil
- **Ses:** 9mm Pasif Piezo Buzzer
- **Kontrol:** 4 adet mikro taktil buton (Sol, Seç, Sağ, Geri) + Donanım Reset + Kayar Sürgülü Açma/Kapama anahtarı

---

## 2. ESP32-C3 Pin Bağlantı Tablosu

| ESP32-C3 Pini | Hedef Modül Pini | İşlev / Not |
| :--- | :--- | :--- |
| **GPIO 8** | OLED `SDA` | I2C Veri Hattı |
| **GPIO 9** | OLED `SCL` | I2C Saat Hattı |
| **GPIO 0** | Buton 1 (SOL) | Dahili Pull-Up (GND'ye basar) |
| **GPIO 1** | Buton 2 (SEÇ / AKSİYON) | Dahili Pull-Up (Deep Sleep EXT0 Uyandırma Pini) |
| **GPIO 2** | Buton 3 (SAĞ) | Dahili Pull-Up |
| **GPIO 3** | Buton 4 (İPTAL / GERİ) | Dahili Pull-Up |
| **GPIO 4** | Buzzer (+) | PWM / LEDC Ses Tonu |
| **GPIO 5** | Pil Bölücü Orta Nokta | ADC Girişi (100k / 100k Gerilim Bölücü ile max 2.1V) |
| **3V3** | OLED `VCC`, ESP32 3.3V | Pozitif Güç Hattı |
| **GND** | Ortak Şasi | OLED `GND`, Buzzer (-), Butonlar, Pil (-) |

---

## 3. Güç Yönetimi ve Batarya Bağlantısı
- **TP4056 `B+` ve `B-`:** Doğrudan Li-Po pile bağlanır (Dahili DW01A aşırı deşarj/aşırı şarj koruması sağlar).
- **TP4056 `OUT+` ve `OUT-`:** Sürgülü açma/kapama anahtarı üzerinden ESP32 `5V` (VBUS/VIN) ve `GND` pinlerine gider.
- **Güç Tasarrufu (Deep Sleep):** Cihaz 45 saniye boyunca butona basılmazsa ekranı karartır ve derin uykuya geçer (`esp_deep_sleep_start()`). Harici `GPIO 1` (Seç butonu) kesmesiyle veya dahili RTC alarmıyla uyanır.
