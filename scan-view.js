// The barcode scanner screen (inside the general sheet) and voice search.
// The camera's frames are read on the device by barcode.js; nothing but the
// code it reads is handed on. Voice search uses the phone's own speech
// recognition to fill a search box.

import { esc, swapPanel, panelEl, backBtn, closeBtn } from "./ui.js";
import { decodeImage, normalizeBarcode } from "./barcode.js";
import { spokenQuery } from "./foods.js";

let stream = null, loop = null;

function stopCamera() {
  clearTimeout(loop);
  loop = null;
  if (stream) for (const t of stream.getTracks()) t.stop();
  stream = null;
}

// Pixels of a video frame or a photo, scaled so the long side is at most `max`.
function pixels(src, w, h, max, canvas, crop = null) {
  const c = crop ?? { x: 0, y: 0, w, h };
  const scale = Math.min(1, max / Math.max(c.w, c.h));
  canvas.width = Math.round(c.w * scale);
  canvas.height = Math.round(c.h * scale);
  const g = canvas.getContext("2d", { willReadFrequently: true });
  g.drawImage(src, c.x, c.y, c.w, c.h, 0, 0, canvas.width, canvas.height);
  return g.getImageData(0, 0, canvas.width, canvas.height);
}

// Read a barcode from a photo file: rows and columns across the whole picture,
// at two sizes (a sharp photo reads best large, a blurry one small).
async function decodePhoto(file) {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  try {
    for (const max of [1600, 800]) {
      const hits = decodeImage(pixels(bmp, bmp.width, bmp.height, max, canvas), { rows: 31, cols: 31, top: 0, bottom: 1 });
      if (hits.length) return hits[0].code;
    }
    return "";
  } finally { bmp.close?.(); }
}

// Opens the scanner. onCode(code) gets a normalized barcode (EAN-13 or EAN-8);
// onBack() returns to wherever the scanner was opened from. Returns the
// handlers' close hook, so the caller's sheet stops the camera when it closes.
export function openScanner({ onCode, onBack, title = "Scan barcode" }) {
  stopCamera();
  const canCamera = !!navigator.mediaDevices?.getUserMedia;
  const finish = (code) => { stopCamera(); onCode(code); };
  const status = (text, tone = "") => {
    const el = panelEl().querySelector("#scan-msg");
    if (el) { el.className = `msg ${tone}`; el.textContent = text; }
  };
  const handlers = {
    click: (act) => {
      if (act === "back") { stopCamera(); onBack(); }
      else if (act === "scan-photo") panelEl().querySelector("#scan-photo")?.click();
      else if (act === "scan-retry") startCamera();
    },
    input: async (e) => {
      if (e.target.id !== "scan-photo") return;
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      status("Reading the photo…");
      try {
        const code = await decodePhoto(file);
        if (!panelEl().querySelector("#scan-photo")) return; // the sheet moved on while the photo was read
        if (code) finish(code);
        else status("No barcode found in that photo. Hold the phone closer, keep the bars sharp and level, or type the number.", "bad");
      } catch { status("That photo could not be read. Try again, or type the number.", "bad"); }
    },
    submit: (form) => {
      const raw = String(new FormData(form).get("code") ?? "");
      const code = normalizeBarcode(raw);
      if (code) finish(code);
      else status(raw.trim() ? "That number is not a valid barcode. Check the digits under the bars (8, 12 or 13 of them)." : "Type the digits under the bars.", "bad");
    },
    close: stopCamera,
  };

  swapPanel(`
    <div class="sheet-head">${backBtn()}<h2 id="panel-title" class="grow">${esc(title)}</h2>${closeBtn}</div>
    <p class="sub">Point the camera at the bars on the package. The picture stays on this phone; only the number is looked up.</p>
    ${canCamera ? `<div class="scan-view"><video id="scan-video" playsinline muted aria-label="Camera view"></video><div class="scan-guide" aria-hidden="true"></div></div>` : ""}
    <p class="msg" role="status" id="scan-msg">${canCamera ? "Starting the camera…" : "The camera is not available here. Take a photo of the barcode or type its number."}</p>
    <div class="foot-actions tight">
      <button type="button" class="btn ghost" data-act="scan-photo">Take a photo instead</button>
    </div>
    <input id="scan-photo" type="file" accept="image/*" capture="environment" hidden>
    <form class="form spaced" id="scan-form" novalidate>
      <label class="field"><span>Or type the number under the bars</span><input name="code" type="text" inputmode="numeric" pattern="[0-9 ]*" maxlength="16" autocomplete="off"></label>
      <button class="btn ghost" type="submit">Look up</button>
    </form>`, handlers);

  async function startCamera() {
    stopCamera();
    const video = panelEl().querySelector("#scan-video");
    if (!video) return;
    status("Starting the camera…");
    // Closing the sheet keeps the panel in the page, so "still showing" means
    // the video is in the page and its dialog is open.
    const live = () => video.isConnected && !!video.closest("dialog")?.open;
    // A permission prompt left unanswered (or a camera that never answers) must not leave only a spinner.
    const slow = setTimeout(() => {
      if (!stream && live()) status("The camera has not started. Allow it if the phone asks, or take a photo or type the number.");
    }, 8000);
    let s;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
    } catch (e) {
      clearTimeout(slow);
      const denied = e?.name === "NotAllowedError" || e?.name === "SecurityError";
      status(denied ? "genki may not use the camera. Allow it in the phone's settings, or take a photo or type the number." : "The camera could not start. Take a photo of the barcode or type its number.", "bad");
      const msg = panelEl().querySelector("#scan-msg");
      if (msg && !panelEl().querySelector("[data-act=scan-retry]")) msg.insertAdjacentHTML("afterend", `<button type="button" class="btn ghost small-btn" data-act="scan-retry">Try the camera again</button>`);
      return;
    }
    clearTimeout(slow);
    // The sheet may have moved on while the phone asked for permission: stop
    // this stream (not the module's, which may belong to a newer scanner).
    if (!live()) { for (const t of s.getTracks()) t.stop(); return; }
    stream = s;
    try { await s.getVideoTracks()[0]?.applyConstraints?.({ advanced: [{ focusMode: "continuous" }] }); } catch { /* not every camera can */ }
    video.srcObject = s;
    let played = true;
    try { await video.play(); } catch { played = false; }
    if (stream !== s) return; // stopped or replaced while starting
    if (!played) { stopCamera(); status("The camera could not show a picture. Take a photo of the barcode or type its number.", "bad"); return; }
    status("Looking for a barcode…");
    const canvas = document.createElement("canvas");
    let last = "";
    const tick = () => {
      loop = null;
      if (stream !== s) return;
      if (!live()) { stopCamera(); return; }
      const w = video.videoWidth, h = video.videoHeight;
      if (w && h) {
        // The guide box: the middle 90 % of the width, 40 % of the height.
        const crop = { x: Math.round(w * 0.05), y: Math.round(h * 0.3), w: Math.round(w * 0.9), h: Math.round(h * 0.4) };
        let hits;
        try { hits = decodeImage(pixels(video, w, h, 1280, canvas, crop), { rows: 11, top: 0.05, bottom: 0.95 }); }
        catch { stopCamera(); status("The camera picture could not be read. Take a photo of the barcode or type its number.", "bad"); return; }
        // Read twice (two lines of one frame, or two frames in a row) before trusting it.
        const top = hits[0];
        if (top && (top.reads >= 2 || top.code === last)) { finish(top.code); return; }
        last = top?.code ?? "";
      }
      loop = setTimeout(tick, 90);
    };
    loop = setTimeout(tick, 150);
  }

  if (canCamera) startCamera();
  return stopCamera;
}

// ---------- voice search ----------

const Recognition = () => globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition ?? null;
export const voiceAvailable = () => !!Recognition();

export const micBtn = () => voiceAvailable()
  ? `<button type="button" class="icon-btn mic" data-act="voice" aria-label="Search by voice" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>`
  : "";

let listening = null;

export function stopVoice() {
  try { listening?.abort(); } catch { /* already ended */ }
  listening = null;
}

// Listen once and put what was said into `input` (firing an input event so
// the search runs). btn shows the listening state; say(text) reports problems.
export function startVoice(input, btn, say) {
  const R = Recognition();
  if (!R || !input) return;
  // A tap on a live mic button stops it; a recognizer left from an earlier
  // screen (its button gone) is stopped and a new one starts.
  if (listening) { const was = listening; stopVoice(); if (was.btn?.isConnected) return; }
  const rec = new R();
  rec.lang = navigator.language || "en-US";
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.continuous = false;
  const set = (text) => {
    if (!input.isConnected) return;
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  rec.onresult = (e) => {
    const text = [...e.results].map((r) => r[0]?.transcript ?? "").join(" ");
    set(spokenQuery(text));
  };
  rec.onerror = (e) => {
    const off = e.error === "not-allowed" || e.error === "service-not-allowed";
    if (e.error === "no-speech") say("Nothing heard. Tap the mic and say a food.");
    else if (e.error !== "aborted") say(off ? "Voice search is off for genki. Allow speech recognition in the phone's settings, or use the keyboard's mic to dictate." : "Voice search did not work this time. Try again, or use the keyboard's mic.");
  };
  rec.onend = () => {
    if (listening === rec) listening = null;
    if (btn?.isConnected) { btn.setAttribute("aria-pressed", "false"); btn.setAttribute("aria-label", "Search by voice"); }
  };
  try { rec.start(); }
  catch { say("Voice search could not start. Use the keyboard's mic to dictate."); return; }
  rec.btn = btn;
  listening = rec;
  say("");
  btn?.setAttribute("aria-pressed", "true");
  btn?.setAttribute("aria-label", "Stop listening");
}
