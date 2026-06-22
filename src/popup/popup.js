const $ = (id) => document.getElementById(id);

async function load() {
  const { settings } = await chrome.storage.local.get(["settings"]);
  const s = settings || {};
  $("key").value = s.geminiKey || "";
  $("lang").value = s.targetLang || "繁體中文";
  $("model").value = s.model || "gemini-2.5-flash";
  $("sec").value = s.chunkSeconds || 6;
  $("secVal").textContent = $("sec").value;
  $("dual").checked = s.dualSubtitle !== false; // 預設開啟
  $("bitrate").value = String(s.bitrate || 6000000);
}

$("sec").addEventListener("input", () => {
  $("secVal").textContent = $("sec").value;
});

$("save").addEventListener("click", async () => {
  const settings = {
    geminiKey: $("key").value.trim(),
    targetLang: $("lang").value.trim() || "繁體中文",
    model: $("model").value,
    chunkSeconds: Number($("sec").value),
    dualSubtitle: $("dual").checked,
    bitrate: Number($("bitrate").value),
  };
  await chrome.storage.local.set({ settings });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { type: "settings-updated" }).catch(() => {});
  $("status").textContent = "已儲存 ✓";
  setTimeout(() => ($("status").textContent = ""), 2000);
});

async function sendCmd(cmd) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/https:\/\/www\.instagram\.com\//.test(tab.url || "")) {
    $("status").textContent = "請在 instagram.com 直播頁使用";
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "cmd", cmd });
    window.close();
  } catch (e) {
    $("status").textContent = "請重新整理 IG 頁面再試";
  }
}

$("rec").addEventListener("click", () => sendCmd("rec"));
$("trans").addEventListener("click", () => sendCmd("trans"));
$("rot").addEventListener("click", () => sendCmd("rotate"));

load();
