package com.jv.stockissue;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class MainActivity extends AppCompatActivity {

    static final String SITE_ISSUE = "https://staff.cuchd.in/frmStoreIssueReceiveLC.aspx";
    static final String ASSET_URL = "file:///android_asset/www/index.html";

    FrameLayout root;
    WebView appView, siteView;
    SharedPreferences prefs;
    File dataFile, jobFile, fillCache;
    ValueCallback<Uri[]> fileCb;
    String lastAlert = "";
    boolean unlocked = false;
    long pausedAt = 0;
    boolean usingBundled = false;
    long updateDownloadId = -1;
    boolean dlRegistered = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences("jv", MODE_PRIVATE);
        dataFile = new File(getFilesDir(), "data.json");
        jobFile = new File(getFilesDir(), "job.json");
        fillCache = new File(getFilesDir(), "fill.js");

        root = new FrameLayout(this);
        appView = makeView();
        siteView = makeView();
        root.addView(siteView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(appView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        siteView.setVisibility(View.GONE);
        setContentView(root);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(siteView, true);

        Bridge bridge = new Bridge();
        appView.addJavascriptInterface(bridge, "JVS");
        siteView.addJavascriptInterface(bridge, "JVS");

        appView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                String u = r.getUrl().toString();
                if (u.startsWith(BuildConfig.PAGES_URL) || u.startsWith("file:///android_asset/")) return false;
                openExternal(u);
                return true;
            }
            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame() && !usingBundled) {
                    usingBundled = true;
                    v.loadUrl(ASSET_URL);
                }
            }
            @Override
            public void onReceivedHttpError(WebView v, WebResourceRequest r, android.webkit.WebResourceResponse resp) {
                if (r.isForMainFrame() && !usingBundled && resp.getStatusCode() >= 400) {
                    usingBundled = true;
                    v.loadUrl(ASSET_URL);
                }
            }
        });
        appView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView w, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        "application/vnd.ms-excel", "text/csv", "text/comma-separated-values", "application/octet-stream"});
                try { startActivityForResult(i, 42); } catch (Exception ex) { fileCb = null; return false; }
                return true;
            }
        });

        siteView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                String host = r.getUrl().getHost();
                if (host != null && host.endsWith("cuchd.in")) return false;
                openExternal(r.getUrl().toString());
                return true;
            }
            @Override
            public void onPageFinished(WebView v, String url) {
                injectFill();
            }
        });
        siteView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView v, String url, String msg, JsResult res) {
                lastAlert = msg == null ? "" : msg;
                new AlertDialog.Builder(MainActivity.this)
                        .setTitle("CUIMS says")
                        .setMessage(lastAlert)
                        .setCancelable(false)
                        .setPositiveButton("OK", (d, w) -> {
                            res.confirm();
                            v.evaluateJavascript("window.JVFill&&window.JVFill.onAlertClosed&&window.JVFill.onAlertClosed()", null);
                        })
                        .show();
                return true;
            }
        });

        fetchFillScript();
        loadApp();
    }

    WebView makeView() {
        WebView w = new WebView(this);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        return w;
    }

    boolean online() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            NetworkCapabilities nc = cm.getNetworkCapabilities(cm.getActiveNetwork());
            return nc != null && nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Exception e) { return false; }
    }

    String mode() { return prefs.getString("mode", "online"); }

    void loadApp() {
        usingBundled = !"online".equals(mode()) || !online();
        if (usingBundled) {
            appView.loadUrl(ASSET_URL);
        } else {
            long bucket = System.currentTimeMillis() / 300000L;
            appView.loadUrl(BuildConfig.PAGES_URL + "index.html?b=" + bucket);
        }
    }

    void fetchFillScript() {
        if (!"online".equals(mode())) return;
        new Thread(() -> {
            try {
                URL u = new URL(BuildConfig.PAGES_URL + "fill.js?t=" + System.currentTimeMillis());
                HttpURLConnection c = (HttpURLConnection) u.openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                if (c.getResponseCode() == 200) {
                    String js = readAll(c.getInputStream());
                    if (js.contains("JVFill")) writeFile(fillCache, js);
                }
                c.disconnect();
            } catch (Exception ignored) { }
        }).start();
    }

    String fillSource() {
        try {
            if ("online".equals(mode()) && fillCache.exists()) return readFile(fillCache);
            return readAll(getAssets().open("www/fill.js"));
        } catch (Exception e) { return ""; }
    }

    void injectFill() {
        String src = fillSource();
        if (src.isEmpty()) return;
        siteView.evaluateJavascript(src, null);
    }

    void showSite(boolean on) {
        siteView.setVisibility(on ? View.VISIBLE : View.GONE);
        appView.setVisibility(on ? View.GONE : View.VISIBLE);
    }

    void openExternal(String u) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(u))); } catch (Exception ignored) { }
    }

    static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        in.close();
        return bo.toString("UTF-8");
    }
    static String readFile(File f) {
        try { return f.exists() ? readAll(new FileInputStream(f)) : ""; } catch (Exception e) { return ""; }
    }
    static void writeFile(File f, String s) {
        try {
            File tmp = new File(f.getPath() + ".tmp");
            FileOutputStream o = new FileOutputStream(tmp);
            o.write(s.getBytes(StandardCharsets.UTF_8));
            o.close();
            tmp.renameTo(f);
        } catch (Exception ignored) { }
    }

    void toast(String m) { runOnUiThread(() -> Toast.makeText(this, m, Toast.LENGTH_LONG).show()); }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == 42 && fileCb != null) {
            Uri[] r = null;
            if (res == RESULT_OK && data != null && data.getData() != null) r = new Uri[]{data.getData()};
            fileCb.onReceiveValue(r);
            fileCb = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (siteView.getVisibility() == View.VISIBLE) {
            showSite(false);
            appView.evaluateJavascript("window.jvOnReturnFromSite&&window.jvOnReturnFromSite()", null);
            return;
        }
        appView.evaluateJavascript("(window.jvBack&&window.jvBack())?'1':'0'", v -> {
            if (!"\"1\"".equals(v)) finish();
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        pausedAt = System.currentTimeMillis();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!prefs.getBoolean("lock", false)) { unlocked = true; root.setVisibility(View.VISIBLE); return; }
        if (unlocked && System.currentTimeMillis() - pausedAt < 60000) return;
        unlocked = false;
        int auth = BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
        if (BiometricManager.from(this).canAuthenticate(auth) != BiometricManager.BIOMETRIC_SUCCESS) {
            unlocked = true; return;
        }
        root.setVisibility(View.INVISIBLE);
        BiometricPrompt p = new BiometricPrompt(this, ContextCompat.getMainExecutor(this), new BiometricPrompt.AuthenticationCallback() {
            @Override public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult r) {
                unlocked = true; root.setVisibility(View.VISIBLE);
            }
            @Override public void onAuthenticationError(int code, @NonNull CharSequence s) {
                if (!unlocked) finish();
            }
        });
        p.authenticate(new BiometricPrompt.PromptInfo.Builder()
                .setTitle("JV Stock Issue")
                .setSubtitle("Unlock to continue")
                .setAllowedAuthenticators(auth)
                .build());
    }

    final BroadcastReceiver dlReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            long id = i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
            if (id != updateDownloadId) return;
            File f = new File(getExternalFilesDir(null), "updates/jv-stock-issue.apk");
            if (!f.exists()) { toast("Update download failed."); return; }
            Uri u = FileProvider.getUriForFile(MainActivity.this, "com.jv.stockissue.files", f);
            Intent inst = new Intent(Intent.ACTION_VIEW);
            inst.setDataAndType(u, "application/vnd.android.package-archive");
            inst.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            try { startActivity(inst); } catch (Exception e) { toast("Could not open the installer."); }
        }
    };

    public class Bridge {
        @JavascriptInterface public String storeGet() { return readFile(dataFile); }
        @JavascriptInterface public void storeSet(String s) { writeFile(dataFile, s); }
        @JavascriptInterface public String jobGet() { return readFile(jobFile); }
        @JavascriptInterface public void jobSet(String s) { writeFile(jobFile, s == null ? "" : s); }

        @JavascriptInterface public void startJob(String j) {
            writeFile(jobFile, j);
            runOnUiThread(() -> { showSite(true); siteView.loadUrl(SITE_ISSUE); });
        }
        @JavascriptInterface public void openSite() {
            runOnUiThread(() -> {
                showSite(true);
                String u = siteView.getUrl();
                if (u == null || !u.contains("cuchd.in")) siteView.loadUrl(SITE_ISSUE);
            });
        }
        @JavascriptInterface public void siteGo(String url) { runOnUiThread(() -> siteView.loadUrl(url)); }
        @JavascriptInterface public void showApp() {
            runOnUiThread(() -> {
                showSite(false);
                appView.evaluateJavascript("window.jvOnReturnFromSite&&window.jvOnReturnFromSite()", null);
            });
        }
        @JavascriptInterface public void siteEvent(String json) {
            runOnUiThread(() -> appView.evaluateJavascript(
                    "window.onSiteEvent&&window.onSiteEvent(" + JSONObject.quote(json) + ")", null));
        }
        @JavascriptInterface public String lastAlert() { return lastAlert; }
        @JavascriptInterface public void clearAlert() { lastAlert = ""; }

        @JavascriptInterface public String saveFile(String b64, String name, String mime) {
            try {
                byte[] data = Base64.decode(b64, Base64.DEFAULT);
                Uri out;
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    cv.put(MediaStore.Downloads.MIME_TYPE, mime);
                    cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/JV Stock Issue");
                    out = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    OutputStream os = getContentResolver().openOutputStream(out);
                    os.write(data);
                    os.close();
                } else {
                    File dir = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "");
                    dir.mkdirs();
                    File f = new File(dir, name);
                    FileOutputStream os = new FileOutputStream(f);
                    os.write(data);
                    os.close();
                    out = FileProvider.getUriForFile(MainActivity.this, "com.jv.stockissue.files", f);
                }
                final Uri fu = out;
                runOnUiThread(() -> new AlertDialog.Builder(MainActivity.this)
                        .setTitle("Saved")
                        .setMessage(name + " saved in Downloads/JV Stock Issue.")
                        .setPositiveButton("Open", (d, w) -> {
                            Intent i = new Intent(Intent.ACTION_VIEW);
                            i.setDataAndType(fu, mime);
                            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            try { startActivity(i); } catch (Exception e) { toast("No app found to open this file."); }
                        })
                        .setNeutralButton("Share", (d, w) -> {
                            Intent i = new Intent(Intent.ACTION_SEND);
                            i.setType(mime);
                            i.putExtra(Intent.EXTRA_STREAM, fu);
                            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            startActivity(Intent.createChooser(i, "Share " + name));
                        })
                        .setNegativeButton("Close", null)
                        .show());
                return "ok";
            } catch (Exception e) {
                return "error: " + e.getMessage();
            }
        }

        @JavascriptInterface public String info() {
            try {
                JSONObject o = new JSONObject();
                o.put("native", 1);
                o.put("version", getPackageManager().getPackageInfo(getPackageName(), 0).versionName);
                o.put("code", getPackageManager().getPackageInfo(getPackageName(), 0).versionCode);
                o.put("pages", BuildConfig.PAGES_URL);
                o.put("repo", BuildConfig.REPO);
                o.put("mode", mode());
                o.put("bundled", usingBundled);
                o.put("lock", prefs.getBoolean("lock", false));
                return o.toString();
            } catch (Exception e) { return "{}"; }
        }
        @JavascriptInterface public void setMode(String m) {
            prefs.edit().putString("mode", m).apply();
            if ("online".equals(m)) fetchFillScript();
            runOnUiThread(MainActivity.this::loadApp);
        }
        @JavascriptInterface public void reloadApp() { fetchFillScript(); runOnUiThread(MainActivity.this::loadApp); }
        @JavascriptInterface public void setLock(boolean on) { prefs.edit().putBoolean("lock", on).apply(); unlocked = true; }
        @JavascriptInterface public void openUrl(String u) { openExternal(u); }
        @JavascriptInterface public void toast(String m) { MainActivity.this.toast(m); }

        @JavascriptInterface public void installUpdate(String url) {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                    toast("Allow 'Install unknown apps' for JV Stock Issue, then tap Update again.");
                    startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
                    return;
                }
                File dir = new File(getExternalFilesDir(null), "updates");
                dir.mkdirs();
                File f = new File(dir, "jv-stock-issue.apk");
                if (f.exists()) f.delete();
                DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
                r.setTitle("JV Stock Issue update");
                r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
                r.setDestinationUri(Uri.fromFile(f));
                if (!dlRegistered) {
                    ContextCompat.registerReceiver(MainActivity.this, dlReceiver,
                            new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), ContextCompat.RECEIVER_EXPORTED);
                    dlRegistered = true;
                }
                updateDownloadId = dm.enqueue(r);
                toast("Downloading update…");
            });
        }
    }
}
