// content.js — 注入 IG 頁面：偵測直播 <video>、提供旋轉校正、錄影、Gemini 即時翻譯字幕。
(function () {
  "use strict";

  const { mergeChunks, encodeWAV, blobToBase64 } = window.__igliveWav;

  const state = {
    video: null,
    rotation: 0, // 0 / 90 / 180 / 270
    flip: false,
    recording: false,
    translating: false,
    // 錄影
    recorder: null,
    recordChunks: [],
    rafId: null,
    canvas: null,
    // 共用音訊管線：錄影與翻譯共用同一個 context 與 source，避免互搶同一條音訊軌
    audioCtxShared: null,
    audioSourceShared: null,
    recDest: null, // 錄影輸出的 MediaStreamDestination 節點
    // 翻譯
    workletNode: null,
    zeroGain: null,
    translSink: null, // 翻譯用的無聲匯流節點（驅動 worklet，不碰喇叭）
    pcmChunks: [],
    flushTimer: null,
    currentSubtitle: "", // 翻譯
    currentOriginal: "", // 原文
    settings: {
      geminiKey: "",
      targetLang: "繁體中文",
      chunkSeconds: 6,
      model: "gemini-2.5-flash",
      dualSubtitle: true, // 雙字幕：原文 + 翻譯
      bitrate: 6000000, // 錄影位元率（bps）：標準 6M / 高 10M / 超高 16M
    },
  };

  // ---------- 設定 ----------
  async function loadSettings() {
    const stored = await chrome.storage.local.get(["settings"]);
    if (stored.settings) Object.assign(state.settings, stored.settings);
    const r = await chrome.storage.local.get(["rotation"]);
    if (typeof r.rotation === "number") state.rotation = r.rotation;
  }

  // ---------- 找到直播影片 ----------
  function findVideo() {
    const videos = Array.from(document.querySelectorAll("video"));
    // 取畫面上最大、正在播放的 video
    let best = null;
    let bestArea = 0;
    for (const v of videos) {
      const rect = v.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea && rect.width > 0) {
        best = v;
        bestArea = area;
      }
    }
    return best;
  }

  // ---------- 旋轉顯示 ----------
  function applyRotationToDisplay() {
    const v = state.video;
    if (!v) return;
    const rot = state.rotation;
    let transform = `rotate(${rot}deg)`;
    if (state.flip) transform += " scaleX(-1)";
    // 旋轉 90/270 時長寬互換：放大填滿容器可用空間
    if (rot === 90 || rot === 270) {
      const rect = v.getBoundingClientRect();
      // 旋轉後 footprint：寬變高、高變寬
      const scale = rect.width / rect.height;
      transform += ` scale(${scale})`;
    }
    v.style.transform = transform;
    v.style.transformOrigin = "center center";
  }

  function setRotation(deg) {
    state.rotation = ((deg % 360) + 360) % 360;
    chrome.storage.local.set({ rotation: state.rotation });
    applyRotationToDisplay();
    updateOverlayLabels();
  }

  // 逐字累積換行（適合中日文等無空格語言）
  function wrapText(ctx, text, maxWidth) {
    const lines = [];
    let line = "";
    for (const ch of text) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  // 將原文（小字）＋翻譯（大字）燒錄到 canvas 底部
  function drawSubtitleOnCanvas(ctx, canvas, translation, original) {
    const baseFont = '-apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif';
    const transSize = Math.max(18, Math.round(canvas.width * 0.038));
    const origSize = Math.max(13, Math.round(transSize * 0.72));
    const maxWidth = canvas.width * 0.92;

    // 組出由上到下的行陣列：原文在上、翻譯在下
    const blocks = [];
    if (original) {
      ctx.font = `600 ${origSize}px ${baseFont}`;
      for (const l of wrapText(ctx, original, maxWidth))
        blocks.push({ text: l, size: origSize, color: "#d6d6d6", weight: 600 });
    }
    if (translation) {
      ctx.font = `700 ${transSize}px ${baseFont}`;
      for (const l of wrapText(ctx, translation, maxWidth))
        blocks.push({ text: l, size: transSize, color: "#ffffff", weight: 700 });
    }
    if (!blocks.length) return;

    const gap = 1.32;
    const heights = blocks.map((b) => b.size * gap);
    const totalH = heights.reduce((a, b) => a + b, 0);
    const padding = transSize * 0.5;
    const bottom = canvas.height - transSize * 0.7;
    const top = bottom - totalH;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, top - padding, canvas.width, totalH + padding * 1.6);

    const cx = canvas.width / 2;
    let y = top;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      y += heights[i];
      ctx.font = `${b.weight} ${b.size}px ${baseFont}`;
      ctx.lineWidth = Math.max(2, b.size * 0.12);
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.strokeText(b.text, cx, y);
      ctx.fillStyle = b.color;
      ctx.fillText(b.text, cx, y);
    }
    ctx.restore();
  }

  // ---------- 錄影（含方向校正）----------
  function buildRotatedCanvasStream(video) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    state.canvas = canvas;

    function resize() {
      const vw = video.videoWidth || 720;
      const vh = video.videoHeight || 1280;
      if (state.rotation === 90 || state.rotation === 270) {
        canvas.width = vh;
        canvas.height = vw;
      } else {
        canvas.width = vw;
        canvas.height = vh;
      }
    }
    resize();

    function draw() {
      if (!state.recording) return;
      const vw = video.videoWidth || canvas.width;
      const vh = video.videoHeight || canvas.height;
      if (
        (state.rotation === 90 || state.rotation === 270) &&
        (canvas.width !== vh || canvas.height !== vw)
      ) {
        resize();
      } else if (
        state.rotation % 180 === 0 &&
        (canvas.width !== vw || canvas.height !== vh)
      ) {
        resize();
      }

      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((state.rotation * Math.PI) / 180);
      if (state.flip) ctx.scale(-1, 1);
      ctx.drawImage(video, -vw / 2, -vh / 2, vw, vh);
      ctx.restore();
      // 字幕燒錄：在校正後的畫面（非旋轉座標）底部繪製
      if (state.currentSubtitle || state.currentOriginal)
        drawSubtitleOnCanvas(ctx, canvas, state.currentSubtitle, state.currentOriginal);
      state.rafId = requestAnimationFrame(draw);
    }
    state.rafId = requestAnimationFrame(draw);

    return canvas.captureStream(30);
  }

  // ---------- 共用音訊管線 ----------
  // 錄影與翻譯共用同一個 AudioContext + 同一個 MediaStreamSource，
  // 否則兩者各自對同一條音訊軌 createMediaStreamSource 會互搶，導致一邊幾秒後變靜音。
  function ensureAudioGraph(video) {
    if (state.audioCtxShared) return state.audioCtxShared;
    const stream = video.captureStream ? video.captureStream() : video.mozCaptureStream();
    const at = stream.getAudioTracks();
    if (!at.length) return null;
    const ctx = new AudioContext();
    if (ctx.state === "suspended") ctx.resume();
    state.audioCtxShared = ctx;
    state.audioSourceShared = ctx.createMediaStreamSource(new MediaStream([at[0]]));
    return ctx;
  }
  // 兩個功能都停了才關閉共用管線
  function maybeCloseAudioGraph() {
    if (state.recording || state.translating) return;
    if (state.audioCtxShared) {
      try { state.audioCtxShared.close(); } catch (_) {}
    }
    state.audioCtxShared = null;
    state.audioSourceShared = null;
  }

  async function startRecording() {
    const v = state.video || findVideo();
    if (!v) {
      toast("找不到直播影片");
      return;
    }
    state.video = v;

    try {
      const canvasStream = buildRotatedCanvasStream(v);
      const mixed = new MediaStream();
      canvasStream.getVideoTracks().forEach((t) => mixed.addTrack(t));

      // 音訊經共用管線重新產生一條與 canvas 影像軌同步、從 0 起算的音訊軌。
      const ctx = ensureAudioGraph(v);
      if (ctx) {
        const dest = ctx.createMediaStreamDestination();
        state.audioSourceShared.connect(dest);
        dest.stream.getAudioTracks().forEach((t) => mixed.addTrack(t));
        state.recDest = dest;
      } else {
        toast("抓不到音訊軌（可能是 DRM 串流），將只錄畫面");
      }

      // 優先錄成 mp4（H.264/AAC，通訊軟體相容性最佳），不支援才退回 webm
      const candidates = [
        "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
        "video/mp4;codecs=h264,aac",
        "video/mp4",
        "video/webm;codecs=vp9,opus",
        "video/webm",
      ];
      const mime = candidates.find((c) => MediaRecorder.isTypeSupported(c)) || "video/webm";
      const isMp4 = mime.startsWith("video/mp4");
      const ext = isMp4 ? "mp4" : "webm";
      const blobType = isMp4 ? "video/mp4" : "video/webm";
      console.log("[iglive] 錄影格式:", mime);

      state.recordChunks = [];
      const vbps = Math.max(1_000_000, Number(state.settings.bitrate) || 6_000_000);
      const recorder = new MediaRecorder(mixed, { mimeType: mime, videoBitsPerSecond: vbps });
      console.log("[iglive] 錄影位元率:", (vbps / 1e6).toFixed(0) + " Mbps");
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) state.recordChunks.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(state.recordChunks, { type: blobType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        a.href = url;
        a.download = `ig-live-${ts}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        toast(`錄影已儲存（${ext}）`);
      };
      recorder.start(1000);
      state.recorder = recorder;
      state.recording = true;
      updateOverlayLabels();
      toast("開始錄影");
    } catch (err) {
      console.error("[iglive] 錄影失敗", err);
      toast("錄影失敗：" + err.message);
    }
  }

  function stopRecording() {
    state.recording = false;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = null;
    if (state.recorder && state.recorder.state !== "inactive") {
      state.recorder.stop();
    }
    state.recorder = null;
    if (state.recDest && state.audioSourceShared) {
      try { state.audioSourceShared.disconnect(state.recDest); } catch (_) {}
    }
    state.recDest = null;
    maybeCloseAudioGraph();
    updateOverlayLabels();
  }

  // ---------- Gemini 即時翻譯 ----------
  async function startTranslate() {
    if (!state.settings.geminiKey) {
      toast("請先在擴充功能設定 Gemini API Key");
      return;
    }
    const v = state.video || findVideo();
    if (!v) {
      toast("找不到直播影片");
      return;
    }
    state.video = v;

    try {
      const audioCtx = ensureAudioGraph(v);
      if (!audioCtx) {
        toast("抓不到音訊軌（可能是 DRM 串流）");
        return;
      }
      await audioCtx.audioWorklet.addModule(chrome.runtime.getURL("src/content/pcm-worklet.js"));

      const workletNode = new AudioWorkletNode(audioCtx, "pcm-worklet");
      const zeroGain = audioCtx.createGain();
      zeroGain.gain.value = 0; // 不重複輸出聲音，只為了驅動處理

      state.pcmChunks = [];
      workletNode.port.onmessage = (e) => {
        if (!state.translating) return;
        state.pcmChunks.push(e.data); // 已是 Float32Array 副本
      };

      // 從共用 source 分流到翻譯用的 worklet（與錄影各自分流、互不搶軌）。
      // 終點接「無聲匯流節點」而非喇叭：只為驅動 worklet 運轉，完全不碰音訊輸出裝置，
      // 避免干擾錄影的音訊擷取。
      const translSink = audioCtx.createMediaStreamDestination();
      state.audioSourceShared.connect(workletNode);
      workletNode.connect(zeroGain);
      zeroGain.connect(translSink);

      state.workletNode = workletNode;
      state.zeroGain = zeroGain;
      state.translSink = translSink;
      state.translating = true;

      const sec = Math.max(3, Number(state.settings.chunkSeconds) || 6);
      state.flushTimer = setInterval(() => flushAndTranslate(audioCtx.sampleRate), sec * 1000);

      updateOverlayLabels();
      showSubtitle("（翻譯啟動中…）");
      toast("開始即時翻譯");
    } catch (err) {
      console.error("[iglive] 翻譯啟動失敗", err);
      toast("翻譯啟動失敗：" + err.message);
    }
  }

  async function flushAndTranslate(sampleRate) {
    if (state.pcmChunks.length === 0) return;
    const merged = mergeChunks(state.pcmChunks);
    state.pcmChunks = [];
    // 音量太小（可能沒人說話）就跳過，省 API 用量
    let energy = 0;
    for (let i = 0; i < merged.length; i += 64) energy += Math.abs(merged[i]);
    if (energy / (merged.length / 64) < 0.003) return;

    const wav = encodeWAV(merged, sampleRate);
    const base64 = await blobToBase64(wav);
    try {
      const resp = await chrome.runtime.sendMessage({
        type: "translate",
        audioBase64: base64,
        mimeType: "audio/wav",
        targetLang: state.settings.targetLang,
        model: state.settings.model,
      });
      if (resp && resp.ok) {
        const translation = (resp.translation || resp.text || "").trim();
        const original = (resp.original || "").trim();
        if (translation || original) showSubtitle(translation, original);
      } else if (resp && resp.error) {
        console.warn("[iglive] 翻譯錯誤", resp.error);
      }
    } catch (err) {
      console.warn("[iglive] sendMessage 失敗", err);
    }
  }

  function stopTranslate() {
    state.translating = false;
    if (state.flushTimer) clearInterval(state.flushTimer);
    state.flushTimer = null;
    try {
      if (state.workletNode) {
        state.workletNode.port.onmessage = null;
        // 只拆「共用 source → 翻譯 worklet」這條邊，不影響錄影分支
        if (state.audioSourceShared) state.audioSourceShared.disconnect(state.workletNode);
        state.workletNode.disconnect();
      }
      if (state.zeroGain) state.zeroGain.disconnect();
    } catch (_) {}
    state.workletNode = null;
    state.zeroGain = null;
    state.translSink = null;
    state.pcmChunks = [];
    state.currentSubtitle = "";
    hideSubtitle();
    maybeCloseAudioGraph();
    updateOverlayLabels();
  }

  // ---------- Overlay UI ----------
  let panel, subtitleEl, toastEl, indicatorEl;

  function buildOverlay() {
    if (document.getElementById("iglive-panel")) return;

    panel = document.createElement("div");
    panel.id = "iglive-panel";
    panel.innerHTML = `
      <div class="iglive-row iglive-title">IG Live 工具 <span id="iglive-drag">⠿</span></div>
      <div class="iglive-row">
        <button data-act="rec" id="iglive-rec">● 錄影</button>
        <button data-act="trans" id="iglive-trans">字 翻譯</button>
      </div>
      <div class="iglive-row">
        <span class="iglive-label">旋轉</span>
        <button data-act="rot-left">↺</button>
        <span id="iglive-rot">0°</span>
        <button data-act="rot-right">↻</button>
        <button data-act="flip">⇋ 鏡像</button>
      </div>
      <div class="iglive-row iglive-small">
        <button data-act="pick">重新選取影片</button>
      </div>
    `;
    document.body.appendChild(panel);

    subtitleEl = document.createElement("div");
    subtitleEl.id = "iglive-subtitle";
    subtitleEl.style.display = "none";
    document.body.appendChild(subtitleEl);

    toastEl = document.createElement("div");
    toastEl.id = "iglive-toast";
    toastEl.style.display = "none";
    document.body.appendChild(toastEl);

    // 翻譯計費提醒燈（啟用字幕時閃爍）
    indicatorEl = document.createElement("div");
    indicatorEl.id = "iglive-trans-indicator";
    indicatorEl.style.display = "none";
    indicatorEl.innerHTML = '<span class="iglive-dot"></span>字幕翻譯中・計費';
    document.body.appendChild(indicatorEl);

    panel.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === "rec") state.recording ? stopRecording() : startRecording();
      else if (act === "trans") state.translating ? stopTranslate() : startTranslate();
      else if (act === "rot-left") setRotation(state.rotation - 90);
      else if (act === "rot-right") setRotation(state.rotation + 90);
      else if (act === "flip") { state.flip = !state.flip; applyRotationToDisplay(); }
      else if (act === "pick") { state.video = findVideo(); applyRotationToDisplay(); toast(state.video ? "已選取影片" : "找不到影片"); }
    });

    makeDraggable(panel, panel.querySelector("#iglive-drag"));
    updateOverlayLabels();
  }

  function updateOverlayLabels() {
    if (!panel) return;
    const rec = panel.querySelector("#iglive-rec");
    const trans = panel.querySelector("#iglive-trans");
    const rot = panel.querySelector("#iglive-rot");
    if (rec) { rec.textContent = state.recording ? "■ 停止" : "● 錄影"; rec.classList.toggle("active", state.recording); }
    if (trans) { trans.textContent = state.translating ? "字 停止" : "字 翻譯"; trans.classList.toggle("active", state.translating); }
    if (rot) rot.textContent = state.rotation + "°";
    if (indicatorEl) indicatorEl.style.display = state.translating ? "flex" : "none";
  }

  function showSubtitle(translation, original) {
    const dual = state.settings.dualSubtitle;
    state.currentSubtitle = translation || "";
    state.currentOriginal = dual ? original || "" : "";
    if (!subtitleEl) return;
    subtitleEl.innerHTML = "";
    if (state.currentOriginal) {
      const o = document.createElement("div");
      o.className = "iglive-sub-original";
      o.textContent = state.currentOriginal;
      subtitleEl.appendChild(o);
    }
    if (state.currentSubtitle) {
      const t = document.createElement("div");
      t.className = "iglive-sub-translation";
      t.textContent = state.currentSubtitle;
      subtitleEl.appendChild(t);
    }
    subtitleEl.style.display = state.currentSubtitle || state.currentOriginal ? "block" : "none";
  }
  function hideSubtitle() {
    state.currentSubtitle = "";
    state.currentOriginal = "";
    if (subtitleEl) subtitleEl.style.display = "none";
  }

  let toastTimer;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.style.display = "none"), 2500);
  }

  function makeDraggable(el, handle) {
    let sx, sy, ox, oy, dragging = false;
    handle.style.cursor = "move";
    handle.addEventListener("mousedown", (e) => {
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      const r = el.getBoundingClientRect();
      ox = r.left; oy = r.top;
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      el.style.left = ox + (e.clientX - sx) + "px";
      el.style.top = oy + (e.clientY - sy) + "px";
      el.style.right = "auto";
    });
    window.addEventListener("mouseup", () => (dragging = false));
  }

  // ---------- 來自 popup 的指令 ----------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "settings-updated") {
      loadSettings();
    } else if (msg.type === "get-state") {
      sendResponse({ recording: state.recording, translating: state.translating, rotation: state.rotation });
    } else if (msg.type === "cmd") {
      if (msg.cmd === "rec") state.recording ? stopRecording() : startRecording();
      else if (msg.cmd === "trans") state.translating ? stopTranslate() : startTranslate();
      else if (msg.cmd === "rotate") setRotation(state.rotation + 90);
    }
    return true;
  });

  // ---------- 啟動 ----------
  async function init() {
    console.log("[iglive] content script 載入：共用音訊管線版（錄影+翻譯不搶軌）");
    if (window.top !== window.self && !findVideo()) return; // 子 frame 沒影片就不注入
    await loadSettings();
    buildOverlay();
    state.video = findVideo();
    if (state.video) applyRotationToDisplay();

    // IG 是 SPA，定期重新偵測影片
    setInterval(() => {
      const v = findVideo();
      if (v && v !== state.video) {
        state.video = v;
        applyRotationToDisplay();
      }
    }, 3000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
