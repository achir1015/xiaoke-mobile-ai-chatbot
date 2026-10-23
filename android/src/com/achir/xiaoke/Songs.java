package com.achir.xiaoke;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 唱歌：讀 YouTube 播放清單（影片 ID＋歌名），隨機挑一首。讀不到時退回整份歌單。 */
final class Songs {
    static final class Song {
        final String id, title;
        Song(String id, String title) { this.id = id; this.title = title; }
    }

    private static final Pattern ID = Pattern.compile("\"contentId\":\"([A-Za-z0-9_-]{11})\"");
    private static final Pattern TITLE = Pattern.compile("\"lockupMetadataViewModel\":\\{\"title\":\\{\"content\":\"([^\"]*)\"");
    private static List<Song> cache;
    private static long cacheAt;
    private static final Random RNG = new Random();

    private Songs() {}

    static String playlistUrl() { return "https://www.youtube.com/playlist?list=" + Config.YT_PLAYLIST_ID; }

    /** 隨機一首；歌單讀取失敗回傳 null。 */
    static synchronized Song pick() {
        if (cache == null || System.currentTimeMillis() - cacheAt > 6 * 3600_000L) {
            List<Song> list = fetch();
            if (!list.isEmpty()) { cache = list; cacheAt = System.currentTimeMillis(); }
        }
        if (cache == null || cache.isEmpty()) return null;
        return cache.get(RNG.nextInt(cache.size()));
    }

    static String watchUrl(Song s) {
        return "https://www.youtube.com/watch?v=" + s.id + "&list=" + Config.YT_PLAYLIST_ID;
    }

    private static List<Song> fetch() {
        List<Song> out = new ArrayList<>();
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(playlistUrl()).openConnection();
            c.setConnectTimeout(10000);
            c.setReadTimeout(15000);
            // 用桌面版 UA，YouTube 才會回傳含歌名的完整頁面
            c.setRequestProperty("User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36");
            c.setRequestProperty("Accept-Language", "zh-TW,zh;q=0.9");
            if (c.getResponseCode() != 200) return out;
            String html;
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream b = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
                html = b.toString("UTF-8");
            }
            // 每個項目在一個 lockupViewModel 區塊裡，各自取影片 ID 與標題
            String[] parts = html.split("\"lockupViewModel\":\\{");
            for (int i = 1; i < parts.length; i++) {
                Matcher id = ID.matcher(parts[i]), t = TITLE.matcher(parts[i]);
                if (id.find() && t.find()) out.add(new Song(id.group(1), t.group(1)));
            }
        } catch (Exception ignored) {}
        return out;
    }
}
