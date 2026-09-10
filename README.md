# Socies - ESP32 Tabanlı Sanal Bebek & IoT Ekosistemi

> **ESP32**, **0.96" SSD1315 Sarı-Mavi OLED**, **Android / iOS Mobil Uygulama** ve **Merkezi Telemetri Sunucusu** ile yeni nesil bağlantılı sanal bebek projesi.

---

## 📌 Proje Genel Bakışı
Socies; klasik 90'lar nostaljisini, modern IoT (ESP32-C3), Sims tarzı dinamik ihtiyaç mekanikleri, kablosuz BLE mobil entegrasyonu, çağrı cihazı (pager) mesajlaşması ve sosyal çok oyunculu mini oyunlarla birleştiren açık ekosistemli bir sanal evcil hayvan konsoludur.

---

## 📂 Depo Mimarisi

- **[`mobile_app/`](file:///home/turan/socies/mobile_app/)**: **Öncelikli Android Mobil Uygulaması & El Konsolu Emülatörü (Flutter)**
  - Sol tarafta 128x64 OLED ekran (üstte 16px Sarı Durum Çubuğu, altta 48px Mavi Oyun Alanı).
  - Sağ tarafta dikey dizilmiş 4 adet dokunsal fiziksel buton (Kısa / Uzun 600ms basma özellikleri).
  - Telefon ivmeölçeri ile sallama algılama (SW-420 titreşim sensörü eşdeğeri - sallayınca top uçar, "İyi gezdik!" der).
  - Taş-Kağıt-Makas (3-2-1 geri sayım & eşzamanlı açılış) ve Kovboy Düellosu (refleks ateşi) mini oyunları.
  - Çağrı cihazı (Pager) ile arkadaşlara mesaj gönderme, Google/Apple bulut yedekleme & Rebirth (sıfırlama).
  - GitHub API üzerinden otomatik sürüm ve OTA güncelleme kontrolü.
- **[`server/`](file:///home/turan/socies/server/)**: **Merkezi Sunucu & Telemetri Dağıtım Merkezi (Node.js)**
  - REST API & Presence (Cihaz kayıt, çevrimiçi/çevrimdışı takibi).
  - Çevrimdışı çağrı mesaj kuyruğu (Store & Forward - hedef cihaz kapalıysa açılınca iletir).
  - Canlı Web Yönetim & Telemetri Paneli (`http://localhost:3000/dashboard`).
- **[`index.html`](file:///home/turan/socies/index.html)**: **Etkileşimli Web Emülatörü**
  - Web Audio API sesleri, titreşim motoru, elastik zıpzıp top fiziği, kaka mekaniği ve canlı test arayüzü.
- **[`firmware/socies_esp32.ino`](file:///home/turan/socies/firmware/socies_esp32.ino)**: **ESP32-C3 Donanım Yazılımı**
  - U8g2lib OLED sürücüsü, NimBLE Bluetooth haberleşmesi, SW-420 kesme servisi ve N-MOSFET titreşim motoru kontrolü.
- **[`hardware/pinout_schematic.md`](file:///home/turan/socies/hardware/pinout_schematic.md)**: **Fiziksel Bağlantı Şeması & Donanım Rehberi**
- **[`docs/mobile_roadmap_and_ota.md`](file:///home/turan/socies/docs/mobile_roadmap_and_ota.md)**: **Mobil Strateji & Kullanıcı Bağlılığı (Retention) Planı**

---

## 🎮 Temel Mekanikler

1. **Fiziksel Buton Düzeni (Kısa & Uzun Basma):**
   - **T1 (UP):** Kısa: Yukarı / Sev / Taş | Uzun: Ses Aç/Kapat (Mute)
   - **T2 (SELECT):** Kısa: Seç / Besle / Kağıt / Düello Ateş | Uzun: BLE Eşleşme Modu
   - **T3 (DOWN):** Kısa: Aşağı / Kaka Temizle / Makas | Uzun: Titreşim Motoru Aç/Kapat
   - **T4 (BACK):** Kısa: Geri / İptal / Uyku | Uzun: Sims İhtiyaçlar HUD Ekranı
2. **Kaka (💩) & Temizlik Mekaniği:**
   - Tuvalet ihtiyacı ihmal edildiğinde veya yemek sonrasında kaka çıkar. Temizlenmezse temizlik ve sağlık hızla düşer.
3. **Sosyal Oyunlar:**
   - **3-2-1 Taş-Kağıt-Makas:** Geri sayım sırasında her iki taraf seçimini kilitler, anında eşzamanlı açılır.
   - **Kovboy Düellosu:** Gerilimli rastgele bekleme sonrası aniden gelen "ATEŞ! (●)" sinyaline ilk basan kazanır (ms bazında reaksiyon süresi).
4. **Bağlantı Topolojisi:**
   - `[ESP32 Anahtarlık]` --BLE--> `[Android / iOS Telefon]` --IP / REST--> `[Merkezi Sunucu]`
