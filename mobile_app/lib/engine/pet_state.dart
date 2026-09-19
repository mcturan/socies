import 'dart:async';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

enum PetBreed { top, kedi, kopek, bitki, sosis, balik, kus }
enum RPSChoice { none, rock, paper, scissors }
enum AppGameMode { normal, rpsCountdown, rpsResult, duelWait, duelFire, duelResult, needsHud }

class PetState extends ChangeNotifier {
  PetBreed breed = PetBreed.top;
  int stage = 1; // 1: Bebek, 2: Genç, 3: Yetişkin
  int score = 310;
  int streakDays = 5;
  int ageDays = 1;
  int steps = 1420;
  int batteryPct = 88;

  // Sims İhtiyaçları (0 - 100)
  double hunger = 85.0;
  double fun = 80.0;
  double love = 90.0;
  double sleep = 75.0;
  double toilet = 85.0;
  double clean = 90.0;
  double social = 60.0;

  // Cihaz ve Durum Değişkenleri
  bool hasPoop = false;
  double poopX = 20.0;
  double poopY = 38.0;
  bool isSleeping = false;
  bool soundMuted = false;
  bool vibroMuted = false;
  bool bleConnected = false;
  int unreadMessagesCount = 0;

  String activeDialogue = "Zıp zıp!";
  int dialogueTicksRemaining = 0;

  // Top (Zıpzıp) Fizik Motoru (128x48 OLED alt alanı için)
  double ballX = 64.0;
  double ballY = 24.0;
  double ballVx = 1.2;
  double ballVy = 0.0;
  double ballSquashX = 1.0;
  double ballSquashY = 1.0;
  static const double gravity = 0.35;
  static const double bounceDamping = 0.78;
  static const double groundY = 40.0;

  // Mini Oyun Durumları
  AppGameMode gameMode = AppGameMode.normal;
  
  // Taş-Kağıt-Makas
  int rpsCountdownSec = 3;
  RPSChoice playerRpsChoice = RPSChoice.none;
  RPSChoice opponentRpsChoice = RPSChoice.none;
  String rpsResultText = "";

  // Kovboy Düellosu
  int duelWaitTicks = 0;
  DateTime? duelFireStartTime;
  int duelReactionMs = 0;
  bool duelWon = false;

  Timer? _ticker;
  final Random _rand = Random();
  int _decayCount = 0;

  PetState() {
    _loadLocal();
    _startLoop();
  }

  void _startLoop() {
    _ticker = Timer.periodic(const Duration(milliseconds: 50), (timer) {
      _physicsTick();
      if (timer.tick % 40 == 0) {
        _decayTick(); // Her 2 saniyede bir ihtiyaç azalımı
      }
      notifyListeners();
    });
  }

  void _physicsTick() {
    if (dialogueTicksRemaining > 0) {
      dialogueTicksRemaining--;
      if (dialogueTicksRemaining == 0 && gameMode == AppGameMode.normal) {
        activeDialogue = "";
      }
    }

    // Top fiziği (yalnızca top seçiliyken)
    if (breed == PetBreed.top && gameMode == AppGameMode.normal && !isSleeping) {
      ballVy += gravity;
      ballX += ballVx;
      ballY += ballVy;

      // Zemin çarpışması
      if (ballY >= groundY) {
        ballY = groundY;
        ballVy = -ballVy * bounceDamping;
        ballSquashX = 1.35;
        ballSquashY = 0.65;
        if (ballVy.abs() < 0.6) ballVy = 0.0;
      } else {
        ballSquashX += (1.0 - ballSquashX) * 0.15;
        ballSquashY += (1.0 - ballSquashY) * 0.15;
      }

      // Yan duvarlar (0 .. 128)
      if (ballX <= 8) {
        ballX = 8;
        ballVx = -ballVx * 0.9;
      } else if (ballX >= 120) {
        ballX = 120;
        ballVx = -ballVx * 0.9;
      }
    }

    // Düello gerilim sayacı
    if (gameMode == AppGameMode.duelWait) {
      duelWaitTicks--;
      if (duelWaitTicks <= 0) {
        gameMode = AppGameMode.duelFire;
        duelFireStartTime = DateTime.now();
        activeDialogue = "ATEŞ! (●)";
      }
    }
  }

  void _decayTick() {
    _decayCount++;
    if (_decayCount % 10 == 0) _saveLocal();

    if (isSleeping) {
      sleep = min(100.0, sleep + 0.8);
      hunger = max(0.0, hunger - 0.05);
    } else {
      hunger = max(0.0, hunger - 0.12);
      fun = max(0.0, fun - 0.10);
      love = max(0.0, love - 0.08);
      sleep = max(0.0, sleep - 0.06);
      toilet = max(0.0, toilet - 0.14);
      social = max(0.0, social - 0.07);

      if (hasPoop) {
        clean = max(0.0, clean - 0.35);
      }
    }

    // Tuvalet ihtiyacı düşükse kaka yap
    if (toilet < 20.0 && !hasPoop && breed != PetBreed.bitki) {
      hasPoop = true;
      poopX = (ballX - 16).clamp(10.0, 110.0);
      setDialogue("💩 Eyvah kaka!", 60);
    }
  }

  // --- EYLEMLER ---

  // Telefon Sallama / Titreşim Sensörü (SW-420 eşdeğeri)
  void onShakeSensor() {
    if (isSleeping) return;
    fun = min(100.0, fun + 15.0);
    score += 5;
    steps += 18;

    if (breed == PetBreed.top) {
      ballVy = -7.5 - _rand.nextDouble() * 3.0;
      ballVx = (_rand.nextBool() ? 1 : -1) * (2.5 + _rand.nextDouble() * 2.0);
      setDialogue("Woohoo! Zıplıyoruz!", 40);
    } else {
      setDialogue("İyi gezdik! Çok eğlenceli!", 40);
    }
    notifyListeners();
  }

  // Besleme (Kısa Select veya Tuş 2)
  void feed() {
    if (isSleeping) return;
    hunger = min(100.0, hunger + 25.0);
    love = min(100.0, love + 5.0);
    score += 10;
    setDialogue("Ham ham! Çok lezzetli!", 40);

    // Bazen yedikten sonra kaka ihtiyacı gelir
    if (_rand.nextDouble() < 0.35 && breed != PetBreed.bitki) {
      toilet = max(10.0, toilet - 30.0);
    }
    _saveLocal();
    notifyListeners();
  }

  // Sevme / Okşama
  void petAnimal() {
    if (isSleeping) return;
    love = min(100.0, love + 20.0);
    fun = min(100.0, fun + 10.0);
    score += 15;
    setDialogue("Mırr... Çok seviyorum seni!", 40);
    _saveLocal();
    notifyListeners();
  }

  // Kaka Temizleme
  void cleanToilet() {
    if (hasPoop) {
      hasPoop = false;
      clean = 100.0;
      toilet = 100.0;
      score += 25;
      setDialogue("Tertemiz oldu! 🧽✨", 40);
    } else {
      clean = 100.0;
      setDialogue("Zaten mis gibi!", 30);
    }
    _saveLocal();
    notifyListeners();
  }

  // Gece / Uyku Modu Geçişi
  void toggleSleep() {
    isSleeping = !isSleeping;
    if (isSleeping) {
      setDialogue("İyi geceler... Zzz 🌙", 50);
    } else {
      setDialogue("Günaydın! Harika bir gün!", 40);
    }
    _saveLocal();
    notifyListeners();
  }

  // Karakter Değiştirme (Test veya Tercih)
  void cycleBreed() {
    final nextIndex = (breed.index + 1) % PetBreed.values.length;
    breed = PetBreed.values[nextIndex];
    ballX = 64.0;
    ballY = 24.0;
    ballVx = 1.0;
    ballVy = 0.0;
    setDialogue("Karakter: ${breed.name.toUpperCase()}!", 50);
    _saveLocal();
    notifyListeners();
  }

  // Mini Oyun 1: Taş-Kağıt-Makas Başlat
  void startRPS() {
    if (gameMode != AppGameMode.normal) return;
    gameMode = AppGameMode.rpsCountdown;
    rpsCountdownSec = 3;
    playerRpsChoice = RPSChoice.none;
    opponentRpsChoice = RPSChoice.none;
    rpsResultText = "";
    
    Timer.periodic(const Duration(seconds: 1), (t) {
      rpsCountdownSec--;
      if (rpsCountdownSec <= 0) {
        t.cancel();
        _finishRPS();
      }
      notifyListeners();
    });
    notifyListeners();
  }

  void chooseRPS(RPSChoice choice) {
    if (gameMode == AppGameMode.rpsCountdown) {
      playerRpsChoice = choice;
      notifyListeners();
    }
  }

  void _finishRPS() {
    gameMode = AppGameMode.rpsResult;
    // Rakip rastgele kilitler
    final choices = [RPSChoice.rock, RPSChoice.paper, RPSChoice.scissors];
    opponentRpsChoice = choices[_rand.nextInt(choices.length)];

    if (playerRpsChoice == RPSChoice.none) {
      playerRpsChoice = choices[_rand.nextInt(choices.length)];
    }

    if (playerRpsChoice == opponentRpsChoice) {
      rpsResultText = "BERABERE!";
      social = min(100.0, social + 10.0);
    } else if (
      (playerRpsChoice == RPSChoice.rock && opponentRpsChoice == RPSChoice.scissors) ||
      (playerRpsChoice == RPSChoice.paper && opponentRpsChoice == RPSChoice.rock) ||
      (playerRpsChoice == RPSChoice.scissors && opponentRpsChoice == RPSChoice.paper)
    ) {
      rpsResultText = "KAZANDIN! (+35 P)";
      score += 35;
      fun = min(100.0, fun + 25.0);
      social = min(100.0, social + 30.0);
    } else {
      rpsResultText = "RAKİP KAZANDI!";
      fun = min(100.0, fun + 10.0);
      social = min(100.0, social + 15.0);
    }

    Timer(const Duration(seconds: 3), () {
      gameMode = AppGameMode.normal;
      notifyListeners();
    });
  }

  // Mini Oyun 2: Kovboy Düellosu Başlat
  void startDuel() {
    gameMode = AppGameMode.duelWait;
    duelWaitTicks = 40 + _rand.nextInt(50); // 2 ila 4.5 saniye rastgele gerilim
    duelReactionMs = 0;
    duelWon = false;
    activeDialogue = "HAZIRLAN...";
    notifyListeners();
  }

  void onDuelButtonPress() {
    if (gameMode == AppGameMode.duelWait) {
      // Erken bastı - faul
      gameMode = AppGameMode.duelResult;
      duelWon = false;
      activeDialogue = "FAUL! Çok erken!";
      Timer(const Duration(seconds: 3), () {
        gameMode = AppGameMode.normal;
        notifyListeners();
      });
    } else if (gameMode == AppGameMode.duelFire && duelFireStartTime != null) {
      final now = DateTime.now();
      duelReactionMs = now.difference(duelFireStartTime!).inMilliseconds;
      gameMode = AppGameMode.duelResult;
      
      // Rakip 320ms - 550ms arasında tetikler
      final opponentReaction = 320 + _rand.nextInt(230);
      if (duelReactionMs < opponentReaction) {
        duelWon = true;
        score += 50;
        fun = min(100.0, fun + 30.0);
        social = min(100.0, social + 35.0);
        activeDialogue = "VURDUN! ${duelReactionMs}ms (+50 P)";
      } else {
        duelWon = false;
        activeDialogue = "ISKALADIN! Rakip: ${opponentReaction}ms";
      }

      Timer(const Duration(seconds: 3), () {
        gameMode = AppGameMode.normal;
        notifyListeners();
      });
    }
    notifyListeners();
  }

  void toggleNeedsHud() {
    if (gameMode == AppGameMode.needsHud) {
      gameMode = AppGameMode.normal;
    } else {
      gameMode = AppGameMode.needsHud;
    }
    notifyListeners();
  }

  void setDialogue(String text, int ticks) {
    activeDialogue = text;
    dialogueTicksRemaining = ticks;
    notifyListeners();
  }

  // Sıfırdan Başlama (Rebirth)
  void rebirth() {
    breed = PetBreed.top;
    stage = 1;
    score = 0;
    hunger = 100.0;
    fun = 100.0;
    love = 100.0;
    sleep = 100.0;
    toilet = 100.0;
    clean = 100.0;
    social = 100.0;
    hasPoop = false;
    isSleeping = false;
    setDialogue("Yeniden Doğuş! Hoş geldin!", 60);
    _saveLocal();
    notifyListeners();
  }

  Map<String, dynamic> toJsonTelemetry(String deviceId, String mac, String email) {
    return {
      "device_id": deviceId,
      "hardware_mac": mac,
      "user_account": {
        "provider": "socies_mobile",
        "email": email
      },
      "pet_state": {
        "breed": breed.name,
        "stage": stage,
        "age_days": ageDays,
        "total_score": score,
        "streak_days": streakDays
      },
      "sims_needs": {
        "hunger": hunger.round(),
        "fun": fun.round(),
        "love": love.round(),
        "sleep": sleep.round(),
        "toilet": toilet.round(),
        "clean": clean.round(),
        "social": social.round()
      },
      "device_metrics": {
        "battery_percent": batteryPct,
        "total_steps": steps,
        "firmware_version": "v1.0.34-flutter"
      }
    };
  }

  Future<void> _loadLocal() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      score = prefs.getInt('score') ?? score;
      streakDays = prefs.getInt('streakDays') ?? streakDays;
      steps = prefs.getInt('steps') ?? steps;
      final breedStr = prefs.getString('breed');
      if (breedStr != null) {
        breed = PetBreed.values.firstWhere((b) => b.name == breedStr, orElse: () => PetBreed.top);
      }
      hunger = prefs.getDouble('hunger') ?? hunger;
      fun = prefs.getDouble('fun') ?? fun;
      love = prefs.getDouble('love') ?? love;
      sleep = prefs.getDouble('sleep') ?? sleep;
      toilet = prefs.getDouble('toilet') ?? toilet;
      clean = prefs.getDouble('clean') ?? clean;
      social = prefs.getDouble('social') ?? social;
      hasPoop = prefs.getBool('hasPoop') ?? hasPoop;
      isSleeping = prefs.getBool('isSleeping') ?? isSleeping;
      ageDays = prefs.getInt('ageDays') ?? ageDays;
      stage = prefs.getInt('stage') ?? stage;
      notifyListeners();
    } catch (_) {}
  }

  Future<void> _saveLocal() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setInt('score', score);
      await prefs.setInt('streakDays', streakDays);
      await prefs.setInt('steps', steps);
      await prefs.setString('breed', breed.name);
      await prefs.setDouble('hunger', hunger);
      await prefs.setDouble('fun', fun);
      await prefs.setDouble('love', love);
      await prefs.setDouble('sleep', sleep);
      await prefs.setDouble('toilet', toilet);
      await prefs.setDouble('clean', clean);
      await prefs.setDouble('social', social);
      await prefs.setBool('hasPoop', hasPoop);
      await prefs.setBool('isSleeping', isSleeping);
      await prefs.setInt('ageDays', ageDays);
      await prefs.setInt('stage', stage);
    } catch (_) {}
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }
}
