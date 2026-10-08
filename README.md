# 小柯 手機 App 聊天機器人

小柯是一個有大眼睛表情的 OpenAI 語音聊天機器人，可以裝在手機上隨身聊天。

| 版本 | 適用 | 資料夾 |
|---|---|---|
| **網頁 App（PWA）** | iPhone、Android、平板、電腦 | `docs/`（GitHub Pages 發布） |
| **Android 原生 App** | Android 7.0 以上手機／平板 | `android/` |

對話流程（兩個版本相同）：
語音偵測 → `gpt-4o-mini-transcribe` → Responses API（`gpt-4o-mini` + web_search）→ `gpt-4o-mini-tts`

## 功能
- 直接說話就開始聽（音量偵測），或點一下螢幕說話
- 小柯說話時點螢幕可以打斷
- 大眼睛表情（開心、愛心、驚訝、難過、生氣、眨眼、害羞）＋字幕
- 會上網查天氣、新聞，只用口語唸重點
- 記得最近幾句對話；直向、橫向螢幕都能用

---

## 網頁 App（iPhone / Android）

### 安裝
1. 用手機瀏覽器開啟 GitHub Pages 網址（iPhone 請用 **Safari**）。
2. iPhone：點分享按鈕 →「**加入主畫面**」；Android Chrome：選單 →「**安裝應用程式**」。
3. 從主畫面打開「小柯」，第一次會要求輸入 **OpenAI API 金鑰**。
4. 按「點一下開始」並允許麥克風權限。

### 金鑰安全
- 金鑰只存在該手機瀏覽器的 localStorage，不會寫進網頁程式，也不會傳到 OpenAI 以外的地方。
- 網頁公開放在 GitHub Pages，但裡面沒有任何金鑰。
- 建議在 OpenAI 後台為小柯另外建一把金鑰並設定用量上限。

### 本機測試
```
python -m http.server 8790 --directory docs
```
開啟 http://localhost:8790

---

## Android 原生 App

### 編譯（不需要 Android Studio / Gradle）
需要：Python 3.8+、JDK 17、Android SDK（build-tools 34.0.0、platforms/android-34、platform-tools）

1. 複製 `android/src/com/achir/xiaoke/Config.example.java.txt` 為 `Config.java`，填入 OpenAI 金鑰（已列入 .gitignore）。
2. 在 `android/` 建立 `local.properties`（已列入 .gitignore）：
   ```
   sdk.dir=C:\\path\\to\\android-sdk
   jdk.dir=C:\\path\\to\\jdk-17
   ```
3. `cd android && python build.py` → `android/build/xiaoke.apk`

`build.py` 流程：aapt2 → javac（`--release 8`）→ d8 → zipalign → apksigner。
路徑含中文時 aapt2 打不開絕對路徑，腳本已改用相對路徑。

### 安裝到手機
1. 手機開啟「開發人員選項」→「USB 偵錯」（小米手機另需開「USB 安裝」）。
2. 用可傳資料的 USB 線接上電腦並允許偵錯。
3. `cd android && python build.py install`（自動授予麥克風權限並啟動）。

### 參數
在 `Config.java` 調整：模型、聲音、語音偵測靈敏度（`VAD_MIN_RMS`、`VAD_RATIO`、`VAD_SILENCE_MS`）、是否上網搜尋、`AUTO_START_ON_BOOT`（開機自動啟動，手機建議關閉）。

---

## 專案緣起
最初是為小米小愛觸屏音箱 LX04 設計，但該音箱無法安裝第三方 App，因此改做成手機 App。

## 開發者
創意開發：吳玉柱（achir1015@gmail.com），與 Claude AI 共同開發。
