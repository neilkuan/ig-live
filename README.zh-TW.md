# IG Live 錄製 + Gemini 即時翻譯

**[English](README.md) | 繁體中文**

一個 Chrome (Manifest V3) 擴充功能：在 Instagram 直播頁面上**錄影**、用 **Gemini API 即時翻譯**雙語字幕，並可**校正橫/直向**畫面。

> ⚠️ **合法使用聲明**
> 本工具僅供**個人學習、無障礙翻譯輔助**等合法用途。錄製或散佈他人的直播內容可能侵犯**著作權**或違反 **Instagram 服務條款**。
> 使用前請確認你**已取得內容方授權**，並遵守當地法律與平台規範。**請勿**用於未經授權的轉錄、散佈或商業用途。
> 因使用本工具所衍生的任何法律責任，由使用者自行承擔；作者與貢獻者不負任何責任。本專案與 Instagram、Meta、Google 均無關聯。

## 功能

| 功能 | 說明 |
| --- | --- |
| 🔴 錄影 | 透過 `<video>` 的 `captureStream()` + canvas 重繪 + `MediaRecorder` 錄影。**優先輸出 `.mp4`（H.264/AAC）**，不支援的環境自動退回 `.webm`。會套用旋轉校正並把字幕一起燒進影片。畫質可選 6 / 10 / 16 Mbps。 |
| 字 即時翻譯 | 用 Web Audio（`AudioWorklet`）擷取直播音訊，每隔數秒切一段轉成 WAV，經 background 送 `gemini-2.5-flash`。**雙語字幕**（原文 + 翻譯）疊在畫面下方。啟用時會有**計費提醒燈**閃爍。 |
| ↻ 方向校正 | 主播橫拿手機、但網頁顯示成直的時，可手動旋轉 0/90/180/270° 或鏡像，**顯示與錄影同步校正**；旋轉後以視窗為基準放大、減少黑邊。 |

## 安裝（開發者模式）

1. 開啟 `chrome://extensions`
2. 右上角開啟「**開發人員模式**」
3. 點「**載入未封裝項目**」，選擇本專案資料夾
4. 到 [Google AI Studio](https://aistudio.google.com/apikey) 取得 Gemini API Key
5. 點擴充功能圖示 → 貼上 API Key → 視需要調整目標語言／模型／雙語字幕／畫質 → 儲存設定

## 使用

1. 開啟一個 Instagram 直播頁面
2. 頁面右上角會出現可拖曳的控制面板（也可從擴充功能 popup 操作）
3. **錄影**：點「● 錄影」開始，再點一次停止會自動下載
4. **翻譯**：點「字 翻譯」開始，字幕即時顯示；正上方會出現 🔴`字幕翻譯中・計費` 閃爍提醒
5. **方向**：用 ↺ / ↻ 調整角度，⇋ 鏡像

## 費用

唯一的變動成本是 **Gemini API**（擴充本身免費、全在本機運作）。以預設 6 秒一段、`gemini-2.5-flash` 估算：

- 連續翻譯約 **US$0.3–0.5／小時**（有靜音門檻，實際通常更低）。
- 免費層有 RPM/RPD 限制，長時間直播建議使用付費方案。
- 調大 `chunkSeconds` 或關閉雙語字幕可進一步省費用。

## 技術重點

- **跨域 CORS**：MV3 content script 的跨域 `fetch` 受頁面 CORS 限制，所以 Gemini 呼叫都走 `background.js`（service worker 才拿得到 `host_permissions`）。
- **音訊格式**：錄成 16-bit PCM WAV 再送 Gemini（webm/opus 支援度不穩）。
- **結構化輸出**：用 `responseSchema` 讓 Gemini 同時回傳 `original` 與 `translation`，雙字幕才好解析。
- **低延遲**：`thinkingBudget: 0` 關閉推理，降低字幕延遲與用量。
- **省 API 用量**：每段音訊先做音量門檻判斷，靜音段落不送出。
- **最小權限**：只用 `storage` 與 `activeTab`。

## 限制與已知問題

- 自動偵測旋轉不可靠（直式畫面內的橫躺內容尺寸看起來仍是直的），故採**手動**旋轉。
- 翻譯有 `chunkSeconds`（預設 6 秒）的天然延遲；調小延遲低但 API 呼叫更頻繁。
- 錄影為畫面內容（非原始串流），畫質上限取決於 IG 來源串流解析度與位元率設定。
- 某些受 DRM 保護的串流可能無法用 `captureStream()` 取得音訊軌。

## 目錄結構

```
manifest.json
src/
  background.js          # Gemini API 呼叫（結構化雙字幕輸出）
  content/
    content.js           # 主邏輯：偵測影片、錄影、翻譯、旋轉、overlay UI
    wav.js               # PCM → WAV 編碼
    pcm-worklet.js       # AudioWorklet：擷取 PCM
    overlay.css          # 面板、字幕與計費燈樣式
  popup/
    popup.html / .js / .css   # 設定與快捷操作
```

## 授權

[MIT](LICENSE) © neilkuan
