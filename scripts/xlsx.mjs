// Minimal .xlsx reader for the food-table build (scripts only, never shipped):
// an .xlsx is a zip of XML, so `unzip -p` pulls each part and a few regexes
// read the cells. Returns rows as arrays of strings, indexed by column.
import { execFileSync } from "node:child_process";

const part = (file, name) => execFileSync("unzip", ["-p", file, name], { maxBuffer: 1 << 28 }).toString("utf8");
const unxml = (s) => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function colIndex(ref) {
  let n = 0;
  for (const c of ref.match(/^[A-Z]+/)[0]) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

export function readSheet(file, sheetNumber) {
  let shared = [];
  try {
    shared = [...part(file, "xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
      // Rich text: join the <t> runs, skipping phonetic (<rPh>) furigana runs.
      unxml([...m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  } catch { /* a workbook without shared strings */ }
  const xml = part(file, `xl/worksheets/sheet${sheetNumber}.xml`);
  const rows = [];
  for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, ref, attrs, body = ""] = c;
      const t = attrs.match(/t="(\w+)"/)?.[1];
      let v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (t === "s") v = shared[Number(v)];
      else if (t === "inlineStr") v = unxml(body.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? "");
      else if (v !== undefined) v = unxml(v);
      row[colIndex(ref)] = v ?? "";
    }
    rows.push(row);
  }
  return rows;
}
