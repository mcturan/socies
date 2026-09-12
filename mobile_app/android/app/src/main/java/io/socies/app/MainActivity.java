package io.socies.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.StrictMode;
import android.provider.Settings;
import android.view.View;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;

public class MainActivity extends Activity {
    private static final int PERMISSION_REQUEST_CODE = 1001;
    private static final int INSTALL_PERMISSION_REQUEST_CODE = 1002;
    private WebView webView;
    private long downloadId = -1;
    private BroadcastReceiver downloadReceiver;

    private static final String[] REQUIRED_PERMISSIONS = new String[]{
        android.Manifest.permission.CAMERA,
        android.Manifest.permission.READ_CONTACTS,
        android.Manifest.permission.WRITE_CONTACTS,
        android.Manifest.permission.RECORD_AUDIO,
        android.Manifest.permission.BODY_SENSORS,
        android.Manifest.permission.ACCESS_FINE_LOCATION,
        android.Manifest.permission.ACCESS_COARSE_LOCATION,
        android.Manifest.permission.READ_EXTERNAL_STORAGE,
        android.Manifest.permission.WRITE_EXTERNAL_STORAGE
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // API 24+ FileUriExposedException engelleme (Paket yükleyici fallback için)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                StrictMode.VmPolicy.Builder builder = new StrictMode.VmPolicy.Builder();
                StrictMode.setVmPolicy(builder.build());
            } catch (Exception ignored) {}
        }

        webView = new WebView(this);
        setContentView(webView);

        configureWebView();

        if (hasAllPermissions()) {
            checkBatteryOptimization();
            loadGame();
        } else {
            requestAllPermissions();
        }
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);

        // Native JS Köprüsü
        webView.addJavascriptInterface(new SociesNativeBridge(), "SociesNative");

        // WebView İndirme Dinleyicisi
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
                if (url != null && (url.endsWith(".apk") || (mimetype != null && mimetype.contains("vnd.android.package-archive")) || url.contains("/download/"))) {
                    startNativeAutoUpdate(url);
                } else {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        startActivity(intent);
                    } catch (Exception ignored) {}
                }
            }
        });

        // WebViewClient (Modern ve Legacy Android sürümleri için)
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrlNavigation(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    return handleUrlNavigation(request.getUrl().toString());
                }
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient());
    }

    private boolean handleUrlNavigation(String url) {
        if (url == null) return false;
        if (url.startsWith("file://") || url.startsWith("data:")) {
            return false;
        }
        if (url.endsWith(".apk") || url.contains("/download/") || url.contains("socies-")) {
            startNativeAutoUpdate(url);
            return true;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            startActivity(intent);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    public class SociesNativeBridge {
        @JavascriptInterface
        public void autoUpdateApp(final String apkUrl) {
            new Handler(Looper.getMainLooper()).post(new Runnable() {
                @Override
                public void run() {
                    startNativeAutoUpdate(apkUrl);
                }
            });
        }

        @JavascriptInterface
        public String getNativeVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "1.0.8";
            }
        }
    }

    public void startNativeAutoUpdate(final String apkUrl) {
        if (apkUrl == null || apkUrl.isEmpty()) return;

        // 1. Android 8.0+ (Oreo) Bilinmeyen Kaynaklardan Yükleme İzni Kontrolü
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!getPackageManager().canRequestPackageInstalls()) {
                Toast.makeText(this, "Socies'in kendini güncelleyebilmesi için 'Bilinmeyen uygulamaları yükle' iznine onay veriniz.", Toast.LENGTH_LONG).show();
                try {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
                    startActivityForResult(intent, INSTALL_PERMISSION_REQUEST_CODE);
                } catch (Exception ignored) {}
            }
        }

        Toast.makeText(this, "🚀 Socies güncellemesi indiriliyor... Tamamlandığında otomatik kurulacak.", Toast.LENGTH_LONG).show();

        try {
            // Önceki güncelleme dosyası varsa temizle
            File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            if (!downloadsDir.exists()) {
                downloadsDir.mkdirs();
            }
            final File destFile = new File(downloadsDir, "socies-update.apk");
            if (destFile.exists()) {
                destFile.delete();
            }

            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(apkUrl));
            request.setTitle("Socies Otomatik Güncelleme");
            request.setDescription("Yeni sürüm indiriliyor...");
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationUri(Uri.fromFile(destFile));

            final DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm != null) {
                downloadId = dm.enqueue(request);

                // Dinleyiciyi kaydet
                if (downloadReceiver != null) {
                    try { unregisterReceiver(downloadReceiver); } catch (Exception ignored) {}
                }

                downloadReceiver = new BroadcastReceiver() {
                    @Override
                    public void onReceive(Context context, Intent intent) {
                        long completedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                        if (completedId == downloadId) {
                            try {
                                unregisterReceiver(this);
                                downloadReceiver = null;
                            } catch (Exception ignored) {}

                            triggerInstallApk(destFile, completedId);
                        }
                    }
                };

                registerReceiver(downloadReceiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
            }
        } catch (Exception e) {
            Toast.makeText(this, "Otomatik indirme başlatılamadı: " + e.getMessage() + "\nTarayıcı açılıyor...", Toast.LENGTH_LONG).show();
            try {
                Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(apkUrl));
                startActivity(browserIntent);
            } catch (Exception ignored) {}
        }
    }

    private void triggerInstallApk(File destFile, long dmId) {
        Toast.makeText(this, "✅ İndirme tamamlandı! Güncelleme ekranı açılıyor...", Toast.LENGTH_SHORT).show();

        Intent installIntent = new Intent(Intent.ACTION_VIEW);
        installIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);

        Uri apkUri = null;
        DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm != null && dmId != -1) {
            try {
                apkUri = dm.getUriForDownloadedFile(dmId);
            } catch (Exception ignored) {}
        }

        if (apkUri == null && destFile != null && destFile.exists()) {
            apkUri = Uri.fromFile(destFile);
        }

        if (apkUri != null) {
            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            try {
                startActivity(installIntent);
            } catch (Exception e) {
                Toast.makeText(this, "Paket yükleyici başlatılamadı: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
    }

    private boolean hasAllPermissions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        for (String perm : REQUIRED_PERMISSIONS) {
            if (checkSelfPermission(perm) != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        return true;
    }

    private void requestAllPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            requestPermissions(REQUIRED_PERMISSIONS, PERMISSION_REQUEST_CODE);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQUEST_CODE) {
            boolean allGranted = true;
            for (int res : grantResults) {
                if (res != PackageManager.PERMISSION_GRANTED) {
                    allGranted = false;
                    break;
                }
            }

            if (allGranted) {
                Toast.makeText(this, "Tüm izinler onaylandı! Socies başlıyor...", Toast.LENGTH_SHORT).show();
                checkBatteryOptimization();
                loadGame();
            } else {
                showPermissionRequiredDialog();
            }
        }
    }

    private void checkBatteryOptimization() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                try {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                } catch (Exception ignored) {}
            }
        }
    }

    private void showPermissionRequiredDialog() {
        new AlertDialog.Builder(this)
            .setTitle("🔒 Zorunlu İzinler Eksik")
            .setMessage("Socies'in çalışabilmesi ve evcil hayvanınızın arka planda yaşayabilmesi için Sensörler, Telefon Defteri, Kamera, Ses ve Konum izinleri zorunludur.\n\nLütfen tüm izinleri verin.")
            .setCancelable(false)
            .setPositiveButton("İzinleri Ver", new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface dialog, int which) {
                    requestAllPermissions();
                }
            })
            .setNegativeButton("Ayarları Aç", new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface dialog, int which) {
                    Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    intent.setData(Uri.fromParts("package", getPackageName(), null));
                    startActivity(intent);
                }
            })
            .show();
    }

    private void loadGame() {
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!hasAllPermissions()) {
            showPermissionRequiredDialog();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (downloadReceiver != null) {
            try {
                unregisterReceiver(downloadReceiver);
            } catch (Exception ignored) {}
            downloadReceiver = null;
        }
    }
}
