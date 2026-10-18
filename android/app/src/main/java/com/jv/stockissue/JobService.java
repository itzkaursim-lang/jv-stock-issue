package com.jv.stockissue;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/** Keeps the app alive while a CUIMS entry is running, and shows live progress with quick buttons. */
public class JobService extends Service {
    static final int ID = 77;
    PowerManager.WakeLock wl;

    static Notification build(android.content.Context c, String title, String text, int done, int total, boolean ongoing, boolean paused) {
        Intent open = new Intent(c, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra("showSite", true);
        PendingIntent pOpen = PendingIntent.getActivity(c, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Bitmap logo = null;
        try { logo = BitmapFactory.decodeResource(c.getResources(), R.mipmap.ic_launcher); } catch (Exception ignored) { }
        NotificationCompat.Builder nb = new NotificationCompat.Builder(c, "jvjob")
                .setSmallIcon(android.R.drawable.ic_popup_sync)
                .setLargeIcon(logo)
                .setContentTitle(title)
                .setContentText(text)
                .setSubText(total > 0 ? done + " of " + total : null)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setOnlyAlertOnce(true)
                .setOngoing(ongoing)
                .setShowWhen(false)
                .setColorized(true)
                .setColor(0xFFB9A7FF)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                .setContentIntent(pOpen)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        if (total > 0) nb.setProgress(total, done, false);
        if (ongoing) {
            nb.addAction(0, paused ? "Resume" : "Pause", act(c, paused ? "resume" : "pause", 2));
            nb.addAction(0, "Open", pOpen);
            nb.addAction(0, "Cancel", act(c, "cancel", 3));
        }
        return nb.build();
    }

    static PendingIntent act(android.content.Context c, String cmd, int req) {
        Intent i = new Intent("com.jv.stockissue.ACT");
        i.setPackage(c.getPackageName());
        i.putExtra("cmd", cmd);
        return PendingIntent.getBroadcast(c, req, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    @Override public int onStartCommand(Intent in, int flags, int startId) {
        String title = in != null ? in.getStringExtra("title") : "JV Stock Issue";
        String text = in != null ? in.getStringExtra("text") : "";
        int done = in != null ? in.getIntExtra("done", 0) : 0, total = in != null ? in.getIntExtra("total", 0) : 0;
        boolean paused = in != null && in.getBooleanExtra("paused", false);
        Notification n = build(this, title == null ? "JV Stock Issue" : title, text == null ? "" : text, done, total, true, paused);
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
