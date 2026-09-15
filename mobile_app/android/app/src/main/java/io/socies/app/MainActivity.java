package io.socies.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.IntentFilter;
import android.Manifest;
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
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;

import java.io.File;

public class MainActivity extends Activity {
    private static final int INSTALL_PERMISSION_REQUEST_CODE = 1002;
    private static final int FILE_CHOOSER_REQUEST_CODE = 1001;
    private WebView webView;
    private ValueCallback<Uri[]> fileUploadCallback;
    private long downloadId = -1;
    private BroadcastReceiver downloadReceiver;
    private boolean doubleBackToExitPressedOnce = false;

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

        // Kamera iznini otomatik kontrol et ve talep et (Android 6.0+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.CAMERA}, 2001);
            }
        }

        webView = new WebView(this);
        setContentView(webView);

        configureWebView();
        loadGame();
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

        webView.setWebChromeClient(new WebChromeClient() {
            // Android 5.0+ (Lollipop ve üzeri) için dosya / selfie fotoğraf seçici desteği
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (fileUploadCallback != null) {
                    fileUploadCallback.onReceiveValue(null);
                    fileUploadCallback = null;
                }
                fileUploadCallback = filePathCallback;
                try {
                    Intent intent = fileChooserParams.createIntent();
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST_CODE);
                    return true;
                } catch (Exception e) {
                    try {
                        Intent fallbackIntent = new Intent(Intent.ACTION_GET_CONTENT);
                        fallbackIntent.addCategory(Intent.CATEGORY_OPENABLE);
                        fallbackIntent.setType("image/*");
                        startActivityForResult(Intent.createChooser(fallbackIntent, "Fotoğraf Seç"), FILE_CHOOSER_REQUEST_CODE);
                        return true;
                    } catch (Exception ex) {
                        fileUploadCallback = null;
                        return false;
                    }
                }
            }

            // WebRTC / Kamera (Selfie) İzin Taleplerini Otomatik Onayla
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        request.grant(request.getResources());
                    }
                });
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle("Socies")
                    .setMessage(message)
                    .setPositiveButton("Tamam", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            result.confirm();
                        }
                    })
                    .setCancelable(false)
                    .create()
                    .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle("Socies")
                    .setMessage(message)
                    .setPositiveButton("Evet", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            result.confirm();
                        }
                    })
                    .setNegativeButton("İptal", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            result.cancel();
                        }
                    })
                    .setCancelable(false)
                    .create()
                    .show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, final JsPromptResult result) {
                final EditText input = new EditText(MainActivity.this);
                if (defaultValue != null) input.setText(defaultValue);
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle("Socies")
                    .setMessage(message)
                    .setView(input)
                    .setPositiveButton("Tamam", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            result.confirm(input.getText().toString());
                        }
                    })
                    .setNegativeButton("İptal", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            result.cancel();
                        }
                    })
                    .setCancelable(false)
                    .create()
                    .show();
                return true;
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            if (fileUploadCallback != null) {
                Uri[] results = null;
                if (resultCode == Activity.RESULT_OK && data != null) {
                    String dataString = data.getDataString();
                    if (dataString != null) {
                        results = new Uri[]{Uri.parse(dataString)};
                    } else if (data.getClipData() != null) {
                        final int count = data.getClipData().getItemCount();
                        results = new Uri[count];
                        for (int i = 0; i < count; i++) {
                            results[i] = data.getClipData().getItemAt(i).getUri();
                        }
                    }
                }
                fileUploadCallback.onReceiveValue(results);
                fileUploadCallback = null;
            }
        }
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
                return "1.0.22";
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

    private void loadGame() {
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView != null) {
            // Webview içinde JS çalıştır: Konsolda oyundaysa veya menüdeyse GERİ bas
            webView.evaluateJavascript(
                "(function(){ " +
                "  if (typeof oled !== 'undefined' && oled && oled.mode && oled.mode !== 'IDLE') { " +
                "    handleConsoleBtn('BACK'); " +
                "    return true; " +
                "  } " +
                "  return false; " +
                "})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if ("true".equals(value)) {
                            return;
                        }

                        if (doubleBackToExitPressedOnce) {
                            MainActivity.super.onBackPressed();
                            return;
                        }

                        doubleBackToExitPressedOnce = true;
                        Toast.makeText(MainActivity.this, "Çıkmak için tekrar geri tuşuna basın", Toast.LENGTH_SHORT).show();

                        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                            @Override
                            public void run() {
                                doubleBackToExitPressedOnce = false;
                            }
                        }, 2000);
                    }
                }
            );
        } else {
            super.onBackPressed();
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
