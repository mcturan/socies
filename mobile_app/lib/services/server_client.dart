import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../engine/pet_state.dart';

class ServerClient {
  String serverUrl;
  String deviceId;
  String userEmail;
  String hardwareMac;

  Timer? _telemetryTimer;
  Timer? _inboxTimer;

  ServerClient({
    this.serverUrl = 'http://10.0.2.2:3000', // Android emülatör için localhost köprüsü veya IP
    this.deviceId = 'SOCIES-AND-9941A',
    this.userEmail = 'user@socies.io',
    this.hardwareMac = 'B8:27:EB:AA:51:72',
  });

  void startBackgroundSync(PetState petState, Function(String from, String msg) onMessageReceived) {
    // 1. Cihazı kaydet
    registerDevice(petState);

    // 2. Her 30 saniyede bir telemetri bildir
    _telemetryTimer?.cancel();
    _telemetryTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      sendTelemetry(petState);
    });

    // 3. Her 5 saniyede bir gelen çağrı mesajlarını kontrol et
    _inboxTimer?.cancel();
    _inboxTimer = Timer.periodic(const Duration(seconds: 5), (_) async {
      final messages = await fetchInbox();
      for (final msg in messages) {
        onMessageReceived(msg['from'] ?? 'Dost', msg['text'] ?? '');
      }
    });
  }

  void stopBackgroundSync() {
    _telemetryTimer?.cancel();
    _inboxTimer?.cancel();
  }

  // Cihaz Kaydı
  Future<bool> registerDevice(PetState petState) async {
    try {
      final url = Uri.parse('$serverUrl/api/v1/devices/register');
      final payload = petState.toJsonTelemetry(deviceId, hardwareMac, userEmail);
      final res = await http.post(
        url,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(payload),
      ).timeout(const Duration(seconds: 4));

      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  // Canlı Telemetri Bildirimi
  Future<bool> sendTelemetry(PetState petState) async {
    try {
      final url = Uri.parse('$serverUrl/api/v1/telemetry');
      final payload = petState.toJsonTelemetry(deviceId, hardwareMac, userEmail);
      final res = await http.post(
        url,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(payload),
      ).timeout(const Duration(seconds: 4));

      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  // Çağrı Mesajı Gönderme
  Future<Map<String, dynamic>> sendPagerMessage({
    required String targetDeviceId,
    required String messageText,
  }) async {
    try {
      final url = Uri.parse('$serverUrl/api/v1/messages/send');
      final res = await http.post(
        url,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'targetDeviceId': targetDeviceId,
          'fromUser': userEmail,
          'messageText': messageText,
        }),
      ).timeout(const Duration(seconds: 5));

      if (res.statusCode == 200) {
        return jsonDecode(res.body);
      }
      return {'success': false, 'error': 'Sunucu hatası: ${res.statusCode}'};
    } catch (e) {
      return {'success': false, 'error': e.toString()};
    }
  }

  // Gelen Mesajları Çekme (Inbox)
  Future<List<dynamic>> fetchInbox() async {
    try {
      final url = Uri.parse('$serverUrl/api/v1/messages/inbox/$deviceId');
      final res = await http.get(url).timeout(const Duration(seconds: 4));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        return data['messages'] ?? [];
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  // Çevrimiçi Arkadaşlar & Cihazlar Listesi
  Future<List<dynamic>> fetchOnlineDevices() async {
    try {
      final url = Uri.parse('$serverUrl/api/v1/presence');
      final res = await http.get(url).timeout(const Duration(seconds: 4));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        return data['devices'] ?? [];
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  // Buluta Yedekleme (Google / Apple ID)
  Future<bool> cloudBackup(PetState petState) async {
    try {
      final url = Uri.parse('$serverUrl/api/v1/cloud/backup');
      final res = await http.post(
        url,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'userEmail': userEmail,
          'petState': {
            'breed': petState.breed.name,
            'stage': petState.stage,
            'ageDays': petState.ageDays,
            'score': petState.score,
          },
          'totalScore': petState.score,
          'streakDays': petState.streakDays,
        }),
      ).timeout(const Duration(seconds: 5));

      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  // Buluttan Geri Yükleme
  Future<Map<String, dynamic>?> cloudRestore(String email) async {
    try {
      final url = Uri.parse('$serverUrl/api/v1/cloud/restore/${Uri.encodeComponent(email)}');
      final res = await http.get(url).timeout(const Duration(seconds: 5));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        return data['backup'];
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  // GitHub / Sunucu OTA Güncelleme Kontrolü
  Future<Map<String, dynamic>?> checkUpdates() async {
    try {
      final url = Uri.parse('$serverUrl/api/v1/version/check');
      final res = await http.get(url).timeout(const Duration(seconds: 4));
      if (res.statusCode == 200) {
        return jsonDecode(res.body);
      }
      return null;
    } catch (_) {
      return null;
    }
  }
}
