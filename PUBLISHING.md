# Chrome Web Store 上架規劃

把這個擴充功能發佈到 Chrome 線上應用程式商店的完整步驟與注意事項。

---

## 一、事前準備（上架前必做）

### 1. 註冊開發者帳號
- 到 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
- 用 Google 帳號登入
- 繳交 **一次性 5 美元** 註冊費（信用卡）
- 首次需驗證身分（可能要求填寫聯絡 email 並驗證）

### 2. 設定發佈者資訊
- 在 Dashboard → **Account** 設定發佈者名稱、聯絡 email（會公開顯示）
- 若要用組織名義發佈，需驗證網域

---

## 二、打包前要補齊的素材

| 項目 | 規格 | 目前狀態 |
| --- | --- | --- |
| 擴充功能 zip | 不含 `node_modules`、`.git`、原始 `.svg` 等多餘檔 | ⬜ 需打包 |
| 圖示 128×128 | PNG | ✅ 已有 `icons/icon128.png` |
| 商店截圖 | 1280×800 或 640×400，**至少 1 張、最多 5 張** | ⬜ 需製作 |
| 小型宣傳圖（選填） | 440×280 PNG/JPG | ⬜ |
| 介紹影片（選填） | YouTube 連結 | ⬜ |
| 商品說明 | 標題 ≤45 字元、簡介 ≤132 字元、詳細說明 | ⬜ 見下方草稿 |
| **隱私權政策網址** | 公開可存取的 URL（**本擴充必填**，見第四節） | ⬜ 必做 |

### 商品說明草稿

- **名稱**：IG Live 錄製 + Gemini 即時翻譯
- **簡短說明（≤132 字）**：在 Instagram 直播頁面一鍵錄影、用你自己的 Gemini API Key 即時翻譯字幕，並可校正橫/直向畫面。
- **詳細說明**：列出三大功能、需自備 Gemini API Key、資料如何處理（音訊只送往 Google Gemini）、不蒐集個資。

---

## 三、打包步驟

```bash
# 在專案根目錄，排除開發用檔案後壓成 zip
cd path/to/ig-live
zip -r ../ig-live-upload.zip . \
  -x "*.git*" "node_modules/*" "icons/icon.svg" "*.DS_Store" "PUBLISHING.md"
```

> 注意：`manifest.json` 必須在 zip 的**根目錄**（不要多包一層資料夾）。

上傳：Dashboard → **Items** → **Add new item** → 上傳 zip → 填寫商店資訊 → 送審。

---

## 四、政策合規重點（本擴充的高風險項，務必處理）

這個擴充功能會**錄製第三方網站內容**並**把使用者音訊送往外部 API**，審查會特別嚴格。以下逐項對應 Chrome Web Store 政策：

### 1. 單一用途（Single Purpose）— 必過
- 政策要求每個擴充只有「一個明確、狹義的用途」。
- 我們的用途可包裝為：**「Instagram 直播輔助：錄影、即時翻譯字幕、畫面方向校正」**——三者都圍繞「觀看 IG 直播」這個核心，論述上算同一用途。送審說明要這樣寫。

### 2. 權限最小化與理由（Permissions Justification）
審查表單會要求逐一說明每個權限，準備好以下理由：

| 權限 | 送審理由 |
| --- | --- |
| `storage` | 儲存使用者的 Gemini API Key 與旋轉/語言偏好 |
| `activeTab` | 讓 popup 讀取目前分頁網址、判斷是否在 IG，並對該分頁送出指令 |
| `host_permissions: instagram.com` | 偵測直播影片、注入 overlay 控制面板 |
| `host_permissions: generativelanguage.googleapis.com` | 由 background 呼叫 Gemini 進行翻譯 |

> 已採最小權限：錄影存檔走瀏覽器原生的 `<a download>`（不需 `downloads` 權限）；content script 為靜態註冊（不需 `scripting` 權限）。這兩個權限已從 manifest 移除，可降低審查退件機率。

### 3. 隱私權揭露（必填）
- Dashboard 的 **Privacy practices** 分頁要逐項勾選並聲明：
  - 是否蒐集「個人身分資訊 / 使用者活動 / 網站內容」→ 我們會處理**音訊（網站內容）**，須誠實揭露。
  - 聲明資料用途：**只為了提供翻譯功能，傳送給 Google Gemini API，不另作他用、不販售。**
- 必須提供**隱私權政策 URL**（可放 GitHub Pages 或 Notion 公開頁）。草稿要點：
  - 不蒐集、不儲存使用者個資到我方伺服器（本擴充無後端）。
  - API Key 只存在使用者本機 `chrome.storage.local`。
  - 直播音訊片段會傳送至 Google Gemini API 以產生翻譯，受 Google 隱私政策規範。

### 4. ⚠️ 內容錄製與版權風險（最可能被退件的點）
- 錄製他人 Instagram 直播可能牽涉**版權／Instagram 服務條款**。審查者可能以「促成侵權」或「違反目標網站 ToS」為由退件。
- 降低風險的做法：
  - 商店說明與擴充內**明確標註**「請僅在取得授權下錄製，並遵守 Instagram 服務條款與當地法律」。
  - 將定位偏向「個人學習／無障礙翻譯輔助」而非「下載他人內容」。
- 須有心理準備：即使如此仍可能被人工審查退件，需依回覆理由調整。

### 5. 程式碼可讀性
- 不可使用混淆/壓縮到無法審查的程式碼（我們目前都是可讀原始碼，OK）。
- 不可遠端載入會改變行為的程式碼（我們無 remote code，OK）。

---

## 五、送審與發佈

1. 填完所有必填欄位（含隱私政策 URL、權限理由、資料揭露）後按 **Submit for review**。
2. 審查時間：通常數小時到數個工作天，含敏感權限者可能更久。
3. 可選擇**發佈範圍**：公開、僅限有連結者（unlisted）、或私人（特定測試帳號）。
   - 建議**先用 unlisted 或私人**測試，確認運作與政策無虞再公開。
4. 退件時會收到具體理由 email，修正後重新送審即可。

---

## 六、發佈後維護

- **版本更新**：改 `manifest.json` 的 `version`（須遞增）→ 重新打包上傳 → 再次送審。
- **使用者回報**：留意商店評論與支援信箱。
- **API 變動**：Gemini 模型名稱／端點若調整，需同步更新並發版。

---

## 七、上架前檢查清單（TL;DR）

- [x] 移除未使用權限（已移除 `downloads`、`scripting`）
- [ ] 準備 ≥1 張 1280×800 截圖
- [ ] 撰寫並上線隱私權政策 URL
- [ ] 商店說明強調合法使用、自備 API Key
- [ ] 打包 zip（manifest 在根目錄、排除開發檔）
- [ ] 先以 unlisted/私人發佈測試
- [ ] 填寫權限理由與資料揭露
- [ ] Submit for review
