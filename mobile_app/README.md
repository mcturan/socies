# Socies Mobile App (Android / Handheld Emulator)

Bu mobil uygulama, **Socies** sanal evcil hayvan ve akıllı anahtarlık ekosisteminin **Android öncelikli (Mobile-First)** istemcisidir.

Kullanıcı fiziksel cihaz henüz elinde olmadan doğrudan telefonunda retro konsol deneyimiyle oynayabilir, donanım hazır olduğunda ise BLE üzerinden gerçek cihaza bağlanabilir.

---

## 📱 Özellikler

1. **Retro Taşınabilir Konsol Kasa Arayüzü:**
   - **Sol Taraf:** 128x64 Sarı-Mavi OLED ekran (Üstte 16px Sarı Telefon Durum Çubuğu, Altta 48px Mavi Oyun Alanı).
   - **Sağ Taraf:** 4 Adet dikey dizilmiş dokunsal fiziksel buton:
     - `T1 (UP):` Kısa bas: Sev / Taş | Uzun bas (600ms): Ses Aç/Kapat
     - `T2 (SELECT):` Kısa bas: Besle / Kağıt / Düello Ateş | Uzun bas: BLE Eşleşme
     - `T3 (DOWN):` Kısa bas: Kaka Temizle / Makas | Uzun bas: Titreşim Aç/Kapat
     - `T4 (BACK):` Kısa bas: Geri / Uyku | Uzun bas: Sims İhtiyaçlar HUD Ekranı
2. **Gerçek Telefon Sensör Entegrasyonu (SW-420 Eşdeğeri):**
   - Telefonu salladığınızda jiroskop/ivmeölçer algılanır; top çılgınca zıplar, ekran dışına seker ve canlı eğlenir (`İyi gezdik!` bildirimi).
3. **Sims İhtiyaç Motoru & Kaka (💩) Mekaniği:**
   - Açlık, Eğlence, Sevgi, Uyku, Tuvalet, Temizlik, Sosyal (0-100 bar).
   - İhmal edildiğinde kaka yapar, temizlenmedikçe hijyen hızla düşer.
4. **Sosyal Çok Oyunculu Mini Oyunlar:**
   - **Taş-Kağıt-Makas:** 3-2-1 geri sayımlı gizli seçim ve eşzamanlı açılış.
   - **Kovboy Düellosu:** Gerilimli rastgele bekleme sonrası anlık `ATEŞ!` refleksi.
5. **Çağrı Cihazı (Pager) & Merkezi Sunucu:**
   - Her 30 sn'de bir merkezi sunucuya (`/api/v1/telemetry`) telemetri gönderir.
   - Diğer cihazlara/kullanıcılara 32 karakterlik retro çağrı mesajları iletir.
6. **Google / Apple Bulut Oturumu & Sıfırlama (Rebirth):**
   - Tek tıkla buluta yedekleme ve başka telefonda geri yükleme.
7. **GitHub OTA Otomatik Güncelleme:**
   - Uygulama açılışında en son commit veya release kontrolü yaparak APK güncellemesini sunar.

---

## 🚀 Çalıştırma

```bash
cd mobile_app
flutter pub get
flutter run
```
