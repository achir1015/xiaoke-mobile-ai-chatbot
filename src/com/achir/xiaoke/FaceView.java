package com.achir.xiaoke;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.view.View;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** 小柯的臉：上半部大眼睛表情，下半部字幕與狀態列。為 800x480 橫向螢幕設計。 */
final class FaceView extends View {
    enum State { IDLE, LISTENING, THINKING, SPEAKING, SLEEPY, ERROR }

    private State state = State.IDLE;
    private String emotion = "happy";
    private String subtitle = "";
    private String userText = "";
    private String status = "";
    private float level = 0f;   // 麥克風音量 0~1

    private final Paint eye = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint cheek = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint mouth = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint sub = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint small = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final long start = System.currentTimeMillis();

    FaceView(Context c) {
        super(c);
        eye.setColor(Color.WHITE);
        cheek.setColor(0x66FF6F91);
        mouth.setColor(Color.WHITE);
        mouth.setStyle(Paint.Style.STROKE);
        mouth.setStrokeCap(Paint.Cap.ROUND);
        mouth.setStrokeWidth(10f);
        sub.setColor(Color.WHITE);
        sub.setTextSize(34f);
        small.setColor(0xFF9AA4B2);
        small.setTextSize(22f);
        setKeepScreenOn(true);
    }

    void setState(State s) { state = s; postInvalidate(); }
    State getState() { return state; }
    void setEmotion(String e) { emotion = e == null ? "happy" : e; postInvalidate(); }
    void setSubtitle(String s) { subtitle = s == null ? "" : s; postInvalidate(); }
    void setUserText(String s) { userText = s == null ? "" : s; postInvalidate(); }
    void setStatus(String s) { status = s == null ? "" : s; postInvalidate(); }
    void setLevel(float l) { level = l; if (state == State.LISTENING) postInvalidate(); }

    @Override
    protected void onDraw(Canvas c) {
        int w = getWidth(), h = getHeight();
        c.drawColor(bgColor());
        float t = (System.currentTimeMillis() - start) / 1000f;

        // ---- 臉 ----
        float faceH = h * 0.62f;
        float cx = w / 2f, cy = faceH * 0.5f + 10;
        float eyeDx = w * 0.17f, eyeW = 92, eyeH = 128;
        boolean blink = state != State.SLEEPY && (t % 4.2f) < 0.13f;
        float bob = (float) Math.sin(t * 2.2) * 6;
        if (state == State.SPEAKING) bob = (float) Math.sin(t * 9) * 4;
        cy += bob;

        for (int side = -1; side <= 1; side += 2) {
            float ex = cx + side * eyeDx;
            drawEye(c, ex, cy, eyeW, eyeH, side, blink, t);
        }
        if ("love".equals(emotion) || "shy".equals(emotion) || "happy".equals(emotion)) {
            c.drawOval(new RectF(cx - eyeDx - 90, cy + 60, cx - eyeDx - 20, cy + 95), cheek);
            c.drawOval(new RectF(cx + eyeDx + 20, cy + 60, cx + eyeDx + 90, cy + 95), cheek);
        }
        drawMouth(c, cx, cy + 95, t);

        // ---- 狀態列 ----
        String time = new SimpleDateFormat("HH:mm", Locale.TAIWAN).format(new Date());
        c.drawText(time, 20, 32, small);
        String st = stateLabel();
        c.drawText(st, w - 20 - small.measureText(st), 32, small);

        // ---- 字幕 ----
        float top = faceH + 8;
        if (!userText.isEmpty()) {
            String u = "你：" + userText;
            if (u.length() > 34) u = u.substring(0, 33) + "…";
            c.drawText(u, 24, top + 22, small);
            top += 34;
        }
        String s = subtitle.isEmpty() ? status : subtitle;
        if (!s.isEmpty()) {
            StaticLayout lay = new StaticLayout(s, sub, w - 48, Layout.Alignment.ALIGN_CENTER, 1.05f, 0, false);
            c.save();
            float avail = h - top - 8;
            float dy = Math.max(0, lay.getHeight() - avail);   // 太長時捲到最後幾行
            c.clipRect(0, top, w, h);
            c.translate(24, top - dy);
            lay.draw(c);
            c.restore();
        }
        postInvalidateDelayed(state == State.IDLE || state == State.SLEEPY ? 80 : 33);
    }

    private void drawEye(Canvas c, float ex, float ey, float ew, float eh, int side, boolean blink, float t) {
        if (state == State.SLEEPY || blink) {
            c.drawRoundRect(new RectF(ex - ew / 2, ey - 8, ex + ew / 2, ey + 8), 8, 8, eye);
            return;
        }
        switch (emotion) {
            case "love": {
                float s = 1f + (float) Math.sin(t * 6) * 0.06f;
                Path p = new Path();
                float r = 34 * s;
                p.moveTo(ex, ey + 2.1f * r);
                p.cubicTo(ex - 2.6f * r, ey + 0.2f * r, ex - 1.4f * r, ey - 1.9f * r, ex, ey - 0.6f * r);
                p.cubicTo(ex + 1.4f * r, ey - 1.9f * r, ex + 2.6f * r, ey + 0.2f * r, ex, ey + 2.1f * r);
                Paint pink = new Paint(Paint.ANTI_ALIAS_FLAG);
                pink.setColor(0xFFFF6F91);
                c.drawPath(p, pink);
                return;
            }
            case "happy":
            case "shy": {
                // ^ ^ 笑眼
                Paint arc = new Paint(mouth);
                arc.setStrokeWidth(16f);
                c.drawArc(new RectF(ex - ew / 2, ey - eh / 4, ex + ew / 2, ey + eh / 2), 200, 140, false, arc);
                return;
            }
            case "wink":
                if (side > 0) {
                    Paint arc = new Paint(mouth);
                    arc.setStrokeWidth(16f);
                    c.drawArc(new RectF(ex - ew / 2, ey - eh / 4, ex + ew / 2, ey + eh / 2), 200, 140, false, arc);
                    return;
                }
                break;
            case "sad":
                ey += 12; eh *= 0.8f;
                break;
            case "surprise":
                ew *= 1.15f; eh *= 1.15f;
                break;
            default:
                break;
        }
        float lookX = 0;
        if (state == State.THINKING) lookX = (float) Math.sin(t * 3) * 16;
        RectF r = new RectF(ex - ew / 2 + lookX, ey - eh / 2, ex + ew / 2 + lookX, ey + eh / 2);
        c.drawRoundRect(r, ew / 2, ew / 2, eye);
        if ("angry".equals(emotion)) {
            Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
            bg.setColor(bgColor());
            Path p = new Path();
            p.moveTo(ex - side * ew, ey - eh);
            p.lineTo(ex + side * ew, ey - eh);
            p.lineTo(ex + side * ew, ey - eh * 0.2f);
            p.close();
            c.drawPath(p, bg);
        }
        if ("sad".equals(emotion)) {
            Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
            bg.setColor(bgColor());
            Path p = new Path();
            p.moveTo(ex + side * ew, ey - eh);
            p.lineTo(ex - side * ew, ey - eh);
            p.lineTo(ex - side * ew, ey - eh * 0.25f);
            p.close();
            c.drawPath(p, bg);
        }
    }

    private void drawMouth(Canvas c, float mx, float my, float t) {
        if (state == State.SPEAKING) {
            float open = 10 + Math.abs((float) Math.sin(t * 14)) * 22;
            Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
            fill.setColor(Color.WHITE);
            c.drawRoundRect(new RectF(mx - 30, my - open / 2, mx + 30, my + open / 2), 14, 14, fill);
        } else if (state == State.LISTENING) {
            float r = 10 + level * 30;
            Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
            fill.setColor(0xFF7CF29C);
            c.drawCircle(mx, my, r, fill);
        } else if (state == State.THINKING) {
            Paint dot = new Paint(Paint.ANTI_ALIAS_FLAG);
            dot.setColor(Color.WHITE);
            for (int i = 0; i < 3; i++) {
                float a = (float) Math.max(0, Math.sin(t * 6 - i * 0.8));
                c.drawCircle(mx - 30 + i * 30, my - a * 10, 8, dot);
            }
        } else if ("sad".equals(emotion)) {
            c.drawArc(new RectF(mx - 34, my, mx + 34, my + 40), 200, 140, false, mouth);
        } else if ("surprise".equals(emotion)) {
            c.drawCircle(mx, my + 6, 16, mouth);
        } else {
            c.drawArc(new RectF(mx - 34, my - 26, mx + 34, my + 14), 20, 140, false, mouth);
        }
    }

    private int bgColor() {
        switch (state) {
            case LISTENING: return 0xFF0E2A1B;
            case THINKING:  return 0xFF13203A;
            case ERROR:     return 0xFF3A1313;
            case SLEEPY:    return 0xFF0A0A12;
            default:        return 0xFF101522;
        }
    }

    private String stateLabel() {
        switch (state) {
            case LISTENING: return "聆聽中…";
            case THINKING:  return "思考中…";
            case SPEAKING:  return "說話中（點一下打斷）";
            case SLEEPY:    return "Zzz… 說話或點我叫醒";
            case ERROR:     return "發生錯誤";
            default:        return Config.VOICE_ACTIVATION ? "直接說話或點螢幕" : "點螢幕說話";
        }
    }
}
