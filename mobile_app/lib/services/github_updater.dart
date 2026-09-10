import 'dart:convert';
import 'package:http/http.dart' as http;

class GitHubUpdater {
  static const String repoOwner = "mcturan";
  static const String repoName = "socies";

  /// GitHub API üzerinden en son sürüm bilgisini çeker
  static Future<Map<String, dynamic>?> checkLatestRelease() async {
    try {
      final url = Uri.parse("https://api.github.com/repos/$repoOwner/$repoName/releases/latest");
      final response = await http.get(url, headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Socies-Mobile-App'
      }).timeout(const Duration(seconds: 5));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        final tagName = data['tag_name'] ?? 'v1.0.0';
        final body = data['body'] ?? 'Hata düzeltmeleri ve performans iyileştirmeleri.';
        
        String apkUrl = "";
        final assets = data['assets'] as List<dynamic>? ?? [];
        for (final asset in assets) {
          if (asset['name'] != null && asset['name'].toString().endsWith('.apk')) {
            apkUrl = asset['browser_download_url'] ?? '';
            break;
          }
        }

        return {
          'hasRelease': true,
          'version': tagName,
          'notes': body,
          'downloadUrl': apkUrl,
          'publishedAt': data['published_at']
        };
      } else {
        // Release henüz yoksa son commit bilgisini kontrol et
        return checkLatestCommit();
      }
    } catch (_) {
      return null;
    }
  }

  /// Son commit özetini ve hash değerini çeker
  static Future<Map<String, dynamic>?> checkLatestCommit() async {
    try {
      final url = Uri.parse("https://api.github.com/repos/$repoOwner/$repoName/commits/main");
      final response = await http.get(url, headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Socies-Mobile-App'
      }).timeout(const Duration(seconds: 5));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        final sha = (data['sha'] ?? '').toString().substring(0, 7);
        final message = data['commit']?['message'] ?? 'Güncel kod tabanı';
        
        return {
          'hasRelease': false,
          'commitHash': sha,
          'notes': message,
          'downloadUrl': "https://github.com/$repoOwner/$repoName/archive/refs/heads/main.zip"
        };
      }
      return null;
    } catch (_) {
      return null;
    }
  }
}
