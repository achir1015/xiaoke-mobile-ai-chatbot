package com.achir.xiaoke;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.view.View;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** 小柯的臉：上半部頭盔機器人表情，下半部字幕與狀態列。直向、橫向螢幕都能用。 */
final class FaceView extends View {
    enum State { IDLE, LISTENING, THINKING, SPEAKING, SLEEPY, ERROR }

    private State state = State.IDLE;
    private String emotion = "happy";
    private String subtitle = "";
    private String userText = "";
    private String status = "";
    private float level = 0f;   // 麥克風音量 0~1

    private final TextPaint sub = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint small = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final long start = System.currentTimeMillis();

    FaceView(Context c) {
        super(c);
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

        // 依螢幕縮放：臉以 800x300 設計，直向手機時臉佔上半部
        boolean portrait = h > w;
        float faceH = h * (portrait ? 0.5f : 0.62f);
        float ui = Math.max(1f, Math.min(w, h) / 480f);
        sub.setTextSize(34f * ui);
        small.setTextSize(22f * ui);

        // ---- 臉：頭盔機器人（以 440x300 設計後縮放，直向手機也能填滿寬度）----
        float k = Math.min(w / 440f, faceH / 300f);
        c.save();
        c.translate((w - 440 * k) / 2f, (faceH - 300 * k) / 2f);
        c.scale(k, k);
        int ex = expression();
        boolean blink = ex != EX_SLEEPY && ex != EX_LISTEN && (t % 4.2f) < 0.13f;
        float lx = ex == EX_THINK ? (float) Math.sin(t * 3) * 8 : 0;
        float ly = ex == EX_THINK ? (float) Math.cos(t * 2.1) * 4 : 0;
        float mouthOpen = state == State.SPEAKING ? 0.3f + Math.abs((float) Math.sin(t * 13)) * 0.7f : 0f;
        float bob = state == State.SPEAKING ? (float) Math.sin(t * 9) * 3 : (float) Math.sin(t * 2.2) * 4;
        drawRobot(c, 220, 158 + bob, 1.35f, ex, lx, ly, blink, mouthOpen, System.currentTimeMillis());
        c.restore();

        // ---- 狀態列 ----
        String time = new SimpleDateFormat("HH:mm", Locale.TAIWAN).format(new Date());
        float barY = small.getTextSize() * 1.45f;
        c.drawText(time, 20, barY, small);
        String st = stateLabel();
        c.drawText(st, w - 20 - small.measureText(st), barY, small);

        // ---- 字幕 ----
        float top = faceH + 8;
        if (!userText.isEmpty()) {
            String u = "你：" + userText;
            int max = (int) ((w - 48) / small.getTextSize());
            if (u.length() > max) u = u.substring(0, Math.max(1, max - 1)) + "…";
            c.drawText(u, 24, top + small.getTextSize(), small);
            top += small.getTextSize() * 1.6f;
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

    // ---------------- 頭盔機器人（移植自 LX04 版 FaceView，與網頁版同造型）----------------
    private static final int C_WHITE = 0xFFFFFFFF, C_GLOW = 0xFF40E8FF, C_GLOW_DIM = 0xFF1E6E87,
            C_RED2 = 0xFFFF4664, C_PINK = 0xFFFF6F91, C_VISOR = 0xFF162A42;
    private static final android.graphics.BlurMaskFilter BLUR5 =
            new android.graphics.BlurMaskFilter(5, android.graphics.BlurMaskFilter.Blur.NORMAL);
    private static final android.graphics.BlurMaskFilter BLUR6 =
            new android.graphics.BlurMaskFilter(6, android.graphics.BlurMaskFilter.Blur.NORMAL);
    private final Paint zp = new Paint(Paint.ANTI_ALIAS_FLAG);   // 想睡的 Zzz

    // 表情
    private static final int EX_NORMAL = 0, EX_HAPPY = 1, EX_LOVE = 2, EX_SURPRISE = 3, EX_SAD = 4,
            EX_ANGRY = 5, EX_WINK = 6, EX_SHY = 7, EX_LISTEN = 8, EX_THINK = 9, EX_SLEEPY = 10;

    private int expression() {
        switch (state) {
            case SLEEPY: return EX_SLEEPY;
            case LISTENING: return EX_LISTEN;
            case THINKING: return EX_THINK;
            case ERROR: return EX_SAD;
            default:
                switch (emotion) {
                    case "love": return EX_LOVE;
                    case "surprise": return EX_SURPRISE;
                    case "sad": return EX_SAD;
                    case "angry": return EX_ANGRY;
                    case "wink": return EX_WINK;
                    case "shy": return EX_SHY;
                    case "happy": return EX_HAPPY;
                    default: return EX_NORMAL;
                }
        }
    }

    // ---------------- 機器人（頭盔 + 面罩 + 眼睛 + 嘴巴 + Zzz）----------------
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint glow = new Paint(Paint.ANTI_ALIAS_FLAG);

    private void drawRobot(Canvas cv, float vx, float vy, float s, int ex, float lx, float ly,
                           boolean blink, float mouthOpen, long now) {
        final float X = vx, Y = vy;
        int g = ex == EX_ANGRY ? C_RED2 : C_GLOW;

        // 耳罩
        for (int side = -1; side <= 1; side += 2) {
            float cx = X + side * S(121, s);
            rrGrad(cv, cx - S(19, s), Y - S(44, s), S(38, s), S(92, s), S(16, s), 0xFFB0BED2, 0xFF687892);
            rr(cv, cx - S(5, s) + side * S(6, s), Y - S(30, s), S(9, s), S(56, s), S(5, s), 0xFFCED8E8);
        }
        // 頭盔
        rr(cv, X - S(125, s), Y - S(96, s), S(250, s), S(198, s), S(90, s), 0xFF808A9A);
        rrGrad(cv, X - S(124, s), Y - S(99, s), S(248, s), S(194, s), S(88, s), 0xFFFCFDFF, 0xFFC4CBD6);
        ellipse(cv, X - S(62, s), Y - S(80, s), S(34, s), S(9, s), C_WHITE);
        // 面罩
        rr(cv, X - S(102, s), Y - S(71, s), S(204, s), S(142, s), S(56, s), 0xFF344660);
        rrGrad(cv, X - S(98, s), Y - S(67, s), S(196, s), S(134, s), S(52, s), 0xFF1E3450, 0xFF091220);
        ellipse(cv, X - S(50, s), Y - S(52, s), S(32, s), S(7, s), 0xFF2C4666);

        float ey = Y - S(10, s), dx = S(44, s), my = Y + S(34, s);
        float th = Math.max(2f, S(5, s));
        boolean talking = mouthOpen > 0.05f;
        boolean smiley = ex == EX_NORMAL || ex == EX_HAPPY || ex == EX_WINK || ex == EX_LOVE || ex == EX_SHY;

        if (ex == EX_SHY || ex == EX_LOVE)
            for (int side = -1; side <= 1; side += 2)
                ellipse(cv, X + side * S(68, s), Y + S(20, s), S(15, s), S(6, s), blend(C_VISOR, C_PINK, 0.55f));

        // 嘴巴
        if (talking) {
            float rx = S(15, s), ry = Math.max(S(4, s), S(4 + 13 * mouthOpen, s));
            ellipse(cv, X, my - S(4, s), rx, ry, g);
            if (ry > S(7, s)) ellipse(cv, X, my - S(4, s), rx - S(5, s), ry - S(5, s), 0xFF0E3C52);
        } else if (smiley) {
            arc(cv, X, my - S(18, s), S(18, s), 35, 110, th, g);
        } else if (ex == EX_SURPRISE || ex == EX_LISTEN) {
            float r = S(ex == EX_SURPRISE ? 9 : 7, s) + (ex == EX_LISTEN ? Math.min(S(6, s), level * S(10, s)) : 0);
            ellipse(cv, X, my - S(2, s), r, r, g);
            if (ex == EX_LISTEN) ellipse(cv, X, my - S(2, s), Math.max(1, r - th), Math.max(1, r - th), C_VISOR);
        } else if (ex == EX_SAD || ex == EX_ANGRY) {
            arc(cv, X, my + S(12, s), S(16, s), 215, 110, th, g);
        } else if (ex == EX_THINK) {
            for (int i = 0; i < 3; i++) {
                fill.setColor((now / 250) % 3 == i ? g : C_GLOW_DIM);
                cv.drawCircle(X + (i - 1) * S(14, s), my - S(2, s), S(4, s), fill);
            }
        } else if (ex == EX_SLEEPY) {
            arc(cv, X, my + S(4, s), S(8, s), 200, 140, th, g);
        } else {
            line(cv, X - S(13, s), my - S(2, s), X + S(13, s), my - S(2, s), th, g);
        }

        // 眼睛
        float ew = S(22, s), eh = S(32, s);
        for (int side = -1; side <= 1; side += 2) {
            float cx = X + side * dx, x = cx + lx, y = ey + ly;
            switch (ex) {
                case EX_HAPPY: case EX_SHY:
                    arc(cv, cx, ey + S(8, s), S(12, s), 200, 140, th + 1, g); break;
                case EX_WINK:
                    if (side < 0) line(cv, cx - S(11, s), ey, cx + S(11, s), ey, th + 1, g);
                    else eye(cv, x, y, ew, eh, g, th);
                    break;
                case EX_LOVE: {
                    float r = S(15, s) + S(2, s) * (float) Math.sin(now / 150.0);
                    heart(cv, cx, ey - S(2, s), r, C_PINK);
                    break;
                }
                case EX_SURPRISE:
                    ellipse(cv, cx, ey, S(10, s), S(10, s), g); break;
                case EX_SLEEPY:
                    arc(cv, cx, ey - S(6, s), S(11, s), 20, 140, th, g); break;
                case EX_THINK:
                    eye(cv, cx + S(6, s), ey - S(8, s), ew, S(20, s), g, th); break;
                default: {
                    float w = ex == EX_LISTEN ? S(25, s) : ew;
                    float hh = ex == EX_LISTEN ? S(36, s) : ex == EX_ANGRY ? S(24, s) : ex == EX_SAD ? S(26, s) : eh;
                    if (blink && ex != EX_LISTEN) line(cv, x - w / 2, y, x + w / 2, y, th + 1, g);
                    else eye(cv, x, y, w, hh, g, th);
                    if (ex == EX_SAD)
                        line(cv, x - S(13, s), y - hh / 2 - S(7, s) + S(5, s) * side, x + S(13, s), y - hh / 2 - S(7, s) - S(5, s) * side, th, g);
                    if (ex == EX_ANGRY)
                        line(cv, x - S(13, s), y - hh / 2 - S(9, s) - S(6, s) * side, x + S(13, s), y - hh / 2 - S(9, s) + S(6, s) * side, th, g);
                }
            }
        }

        // 想睡 Zzz
        if (ex == EX_SLEEPY) {
            int kz = (int) ((now / 500) % 3);
            zp.setColor(C_GLOW);
            zp.setTypeface(Typeface.DEFAULT_BOLD);
            zp.setTextSize(14 * s + 8);
            cv.drawText("z", vx + 100 * s, vy - 78 * s - kz * 3, zp);
            zp.setTextSize(20 * s + 10);
            cv.drawText("Z", vx + 114 * s, vy - 96 * s - kz * 3, zp);
        }
    }

    // 眼睛（圓角矩形 + 內發光）
    private void eye(Canvas cv, float cx, float cy, float w, float h, int color, float glowTh) {
        glow.setColor(color);
        glow.setStyle(Paint.Style.FILL);
        glow.setMaskFilter(BLUR6);
        cv.drawRoundRect(new RectF(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2), w / 2, w / 2, glow);
        glow.setMaskFilter(null);
        fill.setColor(color);
        cv.drawRoundRect(new RectF(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2), w / 2, w / 2, fill);
    }

    // ---------------- 低階繪圖 ----------------
    private static float S(float v, float s) { return v * s; }

    private void rr(Canvas cv, float x, float y, float w, float h, float r, int color) {
        fill.setColor(color);
        fill.setShader(null);
        cv.drawRoundRect(new RectF(x, y, x + w, y + h), r, r, fill);
    }

    private void rrGrad(Canvas cv, float x, float y, float w, float h, float r, int c1, int c2) {
        fill.setShader(new LinearGradient(x, y, x, y + h, c1, c2, Shader.TileMode.CLAMP));
        cv.drawRoundRect(new RectF(x, y, x + w, y + h), r, r, fill);
        fill.setShader(null);
    }

    private void ellipse(Canvas cv, float cx, float cy, float rx, float ry, int color) {
        fill.setColor(color);
        fill.setShader(null);
        cv.drawOval(new RectF(cx - rx, cy - ry, cx + rx, cy + ry), fill);
    }

    private void arc(Canvas cv, float cx, float cy, float r, float startDeg, float sweepDeg, float th, int color) {
        glow.setStyle(Paint.Style.STROKE);
        glow.setStrokeCap(Paint.Cap.ROUND);
        glow.setStrokeWidth(th);
        glow.setColor(color);
        glow.setMaskFilter(BLUR5);
        RectF o = new RectF(cx - r, cy - r, cx + r, cy + r);
        cv.drawArc(o, startDeg, sweepDeg, false, glow);
        glow.setMaskFilter(null);
        cv.drawArc(o, startDeg, sweepDeg, false, glow);
    }

    private void line(Canvas cv, float x0, float y0, float x1, float y1, float th, int color) {
        glow.setStyle(Paint.Style.STROKE);
        glow.setStrokeCap(Paint.Cap.ROUND);
        glow.setStrokeWidth(th);
        glow.setColor(color);
        glow.setMaskFilter(BLUR5);
        cv.drawLine(x0, y0, x1, y1, glow);
        glow.setMaskFilter(null);
        cv.drawLine(x0, y0, x1, y1, glow);
    }

    private void heart(Canvas cv, float cx, float cy, float r, int color) {
        Path path = new Path();
        path.moveTo(cx, cy + r * 0.9f);
        path.cubicTo(cx - r * 1.3f, cy - r * 0.1f, cx - r * 0.7f, cy - r, cx, cy - r * 0.3f);
        path.cubicTo(cx + r * 0.7f, cy - r, cx + r * 1.3f, cy - r * 0.1f, cx, cy + r * 0.9f);
        glow.setStyle(Paint.Style.FILL);
        glow.setColor(color);
        glow.setMaskFilter(BLUR5);
        cv.drawPath(path, glow);
        glow.setMaskFilter(null);
        cv.drawPath(path, glow);
    }

    private static int blend(int a, int b, float t) {
        int ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
        int br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
        int r = (int) (ar + (br - ar) * t), gg = (int) (ag + (bg - ag) * t), bl = (int) (ab + (bb - ab) * t);
        return Color.argb(255, r, gg, bl);
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
