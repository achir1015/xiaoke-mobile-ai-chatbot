package com.achir.xiaoke;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Bundle;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.util.ArrayDeque;

public class MainActivity extends Activity {
    private static final int RATE = 16000;
    private static final int FRAME = 480;              // 30ms
    private static final int FRAME_MS = 30;
    private static final int PREROLL_FRAMES = 10;      // 說話前保留 300ms

    private FaceView face;
    private final OpenAI ai = new OpenAI();
    private volatile boolean running;
    private volatile boolean manualListen;
    private volatile long lastActive = System.currentTimeMillis();
    private Thread worker;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        face = new FaceView(this);
        face.setStatus("嗨！我是" + Config.ROBOT_NAME + "，有什麼想聊的嗎？");
        face.setOnTouchListener(this::onTouch);
        face.setOnLongClickListener(v -> { showInfo(); return true; });
        setContentView(face);
        hideSystemUi();
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemUi();
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 1);
            return;
        }
        startWorker();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) startWorker();
        else face.setStatus("需要麥克風權限才能聊天喔");
    }

    @Override
    protected void onPause() {
        super.onPause();
        running = false;
        ai.stopSpeaking();
    }

    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    private long downAt;

    private boolean onTouch(View v, MotionEvent e) {
        if (e.getAction() == MotionEvent.ACTION_DOWN) downAt = System.currentTimeMillis();
        if (e.getAction() == MotionEvent.ACTION_UP && System.currentTimeMillis() - downAt < 500) {
            lastActive = System.currentTimeMillis();
            FaceView.State s = face.getState();
            if (s == FaceView.State.SPEAKING) ai.stopSpeaking();          // 打斷
            else if (s != FaceView.State.THINKING) manualListen = true;   // 點一下開始聽
        }
        return false;   // 讓長按事件繼續
    }

    private void showInfo() {
        String err = ai.lastError.isEmpty() ? "無" : ai.lastError;
        Toast.makeText(this, Config.ROBOT_NAME + " v1.0\n模型：" + Config.CHAT_MODEL
                + "\n最近錯誤：" + err + "\n（對話記憶已清除）", Toast.LENGTH_LONG).show();
        ai.clearHistory();
    }

    // ---------------- 主迴圈 ----------------
    private synchronized void startWorker() {
        if (running && worker != null && worker.isAlive()) return;
        running = true;
        worker = new Thread(this::loop, "xiaoke");
        worker.start();
    }

    private void loop() {
        AudioRecord rec = openMic();
        if (rec == null) {
            face.setState(FaceView.State.ERROR);
            face.setStatus("打不開麥克風（可能被小愛同學佔用）");
            running = false;
            return;
        }
        short[] buf = new short[FRAME];
        double noise = 150;
        ArrayDeque<short[]> preroll = new ArrayDeque<>();
        face.setState(FaceView.State.IDLE);
        try {
            rec.startRecording();
            while (running) {
                int n = rec.read(buf, 0, FRAME);
                if (n <= 0) continue;
                double rms = rms(buf, n);
                boolean loud = Config.VOICE_ACTIVATION
                        && rms > Math.max(Config.VAD_MIN_RMS, noise * Config.VAD_RATIO);

                if (!loud && !manualListen) {
                    noise = noise * 0.97 + rms * 0.03;
                    preroll.addLast(buf.clone());
                    if (preroll.size() > PREROLL_FRAMES) preroll.removeFirst();
                    updateIdle();
                    continue;
                }

                boolean manual = manualListen;
                manualListen = false;
                byte[] pcm = record(rec, preroll, buf, noise, manual);
                preroll.clear();
                rec.stop();
                if (pcm != null) handleSpeech(pcm);
                lastActive = System.currentTimeMillis();
                if (!running) break;
                face.setState(FaceView.State.IDLE);
                rec.startRecording();
                drain(rec, buf, 300);   // 丟掉喇叭殘響
            }
        } finally {
            try { rec.stop(); } catch (Exception ignored) {}
            rec.release();
        }
    }

    private void updateIdle() {
        boolean sleepy = System.currentTimeMillis() - lastActive > Config.SLEEPY_AFTER_SEC * 1000L;
        FaceView.State s = face.getState();
        if (sleepy && s == FaceView.State.IDLE) face.setState(FaceView.State.SLEEPY);
        if (!sleepy && s == FaceView.State.SLEEPY) face.setState(FaceView.State.IDLE);
    }

    /** 錄到說完為止；太短（雜音）回傳 null。 */
    private byte[] record(AudioRecord rec, ArrayDeque<short[]> preroll, short[] first, double noise, boolean manual) {
        face.setState(FaceView.State.LISTENING);
        face.setEmotion("happy");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (short[] f : preroll) writePcm(out, f, f.length);
        writePcm(out, first, FRAME);

        double thresh = Math.max(Config.VAD_MIN_RMS, noise * Config.VAD_RATIO) * 0.6;
        int speechMs = manual ? 0 : FRAME_MS, silenceMs = 0, totalMs = 0;
        int silenceLimit = Config.VAD_SILENCE_MS + (manual ? 600 : 0);
        short[] buf = new short[FRAME];
        while (running && totalMs < Config.MAX_RECORD_SEC * 1000) {
            int n = rec.read(buf, 0, FRAME);
            if (n <= 0) continue;
            writePcm(out, buf, n);
            double rms = rms(buf, n);
            face.setLevel((float) Math.min(1.0, rms / 3000.0));
            totalMs += FRAME_MS;
            if (rms > thresh) { speechMs += FRAME_MS; silenceMs = 0; }
            else silenceMs += FRAME_MS;
            // 手動模式一開始給 4 秒時間開口
            if (manual && speechMs == 0 && totalMs < 4000) continue;
            if (silenceMs >= silenceLimit) break;
        }
        if (speechMs < Config.VAD_MIN_SPEECH_MS) {
            if (manual) face.setStatus("沒聽到聲音耶，再說一次？");
            return null;
        }
        return out.toByteArray();
    }

    private void handleSpeech(byte[] pcm) {
        face.setState(FaceView.State.THINKING);
        face.setSubtitle("");
        String text = ai.transcribe(pcm);
        if (text.isEmpty()) {
            showError(ai.lastError.isEmpty() ? "沒聽清楚，再說一次好嗎？" : ai.lastError);
            return;
        }
        face.setUserText(text);
        String reply = ai.chat(text);
        if (reply.isEmpty()) {
            showError("連線失敗：" + ai.lastError);
            return;
        }
        face.setEmotion(ai.lastEmotion);
        face.setSubtitle(reply);
        face.setState(FaceView.State.SPEAKING);
        if (!ai.speak(reply)) showError("語音播放失敗：" + ai.lastError);
    }

    private void showError(String msg) {
        face.setState(FaceView.State.ERROR);
        face.setEmotion("sad");
        face.setSubtitle(msg);
        sleep(2500);
        face.setEmotion("happy");
    }

    // ---------------- 工具 ----------------
    private AudioRecord openMic() {
        int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        int[] sources = {MediaRecorder.AudioSource.VOICE_RECOGNITION, MediaRecorder.AudioSource.MIC};
        for (int src : sources) {
            try {
                AudioRecord r = new AudioRecord(src, RATE, AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT, Math.max(min, RATE));
                if (r.getState() == AudioRecord.STATE_INITIALIZED) return r;
                r.release();
            } catch (Exception ignored) {}
        }
        return null;
    }

    private static void drain(AudioRecord rec, short[] buf, int ms) {
        for (int t = 0; t < ms; t += FRAME_MS) rec.read(buf, 0, FRAME);
    }

    private static double rms(short[] b, int n) {
        double s = 0;
        for (int i = 0; i < n; i++) s += (double) b[i] * b[i];
        return Math.sqrt(s / Math.max(1, n));
    }

    private static void writePcm(ByteArrayOutputStream out, short[] b, int n) {
        for (int i = 0; i < n; i++) {
            out.write(b[i] & 0xff);
            out.write((b[i] >> 8) & 0xff);
        }
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) {}
    }
}
