// Where genki's accounts live: the backend project's address and its
// publishable (public) key. Both are public by design: the key can do nothing
// without a signed-in person, and the database shows each person only their
// own rows. Empty until the owner's project exists; while empty, genki shows
// no Account section and makes no account calls.
//
// Set both with `node scripts/set-account.mjs <project url> <publishable key>`,
// which also adds the address to the Content Security Policy in index.html.
// Never put a secret (service) key here: scripts/check.mjs refuses one.
export const ACCOUNT_URL = "https://ehndhbfewcdrngnwixbj.supabase.co";
export const ACCOUNT_KEY = "sb_publishable_EflfO9PqEQ4vfPuQCNhO_Q_xtmq2TBL";
