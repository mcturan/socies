# Socies & Pager Donanım Şeması (Titreşim Motoru + Dikey 4 Tuş)

Bu belge, cihazın ekranı solda ve 4 kontrol butonu sağ tarafta dikey sıralı olan ergonomik düzenine göre hazırlanmış donanım bağlantılarını ve devre şemasını açıklar.

---

## 1. Fiziksel Kasa Düzeni & Ergonomi
- **Sol Taraf:** 0.96" SSD1315 I2C 128x64 OLED Ekran.
- **Sağ Taraf:** Yukarıdan aşağıya 4 adet mikro taktil buton (Tek başparmakla 4 tuşa erişim):
  - **1. Tuş (En Üst):** YUKARI / Menüde Geri (Uzun Basma: Ses Aç/Kapat)
  - **2. Tuş (Üst-Orta):** SEÇ / Etkileşim (Uzun Basma: BLE Eşleşme)
  - **3. Tuş (Alt-Orta):** AŞAĞI / Menüde İleri (Uzun Basma: Titreşim Aç/Kapat)
  - **4. Tuş (En Alt):** İPTAL / GERİ (Uzun Basma: TÜM İHTİYAÇLAR HUD RAPORU)
- **Gövde İçi:**
  - 1027 ERM Mini Titreşim Motoru (N-MOSFET sürücülü)
  - Pasif Piezo Buzzer (LEDC PWM)
  - ESP32-C3 SuperMini
  - TP4056 Type-C Korumalı Şarj Modülü + 3.7V Li-Po Pil (500mAh - 800mAh)

---

## 2. ESP32-C3 Pinout Bağlantı Tablosu

| ESP32-C3 Pini | Hedef Modül Pini | İşlev & Kısa / Uzun Basma Görevi |
| :--- | :--- | :--- |
| **GPIO 8** | OLED `SDA` | I2C Ekran Veri Hattı |
| **GPIO 9** | OLED `SCL` | I2C Ekran Saat Hattı |
| **GPIO 0** | Buton 1 (En Üst Tuş) | **Kısa:** YUKARI \| **Uzun:** Ses Aç/Kapat (Mute) |
| **GPIO 1** | Buton 2 (Üst-Orta Tuş) | **Kısa:** SEÇ / AKSİYON \| **Uzun:** BLE Eşleşme Modu |
| **GPIO 2** | Buton 3 (Alt-Orta Tuş) | **Kısa:** AŞAĞI \| **Uzun:** Titreşim Aç/Kapat |
| **GPIO 3** | Buton 4 (En Alt Tuş) | **Kısa:** İPTAL / GERİ \| **Uzun:** TÜM İHTİYAÇLAR HUD EKRANI |
| **GPIO 4** | Pasif Piezo Buzzer (+) | LEDC PWM Ton Üretimi (8-bit sesler & çağrı melodileri) |
| **GPIO 6** | Titreşim Motoru Sürücüsü | 1kΩ direnç ile N-MOSFET (2N7002 / 2N2222) Gate pini |
| **GPIO 5** | Batarya Gerilim Bölücü | Pil (+) kutbundan 100k / 100k direnç bölücü ADC girişi |
| **3V3 & GND** | Tüm Modüller | Pozitif besleme ve ortak şasi |

---

## 3. Titreşim Motoru Sürücü Devresi
Titreşim motoru dönerken endüktif geri tepme (flyback spike) ve anlık 80-100mA akım çeker. ESP32 GPIO pinleri doğrudan en fazla 20mA verebildiğinden transistör/MOSFET zorunludur:
```
              +3.3V (VCC)
                 |
                 +----+
                 |    |
             [Motor] [1N4148 Diyot] (Ters bağlı koruma)
                 |    |
                 +----+
                 |
               Drain
GPIO 6 ---[ 1k ]--- Gate (2N7002 N-MOSFET)
               Source
                 |
                GND
```
