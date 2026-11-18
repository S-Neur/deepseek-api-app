package com.dsh.deepseek;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 把一个纯静态的对话前端装进 WebView。
 *
 * 关键设计：
 * 1. 前端资源用自定义 https 源提供给页面（而不是 file://），这样 fetch 到 api.deepseek.com
 *    时带的是正常的 https Origin；file:// 会变成 Origin: null，跨域行为不可控。
 * 2. 应用内不保存、也不编译任何 API Key：Key 由用户在设置页输入，存在 WebView 的 localStorage 里。
 */
public class MainActivity extends Activity {

    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + ASSET_HOST + "/index.html";
    private static final int REQUEST_FILE = 2001;
    private static final int REQUEST_MIC = 2002;

    private WebView webView;
    private ValueCallback<Uri[]> pendingFileCallback;
    private PermissionRequest pendingPermission;

    private static final Map<String, String> MIME = new HashMap<>();

    static {
        MIME.put("html", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("mjs", "text/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("webmanifest", "application/manifest+json");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("webp", "image/webp");
        MIME.put("svg", "image/svg+xml");
        MIME.put("ico", "image/x-icon");
        MIME.put("woff", "font/woff");
        MIME.put("woff2", "font/woff2");
        MIME.put("ttf", "font/ttf");
        MIME.put("map", "application/json");
        MIME.put("txt", "text/plain");
        MIME.put("md", "text/plain");
    }

    private static final Map<String, String> CHARSET = new HashMap<>();

    static {
        CHARSET.put("text/html", "utf-8");
        CHARSET.put("text/javascript", "utf-8");
        CHARSET.put("text/css", "utf-8");
        CHARSET.put("application/json", "utf-8");
        CHARSET.put("application/manifest+json", "utf-8");
        CHARSET.put("image/svg+xml", "utf-8");
        CHARSET.put("text/plain", "utf-8");
    }

    private static String mimeOf(String path) {
        int dot = path.lastIndexOf('.');
        if (dot < 0) return "application/octet-stream";
        String ext = path.substring(dot + 1).toLowerCase(Locale.ROOT);
        String type = MIME.get(ext);
        return type == null ? "application/octet-stream" : type;
    }

    private boolean assetExists(String assetPath) {
        try (InputStream ignored = getAssets().open(assetPath)) {
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        // 朗读回答用 <audio>，不能要求用户先点一下才允许播放
        settings.setMediaPlaybackRequiresUserGesture(false);
        // 选中的文件会先复制到应用缓存再交给页面（见 copyToCache），
        // 因此需要允许读 file://；页面本身仍然只从 appassets 源加载。
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setBackgroundColor(0xFFFFFFFF);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri == null || !ASSET_HOST.equals(uri.getHost())) {
                    // api.deepseek.com 的请求原样放行
                    return null;
                }
                String path = uri.getPath();
                if (path == null || path.isEmpty() || "/".equals(path)) {
                    path = "/index.html";
                }
                String assetPath = "www" + path;
                if (!assetExists(assetPath)) {
                    // 单页应用：未知路径回退到 index.html
                    assetPath = "www/index.html";
                }
                try {
                    InputStream stream = getAssets().open(assetPath);
                    String mime = mimeOf(assetPath);
                    return new WebResourceResponse(mime, CHARSET.get(mime), stream);
                } catch (IOException e) {
                    return null;
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri == null) return false;
                if (ASSET_HOST.equals(uri.getHost())) return false;
                // 站外链接交给系统浏览器，别在应用里跑
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException ignored) {
                    // 没有可处理的浏览器就忽略
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (pendingFileCallback != null) {
                    pendingFileCallback.onReceiveValue(null);
                }
                pendingFileCallback = callback;
                try {
                    Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    String[] accept = params == null ? null : params.getAcceptTypes();
                    String type = (accept != null && accept.length > 0 && accept[0] != null
                            && accept[0].contains("/")) ? accept[0] : "*/*";
                    intent.setType(type);
                    startActivityForResult(Intent.createChooser(intent, "选择文件"), REQUEST_FILE);
                    return true;
                } catch (ActivityNotFoundException e) {
                    pendingFileCallback = null;
                    return false;
                }
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean needsMic = false;
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                            needsMic = true;
                        }
                    }
                    boolean granted = checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                            == PackageManager.PERMISSION_GRANTED;
                    if (needsMic && !granted) {
                        pendingPermission = request;
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_MIC);
                        return;
                    }
                    request.grant(request.getResources());
                });
            }
        });

        FrameLayout container = new FrameLayout(this);
        container.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(container);

        // targetSdk 35 在 Android 15 上默认强制 edge-to-edge，内容会顶到状态栏下面。
        // 这里恢复"内容避开系统栏"的传统行为。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(true);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        // 页面可以调用：读系统深浅色、同步状态栏配色
        webView.addJavascriptInterface(new Host(), "AppHost");

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(START_URL);
        }
    }

    /** 暴露给页面的原生能力 */
    private class Host {
        /** 系统当前是否处于深色模式（不依赖 WebView 的 prefers-color-scheme） */
        @JavascriptInterface
        public boolean isSystemDark() {
            return MainActivity.this.isSystemDark();
        }

        /** 页面把自身背景色同步给状态栏；darkIcons 表示图标应为深色（浅色背景） */
        @JavascriptInterface
        public void setStatusBar(final String hexColor, final boolean darkIcons) {
            runOnUiThread(() -> applyStatusBar(hexColor, darkIcons));
        }

        /**
         * 导出文件的开始。WebView 不支持 <a download> + blob URL，必须由原生落盘。
         * 分块写入，避免把上百 MB 的归档一次性塞过桥接层。
         */
        @JavascriptInterface
        public String exportBegin(String fileName) {
            return startExport(fileName);
        }

        @JavascriptInterface
        public boolean exportChunk(String token, String base64) {
            return writeExportChunk(token, base64);
        }

        /** 收尾并把文件发布到系统「下载」目录，返回给用户看的位置 */
        @JavascriptInterface
        public String exportEnd(String token) {
            return finishExport(token);
        }

        @JavascriptInterface
        public void exportAbort(String token) {
            abortExport(token);
        }
    }

    private boolean isSystemDark() {
        int mode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return mode == Configuration.UI_MODE_NIGHT_YES;
    }

    /* ---------------- 导出：分块写临时文件，完成后发布到「下载」 ---------------- */

    private static class ExportSession {
        File file;
        OutputStream out;
    }

    private final Map<String, ExportSession> exports = new ConcurrentHashMap<>();

    private File exportDir() {
        return new File(getCacheDir(), "export");
    }

    private String startExport(String fileName) {
        try {
            String safe = (fileName == null || fileName.trim().isEmpty())
                    ? "deepseek-export.zip"
                    : fileName.replaceAll("[\\\\/:*?\"<>|]", "_");
            File dir = exportDir();
            deleteRecursively(dir);
            if (!dir.mkdirs() && !dir.isDirectory()) {
                return "ERR:cannot create dir";
            }
            ExportSession session = new ExportSession();
            session.file = new File(dir, safe);
            session.out = new BufferedOutputStream(new FileOutputStream(session.file), 256 * 1024);
            String token = String.valueOf(System.nanoTime());
            exports.put(token, session);
            return token;
        } catch (Exception e) {
            return "ERR:" + e.getMessage();
        }
    }

    private boolean writeExportChunk(String token, String base64) {
        ExportSession session = exports.get(token);
        if (session == null || base64 == null) {
            return false;
        }
        try {
            session.out.write(Base64.decode(base64, Base64.DEFAULT));
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private String finishExport(String token) {
        ExportSession session = exports.remove(token);
        if (session == null) {
            return "ERR:unknown session";
        }
        try {
            session.out.flush();
            session.out.close();
            String location = publishToDownloads(session.file);
            deleteRecursively(exportDir());
            return location;
        } catch (Exception e) {
            return "ERR:" + e.getMessage();
        }
    }

    private void abortExport(String token) {
        ExportSession session = exports.remove(token);
        if (session != null) {
            try {
                session.out.close();
            } catch (IOException ignored) {
                // 关闭失败不影响清理
            }
        }
        deleteRecursively(exportDir());
    }

    /** 写进系统「下载」目录，用户在文件管理器里能直接看到 */
    private String publishToDownloads(File source) throws IOException {
        String name = source.getName();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, "application/zip");
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                throw new IOException("MediaStore insert failed");
            }
            try (InputStream in = new FileInputStream(source);
                 OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) {
                    throw new IOException("MediaStore open failed");
                }
                copy(in, out);
            }
            return "Download/" + name;
        }
        File dir = getExternalFilesDir(null);
        if (dir == null) {
            throw new IOException("no external dir");
        }
        File target = new File(dir, name);
        try (InputStream in = new FileInputStream(source);
             OutputStream out = new FileOutputStream(target)) {
            copy(in, out);
        }
        return target.getAbsolutePath();
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buffer = new byte[256 * 1024];
        int read;
        while ((read = in.read(buffer)) != -1) {
            out.write(buffer, 0, read);
        }
    }

    private void applyStatusBar(String hexColor, boolean darkIcons) {
        if (hexColor == null) {
            return;
        }
        try {
            getWindow().setStatusBarColor(Color.parseColor(hexColor));
        } catch (IllegalArgumentException ignored) {
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                int appearance = darkIcons ? WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS : 0;
                controller.setSystemBarsAppearance(
                        appearance, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
            }
        } else {
            View decor = getWindow().getDecorView();
            int flags = decor.getSystemUiVisibility();
            flags = darkIcons
                    ? (flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR)
                    : (flags & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
            decor.setSystemUiVisibility(flags);
        }
    }

    /** 系统深浅色切换时通知页面（此时 Activity 不重建，页面状态不会丢） */
    private void pushSystemTheme() {
        if (webView == null) {
            return;
        }
        boolean dark = isSystemDark();
        webView.evaluateJavascript(
                "window.__setSystemDark && window.__setSystemDark(" + dark + ")", null);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        pushSystemTheme();
    }

    @Override
    protected void onResume() {
        super.onResume();
        pushSystemTheme();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE) {
            final ValueCallback<Uri[]> callback = pendingFileCallback;
            pendingFileCallback = null;
            if (callback == null) {
                return;
            }
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                callback.onReceiveValue(null);
                return;
            }
            final Uri picked = data.getData();
            // 复制可能耗时（几十 MB 的包），放后台线程，完成后再回调 WebView
            new Thread(() -> {
                Uri delivered = picked;
                try {
                    Uri cached = copyToCache(picked);
                    if (cached != null) {
                        delivered = cached;
                    }
                } catch (Exception ignored) {
                    // 复制失败就退回原始 content:// URI，最多慢一点
                }
                final Uri result = delivered;
                runOnUiThread(() -> callback.onReceiveValue(new Uri[]{result}));
            }, "file-copy").start();
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /**
     * 把选择器给的 content:// 文件复制到应用缓存，返回 file:// URI。
     *
     * 为什么要复制：WebView 通过 content provider 随机读取极慢。实测读 46 字节要 30ms，
     * 而导入一份上千条对话的历史需要几千次这样的读取，光读取就要好几分钟，
     * 用户看到的就是"按钮变灰、没有任何反应"。换成本地文件后快两个数量级。
     */
    private Uri copyToCache(Uri source) throws IOException {
        String name = queryDisplayName(source);
        if (name == null || name.trim().isEmpty()) {
            name = "picked-" + System.currentTimeMillis();
        }
        File dir = new File(getCacheDir(), "picked");
        deleteRecursively(dir);
        if (!dir.mkdirs() && !dir.isDirectory()) {
            return null;
        }
        File target = new File(dir, name.replace('/', '_').replace('\\', '_'));
        try (InputStream in = getContentResolver().openInputStream(source);
             OutputStream out = new FileOutputStream(target)) {
            if (in == null) {
                return null;
            }
            byte[] buffer = new byte[256 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
        }
        return Uri.fromFile(target);
    }

    private String queryDisplayName(Uri uri) {
        try (Cursor cursor = getContentResolver().query(
                uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    return cursor.getString(index);
                }
            }
        } catch (Exception ignored) {
            // 拿不到文件名就用时间戳命名
        }
        return null;
    }

    private static void deleteRecursively(File file) {
        if (file == null || !file.exists()) {
            return;
        }
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) {
                deleteRecursively(child);
            }
        }
        file.delete();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        if (requestCode == REQUEST_MIC && pendingPermission != null) {
            boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
            if (granted) {
                pendingPermission.grant(pendingPermission.getResources());
            } else {
                pendingPermission.deny();
            }
            pendingPermission = null;
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, results);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        // 交给页面决定：先关抽屉 / 关弹窗 / 回到新对话，都没有可关的才退出应用
        webView.evaluateJavascript(
                "(function(){try{return window.__appBack ? window.__appBack() : false}catch(e){return false}})()",
                value -> {
                    if (!"true".equals(value)) {
                        MainActivity.super.onBackPressed();
                    }
                });
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
