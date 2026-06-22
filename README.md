# IG Live Recorder + Gemini Live Translation

**English | [繁體中文](README.zh-TW.md)**

A Chrome (Manifest V3) extension that **records** Instagram live streams, adds **real-time bilingual subtitles via the Gemini API**, and lets you **fix landscape/portrait orientation**.

> ⚠️ **Legal / acceptable-use notice**
> This tool is intended for **personal, educational, and accessibility (translation) use only**. Recording or redistributing someone else's live stream may infringe **copyright** or violate **Instagram's Terms of Service**.
> Before use, make sure you have the **content owner's permission** and comply with your local laws and the platform's rules. **Do not** use it for unauthorized transcription, redistribution, or commercial purposes.
> You assume all legal responsibility arising from your use of this tool; the authors and contributors accept no liability. This project is **not affiliated** with Instagram, Meta, or Google.

## Features

| Feature | Description |
| --- | --- |
| 🔴 Recording | Captures the `<video>` element via `captureStream()`, redraws through a canvas, and records with `MediaRecorder`. **Outputs `.mp4` (H.264/AAC) when supported**, falling back to `.webm`. Applies orientation correction and burns subtitles into the video. Quality selectable at 6 / 10 / 16 Mbps. |
| 字 Live translation | Captures stream audio with Web Audio (`AudioWorklet`), slices it into a few-second WAV chunks, and sends them through the background worker to `gemini-2.5-flash`. **Bilingual subtitles** (original + translation) are overlaid at the bottom. A **billing indicator** blinks while it's running. |
| ↻ Orientation fix | When a streamer holds the phone in landscape but the web shows it portrait, rotate manually by 0/90/180/270° or mirror it. **Display and recording stay in sync**, and rotated video is scaled up to the viewport to reduce black bars. |

## Installation (developer mode)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked** and select this project folder
4. Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)
5. Click the extension icon → paste the API key → adjust target language / model / bilingual subtitles / quality as needed → save

## Usage

1. Open an Instagram live page
2. A draggable control panel appears at the top-right (you can also use the extension popup)
3. **Record**: click "● 錄影" to start; click again to stop and auto-download
4. **Translate**: click "字 翻譯"; subtitles appear in real time, and a blinking 🔴 `字幕翻譯中・計費` indicator shows at the top
5. **Orientation**: use ↺ / ↻ to rotate, ⇋ to mirror

## Cost

The only variable cost is the **Gemini API** (the extension itself is free and runs entirely locally). With the default 6-second chunks on `gemini-2.5-flash`:

- Roughly **US$0.3–0.5 per hour** of continuous translation (a silence threshold usually makes it lower).
- The free tier has RPM/RPD limits; use a paid plan for long sessions.
- Increase `chunkSeconds` or disable bilingual subtitles to cut costs further.

## Technical notes

- **CORS**: In MV3, cross-origin `fetch` from a content script is subject to the page's CORS, so all Gemini calls go through `background.js` (only the service worker gets `host_permissions`).
- **Audio format**: Audio is encoded as 16-bit PCM WAV before being sent to Gemini (webm/opus support is unreliable).
- **Structured output**: A `responseSchema` makes Gemini return both `original` and `translation`, which keeps the bilingual subtitles easy to parse.
- **Low latency**: `thinkingBudget: 0` disables reasoning to reduce subtitle latency and usage.
- **API savings**: Each chunk passes a volume threshold first; silent segments are skipped.
- **Least privilege**: Only `storage` and `activeTab` permissions are used.

## Limitations & known issues

- Automatic rotation detection is unreliable (sideways content in a portrait frame still has portrait dimensions), so rotation is **manual**.
- Translation has inherent latency from `chunkSeconds` (default 6s); smaller is faster but means more API calls.
- Recording captures the displayed content (not the raw stream); quality is bounded by the source stream resolution and the bitrate setting.
- Some DRM-protected streams may not expose an audio track via `captureStream()`.

## Project structure

```
manifest.json
src/
  background.js          # Gemini API calls (structured bilingual output)
  content/
    content.js           # core: detect video, record, translate, rotate, overlay UI
    wav.js               # PCM → WAV encoding
    pcm-worklet.js       # AudioWorklet: PCM capture
    overlay.css          # panel, subtitle, and billing-indicator styles
  popup/
    popup.html / .js / .css   # settings and quick actions
```

## License

[MIT](LICENSE) © neilkuan
