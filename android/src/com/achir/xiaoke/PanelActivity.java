package com.achir.xiaoke;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** 長按小柯開啟的快速查詢面板（班表、工作流程、工作站工具、說明），內容是網頁版 panel.html。 */
public class PanelActivity extends Activity {
    private WebView web;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setTextZoom(100);
        web.setBackgroundColor(0xFF101522);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                return openOutside(req.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView v, String url) {   // Android 7.0 以下
                return openOutside(Uri.parse(url));
            }
        });
        setContentView(web);
        web.loadUrl(Config.PANEL_URL);
    }

    /** 面板本身留在 App 內；工作站工具等其他網址交給系統瀏覽器開。 */
    private boolean openOutside(Uri uri) {
        String u = uri.toString();
        if (u.startsWith(Config.PANEL_URL)) return false;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
        return true;
    }

    @Override
    public void onBackPressed() {
        // 面板用 #分頁 切換頁面，先在網頁內返回，回到首頁後再關閉
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
