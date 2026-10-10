// Gorgon 2.0 — native persistence bridge (Android via Capacitor).
//
// WHY THIS EXISTS
// ---------------
// Every store in the app (store.js, task-repository.js, workbench-store.js,
// proposal-repository.js, demo-mode.js) reads and writes `localStorage`
// SYNCHRONOUSLY. On Android a Capacitor WebView's localStorage lives inside
// the WebView data dir; it survives app restarts in normal operation, but it
// is wiped by "clear WebView data", is not exportable, and — critically —
// gives us no native-side durability guarantees. The task charter (Module A)
// demands reliable persistence verified across restarts on BOTH platforms.
//
// STRATEGY: mirror, don't refactor.
//   1. BEFORE React mounts, we hydrate: every `gorgon_*` key stored in
//      Capacitor Preferences (SharedPreferences on Android — native,
//      durable, survives WebView resets) is copied INTO localStorage.
//      All existing synchronous readers then work UNCHANGED.
//   2. We wrap localStorage.setItem/removeItem so every write is mirrored
//      back into Preferences (debounced flush, fire-and-forget with a
//      pending-writes counter the app can await before exit if it wants).
//   3. On plain web/desktop (no Capacitor), this module is a NO-OP: the
//      desktop persistence fix lives in desktop/main.py (private_mode=False
//      + stable storage_path), and browsers already persist localStorage.
//
// This keeps the diff to existing store files at ZERO while giving Android
// a native-backed durable copy of the same data.

const KEY_PREFIX = "gorgon_";
const FLUSH_DEBOUNCE_MS = 250;

let prefs = null; // Capacitor Preferences plugin, or null on web
let installed = false;
let flushTimer = null;
const pendingKeys = new Set();

/** True when running inside a Capacitor native shell (Android/iOS). */
export function isNative() {
  return !!(
    typeof window !== "undefined" &&
    window.Capacitor &&
    window.Capacitor.isNativePlatform &&
    window.Capacitor.isNativePlatform()
  );
}

/**
 * Load the Preferences plugin lazily so web builds never pay for it and a
 * missing/failed plugin can never break the app (we degrade to plain
 * localStorage, which still works — just without the native mirror).
 *
 * Tests may inject a fake via `globalThis.__GORGON_PREFS_OVERRIDE__`
 * (any object exposing get/set/remove/keys). Production never sets it.
 */
async function loadPreferences() {
  if (typeof globalThis.__GORGON_PREFS_OVERRIDE__ !== "undefined") {
    prefs = globalThis.__GORGON_PREFS_OVERRIDE__;
    return prefs;
  }
  try {
    const mod = await import("@capacitor/preferences");
    prefs = mod.Preferences;
  } catch (e) {
    prefs = null; // plugin unavailable -> mirror disabled, app still runs
  }
  return prefs;
}

async function listNativeKeys() {
  if (!prefs) return [];
  try {
    const { keys } = await prefs.keys();
    return (keys || []).filter((k) => k.startsWith(KEY_PREFIX));
  } catch (e) {
    return [];
  }
}

/**
 * Copy every gorgon_* key from Capacitor Preferences into localStorage.
 * Native wins on conflict ONLY when localStorage has no value for the key,
 * or when the native copy is newer (tracked via a per-key `gorgon__rev_<key>`
 * revision counter we maintain on every mirrored write).
 */
async function hydrate() {
  if (!prefs) return;
  const keys = await listNativeKeys();
  for (const key of keys) {
    if (key.startsWith("gorgon__rev_")) continue; // internal bookkeeping
    try {
      const { value } = await prefs.get({ key });
      if (value == null) continue;
      const nativeRev = await getNativeRev(key);
      const localRev = getLocalRev(key);
      const localRaw = safeLocalGet(key);
      // Restore when local is missing, or when native is strictly newer.
      if (localRaw == null || nativeRev > localRev) {
        safeLocalSet(key, value);
        setLocalRev(key, nativeRev);
      }
    } catch (e) {
      /* keep going — one bad key must not block the others */
    }
  }
}

function safeLocalGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function safeLocalSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    /* quota / disabled storage — nothing we can do here */
  }
}

function getLocalRev(key) {
  const raw = safeLocalGet("gorgon__rev_" + key);
  const n = raw == null ? 0 : parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

function setLocalRev(key, rev) {
  safeLocalSet("gorgon__rev_" + key, String(rev));
}

async function getNativeRev(key) {
  try {
    const { value } = await prefs.get({ key: "gorgon__rev_" + key });
    const n = value == null ? 0 : parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
  } catch (e) {
    return 0;
  }
}

/** Mirror a single key write to Preferences with a bumped revision. */
async function mirrorKey(key) {
  if (!prefs) return;
  try {
    const raw = safeLocalGet(key);
    if (raw == null) {
      await prefs.remove({ key });
      await prefs.remove({ key: "gorgon__rev_" + key });
      return;
    }
    const nextRev = getLocalRev(key) + 1;
    await prefs.set({ key, value: raw });
    await prefs.set({ key: "gorgon__rev_" + key, value: String(nextRev) });
    setLocalRev(key, nextRev);
  } catch (e) {
    /* mirror failure must never break the write path */
  }
}

function scheduleFlush(keys) {
  for (const k of keys) pendingKeys.add(k);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    const batch = Array.from(pendingKeys);
    pendingKeys.clear();
    flushTimer = null;
    // sequential to keep SharedPreferences transactions cheap & ordered
    batch.reduce((p, k) => p.then(() => mirrorKey(k)), Promise.resolve());
  }, FLUSH_DEBOUNCE_MS);
}

/**
 * Wrap localStorage.setItem/removeItem so gorgon_* writes are mirrored.
 * Idempotent; no-op on web or when already installed.
 */
function installMirror() {
  if (installed || typeof localStorage === "undefined") return;
  installed = true;

  const origSet = localStorage.setItem.bind(localStorage);
  const origRemove = localStorage.removeItem.bind(localStorage);

  localStorage.setItem = function (key, value) {
    origSet(key, value);
    if (typeof key === "string" && key.startsWith(KEY_PREFIX) && !key.startsWith("gorgon__rev_")) {
      scheduleFlush([key]);
    }
  };

  localStorage.removeItem = function (key) {
    origRemove(key);
    if (typeof key === "string" && key.startsWith(KEY_PREFIX) && !key.startsWith("gorgon__rev_")) {
      // mirror the removal immediately (small, and resets are rare)
      if (prefs) {
        prefs.remove({ key }).catch(() => {});
        prefs.remove({ key: "gorgon__rev_" + key }).catch(() => {});
      }
    }
  };

  // `clear()` is only used by tests/dev; mirror removal of all gorgon keys.
  const origClear = localStorage.clear.bind(localStorage);
  localStorage.clear = function () {
    origClear();
    if (prefs) {
      listNativeKeys().then((keys) =>
        Promise.all(keys.map((k) => prefs.remove({ key: k })).concat([]))
      ).catch(() => {});
    }
  };
}

/**
 * One-shot boot entry: call BEFORE React mounts.
 *
 * Resolves quickly on web (no-op). On native, loads Preferences, hydrates
 * localStorage from the durable native copy, and installs the write mirror.
 * Never rejects — a persistence failure must not prevent the app from
 * opening (it degrades to in-session localStorage and REPORTS it).
 *
 * @returns {Promise<{native: boolean, mirrored: boolean, hydratedKeys: number, error?: string}>}
 */
export async function initNativePersistence() {
  const result = { native: isNative(), mirrored: false, hydratedKeys: 0 };
  if (!result.native) return result;
  try {
    await loadPreferences();
    if (prefs) {
      const before = new Set(await listNativeKeys());
      await hydrate();
      result.hydratedKeys = before.size;
      installMirror();
      result.mirrored = true;
    } else {
      result.error = "preferences-plugin-unavailable";
      // Still install the mirror hooks? No — without prefs there is nothing
      // to mirror to. localStorage alone still works inside the WebView.
    }
  } catch (e) {
    result.error = String((e && e.message) || e);
  }
  return result;
}

/** Await any in-flight debounced mirror writes (use before app pause/exit). */
export async function flushPendingWrites() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const batch = Array.from(pendingKeys);
  pendingKeys.clear();
  for (const k of batch) await mirrorKey(k);
}
