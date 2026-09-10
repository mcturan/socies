# Socies V4 - Mobil Öncelikli Strateji, Bulut Mimarisi & Bağlılık Rehberi

Bu belge, Socies ekosisteminin **Android öncelikli geliştirme planını**, **sunucu telemetri protokolünü**, **Google/Apple bulut oturum geri yüklemesini** ve **kullanıcı bağlılığını (retention) artıran oyun mekaniklerini** tanımlar.

---

## 1. Ana Sunucu Telemetri & Cihaz Kaydı (API)

Cihaz internete/sunucuya her bağlandığında arka planda `POST /api/v1/telemetry` uç noktasına aşağıdaki JSON paketini iletir. Bu veri hem bulut yedeklemesini hem de ilerideki etkinlik/reklam analizlerini besler:

```json
{
  "device_id": "SOCIES-ESP32-84920A",
  "hardware_mac": "A4:CF:12:89:34:B1",
  "user_account": {
    "provider": "google",
    "user_id": "usr_9482019482",
    "email": "turan@socies.io"
  },
  "pet_state": {
    "breed": "top",
    "stage": 1,
    "age_days": 1,
    "total_score": 310,
    "streak_days": 5
  },
  "sims_needs": {
    "hunger": 85,
    "fun": 80,
    "love": 90,
    "sleep": 75,
    "toilet": 85,
    "clean": 90,
    "social": 60
  },
  "device_metrics": {
    "battery_voltage_mv": 3980,
    "battery_percent": 88,
    "total_steps": 1420,
    "firmware_version": "v1.0.4-76a84a1"
  },
  "analytics_ad_profile": {
    "daily_active_seconds": 1840,
    "ads_eligible": true,
    "last_sync_timestamp": "2026-09-10T23:50:00Z"
  }
}
```

---

## 2. Çoklu Cihaz Bulut Oturumu & Sıfırdan Başlama (Rebirth)

1. **Yeni Cihazda Oturum Geri Yükleme:**
   - Kullanıcı telefonunu değiştirdiğinde Google veya Apple ID ile giriş yaptığı anda buluttaki en güncel kayıt çekilir. Puanlar, seriler ve evcil hayvan kaldığı yerden devam eder.
2. **Sıfırdan Başlama (Rebirth / Factory Reset):**
   - Kullanıcı istediğinde mevcut canlının mirasını (Rozetler ve Skor) müzeye kaldırıp yeni bir yumurtadan sıfırdan başlama seçeneğine sahiptir.

---

## 3. Sosyal Mini Oyunlar

### ✊ 1. Taş - Kağıt - Makas (3-2-1 Geri Sayımlı & Eşzamanlı Açılış)
- Cihaz ekranda **3... 2... 1...** diye geri sayar.
- Geri sayım bitene kadar her iki taraf da tuşlarla seçimini gizlice kilitler:
  - `Tuş 1:` Taş 🪨 | `Tuş 2:` Kağıt 📄 | `Tuş 3:` Makas ✂️
- "AÇ!" dendiğinde iki el aynı milisaniyede ekranda açılır (`Sen: 🪨` vs `Rakip: ✂️`).
- Kazanan haptik titreşim ve zafer melodisiyle ödüllendirilir (+35 Puan).

### 🤠 2. Hızlı Çekim Kovboy Düellosu (Quick Draw Duel)
- İki evcil hayvan kovboy şapkası takıp karşı karşıya gelir.
- Ekranda **"HAZIRLAN..."** yazar. Rastgele bir gerilim süresi (2 ila 4.5 saniye) beklenir.
- Aniden cihaz titrer, ıslık çalar ve ekranda dev harflerle **"ATEŞ! (●)"** çıkar!
- Seç butonuna ilk basan düelloyu kazanır (Reaksiyon süresi ms cinsinden ekranda gösterilir).

---

## 4. Kullanıcı Bağlılığını (Retention) Artıran 6 Stratejik Mekanik

1. **🔥 Günlük Sadakat Serisi (Daily Streak):**
   - Her gün en az 1 kez ilgilenen kullanıcı serisini korur. 7. günde Altın Taç 👑, 30. günde Kozaya Geçiş Kristali kazanır.
2. **🌙 Birlikte Uyuma (Sleep Sync):**
   - Telefon şarja konduğunda bebek de takkesini takıp uyur; sabah telefon alarmıyla birlikte cıvıldayarak sahibini uyandırır.
3. **🌦️ Gerçek Hava Durumu Senkronizasyonu:**
   - Dışarıda yağmur yağıyorsa ekranda bebek minik yaprak şemsiyesi açar.
4. **📸 Piksel Polaroid Hatıra Defteri:**
   - Bebek evrimleştikçe veya 30. gününü tamamladıkça albüme 1-bit nostaljik Polaroid fotoğraflar kaydeder.
5. **🎒 Arkadaş Kreşi (Playdate / Tatil Modu):**
   - Tatile çıkarken veya sınav haftasında bebeği BLE ile arkadaşın cihazına "emanet" edebilme.
6. **🎁 3.000 Adımda Hazine Sandığı Düşmesi:**
   - Günlük 3.000 adım tamamlandığında gökten sürpriz sandık düşer.
