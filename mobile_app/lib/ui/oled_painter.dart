import 'dart:math';
import 'package:flutter/material.dart';
import '../engine/pet_state.dart';

class OledPainter extends CustomPainter {
  final PetState state;

  OledPainter({required this.state});

  static const Color yellowColor = Color(0xFFFFD700);
  static const Color blueColor = Color(0xFF00E5FF);
  static const Color blackColor = Color(0xFF040608);

  @override
  void paint(Canvas canvas, Size size) {
    // 128 x 64 koordinat sistemine normalize et
    final scaleX = size.width / 128.0;
    final scaleY = size.height / 64.0;
    canvas.scale(scaleX, scaleY);

    // OLED Siyah Arka Plan
    final bgPaint = Paint()..color = blackColor..style = PaintingStyle.fill;
    canvas.drawRect(const Rect.fromLTWH(0, 0, 128, 64), bgPaint);

    // 1. ÜST 16 PIXEL: SARI TELEFON DURUM ÇUBUĞU (STATUS BAR)
    _drawYellowStatusBar(canvas);

    // İki bölge arasındaki ayırıcı çizgi
    final divPaint = Paint()
      ..color = const Color(0xFF1E293B)
      ..strokeWidth = 1.0;
    canvas.drawLine(const Offset(0, 16), const Offset(128, 16), divPaint);

    // 2. ALT 48 PIXEL: MAVİ OYUN ALANI (16 .. 64)
    canvas.save();
    canvas.clipRect(const Rect.fromLTWH(0, 16, 128, 48));

    switch (state.gameMode) {
      case AppGameMode.normal:
        _drawNormalMode(canvas);
        break;
      case AppGameMode.rpsCountdown:
        _drawRpsCountdown(canvas);
        break;
      case AppGameMode.rpsResult:
        _drawRpsResult(canvas);
        break;
      case AppGameMode.duelWait:
        _drawDuelWait(canvas);
        break;
      case AppGameMode.duelFire:
        _drawDuelFire(canvas);
        break;
      case AppGameMode.duelResult:
        _drawDuelResult(canvas);
        break;
      case AppGameMode.needsHud:
        _drawNeedsHud(canvas);
        break;
    }

    canvas.restore();
  }

  // --- SARI DURUM ÇUBUĞU (TELEFON SİMGELERİ) ---
  void _drawYellowStatusBar(Canvas canvas) {
    final p = Paint()..color = yellowColor..style = PaintingStyle.fill;
    final strokeP = Paint()..color = yellowColor..style = PaintingStyle.stroke..strokeWidth = 1.0;

    // Saat (Sol taraf: 12:45)
    final now = DateTime.now();
    final timeStr = "${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}";
    _drawText(canvas, timeStr, 4, 3, yellowColor, fontSize: 8);

    // Bluetooth Rünü (x: 42)
    if (state.bleConnected) {
      canvas.drawLine(const Offset(45, 3), const Offset(45, 12), strokeP);
      canvas.drawLine(const Offset(45, 7), const Offset(48, 4), strokeP);
      canvas.drawLine(const Offset(48, 4), const Offset(45, 12), strokeP);
      canvas.drawLine(const Offset(45, 3), const Offset(48, 10), strokeP);
      canvas.drawLine(const Offset(48, 10), const Offset(45, 7), strokeP);
    }

    // Ses Simgesi (Hoparlör & Dalga/Çizgi) (x: 54)
    canvas.drawRect(const Rect.fromLTWH(54, 6, 2, 4), p); // Gövde
    final conePath = Path()..moveTo(56, 6)..lineTo(59, 3)..lineTo(59, 13)..lineTo(56, 10)..close();
    canvas.drawPath(conePath, p);
    if (state.soundMuted) {
      canvas.drawLine(const Offset(53, 3), const Offset(62, 13), strokeP);
    } else {
      // Ses dalgası arkı
      canvas.drawArc(const Rect.fromLTWH(58, 4, 4, 8), -pi / 3, 2 * pi / 3, false, strokeP);
    }

    // Titreşim Simgesi (Telefon & Yan Dalgalar) (x: 68)
    canvas.drawRect(const Rect.fromLTWH(69, 4, 5, 8), strokeP);
    if (!state.vibroMuted) {
      canvas.drawLine(const Offset(66, 6), const Offset(67, 8), strokeP);
      canvas.drawLine(const Offset(67, 8), const Offset(66, 10), strokeP);
      canvas.drawLine(const Offset(76, 6), const Offset(75, 8), strokeP);
      canvas.drawLine(const Offset(75, 8), const Offset(76, 10), strokeP);
    }

    // Gece Modu / Hilal Ay (x: 82)
    if (state.isSleeping) {
      canvas.drawCircle(const Offset(84, 8), 3.5, p);
      final cutP = Paint()..color = blackColor..style = PaintingStyle.fill;
      canvas.drawCircle(const Offset(82.5, 7), 3.0, cutP);
    }

    // Çağrı Cihazı / Mektup (x: 94)
    canvas.drawRect(const Rect.fromLTWH(93, 4, 9, 7), strokeP);
    canvas.drawLine(const Offset(93, 4), const Offset(97, 8), strokeP);
    canvas.drawLine(const Offset(97, 8), const Offset(102, 4), strokeP);
    if (state.unreadMessagesCount > 0) {
      canvas.drawCircle(const Offset(103, 3), 1.5, Paint()..color = const Color(0xFFFF3366));
    }

    // Pil Simgesi (Sağ köşe: x: 108..124)
    canvas.drawRect(const Rect.fromLTWH(108, 4, 14, 7), strokeP);
    canvas.drawRect(const Rect.fromLTWH(122, 6, 2, 3), p); // Pil ucu nub
    final fillBlocks = ((state.batteryPct / 100.0) * 4).round();
    for (int i = 0; i < fillBlocks; i++) {
      canvas.drawRect(Rect.fromLTWH(110 + (i * 2.5), 5.5, 2, 4), p);
    }
  }

  // --- MAVİ OYUN ALANI: NORMAL OYUN MODU ---
  void _drawNormalMode(Canvas canvas) {
    final p = Paint()..color = blueColor..style = PaintingStyle.fill;

    // Kaka Varsa Çiz
    if (state.hasPoop) {
      _drawPoop(canvas, state.poopX, state.poopY);
    }

    // Evcil Hayvanı Çiz
    if (state.breed == PetBreed.top) {
      _drawBouncyBall(canvas);
    } else {
      _drawPixelBreed(canvas, state.breed);
    }

    // Uyku Efekti
    if (state.isSleeping) {
      _drawText(canvas, "Zzz...", state.ballX + 10, state.ballY - 14, blueColor, fontSize: 8);
    }

    // Konuşma Baloncuğu
    if (state.activeDialogue.isNotEmpty) {
      _drawSpeechBubble(canvas, state.activeDialogue, 8, 19);
    }
  }

  // Zıpzıp Top Çizimi (Ezilme/Esnek Elastik Fizik)
  void _drawBouncyBall(Canvas canvas) {
    final p = Paint()..color = blueColor..style = PaintingStyle.fill;
    final strokeP = Paint()..color = const Color(0xFFFFFFFF)..style = PaintingStyle.stroke..strokeWidth = 1.0;

    canvas.save();
    canvas.translate(state.ballX, state.ballY);
    canvas.scale(state.ballSquashX, state.ballSquashY);

    // Ana Top Küresi
    canvas.drawCircle(Offset.zero, 9.0, p);
    
    // Işık Yansıması (Highlight)
    final hlPaint = Paint()..color = const Color(0xFFFFFFFF)..style = PaintingStyle.fill;
    canvas.drawCircle(const Offset(-3, -3), 2.0, hlPaint);

    // Şirin Gözler
    final eyePaint = Paint()..color = blackColor..style = PaintingStyle.fill;
    if (state.isSleeping) {
      // Kapalı gözler (çizgi)
      final eyeStroke = Paint()..color = blackColor..style = PaintingStyle.stroke..strokeWidth = 1.0;
      canvas.drawLine(const Offset(-4, 0), const Offset(-1, 0), eyeStroke);
      canvas.drawLine(const Offset(2, 0), const Offset(5, 0), eyeStroke);
    } else {
      canvas.drawCircle(const Offset(-2.5, 0), 1.2, eyePaint);
      canvas.drawCircle(const Offset(3.5, 0), 1.2, eyePaint);
      // Şirin Gülümseme
      final mouthPath = Path()..arcTo(const Rect.fromLTWH(-1, 1, 3, 3), 0, pi, false);
      canvas.drawPath(mouthPath, Paint()..color = blackColor..style = PaintingStyle.stroke..strokeWidth = 0.8);
    }

    canvas.restore();
  }

  // Diğer Karakterler için Retro Piksel Çizimi
  void _drawPixelBreed(Canvas canvas, PetBreed breed) {
    final p = Paint()..color = blueColor..style = PaintingStyle.fill;
    final cx = state.ballX;
    final cy = 40.0;

    switch (breed) {
      case PetBreed.kedi:
        // Kedi Gövdesi ve Kulakları
        canvas.drawRect(Rect.fromLTWH(cx - 8, cy - 8, 16, 12), p);
        // Kulaklar
        final earPath = Path()
          ..moveTo(cx - 8, cy - 8)..lineTo(cx - 5, cy - 14)..lineTo(cx - 2, cy - 8)
          ..moveTo(cx + 2, cy - 8)..lineTo(cx + 5, cy - 14)..lineTo(cx + 8, cy - 8);
        canvas.drawPath(earPath, p);
        // Kuyruk
        canvas.drawLine(Offset(cx + 8, cy), Offset(cx + 14, cy - 6), Paint()..color = blueColor..strokeWidth = 2);
        break;

      case PetBreed.kopek:
        // Köpek Gövdesi ve Sarkık Kulaklar
        canvas.drawRect(Rect.fromLTWH(cx - 9, cy - 7, 18, 13), p);
        canvas.drawRect(Rect.fromLTWH(cx - 11, cy - 6, 3, 8), p); // Sol kulak
        canvas.drawRect(Rect.fromLTWH(cx + 8, cy - 6, 3, 8), p);  // Sağ kulak
        // Burun
        canvas.drawCircle(Offset(cx, cy - 1), 1.5, Paint()..color = blackColor);
        break;

      case PetBreed.bitki:
        // Saksı ve Yapraklar (Asla kaka yapmaz!)
        canvas.drawRect(Rect.fromLTWH(cx - 6, cy - 2, 12, 10), p); // Saksı
        canvas.drawLine(Offset(cx, cy - 2), Offset(cx, cy - 12), Paint()..color = blueColor..strokeWidth = 2);
        canvas.drawOval(Rect.fromLTWH(cx - 7, cy - 12, 6, 4), p); // Sol yaprak
        canvas.drawOval(Rect.fromLTWH(cx + 1, cy - 14, 6, 4), p); // Sağ yaprak
        break;

      case PetBreed.sosis:
        // Uzun Tombul Sosis Köpek
        canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(cx - 14, cy - 6, 28, 10), const Radius.circular(5)), p);
        canvas.drawRect(Rect.fromLTWH(cx - 12, cy + 4, 3, 4), p); // Ön bacak
        canvas.drawRect(Rect.fromLTWH(cx + 9, cy + 4, 3, 4), p);  // Arka bacak
        break;

      default:
        canvas.drawCircle(Offset(cx, cy), 8, p);
    }
  }

  // Kaka Çizimi (💩)
  void _drawPoop(Canvas canvas, double x, double y) {
    final p = Paint()..color = const Color(0xFFFF9900)..style = PaintingStyle.fill;
    // Alt katman
    canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(x, y + 6, 12, 4), const Radius.circular(2)), p);
    // Orta katman
    canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(x + 2, y + 2, 8, 4), const Radius.circular(2)), p);
    // Tepe kıvrımı
    canvas.drawCircle(Offset(x + 5, y + 1), 2.0, p);
    // Koku çizgileri (dalgalı buhar)
    final steamP = Paint()..color = const Color(0xFF888888)..style = PaintingStyle.stroke..strokeWidth = 0.8;
    canvas.drawLine(Offset(x + 3, y - 2), Offset(x + 4, y - 5), steamP);
    canvas.drawLine(Offset(x + 8, y - 2), Offset(x + 7, y - 5), steamP);
  }

  // Konuşma Baloncuğu
  void _drawSpeechBubble(Canvas canvas, String text, double x, double y) {
    final bg = Paint()..color = const Color(0xFF0F172A)..style = PaintingStyle.fill;
    final border = Paint()..color = blueColor..style = PaintingStyle.stroke..strokeWidth = 1.0;
    
    final rrect = RRect.fromRectAndRadius(Rect.fromLTWH(x, y, 112, 12), const Radius.circular(3));
    canvas.drawRRect(rrect, bg);
    canvas.drawRRect(rrect, border);
    _drawText(canvas, text, x + 4, y + 2, const Color(0xFFF8FAFC), fontSize: 7);
  }

  // --- MİNİ OYUN: TAŞ-KAĞIT-MAKAS ---
  void _drawRpsCountdown(Canvas canvas) {
    _drawText(canvas, "TAŞ - KAĞIT - MAKAS", 16, 20, yellowColor, fontSize: 8);
    _drawText(canvas, "${state.rpsCountdownSec}", 58, 32, blueColor, fontSize: 16);
    
    final choiceStr = state.playerRpsChoice == RPSChoice.rock ? "TAŞ 🪨" :
                      state.playerRpsChoice == RPSChoice.paper ? "KAĞIT 📄" :
                      state.playerRpsChoice == RPSChoice.scissors ? "MAKAS ✂️" : "Tuşlarla Seç!";
    _drawText(canvas, "Seçimin: $choiceStr", 22, 52, const Color(0xFFFFFFFF), fontSize: 7);
  }

  void _drawRpsResult(Canvas canvas) {
    _drawText(canvas, state.rpsResultText, 20, 20, yellowColor, fontSize: 9);
    final pStr = state.playerRpsChoice.name.toUpperCase();
    final oStr = state.opponentRpsChoice.name.toUpperCase();
    _drawText(canvas, "SEN: $pStr  |  RAKİP: $oStr", 10, 36, blueColor, fontSize: 8);
  }

  // --- MİNİ OYUN: KOVBOY DÜELLOSU ---
  void _drawDuelWait(Canvas canvas) {
    _drawText(canvas, "KOVBOY DÜELLOSU", 24, 20, yellowColor, fontSize: 8);
    _drawText(canvas, "HAZIRLAN...", 38, 36, const Color(0xFFFF5555), fontSize: 9);
    // İki kovboy silüeti
    final p = Paint()..color = blueColor..style = PaintingStyle.fill;
    canvas.drawRect(const Rect.fromLTWH(18, 42, 10, 14), p); // Kovboy 1
    canvas.drawRect(const Rect.fromLTWH(100, 42, 10, 14), p); // Kovboy 2
  }

  void _drawDuelFire(Canvas canvas) {
    // Ekran flaşı
    canvas.drawRect(const Rect.fromLTWH(0, 16, 128, 48), Paint()..color = const Color(0xFFFFEE00));
    _drawText(canvas, "ATEŞ! (●)", 32, 30, blackColor, fontSize: 14);
  }

  void _drawDuelResult(Canvas canvas) {
    _drawText(canvas, state.duelWon ? "KAZANDIN! 🤠" : "KAYBETTİN! 💥", 28, 22, yellowColor, fontSize: 9);
    _drawText(canvas, "Süre: ${state.duelReactionMs} ms", 36, 38, blueColor, fontSize: 8);
  }

  // --- SİMS İHTİYAÇLAR HUD EKRANI ---
  void _drawNeedsHud(Canvas canvas) {
    _drawText(canvas, "DURUM & İHTİYAÇLAR", 16, 18, yellowColor, fontSize: 8);

    _drawBar(canvas, "AÇLIK", state.hunger, 8, 28);
    _drawBar(canvas, "EĞLENCE", state.fun, 68, 28);
    _drawBar(canvas, "SEVGİ", state.love, 8, 36);
    _drawBar(canvas, "UYKU", state.sleep, 68, 36);
    _drawBar(canvas, "TUVALET", state.toilet, 8, 44);
    _drawBar(canvas, "TEMİZLİK", state.clean, 68, 44);
    _drawBar(canvas, "SOSYAL", state.social, 8, 52);
  }

  void _drawBar(Canvas canvas, String label, double val, double x, double y) {
    _drawText(canvas, label, x, y, const Color(0xFF94A3B8), fontSize: 6);
    final border = Paint()..color = blueColor..style = PaintingStyle.stroke..strokeWidth = 0.8;
    final fill = Paint()..color = blueColor..style = PaintingStyle.fill;
    
    canvas.drawRect(Rect.fromLTWH(x + 28, y, 24, 5), border);
    final fillW = (val / 100.0 * 24).clamp(0.0, 24.0);
    canvas.drawRect(Rect.fromLTWH(x + 28, y, fillW, 5), fill);
  }

  void _drawText(Canvas canvas, String text, double x, double y, Color color, {double fontSize = 8}) {
    final textSpan = TextSpan(
      text: text,
      style: TextStyle(
        color: color,
        fontSize: fontSize,
        fontFamily: 'monospace',
        fontWeight: FontWeight.bold,
      ),
    );
    final textPainter = TextPainter(
      text: textSpan,
      textDirection: TextDirection.ltr,
    );
    textPainter.layout();
    textPainter.paint(canvas, Offset(x, y));
  }

  @override
  bool shouldRepaint(covariant OledPainter oldDelegate) => true;
}
