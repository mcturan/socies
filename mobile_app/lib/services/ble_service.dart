import 'dart:async';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';

class BleService {
  static const String serviceUuid = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
  static const String telemetryCharUuid = "beb5483e-36e1-4688-b7f5-ea07361b26a8";
  static const String pagerCharUuid = "cba1d466-344c-4be3-ab3f-189f80dd7518";

  BluetoothDevice? connectedDevice;
  BluetoothCharacteristic? pagerCharacteristic;
  bool isScanning = false;

  Future<void> startScan({required Function(BluetoothDevice) onDeviceFound}) async {
    isScanning = true;
    try {
      await FlutterBluePlus.startScan(timeout: const Duration(seconds: 8));
      FlutterBluePlus.scanResults.listen((results) {
        for (ScanResult r in results) {
          if (r.device.platformName.contains("SOCIES") || r.advertisementData.advName.contains("SOCIES")) {
            onDeviceFound(r.device);
          }
        }
      });
    } catch (_) {}
  }

  Future<bool> connect(BluetoothDevice device) async {
    try {
      await device.connect(autoConnect: false);
      connectedDevice = device;
      
      final services = await device.discoverServices();
      for (final s in services) {
        if (s.uuid.toString().toLowerCase() == serviceUuid.toLowerCase()) {
          for (final c in s.characteristics) {
            if (c.uuid.toString().toLowerCase() == pagerCharUuid.toLowerCase()) {
              pagerCharacteristic = c;
            }
          }
        }
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<bool> sendPagerMessage(String message) async {
    if (pagerCharacteristic == null) return false;
    try {
      await pagerCharacteristic!.write(message.codeUnits);
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<void> disconnect() async {
    try {
      await connectedDevice?.disconnect();
      connectedDevice = null;
      pagerCharacteristic = null;
    } catch (_) {}
  }
}
