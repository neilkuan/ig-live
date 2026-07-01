// background.js — service worker：集中處理 Gemini API 呼叫（content script 跨域 fetch 會被頁面 CORS 擋）。

async function callGemini({ audioBase64, mimeType, targetLang, model }) {
  const { settings } = await chrome.storage.local.get(["settings"]);
  const key = settings && settings.geminiKey;
  if (!key) return { ok: false, error: "未設定 Gemini API Key" };

  const useModel = model || (settings && settings.model) || "gemini-2.5-flash";
  const lang = targetLang || (settings && settings.targetLang) || "繁體中文";

  const prompt =
    `你是即時口譯字幕員。請聽這段直播音訊，輸出兩個欄位：` +
    `original = 講者說話的原文逐字稿（保留原本的語言，不要翻譯）；` +
    `translation = 把內容翻譯成${lang}。` +
    `若聽不清楚或沒有人說話，兩個欄位都回空字串。`;

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${encodeURIComponent(key)}`;

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inlineData: { mimeType: mimeType || "audio/wav", data: audioBase64 } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 512,
      thinkingConfig: { thinkingBudget: 0 },
      // 強制結構化輸出，雙字幕才好解析
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          original: { type: "STRING" },
          translation: { type: "STRING" },
        },
        required: ["original", "translation"],
      },
    },
  };

  // fetch 逾時保護：Gemini API 若卡住不回應，逾時後主動中斷請求並回報錯誤，
  // 避免 content.js 端的 sendMessage 永遠等不到回應。
  const FETCH_TIMEOUT_MS = 12000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${txt.slice(0, 200)}` };
    }
    const data = await res.json();
    const raw =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    let original = "";
    let translation = "";
    try {
      const obj = JSON.parse(raw);
      original = (obj.original || "").trim();
      translation = (obj.translation || "").trim();
    } catch (_) {
      // 萬一沒回成 JSON，整段當翻譯用
      translation = raw.trim();
    }
    // text 欄位保留為翻譯，向下相容
    return { ok: true, original, translation, text: translation };
  } catch (err) {
    if (err.name === "AbortError") {
      return { ok: false, error: "timeout" };
    }
    return { ok: false, error: String(err) };
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "translate") {
    callGemini(msg).then(sendResponse);
    return true; // 非同步回應
  }
  return false;
});
