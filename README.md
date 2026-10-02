# 小柯 Android 版（XiaoKe for Android）

把閒置的 Android 手機／平板變成有螢幕的 OpenAI 語音聊天機器人「小柯」。
原本是為小米小愛觸屏音箱 LX04（800×480）設計，畫面以橫向 800×480 為基準，任何 Android 7.0 以上裝置都能用。

對話流程與 ESP32 版小柯相同：
語音偵測 → `gpt-4o-mini-transcribe` → Responses API（`gpt-4o-mini` + web_search）→ `gpt-4o-mini-tts`（串流 PCM 播放）

## 功能
- 直接說話就開始聽（音量 VAD），或點一下螢幕說話
- 說話時點螢幕可打斷；長按顯示狀態並清除對話記憶
- 大眼睛表情（happy / love / surprise / sad / angry / wink / shy）＋字幕
- 可上網查天氣、新聞（搜尋結果的條列表格會自動略過，只唸口語摘要）
- 開機自動啟動、螢幕常亮

## 編譯（不需要 Android Studio / Gradle）
需要：Python 3.8+、JDK 17、Android SDK（build-tools 34.0.0、platforms/android-34、platform-tools）

1. 複製 `src/com/achir/xiaoke/Config.example.java.txt` 為 `Config.java`，填入 OpenAI 金鑰（已列入 .gitignore）。
2. 建立 `local.properties`（已列入 .gitignore）：
   ```
   sdk.dir=C:\\path\\to\\android-sdk
   jdk.dir=C:\\path\\to\\jdk-17
   ```
3. 編譯：`python build.py` → `build/xiaoke.apk`

`build.py` 流程：aapt2 → javac（`--release 8`）→ d8 → zipalign → apksigner。
專案路徑含中文時 aapt2 會打不開絕對路徑，腳本已改用相對路徑處理。

## 安裝到手機／平板
1. 手機開啟「開發人員選項」→「USB 偵錯」（小米手機另需開「USB 安裝」）。
2. 用可傳資料的 USB 線接上電腦並允許偵錯。
3. `python build.py install`（會自動授予麥克風權限並啟動小柯）。

## 參數
在 `Config.java` 調整：模型、聲音、VAD 靈敏度（`VAD_MIN_RMS`、`VAD_RATIO`、`VAD_SILENCE_MS`）、是否上網搜尋、多久沒互動變想睡等。

## 關於小米小愛觸屏音箱 LX04
LX04 是 MediaTek MT8167、Android 8.1、A/B 分區的裝置。原廠系統沒有 ADB 也不能安裝第三方 App，
嘗試以修改系統分區開啟 ADB 會導致開機循環（已還原），因此本專案改為支援一般 Android 裝置。

## 開發者
創意開發：吳玉柱（achir1015@gmail.com），與 Claude AI 共同開發。
