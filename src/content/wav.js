// wav.js — 將 Float32 PCM 樣本編碼成 16-bit PCM WAV blob。
// 內容腳本在同一個 isolated world 共用 global scope，因此這裡掛到 window 供 content.js 使用。
(function () {
  "use strict";

  // 把多段 Float32Array 合併成一段
  function mergeChunks(chunks) {
    let length = 0;
    for (const c of chunks) length += c.length;
    const result = new Float32Array(length);
    let offset = 0;
    for (const c of chunks) {
      result.set(c, offset);
      offset += c.length;
    }
    return result;
  }

  // 將 [-1,1] 的 Float32 樣本寫成 16-bit PCM
  function floatTo16BitPCM(view, offset, input) {
    for (let i = 0; i < input.length; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, input[i]));
      s = s < 0 ? s * 0x8000 : s * 0x7fff;
      view.setInt16(offset, s, true);
    }
  }

  function writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // samples: Float32Array, sampleRate: number → Blob(audio/wav)
  function encodeWAV(samples, sampleRate) {
    const numChannels = 1;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = samples.length * bytesPerSample;

    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, "WAVE");
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true); // audio format = PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 8 * bytesPerSample, true); // bits per sample
    writeString(view, 36, "data");
    view.setUint32(40, dataSize, true);
    floatTo16BitPCM(view, 44, samples);

    return new Blob([view], { type: "audio/wav" });
  }

  // Blob → base64（不含 data: 前綴）
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result || "";
        const idx = result.indexOf(",");
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  window.__igliveWav = { mergeChunks, encodeWAV, blobToBase64 };
})();
