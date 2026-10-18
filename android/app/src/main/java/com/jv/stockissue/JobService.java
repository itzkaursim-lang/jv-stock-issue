package com.jv.stockissue;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Typeface;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
import android.text.style.StyleSpan;
import android.view.View;
import android.widget.RemoteViews;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONObject;

/** Keeps the app alive while a CUIMS entry runs, and shows the premium live notification. */
public class JobService extends Service {
    static final int ID = 77;
    PowerManager.WakeLock wl;

    static CharSequence serial(String s) {
        SpannableStringBuilder b = new SpannableStringBuilder(s == null ? "" : s);
        if (s != null && s.length() > 2) {
            int i = s.length() - 2;
            b.setSpan(new StyleSpan(Typeface.BOLD), i, s.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            b.setSpan(new ForegroundColorSpan(0xFF12A36B), i, s.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            b.setSpan(new RelativeSizeSpan(1.35f), i, s.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        return b;
    }

    static PendingIntent act(Context c, String cmd, int req) {
        Intent i = new Intent("com.jv.stockissue.ACT");
        i.setPackage(c.getPackageName());
        i.putExtra("cmd", cmd);
        return PendingIntent.getBroadcast(c, req, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static PendingIntent open(Context c) {
        Intent o = new Intent(c, MainActivity.class);
        o.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        o.putExtra("showSite", true);
        return PendingIntent.getActivity(c, 1, o, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static Notification build(Context c, JSONObject d, boolean ongoing) {
        String kind = d.optString("kind", "fill");
        int done = d.optInt("done", 0), total = d.optInt("total", 0);
        int pct = total > 0 ? Math.round(done * 100f / total) : 0;
        boolean ok = "saved".equals(kind) || "ready".equals(kind);
        String ringTxt = total > 0 ? done + "/" + total : "";

        RemoteViews sm = new RemoteViews(c.getPackageName(), R.layout.notif_small);
        sm.setTextViewText(R.id.n_over, d.optString("over"));
        sm.setTextViewText(R.id.n_title, d.optString("title"));
        sm.setTextViewText(R.id.n_sub, d.optString("sub"));
        boolean showSerial = "saved".equals(kind) && d.optString("serial").length() > 0;
        sm.setViewVisibility(R.id.n_ringbox, showSerial || total == 0 ? View.GONE : View.VISIBLE);
        sm.setViewVisibility(R.id.n_serial, showSerial ? View.VISIBLE : View.GONE);
        sm.setTextViewText(R.id.n_serial, serial(d.optString("serial")));
        sm.setViewVisibility(R.id.n_ring, ok ? View.GONE : View.VISIBLE);
        sm.setViewVisibility(R.id.n_ring_ok, ok ? View.VISIBLE : View.GONE);
        sm.setProgressBar(R.id.n_ring, 100, pct, false);
        sm.setProgressBar(R.id.n_ring_ok, 100, pct, false);
        sm.setTextViewText(R.id.n_ringtxt, ringTxt);

        RemoteViews bg = new RemoteViews(c.getPackageName(), R.layout.notif_big);
        bg.setTextViewText(R.id.b_over, d.optString("bigOver", d.optString("over")));
        bg.setTextViewText(R.id.b_title, d.optString("title"));
        bg.setTextViewText(R.id.b_req, d.optString("req", "–"));
        bg.setTextViewText(R.id.b_slip, d.optString("slip", "–"));
        bg.setViewVisibility(R.id.b_ringbox, total == 0 ? View.GONE : View.VISIBLE);
        bg.setViewVisibility(R.id.b_ring, ok ? View.GONE : View.VISIBLE);
        bg.setViewVisibility(R.id.b_ring_ok, ok ? View.VISIBLE : View.GONE);
        bg.setProgressBar(R.id.b_ring, 100, pct, false);
        bg.setProgressBar(R.id.b_ring_ok, 100, pct, false);
        bg.setTextViewText(R.id.b_ringtxt, ringTxt);
        bg.setTextViewText(R.id.b_now, d.optString("now"));
        bg.setTextViewText(R.id.b_nowsub, d.optString("nowSub"));
        int card = R.drawable.n_now, ic = R.drawable.ic_n_plus, icBg = R.drawable.n_ic_lav, nowCol = 0xFFFFFFFF, subCol = 0xFFC9C5D6;
        if ("ready".equals(kind)) { card = d.optBoolean("allOk", true) ? R.drawable.n_ok : R.drawable.n_warn; ic = R.drawable.ic_n_check; icBg = R.drawable.n_ic_green; nowCol = 0xFF141414; subCol = 0xFF4E5A55; }
        else if ("paused".equals(kind)) { card = R.drawable.n_warn; ic = R.drawable.ic_n_pause; icBg = R.drawable.n_ic_amber; nowCol = 0xFF141414; subCol = 0xFF6E5A2A; }
        else if ("saved".equals(kind)) { card = R.drawable.n_ok; ic = R.drawable.ic_n_check; icBg = R.drawable.n_ic_green; nowCol = 0xFF141414; subCol = 0xFF4E5A55; }
        else if ("capture".equals(kind)) { ic = R.drawable.ic_n_search; }
        bg.setInt(R.id.b_card, "setBackgroundResource", card);
        bg.setImageViewResource(R.id.b_cardic, ic);
        bg.setInt(R.id.b_cardic, "setBackgroundResource", icBg);
        bg.setTextColor(R.id.b_now, nowCol);
        bg.setTextColor(R.id.b_nowsub, subCol);
        bg.setViewVisibility(R.id.b_serial, showSerial ? View.VISIBLE : View.GONE);
        bg.setTextViewText(R.id.b_serial, serial(d.optString("serial")));
        boolean bar = total > 0 && !"saved".equals(kind) && !"ready".equals(kind);
        bg.setViewVisibility(R.id.b_bar, bar ? View.VISIBLE : View.GONE);
        bg.setProgressBar(R.id.b_bar, 100, pct, false);
        bg.setTextViewText(R.id.b_metal, d.optString("metaL"));
        bg.setTextViewText(R.id.b_metar, d.optString("metaR"));

        int[] ids = {R.id.b_btn1, R.id.b_btn2, R.id.b_btn3};
        String[] keys = {"b1", "b2", "b3"};
        boolean anyBtn = false;
        for (int k = 0; k < 3; k++) {
            String spec = d.optString(keys[k]);
            if (spec.isEmpty()) { bg.setViewVisibility(ids[k], View.GONE); continue; }
            anyBtn = true;
            String[] p = spec.split("\\|", 2);
            String label = p[0], cmd = p.length > 1 ? p[1] : "open";
            bg.setViewVisibility(ids[k], View.VISIBLE);
            bg.setTextViewText(ids[k], label);
            bg.setOnClickPendingIntent(ids[k], "open".equals(cmd) ? open(c) : act(c, cmd, 10 + k + cmd.hashCode() % 50));
        }
        bg.setViewVisibility(R.id.b_acts, anyBtn ? View.VISIBLE : View.GONE);

        NotificationCompat.Builder nb = new NotificationCompat.Builder(c, "jvjob")
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(d.optString("title"))
                .setContentText(d.optString("sub"))
                .setStyle(new NotificationCompat.DecoratedCustomViewStyle())
                .setCustomContentView(sm)
                .setCustomBigContentView(bg)
                .setOnlyAlertOnce(true)
                .setOngoing(ongoing)
                .setShowWhen(!ongoing)
                .setColor(0xFFB9A7FF)
                .setSubText(d.optString("tag"))
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                .setContentIntent(open(c))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        return nb.build();
    }

    @Override public int onStartCommand(Intent in, int flags, int startId) {
        JSONObject d;
        try { d = new JSONObject(in != null && in.getStringExtra("data") != null ? in.getStringExtra("data") : "{}"); } catch (Exception e) { d = new JSONObject(); }
        Notification n = build(this, d, true);
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            else startForeground(ID, n);
        } catch (Exception e) {
            try { NotificationManagerCompat.from(this).notify(ID, n); } catch (SecurityException ignored) { }
        }
        if (wl == null) {
            try {
                wl = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "jv:job");
                wl.acquire(3 * 60 * 60 * 1000L);
            } catch (Exception ignored) { }
        }
        return START_NOT_STICKY;
    }

    @Override public void onDestroy() {
        try { if (wl != null && wl.isHeld()) wl.release(); } catch (Exception ignored) { }
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent i) { return null; }
}
