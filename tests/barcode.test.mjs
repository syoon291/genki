import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeRow, decodeImage, normalizeBarcode, ean13Valid, ean8Valid, upcEToA } from "../barcode.js";

// ---- a small encoder, so tests can draw barcodes of made-up numbers ----
const LW = ["3211", "2221", "2122", "1411", "1132", "1231", "1114", "1312", "1213", "3112"];
const FIRST = ["000000", "001011", "001101", "001110", "010011", "011001", "011100", "010101", "010110", "011010"];
const UPCE = ["111000", "110100", "110010", "110001", "101100", "100110", "100011", "101010", "101001", "100101"];
// Widths -> module bits, starting with `startDark`.
const bits = (widths, startDark) => [...widths].map(Number).map((w, i) => String((i % 2 === 0) === startDark ? 1 : 0).repeat(w)).join("");
const lBits = (d) => bits(LW[d], false);
const gBits = (d) => bits([...LW[d]].reverse().join(""), false);
const rBits = (d) => bits(LW[d], true);

function ean13Modules(code) {
  const p = FIRST[Number(code[0])];
  let s = "101";
  for (let i = 0; i < 6; i++) s += p[i] === "0" ? lBits(Number(code[1 + i])) : gBits(Number(code[1 + i]));
  s += "01010";
  for (let i = 0; i < 6; i++) s += rBits(Number(code[7 + i]));
  return s + "101";
}
function ean8Modules(code) {
  let s = "101";
  for (let i = 0; i < 4; i++) s += lBits(Number(code[i]));
  s += "01010";
  for (let i = 4; i < 8; i++) s += rBits(Number(code[i]));
  return s + "101";
}
function upcEModules(six, check, ns = 0) {
  const p = UPCE[check];
  let s = "101";
  for (let i = 0; i < 6; i++) {
    const even = (p[i] === "1") !== (ns === 1);
    s += even ? gBits(Number(six[i])) : lBits(Number(six[i]));
  }
  return s + "010101";
}

// Draw modules as a row of luminance: `px` pixels a module (any fraction),
// a quiet zone each side, box blur, uneven light and noise.
function row(modules, { px = 3, quiet = 12, blur = 0, gradient = 0, noise = 0, dark = 40, light = 215, seed = 1 } = {}) {
  const m = "0".repeat(quiet) + modules + "0".repeat(quiet);
  const n = Math.round(m.length * px);
  let out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Area average of the modules this pixel covers.
    const a = i / px, b = (i + 1) / px;
    let v = 0;
    for (let k = Math.floor(a); k < Math.ceil(b); k++) {
      const cover = Math.min(b, k + 1) - Math.max(a, k);
      v += cover * (m[k] === "1" ? dark : light);
    }
    out[i] = v / (b - a);
  }
  for (let pass = 0; pass < blur; pass++) out = out.map((_, i) => (out[Math.max(0, i - 1)] + out[i] + out[Math.min(n - 1, i + 1)]) / 3);
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  return out.map((v, i) => Math.max(0, Math.min(255, v * (1 - gradient * (i / n)) + (rnd() - 0.5) * noise)));
}

// Made-up numbers with valid check digits.
const withCheck13 = (twelve) => { for (let c = 0; c < 10; c++) if (ean13Valid(twelve + c)) return twelve + c; };
const CODES = ["012345678905", "400638133393", "590123412345", "978020137962", "871234567890", "490000000001"].map((x) => withCheck13(x.slice(0, 12)));

test("check digits", () => {
  assert.ok(ean13Valid("4006381333931"));
  assert.ok(!ean13Valid("4006381333932"));
  assert.ok(ean8Valid("96385074"));
  assert.ok(!ean8Valid("96385075"));
});

test("normalizeBarcode stores UPC-A as its 13-digit EAN and rejects bad digits", () => {
  assert.equal(normalizeBarcode("036000291452"), "0036000291452");
  assert.equal(normalizeBarcode("0 36000 29145 2"), "0036000291452");
  assert.equal(normalizeBarcode("4006381333931"), "4006381333931");
  assert.equal(normalizeBarcode("96385074"), "96385074");
  assert.equal(normalizeBarcode("00036000291452"), "0036000291452");
  assert.equal(normalizeBarcode("036000291453"), "");
  assert.equal(normalizeBarcode("12345"), "");
  assert.equal(normalizeBarcode("abc"), "");
});

test("UPC-E expands to its UPC-A", () => {
  assert.equal(upcEToA(0, "123450", 5), "012000003455");
  assert.equal(upcEToA(0, "425261", 4), "042100005264");
  assert.equal(upcEToA(0, "123453", 0), "012300000450");
  assert.equal(upcEToA(0, "123454", 0), "012340000050");
  assert.equal(upcEToA(0, "123457", 0), "012345000070");
});

test("reads EAN-13 rows at several sizes", () => {
  for (const code of CODES) for (const px of [1.6, 2, 2.7, 3.3, 5]) {
    assert.equal(decodeRow(row(ean13Modules(code), { px })), code, `${code} at ${px} px a module`);
  }
});

test("reads blurry, noisy and unevenly lit rows", () => {
  for (const [i, code] of CODES.entries()) {
    assert.equal(decodeRow(row(ean13Modules(code), { px: 3.2, blur: 2, noise: 30, gradient: 0.45, seed: i + 3 })), code);
  }
});

test("reads a barcode upside down (right to left)", () => {
  const code = CODES[1];
  assert.equal(decodeRow(row([...ean13Modules(code)].reverse().join(""), { px: 2.5 })), code);
});

test("reads a barcode with other print beside it", () => {
  const code = CODES[2];
  const r = row("1101001" + "0".repeat(14) + ean13Modules(code) + "0".repeat(14) + "1011", { px: 2.4 });
  assert.equal(decodeRow(r), code);
});

test("reads UPC-A as EAN-13 with a leading 0", () => {
  const upcA = "036000291452";
  assert.equal(decodeRow(row(ean13Modules(`0${upcA}`), { px: 2.8 })), `0${upcA}`);
});

test("reads EAN-8 and UPC-E", () => {
  assert.equal(decodeRow(row(ean8Modules("96385074"), { px: 3 })), "96385074");
  // UPC-E 0 425261 4 is UPC-A 042100005264.
  assert.equal(decodeRow(row(upcEModules("425261", 4), { px: 3 })), "0042100005264");
});

test("reads nothing from a flat, empty or broken row", () => {
  assert.equal(decodeRow(new Float64Array(400).fill(128)), "");
  assert.equal(decodeRow(new Float64Array(0)), "");
  const broken = ean13Modules(CODES[0]).split("");
  for (let i = 30; i < 40; i++) broken[i] = "0";
  assert.equal(decodeRow(row(broken.join(""), { px: 3 })), "");
});

test("decodeImage reads rows of an RGBA image and counts the reads", () => {
  const code = CODES[3];
  const line = row(ean13Modules(code), { px: 3 });
  const width = line.length, height = 60;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4;
    const v = y > 10 && y < 50 ? line[x] : 230;
    data[p] = data[p + 1] = data[p + 2] = v; data[p + 3] = 255;
  }
  const hits = decodeImage({ width, height, data }, { rows: 9, top: 0.2, bottom: 0.8 });
  assert.equal(hits[0].code, code);
  assert.ok(hits[0].reads >= 5);
});

test("decodeImage reads an upright barcode from its columns", () => {
  const code = CODES[4];
  const line = row(ean13Modules(code), { px: 2.5 });
  const height = line.length, width = 40;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4;
    data[p] = data[p + 1] = data[p + 2] = line[y]; data[p + 3] = 255;
  }
  assert.equal(decodeImage({ width, height, data }, { rows: 5, cols: 5 })[0]?.code, code);
});

test("random bars never read as a barcode", () => {
  let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let k = 0; k < 300; k++) {
    let m = "";
    while (m.length < 140) m += String(rnd() < 0.5 ? 1 : 0).repeat(1 + Math.floor(rnd() * 4));
    assert.equal(decodeRow(row(m, { px: 2 + rnd() * 2, noise: 20, seed: k + 1 })), "");
  }
});
