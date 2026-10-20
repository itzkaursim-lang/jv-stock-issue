package com.jv.stockissue;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import android.Manifest;
import android.content.pm.PackageManager;
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
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
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
import androidx.webkit.ProfileStore;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

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

    static final String DEF_ISSUE = "https://staff.cuchd.in/frmStoreIssueReceiveLC.aspx";
    static final String DEF_MGR = "https://staff.cuchd.in/frmItemStatementLC.aspx";
    static final String ASSET_URL = "file:///android_asset/www/index.html";
    static final String DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    FrameLayout root;
    WebView appView, siteView, mgrView;
    android.widget.ImageView cover;
    android.widget.LinearLayout shield;
    android.widget.TextView shieldMsg;
    java.util.ArrayList<android.animation.Animator> shieldAnims = new java.util.ArrayList<>();
    boolean coverMode = false;
    final java.util.HashMap<String, Boolean> painted = new java.util.HashMap<>();
    final android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
    final Runnable uncoverR = () -> { if (cover != null) { cover.setVisibility(View.GONE); cover.setImageBitmap(null); } if (shield != null && shield.getVisibility() == View.VISIBLE) { shield.animate().alpha(0f).setDuration(180).withEndAction(() -> { shield.setVisibility(View.GONE); shield.setAlpha(1f); for (android.animation.Animator a : shieldAnims) a.cancel(); }).start(); } };
    SharedPreferences prefs;
    File dataFile, jobFile, fillCache;
    ValueCallback<Uri[]> fileCb;
    String lastAlert = "";
    boolean unlocked = false, usingBundled = false, mgrSeparate = false, dlRegistered = false;
    long pausedAt = 0, updateDownloadId = -1;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences("jv", MODE_PRIVATE);
        dataFile = new File(getFilesDir(), "data.json");
        jobFile = new File(getFilesDir(), "job.json");
        fillCache = new File(getFilesDir(), "fill.js");

        root = new FrameLayout(this);
        appView = makeView(null);
        siteView = makeView(null);
        mgrView = makeView("manager");
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        root.addView(siteView, lp);
        cover = new android.widget.ImageView(this);
        cover.setScaleType(android.widget.ImageView.ScaleType.FIT_XY);
        cover.setVisibility(View.GONE);
        cover.setClickable(true);
        root.addView(cover, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        buildShield();
        root.addView(shield, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(mgrView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(appView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        siteView.setVisibility(View.GONE);
        mgrView.setVisibility(View.GONE);
        setContentView(root);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(siteView, true);

        appView.addJavascriptInterface(new Bridge("app"), "JVS");
        siteView.addJavascriptInterface(new Bridge("emp"), "JVS");
        mgrView.addJavascriptInterface(new Bridge("mgr"), "JVS");

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
                if (r.isForMainFrame() && !usingBundled) { usingBundled = true; v.loadUrl(ASSET_URL); }
            }
            @Override
            public void onReceivedHttpError(WebView v, WebResourceRequest r, WebResourceResponse resp) {
                if (r.isForMainFrame() && !usingBundled && resp.getStatusCode() >= 400) { usingBundled = true; v.loadUrl(ASSET_URL); }
            }
        });
        appView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView w, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                String[] acc = p.getAcceptTypes();
                boolean img = acc != null && acc.length > 0 && acc[0] != null && acc[0].startsWith("image");
                if (img) {
                    i.setType("image/*");
                } else {
                    i.setType("*/*");
                    i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                            "application/vnd.ms-excel", "text/csv", "text/comma-separated-values", "text/plain", "application/octet-stream"});
                }
                try { startActivityForResult(i, 42); } catch (Exception ex) { fileCb = null; return false; }
                return true;
            }
        });

        setupSite(siteView, "emp");
        setupSite(mgrView, "mgr");

        fetchFillScript();
        loadApp();
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel("jvjob", "Live entry progress", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shows the CUIMS entry the app is filling");
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(ch);
        }
        ContextCompat.registerReceiver(this, actReceiver, new IntentFilter("com.jv.stockissue.ACT"), ContextCompat.RECEIVER_NOT_EXPORTED);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7);
        }
    }

    boolean svcOn = false;
    void postData(String json, boolean ongoing) {
        try {
            JSONObject d = new JSONObject(json);
            if (ongoing) {
                if (!svcOn) { Intent si = new Intent(this, JobService.class); si.putExtra("data", json); ContextCompat.startForegroundService(this, si); svcOn = true; }
                else NotificationManagerCompat.from(this).notify(JobService.ID, JobService.build(this, d, true));
            } else {
                if (svcOn) { stopService(new Intent(this, JobService.class)); svcOn = false; }
                NotificationManagerCompat.from(this).notify(JobService.ID, JobService.build(this, d, false));
            }
        } catch (SecurityException ignored) { } catch (Exception ignored) { }
    }
    void postProgress(String title, String text, int done, int total, boolean ongoing) {
        try { JSONObject d = new JSONObject(); d.put("title", title); d.put("sub", text); d.put("done", done); d.put("total", total); d.put("kind", text != null && text.startsWith("Paused") ? "paused" : "fill"); postData(d.toString(), ongoing); } catch (Exception ignored) { }
    }

    final BroadcastReceiver actReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            String cmd = i.getStringExtra("cmd");
            if (cmd == null) return;
            siteView.evaluateJavascript("window.JVFill&&window.JVFill.cmd&&window.JVFill.cmd(" + JSONObject.quote(cmd) + ")", null);
        }
    };

    void setFull(boolean on) {
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), root);
        if (on) {
            c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            c.hide(WindowInsetsCompat.Type.systemBars());
        } else c.show(WindowInsetsCompat.Type.systemBars());
    }

    WebView makeView(String profile) {
        WebView w = new WebView(this);
        if (profile != null) {
            try {
                if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
                    ProfileStore.getInstance().getOrCreateProfile(profile);
                    WebViewCompat.setProfile(w, profile);
                    mgrSeparate = true;
                }
            } catch (Throwable t) { mgrSeparate = false; }
        }
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        return w;
    }

    void setupSite(WebView v, String who) {
        WebSettings s = v.getSettings();
        s.setUserAgentString(DESKTOP_UA);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setTextZoom(100);
        s.setLayoutAlgorithm(WebSettings.LayoutAlgorithm.NORMAL);
        s.setOffscreenPreRaster(true);
        float sc = prefs.getFloat("scale_" + who, 0f);
        if (sc > 0) v.setInitialScale(Math.round(sc * 100));
        v.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView wv, WebResourceRequest r) {
                String host = r.getUrl().getHost();
                if (host != null && host.endsWith("cuchd.in")) return false;
                openExternal(r.getUrl().toString());
                return true;
            }
            @Override
            public void onPageStarted(WebView wv, String url, android.graphics.Bitmap fav) {
                if (prefs.getBoolean("cover_" + who, false) && wv.getVisibility() == View.VISIBLE) {
                    boolean snap = Boolean.TRUE.equals(painted.get(who)) && wv.getWidth() > 0 && wv.getHeight() > 0;
                    painted.put(who, false);
                    if (snap) {
                        try {
                            android.graphics.Bitmap bm = android.graphics.Bitmap.createBitmap(wv.getWidth(), wv.getHeight(), android.graphics.Bitmap.Config.RGB_565);
                            wv.draw(new android.graphics.Canvas(bm));
                            cover.setImageBitmap(bm);
                            cover.setVisibility(View.VISIBLE);
                        } catch (Throwable t) { showShield("mgr".equals(who) ? "Loading Manager CUIMS" : "Loading the next step"); }
                    } else showShield("mgr".equals(who) ? "Loading Manager CUIMS" : "Loading the next step");
                    h.removeCallbacks(uncoverR);
                    h.postDelayed(uncoverR, 12000);
                }
                float sc2 = prefs.getFloat("scale_" + who, 0f);
                if (sc2 > 0) wv.setInitialScale(Math.round(sc2 * 100));
            }
            @Override
            public void onPageCommitVisible(WebView wv, String url) { injectFill(wv); }
            @Override
            public void onPageFinished(WebView wv, String url) { injectFill(wv); }
            @Override
            public void onScaleChanged(WebView wv, float oldScale, float newScale) {
                prefs.edit().putFloat("scale_" + who, newScale).apply();
            }
        });
        v.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView wv, String url, String msg, JsResult res) {
                lastAlert = msg == null ? "" : msg;
                String jb = readFile(jobFile);
                if ("emp".equals(who) && (jb.contains("\"phase\":\"capture\"") || jb.contains("\"phase\":\"await\""))) {
                    // entry already submitted: take the message (Serial No) silently, no popup
                    res.confirm();
                    wv.evaluateJavascript("window.JVFill&&window.JVFill.onAlertClosed&&window.JVFill.onAlertClosed()", null);
                    return true;
                }
                new AlertDialog.Builder(MainActivity.this)
                        .setTitle("CUIMS says")
                        .setMessage(lastAlert)
                        .setCancelable(false)
                        .setPositiveButton("OK", (d, w2) -> {
                            res.confirm();
                            wv.evaluateJavascript("window.JVFill&&window.JVFill.onAlertClosed&&window.JVFill.onAlertClosed()", null);
                        })
                        .show();
                return true;
            }
        });
        v.setDownloadListener((url, ua, cd, mime, len) -> {
            if ("mgr".equals(who) && prefs.getBoolean("autoStockOn", false)) { fetchStock(url, URLUtil.guessFileName(url, cd, mime)); return; }
            try {
                String name = URLUtil.guessFileName(url, cd, mime);
                DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
                CookieManager c = CookieManager.getInstance();
                try {
                    if ("mgr".equals(who) && mgrSeparate) c = ProfileStore.getInstance().getProfile("manager").getCookieManager();
                } catch (Throwable ignored) { }
                String ck = c.getCookie(url);
                if (ck != null) r.addRequestHeader("Cookie", ck);
                r.addRequestHeader("User-Agent", DESKTOP_UA);
                r.setMimeType(mime);
                r.setTitle(name);
                r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
                toast("Downloading " + name + " to Downloads…");
            } catch (Exception e) { toast("Download failed: " + e.getMessage()); }
        });
    }

    boolean online() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            NetworkCapabilities nc = cm.getNetworkCapabilities(cm.getActiveNetwork());
            return nc != null && nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Exception e) { return false; }
    }

    String mode() { return prefs.getString("mode", "online"); }
    String url(String who) { return "mgr".equals(who) ? prefs.getString("url_mgr", DEF_MGR) : prefs.getString("url_emp", DEF_ISSUE); }

    void loadApp() {
        usingBundled = !"online".equals(mode()) || !online();
        if (usingBundled) appView.loadUrl(ASSET_URL);
        else appView.loadUrl(BuildConfig.PAGES_URL + "index.html?b=" + (System.currentTimeMillis() / 300000L));
    }

    void fetchFillScript() {
        if (!"online".equals(mode())) return;
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(BuildConfig.PAGES_URL + "fill.js?t=" + System.currentTimeMillis()).openConnection();
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

    void injectFill(WebView v) {
        String src = fillSource();
        if (!src.isEmpty()) v.evaluateJavascript(src, null);
    }

    void loadFresh(WebView v, String who, String u) {
        long at = prefs.getLong("login_" + who, 0);
        if (at > 0 && System.currentTimeMillis() - at > 3600000L) {
            prefs.edit().putLong("login_" + who, 0).apply();
            CookieManager c = CookieManager.getInstance();
            try { if ("mgr".equals(who) && mgrSeparate) c = ProfileStore.getInstance().getProfile("manager").getCookieManager(); } catch (Throwable ignored) { }
            final CookieManager cm = c;
            cm.removeAllCookies(ok -> { cm.flush(); v.loadUrl(u); });
            toast("Login is over 1 hour old. Logging in fresh…");
            return;
        }
        v.loadUrl(u);
    }

    void fetchStock(String url, String name) {
        CookieManager c0 = CookieManager.getInstance();
        try { if (mgrSeparate) c0 = ProfileStore.getInstance().getProfile("manager").getCookieManager(); } catch (Throwable ignored) { }
        final String ck = c0.getCookie(url);
        mgrView.evaluateJavascript("window.JVFill&&window.JVFill.autoMsg&&window.JVFill.autoMsg('download')", null);
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                if (ck != null) c.setRequestProperty("Cookie", ck);
                c.setRequestProperty("User-Agent", DESKTOP_UA);
                c.setConnectTimeout(20000); c.setReadTimeout(120000);
                InputStream in = c.getInputStream();
                ByteArrayOutputStream bo = new ByteArrayOutputStream(); byte[] buf = new byte[16384]; int n;
                while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                in.close(); c.disconnect();
                String b64 = Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
                String nm = name == null ? "stock.xlsx" : name;
                runOnUiThread(() -> {
                    prefs.edit().putBoolean("autoStockOn", false).putBoolean("cover_mgr", false).apply();
                    setFull(false); coverMode = false; h.post(uncoverR);
                    appView.evaluateJavascript("window.jvStockFile&&window.jvStockFile(" + JSONObject.quote(b64) + "," + JSONObject.quote(nm) + ")", null);
                    backToApp();
                });
            } catch (Exception e) {
                runOnUiThread(() -> mgrView.evaluateJavascript("window.JVFill&&window.JVFill.autoMsg&&window.JVFill.autoMsg('fail'," + JSONObject.quote(String.valueOf(e.getMessage())) + ")", null));
            }
        }).start();
    }

    int dp(float v) { return Math.round(v * getResources().getDisplayMetrics().density); }
    void buildShield() {
        shield = new android.widget.LinearLayout(this);
        shield.setOrientation(android.widget.LinearLayout.VERTICAL);
        shield.setGravity(android.view.Gravity.CENTER);
        shield.setBackgroundColor(0xFFF2F1F6);
        shield.setClickable(true);
        FrameLayout orb = new FrameLayout(this);
        int[] rings = {R.drawable.sh_ring_pnk, R.drawable.sh_ring_lav, R.drawable.sh_ring_org};
        int[] sizes = {150, 128, 104};
        long[] speeds = {2200, 1100, 1600};
        for (int i = 0; i < 3; i++) {
            android.widget.ImageView r = new android.widget.ImageView(this);
            r.setImageResource(rings[i]);
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(dp(sizes[i]), dp(sizes[i]), android.view.Gravity.CENTER);
            orb.addView(r, lp);
            android.animation.ObjectAnimator an = android.animation.ObjectAnimator.ofFloat(r, "rotation", i == 1 ? 360f : 0f, i == 1 ? 0f : 360f);
            an.setDuration(speeds[i]); an.setRepeatCount(android.animation.ValueAnimator.INFINITE); an.setInterpolator(new android.view.animation.LinearInterpolator());
            shieldAnims.add(an);
        }
        android.widget.ImageView lg = new android.widget.ImageView(this);
        lg.setImageResource(R.mipmap.ic_launcher);
        lg.setElevation(dp(10));
        orb.addView(lg, new FrameLayout.LayoutParams(dp(68), dp(68), android.view.Gravity.CENTER));
        android.animation.ObjectAnimator bob = android.animation.ObjectAnimator.ofFloat(lg, "translationY", 0f, -dp(7), 0f);
        bob.setDuration(1400); bob.setRepeatCount(android.animation.ValueAnimator.INFINITE); bob.setInterpolator(new android.view.animation.AccelerateDecelerateInterpolator());
        shieldAnims.add(bob);
        android.animation.ObjectAnimator tilt = android.animation.ObjectAnimator.ofFloat(lg, "rotation", 0f, -6f, 0f);
        tilt.setDuration(1400); tilt.setRepeatCount(android.animation.ValueAnimator.INFINITE);
        shieldAnims.add(tilt);
        shield.addView(orb, new android.widget.LinearLayout.LayoutParams(dp(160), dp(160)));
        android.widget.TextView t1 = new android.widget.TextView(this);
        t1.setText("JV Stock Issue"); t1.setTextSize(20); t1.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD)); t1.setTextColor(0xFF141414);
        t1.setGravity(android.view.Gravity.CENTER); t1.setPadding(0, dp(14), 0, 0);
        shield.addView(t1);
        shieldMsg = new android.widget.TextView(this);
        shieldMsg.setText("Working on CUIMS"); shieldMsg.setTextSize(14.5f); shieldMsg.setTextColor(0xFF6E6B7B); shieldMsg.setGravity(android.view.Gravity.CENTER); shieldMsg.setPadding(0, dp(4), 0, dp(14));
        shield.addView(shieldMsg);
        FrameLayout track = new FrameLayout(this);
        track.setBackgroundResource(R.drawable.sh_track);
        View thumb = new View(this);
        thumb.setBackgroundResource(R.drawable.sh_thumb);
        track.addView(thumb, new FrameLayout.LayoutParams(dp(56), dp(6)));
        track.setClipChildren(true);
        shield.addView(track, new android.widget.LinearLayout.LayoutParams(dp(150), dp(6)));
        android.animation.ObjectAnimator sl = android.animation.ObjectAnimator.ofFloat(thumb, "translationX", -dp(56), dp(150));
        sl.setDuration(1100); sl.setRepeatCount(android.animation.ValueAnimator.INFINITE); sl.setInterpolator(new android.view.animation.AccelerateDecelerateInterpolator());
        shieldAnims.add(sl);
        android.widget.TextView t3 = new android.widget.TextView(this);
        t3.setText("Your work keeps going in the background"); t3.setTextSize(12); t3.setTextColor(0xFF9A97A8); t3.setGravity(android.view.Gravity.CENTER); t3.setPadding(0, dp(18), 0, 0);
        shield.addView(t3);
        shield.setVisibility(View.GONE);
    }
    void showShield(String msg) {
        if (shieldMsg != null && msg != null) shieldMsg.setText(msg);
        if (shield.getVisibility() != View.VISIBLE) {
            shield.setAlpha(0f); shield.setVisibility(View.VISIBLE); shield.animate().alpha(1f).setDuration(160).start();
            for (android.animation.Animator a : shieldAnims) if (!a.isStarted()) a.start();
        }
    }

    void show(String which) {
        if ("app".equals(which)) appView.bringToFront();
        else { WebView w = "mgr".equals(which) ? mgrView : siteView; w.bringToFront(); cover.bringToFront(); shield.bringToFront(); }
        siteView.setVisibility("emp".equals(which) ? View.VISIBLE : View.GONE);
        mgrView.setVisibility("mgr".equals(which) ? View.VISIBLE : View.GONE);
        appView.setVisibility("app".equals(which) ? View.VISIBLE : View.GONE);
    }

    void backToApp() {
        h.post(uncoverR);
        show("app");
        appView.evaluateJavascript("window.jvOnReturnFromSite&&window.jvOnReturnFromSite()", null);
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

    void authenticate(Runnable ok, Runnable fail) {
        int auth = BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
        if (BiometricManager.from(this).canAuthenticate(auth) != BiometricManager.BIOMETRIC_SUCCESS) { ok.run(); return; }
        BiometricPrompt p = new BiometricPrompt(this, ContextCompat.getMainExecutor(this), new BiometricPrompt.AuthenticationCallback() {
            @Override public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult r) { ok.run(); }
            @Override public void onAuthenticationError(int code, @NonNull CharSequence s) { fail.run(); }
        });
        p.authenticate(new BiometricPrompt.PromptInfo.Builder()
                .setTitle("JV Stock Issue")
                .setSubtitle("Confirm it's you")
                .setAllowedAuthenticators(auth)
                .build());
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        if (i != null && i.getBooleanExtra("showSite", false)) show("emp");
    }

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
        if (siteView.getVisibility() == View.VISIBLE || mgrView.getVisibility() == View.VISIBLE) { backToApp(); return; }
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
        if (pausedAt > 0 && System.currentTimeMillis() - pausedAt > 120000) {
            appView.evaluateJavascript("window.jvRelock&&window.jvRelock()", null);
        }
        if (!prefs.getBoolean("lock", false)) { unlocked = true; root.setVisibility(View.VISIBLE); return; }
        if (unlocked && System.currentTimeMillis() - pausedAt < 60000) return;
        unlocked = false;
        int auth = BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
        if (BiometricManager.from(this).canAuthenticate(auth) != BiometricManager.BIOMETRIC_SUCCESS) { unlocked = true; return; }
        root.setVisibility(View.INVISIBLE);
        authenticate(() -> { unlocked = true; root.setVisibility(View.VISIBLE); }, () -> { if (!unlocked) finish(); });
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
        final String who;
        Bridge(String w) { who = w; }

        @JavascriptInterface public String who() { return who; }
        @JavascriptInterface public void openMgrAuto(String cfg) {
            prefs.edit().putString("autoStockCfg", cfg).putBoolean("autoStockOn", true).putLong("autoStockAt", System.currentTimeMillis()).apply();
            prefs.edit().putBoolean("cover_mgr", true).apply();
            runOnUiThread(() -> { show("mgr"); setFull(true); showShield("Opening Manager CUIMS for live stock"); painted.put("mgr", false); h.removeCallbacks(uncoverR); h.postDelayed(uncoverR, 15000); loadFresh(mgrView, "mgr", url("mgr")); });
        }
        @JavascriptInterface public String autoCfg() {
            if (!"mgr".equals(who) || !prefs.getBoolean("autoStockOn", false)) return "";
            if (System.currentTimeMillis() - prefs.getLong("autoStockAt", 0) > 15 * 60000L) { prefs.edit().putBoolean("autoStockOn", false).apply(); return ""; }
            return prefs.getString("autoStockCfg", "");
        }
        @JavascriptInterface public void autoStop() { prefs.edit().putBoolean("autoStockOn", false).putBoolean("cover_mgr", false).apply(); runOnUiThread(() -> { setFull(false); coverMode = false; h.post(uncoverR); }); }
        @JavascriptInterface public void fetchStockUrl(String u) { if ("mgr".equals(who) && prefs.getBoolean("autoStockOn", false)) runOnUiThread(() -> fetchStock(u, "stock.xlsx")); }
        @JavascriptInterface public void setCover(boolean on) { prefs.edit().putBoolean("cover_" + who, on).apply(); coverMode = on; if (!on) runOnUiThread(uncoverR); }
        @JavascriptInterface public void uncover() { painted.put(who, true); h.removeCallbacks(uncoverR); h.postDelayed(uncoverR, 60); }
        @JavascriptInterface public void markLogin() { if (!"app".equals(who)) prefs.edit().putLong("login_" + who, System.currentTimeMillis()).apply(); }
        @JavascriptInterface public void progress(String title, String text, int done, int total, boolean ongoing) { runOnUiThread(() -> postProgress(title, text, done, total, ongoing)); }
        @JavascriptInterface public void progress2(String json, boolean ongoing) { runOnUiThread(() -> postData(json, ongoing)); }
        @JavascriptInterface public void progressClear() { runOnUiThread(() -> { try { if (svcOn) { stopService(new Intent(MainActivity.this, JobService.class)); svcOn = false; } NotificationManagerCompat.from(MainActivity.this).cancel(77); } catch (Exception ignored) { } }); }
        @JavascriptInterface public void setFullscreen(boolean on) { runOnUiThread(() -> setFull(on)); }
        @JavascriptInterface public void keepAwake(boolean on) { runOnUiThread(() -> { if (on) getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); else getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); }); }
        @JavascriptInterface public String getCred() {
            if ("app".equals(who)) return "";
            try { JSONObject o = new JSONObject(); o.put("u", prefs.getString("cu_" + who, "")); o.put("p", prefs.getString("cp_" + who, "")); o.put("auto", prefs.getBoolean("ca_" + who, true)); return o.toString(); } catch (Exception e) { return ""; }
        }
        @JavascriptInterface public void setCred(String forWho, String u, String p, boolean auto) {
            if (!"app".equals(who)) return;
            if (!"emp".equals(forWho) && !"mgr".equals(forWho)) return;
            String pw = "__keep__".equals(p) ? prefs.getString("cp_" + forWho, "") : (p == null ? "" : p);
            prefs.edit().putString("cu_" + forWho, u == null ? "" : u).putString("cp_" + forWho, pw).putBoolean("ca_" + forWho, auto).apply();
        }
        @JavascriptInterface public String credInfo() {
            if (!"app".equals(who)) return "{}";
            try { JSONObject o = new JSONObject();
                for (String w : new String[]{"emp", "mgr"}) { JSONObject x = new JSONObject(); x.put("u", prefs.getString("cu_" + w, "")); x.put("has", prefs.getString("cp_" + w, "").length() > 0); x.put("auto", prefs.getBoolean("ca_" + w, true)); o.put(w, x); }
                return o.toString(); } catch (Exception e) { return "{}"; }
        }
        @JavascriptInterface public String targetUrl() { return url(who); }
        @JavascriptInterface public String storeGet() { return readFile(dataFile); }
        @JavascriptInterface public void storeSet(String s) { writeFile(dataFile, s); }
        @JavascriptInterface public String jobGet() { return "mgr".equals(who) ? "" : readFile(jobFile); }
        @JavascriptInterface public void jobSet(String s) { if (!"mgr".equals(who)) writeFile(jobFile, s == null ? "" : s); }

        @JavascriptInterface public void startJob(String j) {
            writeFile(jobFile, j);
            runOnUiThread(() -> { show("emp"); if (prefs.getBoolean("cover_emp", false)) { showShield("Opening Issue CUIMS"); painted.put("emp", false); h.removeCallbacks(uncoverR); h.postDelayed(uncoverR, 15000); } loadFresh(siteView, "emp", url("emp")); });
        }
        @JavascriptInterface public void openSite() {
            runOnUiThread(() -> {
                show("emp");
                String u = siteView.getUrl();
                long at = prefs.getLong("login_emp", 0);
                if (u == null || !u.contains("cuchd.in") || (at > 0 && System.currentTimeMillis() - at > 3600000L)) loadFresh(siteView, "emp", url("emp"));
            });
        }
        @JavascriptInterface public void openMgr() {
            runOnUiThread(() -> {
                show("mgr");
                String u = mgrView.getUrl();
                long at = prefs.getLong("login_mgr", 0);
                if (u == null || !u.contains("cuchd.in") || (at > 0 && System.currentTimeMillis() - at > 3600000L)) loadFresh(mgrView, "mgr", url("mgr"));
            });
        }
        @JavascriptInterface public void setUrls(String emp, String mgr) {
            SharedPreferences.Editor e = prefs.edit();
            if (emp != null && emp.startsWith("https://")) e.putString("url_emp", emp);
            if (mgr != null && mgr.startsWith("https://")) e.putString("url_mgr", mgr);
            e.apply();
        }
        @JavascriptInterface public void resetZoom() {
            prefs.edit().remove("scale_emp").remove("scale_mgr").apply();
            runOnUiThread(() -> { siteView.setInitialScale(0); mgrView.setInitialScale(0); });
        }
        @JavascriptInterface public void siteGo(String u) { runOnUiThread(() -> ("mgr".equals(who) ? mgrView : siteView).loadUrl(u)); }
        @JavascriptInterface public void showApp() { runOnUiThread(MainActivity.this::backToApp); }
        @JavascriptInterface public void siteEvent(String json) {
            runOnUiThread(() -> appView.evaluateJavascript("window.onSiteEvent&&window.onSiteEvent(" + JSONObject.quote(json) + ")", null));
        }
        @JavascriptInterface public String lastAlert() { return lastAlert; }
        @JavascriptInterface public void clearAlert() { lastAlert = ""; }

        @JavascriptInterface public void authenticate() {
            runOnUiThread(() -> MainActivity.this.authenticate(
                    () -> appView.evaluateJavascript("window.jvAuth&&window.jvAuth(true)", null),
                    () -> appView.evaluateJavascript("window.jvAuth&&window.jvAuth(false)", null)));
        }

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
                    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
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
                            try { startActivity(i); } catch (Exception e) { MainActivity.this.toast("No app found to open this file."); }
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
                o.put("native", 2);
                o.put("version", getPackageManager().getPackageInfo(getPackageName(), 0).versionName);
                o.put("code", getPackageManager().getPackageInfo(getPackageName(), 0).versionCode);
                o.put("pages", BuildConfig.PAGES_URL);
                o.put("repo", BuildConfig.REPO);
                o.put("mode", mode());
                o.put("bundled", usingBundled);
                o.put("lock", prefs.getBoolean("lock", false));
                o.put("urlEmp", url("emp"));
                o.put("urlMgr", url("mgr"));
                o.put("mgrSeparate", mgrSeparate);
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

        @JavascriptInterface public void installUpdate(String u) {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                    MainActivity.this.toast("Allow 'Install unknown apps' for JV Stock Issue, then tap Update again.");
                    startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
                    return;
                }
                File dir = new File(getExternalFilesDir(null), "updates");
                dir.mkdirs();
                File f = new File(dir, "jv-stock-issue.apk");
                if (f.exists()) f.delete();
                DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                DownloadManager.Request r = new DownloadManager.Request(Uri.parse(u));
                r.setTitle("JV Stock Issue update");
                r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
                r.setDestinationUri(Uri.fromFile(f));
                if (!dlRegistered) {
                    ContextCompat.registerReceiver(MainActivity.this, dlReceiver,
                            new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), ContextCompat.RECEIVER_EXPORTED);
                    dlRegistered = true;
                }
                updateDownloadId = dm.enqueue(r);
                MainActivity.this.toast("Downloading update…");
            });
        }
    }
}
