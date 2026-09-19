import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'engine/pet_state.dart';
import 'services/server_client.dart';
import 'ui/virtual_device_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xFF070A12),
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );

  final prefs = await SharedPreferences.getInstance();
  String? deviceId = prefs.getString('device_id');
  if (deviceId == null || deviceId.isEmpty) {
    deviceId = 'SOCIES-AND-${DateTime.now().millisecondsSinceEpoch.toString().substring(7)}';
    await prefs.setString('device_id', deviceId);
  }
  final userEmail = prefs.getString('user_email') ?? '';

  final petState = PetState();
  final serverClient = ServerClient(
    deviceId: deviceId,
    userEmail: userEmail,
  );

  runApp(SociesApp(petState: petState, serverClient: serverClient));
}

class SociesApp extends StatelessWidget {
  final PetState petState;
  final ServerClient serverClient;

  const SociesApp({
    super.key,
    required this.petState,
    required this.serverClient,
  });

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Socies Virtual Pet',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF070A12),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF00E5FF),
          secondary: Color(0xFFA855F7),
          surface: Color(0xFF0F172A),
        ),
        fontFamily: 'monospace',
      ),
      home: PermissionGateWrapper(
        petState: petState,
        serverClient: serverClient,
      ),
    );
  }
}

/// Tüm kritik izinler (Sensör, Rehber, Kamera, Ses, Arka Plan, BLE)
/// onaylanana kadar uygulamayı kilitleyen güvenlik ve izin kapısı
class PermissionGateWrapper extends StatefulWidget {
  final PetState petState;
  final ServerClient serverClient;

  const PermissionGateWrapper({
    super.key,
    required this.petState,
    required this.serverClient,
  });

  @override
  State<PermissionGateWrapper> createState() => _PermissionGateWrapperState();
}

class _PermissionGateWrapperState extends State<PermissionGateWrapper> with WidgetsBindingObserver {
  bool _allPermissionsGranted = false;
  bool _checking = true;

  final List<Permission> _requiredPermissions = [
    Permission.camera,
    Permission.contacts,
    Permission.microphone,
    Permission.sensors,
    Permission.activityRecognition,
    Permission.bluetoothScan,
    Permission.bluetoothConnect,
    Permission.locationWhenInUse,
    Permission.ignoreBatteryOptimizations,
    Permission.notification,
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _checkPermissions();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _checkPermissions();
    }
  }

  Future<void> _checkPermissions() async {
    setState(() => _checking = true);
    bool granted = true;
    for (final p in _requiredPermissions) {
      try {
        final status = await p.status;
        if (!status.isGranted) {
          granted = false;
          break;
        }
      } catch (_) {
        // Bazı izinler platform sürümüne göre no-op dönebilir
      }
    }
    setState(() {
      _allPermissionsGranted = granted;
      _checking = false;
    });
  }

  Future<void> _requestAll() async {
    setState(() => _checking = true);
    for (final p in _requiredPermissions) {
      try {
        await p.request();
      } catch (_) {}
    }
    await _checkPermissions();
  }

  @override
  Widget build(BuildContext context) {
    if (_allPermissionsGranted) {
      return VirtualDeviceScreen(
        petState: widget.petState,
        serverClient: widget.serverClient,
      );
    }

    return Scaffold(
      backgroundColor: const Color(0xFF070A12),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Icon(Icons.security, color: Color(0xFF00E5FF), size: 64),
              const SizedBox(height: 16),
              const Text(
                "SOCIES İZİN & ERİŞİM MERKEZİ",
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1.2,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 12),
              const Text(
                "Socies'in çalışabilmesi için Sensörler, Telefon Defteri, Kamera, Ses, Bluetooth ve Arka Planda Kesintisiz Çalışma izinleri zorunludur.\n\nErişim verilmeden uygulama kilitli kalacaktır.",
                style: TextStyle(color: Colors.white70, fontSize: 11, height: 1.5),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              _buildPermissionItem("Sensörler & Adımsayar", "SW-420 eşdeğeri hareket ve sallama", Icons.vibration),
              _buildPermissionItem("Telefon Defteri", "Arkadaş bulma & çağrı cihazı rehberi", Icons.contacts),
              _buildPermissionItem("Kamera & Mikrofon", "Foto albümü & chiptune ses tepkisi", Icons.camera_alt),
              _buildPermissionItem("Arka Planda Çalışma", "Canlının arka planda hayatta kalması", Icons.battery_charging_full),
              _buildPermissionItem("Bluetooth & Konum", "ESP32 anahtarlık donanım iletişimi", Icons.bluetooth),
              const Spacer(),
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF00E5FF),
                  foregroundColor: Colors.black,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                icon: const Icon(Icons.check_circle_outline, size: 20),
                label: const Text(
                  "TÜM İZİNLERİ ONAYLA VE BAŞLAT",
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
                ),
                onPressed: _requestAll,
              ),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFFA855F7),
                  side: const BorderSide(color: Color(0xFFA855F7)),
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                icon: const Icon(Icons.settings, size: 18),
                label: const Text(
                  "Cihaz Ayarlarından Aç",
                  style: TextStyle(fontSize: 11),
                ),
                onPressed: openAppSettings,
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: () => setState(() {
                  _allPermissionsGranted = true; // Sınırlı mod — BLE ve sensör çalışmaz
                }),
                child: const Text(
                  "Sınırlı Modda Devam Et (BLE & Sensör Devre Dışı)",
                  style: TextStyle(color: Colors.white38, fontSize: 10),
                  textAlign: TextAlign.center,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildPermissionItem(String title, String desc, IconData icon) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6.0),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: const Color(0xFF1E293B),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(icon, color: const Color(0xFF00E5FF), size: 16),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold)),
                Text(desc, style: const TextStyle(color: Colors.white54, fontSize: 10)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
