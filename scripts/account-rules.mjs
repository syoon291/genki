// What account-config.js may hold, shared by scripts/check.mjs and
// scripts/set-account.mjs: either nothing (accounts off) or a Supabase project
// address and its publishable key. A secret key, or any key the database
// would treat as an admin, is refused.
export const CONNECT_BASE = "'self' https://api.github.com https://world.openfoodfacts.org";

export function accountConfigProblem(url, key) {
  if (!url && !key) return "";
  if (!url || !key) return "account-config.js must set both ACCOUNT_URL and ACCOUNT_KEY, or neither";
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url)) return `ACCOUNT_URL must be https://<20-letter project id>.supabase.co, found ${url}`;
  if (/secret|service_role/i.test(key) || key.startsWith("eyJ")) return "ACCOUNT_KEY looks like a secret or legacy key: only the publishable key (sb_publishable_...) may be in this repo";
  if (!/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(key)) return "ACCOUNT_KEY must be the project's publishable key (sb_publishable_...)";
  return "";
}

// The connect-src the CSP must have for this config.
export const connectFor = (url) => (url ? `${CONNECT_BASE} ${url}` : CONNECT_BASE);
