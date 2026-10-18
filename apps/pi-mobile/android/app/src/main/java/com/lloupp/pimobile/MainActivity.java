package com.lloupp.pimobile;

import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.webkit.WebView;
import android.webkit.WebSettings;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.content.Intent;
import android.net.Uri;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
    private WebView view;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(16, 24, 39));
        getWindow().setNavigationBarColor(Color.rgb(16, 24, 39));
        view = new WebView(this);
        view.setBackgroundColor(Color.rgb(16, 24, 39));
        view.getSettings().setJavaScriptEnabled(true);
        view.getSettings().setDomStorageEnabled(true);
        view.getSettings().setAllowFileAccess(false);
        view.getSettings().setAllowContentAccess(false);
        view.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        view.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView web, WebResourceRequest req) {
                Uri uri = req.getUrl();
                if ("127.0.0.1".equals(uri.getHost()) && "http".equals(uri.getScheme())) return false;
                if ("https".equals(uri.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
                }
                return true;
            }
        });
        setContentView(view);
        try (InputStream in = getAssets().open("index.html")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] bytes = new byte[8192]; int n;
            while ((n = in.read(bytes)) != -1) out.write(bytes, 0, n);
            // Bundle HTML as first-party content, but use localhost as its origin:
            // this avoids universal file:// permissions and any cross-origin bridge.
            view.loadDataWithBaseURL("http://127.0.0.1:8765/", out.toString(StandardCharsets.UTF_8.name()), "text/html", "UTF-8", null);
        } catch (Exception e) {
            view.loadData("Não foi possível abrir a interface Pi Mobile.", "text/plain", "UTF-8");
        }
    }

    @Override public void onBackPressed() {
        if (view != null && view.canGoBack()) view.goBack(); else super.onBackPressed();
    }
    @Override protected void onDestroy() {
        if (view != null) { view.destroy(); view = null; }
        super.onDestroy();
    }
}
