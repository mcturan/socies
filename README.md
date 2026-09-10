# Socies - ESP32 Tabanlı Sanal Bebek & IoT Ekosistemi

> **ESP32**, **0.96" SSD1315 Sarı-Mavi OLED** ve **Android/iOS BLE Entegrasyonu** ile yeni nesil bağlantılı sanal bebek projesi.

---

## 📌 Proje Genel Bakışı
Socies; klasik 90'lar Tamagotchi nostaljisini, modern IoT (ESP32), Sims tarzı dinamik ihtiyaç mekanikleri, kablosuz BLE mobil entegrasyonu ve sosyal skorlama ile birleştiren açık donanımlı bir sanal evcil hayvan konsoludur.

### 🎮 Temel Özellikler
1. **Donanım Altyapısı**:
   - ESP32 (ESP32-C3 SuperMini / WROOM / Pico)
   - 0.96" 128x64 4-Pin I2C OLED (SSD1315/SSD1306 - Üst 16px Sarı, Alt 48px Mavi)
   - 3.7V Li-Po / 18650 Pil + TP4056 Type-C Korumalı Şarj Devresi
   - Açma/Kapama + Reset + 4 Taktil Kontrol Butonu
   - Piezo Pasif Buzzer (8-bit chiptune ses efektleri için)
2. **Sanal Canlılar**:
   - Kedi, Köpek, Kuş, Balık, Sosis, Pacman, Yengeç
3. **Evrim ve Yaşam Döngüsü**:
   - Yumurtadan çatlama ➔ Bebeklik ➔ Çocukluk ➔ Yetişkinlik (3 aylık süreç) ➔ Koza Evresi ➔ Üst Düzey Metamorfoz
4. **Sims Tarzı İhtiyaç Sistemi**:
   - Yemek, Oyun, Sevme, Uyuma, Tuvalet, Temizlik, Sosyalleşme
   - Hayvan cinsine göre değişen tüketim hızları (Örn. Kuş hızlı acıkır, Balık temizlik hassastır, Köpek sevgi ve oyun ister).
5. **Kritik Eşik & Kural Seti**:
   - **%50 Altı**: Cihazda sesli ve görsel uyarı, mobil bildirim.
   - **%0 Kilitlenme**: İhtiyaç 0'a inerse giderilmeden başka hiçbir aktivite yapılamaz.
   - **5 Gün Kuralı**: Tüm ihtiyaçlar sıfırken 5 gün boyunca müdahale edilmezse hayvan bir önceki seviyesine düşer, en baştaysa yumurtaya döner.
6. **Bağlantı & Mobil Ekosistem**:
   - BLE (Bluetooth Low Energy) ile ilk kurulum, eşleştirme ve hesap girişi.
   - Günlük görevler, puanlama, hem küresel hem arkadaşlar arası liderlik tablosu (Leaderboard).
   - Sosyalleşme için ID / Nickname / Arkadaş kodu paylaşımı.
