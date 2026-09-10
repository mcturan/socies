# Socies - Mobil Öncelikli Strateji & GitHub Otomatik Güncelleme (OTA) Mimarisi

Bu belge, projenin **"Öncelikle Android Uygulaması Yapılması"**, fiziksel cihazın telefonda birebir simüle edilerek test edilmesi ve uygulamanın **GitHub commit / release sürümlerine göre kendini otomatik güncellemesi** mimarisini açıklar.

---

## 1. Neden Mobil Öncelikli (Phone-First) Yaklaşım?

1. **Sıfır Donanım Maliyetiyle Hızlı İterasyon:**
   - ESP32 devrelerini lehimlemeden ve 3D kutu basmadan önce tüm oyun mekanikleri (Top'un zıplaması, kaka yapma/temizleme, Taş-Kağıt-Makas mini oyunu, Sims ihtiyaç düşüşleri) doğrudan elde tutulan Android telefon üzerinde test edilir.
2. **Gerçek Sensörler ve Titreşim:**
   - Telefonun dahili ivmeölçeri (Accelerometer) sallama/zıplatma algılamasını doğrudan sağlar.
   - Telefonun lineer titreşim motoru (Haptic Feedback) gerçek bir cihaz hissi verir.
3. **Donanıma Birebir Geçiş Kolaylığı:**
   - Telefonda yazılan telemetri ve komut veri paketleri (Byte dizilimi), ileride ESP32'ye bağlanacak BLE GATT servisiyle %100 aynı yapıda tutulur.

---

## 2. GitHub Commit & Sürüm Kontrolü ile Otomatik Güncelleme (OTA)

Uygulama her açıldığında arka planda GitHub API'sine sorgu atarak en güncel sürümü kontrol eder:

```
[Android Uygulama Başlatıldı]
             |
             v
   GitHub API Sorgusu:
   GET https://api.github.com/repos/mcturan/socies/releases/latest
   veya https://api.github.com/repos/mcturan/socies/commits/main
             |
             +---> Yerel Commit SHA == Uzak Commit SHA?
             |         |
             |         +--[EVET]--> "Uygulama Güncel", Doğrudan Başla
             |
             +--[HAYIR / YENİ SÜRÜM]--> 
                       |
                       v
         Ekranda Pop-up Bildirimi:
         "Yeni bir Socies güncellemesi mevcut! (Commit: 9b57c46)"
         "Yenilikler: Yeni karakterler, Taş-Kağıt-Makas optimizasyonu"
                       |
                       v
         [Şimdi Güncelle] Butonu -> Arka Planda APK İndirilir
         ve Android PackageInstaller ile güncellenir.
```

### Versiyonlama Şeması:
- Format: `v1.0.<build_number>-<short_commit_hash>`
- Örnek: `v1.0.4-9a5187e`

---

## 3. Yeni Karakterler & Kaka (Poop) Mekaniği

1. **⚽ Top (Zıpzıp):**
   - Başlangıç evcil hayvanı. Ekranda yuvarlanır, köşelerden seker.
   - Cihaz sallandığında tavandan ve duvardan elastik fizik kurallarıyla seker.
2. **🌿 Bitki (Filiz):**
   - Saksıda büyüyen canlı. Tuvalet ihtiyacı yoktur (kaka yapmaz). Düzenli sulama ve sevgi ister.
3. **💩 Kaka (Poop) Mantığı:**
   - Tuvalet ihtiyacı %15'in altına düştüğünde veya yemekten bir süre sonra ekranda 💩 belirir.
   - Ekranda kaka varken temizlik ihtiyacı 3 kat daha hızlı düşer.
   - Cihazdan "TEMİZLE" veya telefondan "Ekranı Yıka" dendiğinde süpürülür ve evcil hayvan mutlu olur.
