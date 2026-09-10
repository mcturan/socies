import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'engine/pet_state.dart';
import 'services/server_client.dart';
import 'ui/virtual_device_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // Ekranı dikey veya yatay modda sabitleme veya sistem çubuğu stilini ayarlama
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xFF070A12),
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );

  final petState = PetState();
  final serverClient = ServerClient(
    serverUrl: 'http://10.0.2.2:3000', // Android emülatör veya 'http://localhost:3000'
    deviceId: 'SOCIES-AND-9941A',
    userEmail: 'turan@socies.io',
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
      home: VirtualDeviceScreen(
        petState: petState,
        serverClient: serverClient,
      ),
    );
  }
}
