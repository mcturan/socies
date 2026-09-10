import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:sensors_plus/sensors_plus.dart';
import '../engine/pet_state.dart';
import '../services/server_client.dart';
import '../services/github_updater.dart';
import 'oled_painter.dart';

class VirtualDeviceScreen extends StatefulWidget {
  final PetState petState;
  final ServerClient serverClient;

  const VirtualDeviceScreen({
    super.key,
    required this.petState,
    required this.serverClient,
  });

  @override
  State<VirtualDeviceScreen> createState() => _VirtualDeviceScreenState();
}

class _VirtualDeviceScreenState extends State<VirtualDeviceScreen> {
  StreamSubscription? _accelerometerSub;
  double _lastAccelMagnitude = 0.0;
  final TextEditingController _msgTargetCtrl = TextEditingController(text: 'SOCIES-ESP32-84920A');
  final TextEditingController _msgTextCtrl = TextEditingController(text: 'Selam! Parka gidelim mi?');
  final TextEditingController _emailCtrl = TextEditingController(text: 'turan@socies.io');

  @override
  void initState() {
    super.initState();
    _initShakeSensor();
    _initServerBackground();
  }

  void _initShakeSensor() {
    try {
      _accelerometerSub = accelerometerEventStream().listen((event) {
        final magnitude = (event.x * event.x + event.y * event.y + event.z * event.z);
        if (magnitude > 180 && (_lastAccelMagnitude - magnitude).abs() > 40) {
          widget.petState.onShakeSensor();
          HapticFeedback.mediumImpact();
        }
        _lastAccelMagnitude = magnitude;
      });
    } catch (_) {}
  }

  void _initServerBackground() {
    widget.serverClient.startBackgroundSync(widget.petState, (from, msg) {
      if (!widget.petState.soundMuted) {
        SystemSound.play(SystemSoundType.alert);
      }
      if (!widget.petState.vibroMuted) {
        HapticFeedback.vibrate();
      }
      widget.petState.unreadMessagesCount++;
      widget.petState.setDialogue("[$from]: $msg", 100);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text("📬 Yeni Çağrı Mesajı: [$from] $msg"),
          backgroundColor: const Color(0xFF00E5FF),
          behavior: SnackBarBehavior.floating,
        ),
      );
    });
  }

  @override
  void dispose() {
    _accelerometerSub?.cancel();
    _msgTargetCtrl.dispose();
    _msgTextCtrl.dispose();
    _emailCtrl.dispose();
    super.dispose();
  }

  // --- FİZİKSEL 4 DÜĞME İŞLEYİCİSİ ---
  // Tuş 1: UP
  void _onBtn1Short() {
    _hapticShort();
    if (widget.petState.gameMode == AppGameMode.rpsCountdown) {
      widget.petState.chooseRPS(RPSChoice.rock);
    } else if (widget.petState.gameMode == AppGameMode.duelFire) {
      widget.petState.onDuelButtonPress();
    } else {
      widget.petState.petAnimal();
    }
  }
  void _onBtn1Long() {
    _hapticLong();
    widget.petState.soundMuted = !widget.petState.soundMuted;
    widget.petState.setDialogue(widget.petState.soundMuted ? "Ses Kapatıldı 🔇" : "Ses Açıldı 🔊", 40);
  }

  // Tuş 2: SELECT
  void _onBtn2Short() {
    _hapticShort();
    if (widget.petState.gameMode == AppGameMode.rpsCountdown) {
      widget.petState.chooseRPS(RPSChoice.paper);
    } else if (widget.petState.gameMode == AppGameMode.duelFire || widget.petState.gameMode == AppGameMode.duelWait) {
      widget.petState.onDuelButtonPress();
    } else {
      widget.petState.feed();
    }
  }
  void _onBtn2Long() {
    _hapticLong();
    widget.petState.bleConnected = !widget.petState.bleConnected;
    widget.petState.setDialogue(widget.petState.bleConnected ? "BLE: Eşleşti ᛒ" : "BLE: Eşleşme Modu...", 50);
  }

  // Tuş 3: DOWN
  void _onBtn3Short() {
    _hapticShort();
    if (widget.petState.gameMode == AppGameMode.rpsCountdown) {
      widget.petState.chooseRPS(RPSChoice.scissors);
    } else {
      widget.petState.cleanToilet();
    }
  }
  void _onBtn3Long() {
    _hapticLong();
    widget.petState.vibroMuted = !widget.petState.vibroMuted;
    widget.petState.setDialogue(widget.petState.vibroMuted ? "Titreşim Kapatıldı 📳" : "Titreşim Açık 📳", 40);
  }

  // Tuş 4: BACK
  void _onBtn4Short() {
    _hapticShort();
    if (widget.petState.gameMode != AppGameMode.normal) {
      widget.petState.gameMode = AppGameMode.normal;
    } else {
      widget.petState.toggleSleep();
    }
  }
  void _onBtn4Long() {
    _hapticLong();
    widget.petState.toggleNeedsHud();
  }

  void _hapticShort() {
    if (!widget.petState.vibroMuted) HapticFeedback.lightImpact();
    if (!widget.petState.soundMuted) SystemSound.play(SystemSoundType.click);
  }

  void _hapticLong() {
    if (!widget.petState.vibroMuted) HapticFeedback.heavyImpact();
    if (!widget.petState.soundMuted) SystemSound.play(SystemSoundType.alert);
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.petState,
      builder: (context, _) {
        return Scaffold(
          backgroundColor: const Color(0xFF070A12),
          appBar: AppBar(
            backgroundColor: const Color(0xFF0B101D),
            elevation: 0,
            title: Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: const Color(0xFF00E5FF).withOpacity(0.15),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: const Color(0xFF00E5FF).withOpacity(0.4)),
                  ),
                  child: const Text(
                    "SOCIES v1.0.4",
                    style: TextStyle(fontFamily: 'monospace', fontSize: 13, fontWeight: FontWeight.bold, color: Color(0xFF00E5FF)),
                  ),
                ),
                const SizedBox(width: 10),
                Text(
                  "Skor: ${widget.petState.score} P",
                  style: const TextStyle(fontSize: 13, color: Color(0xFFFFD700), fontWeight: FontWeight.w600),
                ),
              ],
            ),
            actions: [
              IconButton(
                icon: const Icon(Icons.sync_rounded, color: Color(0xFF00E5FF)),
                tooltip: "Sunucu ve OTA Kontrolü",
                onPressed: _showSyncDialog,
              ),
              IconButton(
                icon: const Icon(Icons.cloud_upload_outlined, color: Colors.white70),
                tooltip: "Bulut Hesabı",
                onPressed: _showCloudDialog,
              ),
            ],
          ),
          body: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // 1. FİZİKSEL CİHAZ KUTUSU (SOL EKRAN + SAĞ 4 DİKEY TUŞ)
                _buildHandheldDeviceCase(),

                const SizedBox(height: 18),

                // 2. KULLANICI KONTROL & TEST ÇUBUĞU
                _buildQuickActionDeck(),

                const SizedBox(height: 18),

                // 3. SOSYAL ÇAĞRI (PAGER) & MİNİ OYUNLAR KARTI
                _buildSocialHubCard(),
              ],
            ),
          ),
        );
      },
    );
  }

  // --- CİHAZ GÖVDESİ MİMARİSİ (SOL: EKRAN, SAĞ: 4 DİKEY DÜĞME) ---
  Widget _buildHandheldDeviceCase() {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF131B2E),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFF27354F), width: 3),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.6),
            blurRadius: 20,
            offset: const Offset(0, 10),
          ),
          BoxShadow(
            color: const Color(0xFF00E5FF).withOpacity(0.08),
            blurRadius: 30,
            spreadRadius: -5,
          ),
        ],
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          // Üst Logo & Güç LED'i
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  Icon(Icons.sports_esports, color: Color(0xFF00E5FF), size: 16),
                  SizedBox(width: 6),
                  Text(
                    "SOCIES HARDWARE EMULATOR",
                    style: TextStyle(color: Colors.white54, fontSize: 10, letterSpacing: 1.2, fontWeight: FontWeight.w800),
                  ),
                ],
              ),
              Row(
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: widget.petState.bleConnected ? const Color(0xFF00FF66) : const Color(0xFFFF9900),
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: (widget.petState.bleConnected ? const Color(0xFF00FF66) : const Color(0xFFFF9900)).withOpacity(0.8),
                          blurRadius: 6,
                          spreadRadius: 2,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    widget.petState.bleConnected ? "BLE BAĞLI" : "STANDBY",
                    style: const TextStyle(color: Colors.white38, fontSize: 9, fontFamily: 'monospace'),
                  ),
                ],
              ),
            ],
          ),

          const SizedBox(height: 14),

          // ANA GÖVDE: SOLDA EKRAN, SAĞDA 4 DİKEY TUŞ
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              // SOL: 128x64 OLED EKRAN (2:1 oranı)
              Expanded(
                flex: 7,
                child: Container(
                  decoration: BoxDecoration(
                    color: Colors.black,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFF0A0F1A), width: 6),
                    boxShadow: [
                      BoxShadow(color: Colors.black.withOpacity(0.8), blurRadius: 8, inset: true),
                    ],
                  ),
                  child: AspectRatio(
                    aspectRatio: 128 / 64,
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(6),
                      child: CustomPaint(
                        painter: OledPainter(state: widget.petState),
                      ),
                    ),
                  ),
                ),
              ),

              const SizedBox(width: 14),

              // SAĞ: DİKEY SIRALANMIŞ 4 ADET FİZİKSEL DÜĞME
              Expanded(
                flex: 3,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    _buildPhysicalButton(
                      num: 1,
                      label: "YUKARI / SES",
                      color: const Color(0xFF38BDF8),
                      icon: Icons.keyboard_arrow_up,
                      onShort: _onBtn1Short,
                      onLong: _onBtn1Long,
                    ),
                    const SizedBox(height: 8),
                    _buildPhysicalButton(
                      num: 2,
                      label: "SEÇ / BLE",
                      color: const Color(0xFF22C55E),
                      icon: Icons.radio_button_checked,
                      onShort: _onBtn2Short,
                      onLong: _onBtn2Long,
                    ),
                    const SizedBox(height: 8),
                    _buildPhysicalButton(
                      num: 3,
                      label: "AŞAĞI / TİTR.",
                      color: const Color(0xFFA855F7),
                      icon: Icons.keyboard_arrow_down,
                      onShort: _onBtn3Short,
                      onLong: _onBtn3Long,
                    ),
                    const SizedBox(height: 8),
                    _buildPhysicalButton(
                      num: 4,
                      label: "GERİ / HUD",
                      color: const Color(0xFFF43F5E),
                      icon: Icons.undo,
                      onShort: _onBtn4Short,
                      onLong: _onBtn4Long,
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 12),
          const Text(
            "Tuşlara Kısa Bas: Oyun / Aksiyon  |  Uzun Bas (600ms): Ayarlar & HUD",
            style: TextStyle(color: Colors.white38, fontSize: 9),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  // Özel Dokunsal Buton Bileşeni
  Widget _buildPhysicalButton({
    required int num,
    required String label,
    required Color color,
    required IconData icon,
    required VoidCallback onShort,
    required VoidCallback onLong,
  }) {
    return GestureDetector(
      onTap: onShort,
      onLongPress: onLong,
      child: Container(
        height: 40,
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              color.withOpacity(0.35),
              color.withOpacity(0.12),
            ],
          ),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: color.withOpacity(0.7), width: 1.5),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.4),
              offset: const Offset(0, 3),
              blurRadius: 4,
            ),
          ],
        ),
        padding: const EdgeInsets.symmetric(horizontal: 6),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: color, size: 16),
            const SizedBox(width: 4),
            Expanded(
              child: Text(
                "T$num",
                style: TextStyle(
                  color: Colors.white.withOpacity(0.9),
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  fontFamily: 'monospace',
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // --- HIZLI EYLEM GÜVERTESİ (SALLA, KARAKTER, BESLE) ---
  Widget _buildQuickActionDeck() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF0F172A),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFF1E293B)),
      ),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        alignment: WrapAlignment.center,
        children: [
          // Telefonu Salla Testi (SW-420 Titreşim Sensörü Tetikleyicisi)
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF2563EB),
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            icon: const Icon(Icons.vibration, size: 16),
            label: const Text("Cihazı Salla (SW-420)", style: TextStyle(fontSize: 11)),
            onPressed: () {
              widget.petState.onShakeSensor();
              _hapticLong();
            },
          ),
          // Karakter Değiştir Test Butonu
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              foregroundColor: const Color(0xFF00E5FF),
              side: const BorderSide(color: Color(0xFF00E5FF)),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            icon: const Icon(Icons.pets, size: 16),
            label: Text("Karakter: ${widget.petState.breed.name.toUpperCase()}", style: const TextStyle(fontSize: 11)),
            onPressed: widget.petState.cycleBreed,
          ),
          // Besle
          IconButton.filledTonal(
            icon: const Icon(Icons.restaurant, size: 18),
            tooltip: "Besle (Elma)",
            onPressed: widget.petState.feed,
          ),
          // Kaka Temizle
          IconButton.filledTonal(
            icon: const Icon(Icons.cleaning_services, size: 18),
            tooltip: "Kaka Temizle",
            onPressed: widget.petState.cleanToilet,
          ),
          // Uyku / Uyan
          IconButton.filledTonal(
            icon: Icon(widget.petState.isSleeping ? Icons.wb_sunny : Icons.nightlight_round, size: 18),
            tooltip: "Uyku Modu Geçişi",
            onPressed: widget.petState.toggleSleep,
          ),
        ],
      ),
    );
  }

  // --- SOSYAL MERKEZ (ÇEVRİMİÇİ DÜELLO, TAŞ-KAĞIT-MAKAS, ÇAĞRI CİHAZI) ---
  Widget _buildSocialHubCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF0F172A),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFF1E293B)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.hub_outlined, color: Color(0xFF00E5FF), size: 18),
              SizedBox(width: 8),
              Text(
                "SOSYAL MERKEZ & OYUNLAR",
                style: TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold, letterSpacing: 0.8),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Mini Oyun Butonları
          Row(
            children: [
              Expanded(
                child: ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF4338CA),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  icon: const Icon(Icons.front_hand, size: 16),
                  label: const Text("Taş-Kağıt-Makas", style: TextStyle(fontSize: 11)),
                  onPressed: widget.petState.startRPS,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFB45309),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  icon: const Icon(Icons.flash_on, size: 16),
                  label: const Text("Kovboy Düellosu", style: TextStyle(fontSize: 11)),
                  onPressed: widget.petState.startDuel,
                ),
              ),
            ],
          ),

          const SizedBox(height: 16),
          const Divider(color: Color(0xFF1E293B)),
          const SizedBox(height: 10),

          // Çağrı Cihazı (Pager) Mesaj Gönderim Bölümü
          const Text(
            "📟 ÇAĞRI CİHAZI (PAGER) İLE MESAJ GÖNDER",
            style: TextStyle(color: Colors.white70, fontSize: 11, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _msgTargetCtrl,
            style: const TextStyle(color: Colors.white, fontSize: 12, fontFamily: 'monospace'),
            decoration: InputDecoration(
              labelText: "Hedef Cihaz ID veya Arkadaş MAC",
              labelStyle: const TextStyle(color: Colors.white54, fontSize: 11),
              filled: true,
              fillColor: const Color(0xFF1E293B),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
              contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            ),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _msgTextCtrl,
                  maxLength: 32,
                  style: const TextStyle(color: Colors.white, fontSize: 12),
                  decoration: InputDecoration(
                    labelText: "Mesaj (Maks 32 Karakter)",
                    labelStyle: const TextStyle(color: Colors.white54, fontSize: 11),
                    filled: true,
                    fillColor: const Color(0xFF1E293B),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    counterStyle: const TextStyle(color: Colors.white38, fontSize: 9),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF00E5FF),
                  foregroundColor: Colors.black,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                ),
                onPressed: _sendPagerMessage,
                child: const Text("GÖNDER", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 11)),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // Çağrı Mesajı Gönderme Eylemi
  Future<void> _sendPagerMessage() async {
    final target = _msgTargetCtrl.text.trim();
    final text = _msgTextCtrl.text.trim();
    if (target.isEmpty || text.isEmpty) return;

    final result = await widget.serverClient.sendPagerMessage(
      targetDeviceId: target,
      messageText: text,
    );

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(result['status'] == 'DELIVERED_TO_ONLINE_DEVICE'
              ? "✨ Mesaj hedefe anında iletildi!"
              : "📬 Hedef kapalı, sunucu kuyruğuna alındı."),
          backgroundColor: const Color(0xFF00E5FF),
        ),
      );
    }
  }

  // Bulut Diyaloğu (Yedekle / Geri Yükle / Rebirth)
  void _showCloudDialog() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF0F172A),
        title: const Text("☁️ Bulut Oturumu & Sıfırlama", style: TextStyle(color: Colors.white, fontSize: 15)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _emailCtrl,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(
                labelText: "Google / Apple / E-posta",
                labelStyle: TextStyle(color: Colors.white54),
              ),
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF2563EB), minimumSize: const Size.fromHeight(38)),
              icon: const Icon(Icons.cloud_upload, size: 16),
              label: const Text("Buluta Yedekle"),
              onPressed: () async {
                final ok = await widget.serverClient.cloudBackup(widget.petState);
                if (mounted) {
                  Navigator.pop(ctx);
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(ok ? "Buluta başarıyla kaydedildi!" : "Sunucuya bağlanılamadı")),
                  );
                }
              },
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(foregroundColor: const Color(0xFF00E5FF), minimumSize: const Size.fromHeight(38)),
              icon: const Icon(Icons.cloud_download, size: 16),
              label: const Text("Buluttan Geri Yükle"),
              onPressed: () async {
                final backup = await widget.serverClient.cloudRestore(_emailCtrl.text.trim());
                if (backup != null && mounted) {
                  widget.petState.score = backup['totalScore'] ?? widget.petState.score;
                  widget.petState.streakDays = backup['streakDays'] ?? widget.petState.streakDays;
                  Navigator.pop(ctx);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text("Oturum buluttan başarıyla geri yüklendi!")),
                  );
                }
              },
            ),
            const SizedBox(height: 12),
            TextButton.icon(
              style: TextButton.styleFrom(foregroundColor: const Color(0xFFFF5555)),
              icon: const Icon(Icons.restart_alt, size: 16),
              label: const Text("Sıfırdan Başla (Rebirth)"),
              onPressed: () {
                widget.petState.rebirth();
                Navigator.pop(ctx);
              },
            ),
          ],
        ),
      ),
    );
  }

  // Senkronizasyon & OTA Kontrol Diyaloğu
  void _showSyncDialog() async {
    final info = await widget.serverClient.checkUpdates();
    if (!mounted) return;

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF0F172A),
        title: const Text("🔄 Güncelleme & Sunucu Durumu", style: TextStyle(color: Colors.white, fontSize: 15)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text("Mevcut Sürüm: v1.0.4", style: TextStyle(color: Colors.white70, fontSize: 12)),
            const SizedBox(height: 4),
            Text("Sunucu Hedef: ${info?['latestVersion'] ?? 'Kontrol ediliyor...'}", style: const TextStyle(color: Color(0xFF00E5FF), fontSize: 12)),
            const SizedBox(height: 8),
            Text("Notlar: ${info?['releaseNotes'] ?? 'En güncel sürümdesiniz.'}", style: const TextStyle(color: Colors.white54, fontSize: 11)),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text("Kapat", style: TextStyle(color: Colors.white54)),
          ),
        ],
      ),
    );
  }
}
