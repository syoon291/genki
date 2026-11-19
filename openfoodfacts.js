// Barcode lookup on Open Food Facts (an open database of food packages,
// openfoodfacts.org). Only the barcode leaves the device: a GET with no
// cookies and no referrer. The reply becomes a my food with numbers per
// serving, for the owner to check against the label before saving.
// productUrl and foodFromProduct are pure (unit-tested); lookupBarcode fetches.

export const OFF_ORIGIN = "https://world.openfoodfacts.org";
const FIELDS = ["product_name", "product_name_en", "generic_name", "brands", "serving_size", "serving_quantity", "serving_quantity_unit", "quantity", "nutriments"];

export function productUrl(code) {
  if (!/^\d{8,14}$/.test(code)) throw new Error("Not a barcode");
  return `${OFF_ORIGIN}/api/v2/product/${code}.json?fields=${FIELDS.join(",")}`;
}

const num = (v) => {
  if (typeof v === "string" && !v.trim()) return null; // Number("") is 0, not "not given"
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : v;
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const r1 = (v) => Math.round(v * 10) / 10;

// The product's nutrient numbers on one basis ("100g" or "serving"): kcal from
// kJ when only kJ is given, sodium in mg (from salt when only salt is given).
function nutrientsOn(n, basis) {
  const g = (k) => num(n[`${k}_${basis}`]);
  let kcal = g("energy-kcal");
  if (kcal === null) { const kj = g("energy-kj") ?? g("energy"); if (kj !== null) kcal = kj / 4.184; }
  let sodium = g("sodium");
  if (sodium === null) { const salt = g("salt"); if (salt !== null) sodium = salt / 2.5; }
  return { kcal, protein: g("proteins"), carbs: g("carbohydrates"), fat: g("fat"), fiber: g("fiber"), sugar: g("sugars"), sodium: sodium === null ? null : sodium * 1000 };
}

// A my food (without id and counters) from an Open Food Facts product, or null
// when it has no calories to go on. Numbers are per the package's serving
// when it gives one in g or ml, else per 100 g (or 100 ml).
export function foodFromProduct(p, code) {
  if (!p || typeof p !== "object") return null;
  const n = p.nutriments && typeof p.nutriments === "object" ? p.nutriments : {};
  const per100 = nutrientsOn(n, "100g");
  const perServ = nutrientsOn(n, "serving");
  const unit = String(p.serving_quantity_unit || "g").toLowerCase() === "ml" ? "ml" : "g";
  const q = num(p.serving_quantity);
  const servingText = String(p.serving_size ?? "").trim().slice(0, 40);
  let vals, serving, grams;
  if (per100.kcal !== null && q > 0) {
    vals = Object.fromEntries(Object.entries(per100).map(([k, v]) => [k, v === null ? null : (v * q) / 100]));
    serving = servingText || `${r1(q)} ${unit}`;
    grams = unit === "g" ? r1(q) : null;
  } else if (perServ.kcal !== null && servingText) {
    vals = perServ;
    serving = servingText;
    grams = unit === "g" && q > 0 ? r1(q) : null;
  } else if (per100.kcal !== null) {
    vals = per100;
    serving = `100 ${unit}`;
    grams = unit === "g" ? 100 : null;
  } else return null;
  const name = String(p.product_name || p.product_name_en || p.generic_name || "").trim().slice(0, 80);
  const brand = String(p.brands ?? "").split(",")[0].trim().slice(0, 60);
  return {
    name, brand, serving, grams, barcode: code,
    kcal: Math.round(vals.kcal), protein: r1(vals.protein ?? 0), carbs: r1(vals.carbs ?? 0), fat: r1(vals.fat ?? 0),
    fiber: vals.fiber === null ? null : r1(vals.fiber),
    sugar: vals.sugar === null ? null : r1(vals.sugar),
    sodium: vals.sodium === null ? null : Math.round(vals.sodium),
  };
}

// { status: "found", food } | { status: "missing" } (not in the database, or
// no calories given) | { status: "error", message }.
export async function lookupBarcode(code, fetchFn = fetch) {
  let res;
  const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined;
  try {
    res = await fetchFn(productUrl(code), { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal });
  } catch (e) {
    return { status: "error", message: e?.name === "TimeoutError" ? "Open Food Facts took too long to answer" : "Could not reach Open Food Facts (offline?)" };
  }
  if (res.status === 404) return { status: "missing" };
  if (!res.ok) return { status: "error", message: `Open Food Facts answered ${res.status}` };
  let data;
  try { data = await res.json(); } catch (e) { return { status: "error", message: e?.name === "TimeoutError" ? "Open Food Facts took too long to answer" : "Open Food Facts sent a reply genki cannot read" }; }
  if (data?.status === 0 || !data?.product) return { status: "missing" };
  const food = foodFromProduct(data.product, code);
  return food ? { status: "found", food } : { status: "missing", name: String(data.product.product_name ?? "").trim().slice(0, 80) };
}
