// Gorgon Workbench — place-view.js (Phase 3: 地点管理纯视图助手).
//
// Pure functions only — no store, no React, no persistence. Screens and
// the store facade compose these for search / duplicate-hint / grouping.
// Mirrors the style of lib/calendar.js and lib/schedule-view.js.

/**
 * Case-insensitive substring search over name + address.
 * Empty/whitespace query returns the list unchanged (no filter).
 * Null/undefined list returns [].
 */
export function searchPlaces(places, query) {
  if (!Array.isArray(places)) return [];
  const q = String(query == null ? "" : query).trim().toLowerCase();
  if (!q) return places.slice();
  return places.filter((p) => {
    if (!p) return false;
    const name = String(p.name || "").toLowerCase();
    const address = String(p.address || "").toLowerCase();
    return name.includes(q) || address.includes(q);
  });
}

/**
 * Find a duplicate place by name (trimmed + case-insensitive compare).
 * Returns the existing place's id, or null when no duplicate exists.
 *
 * excludeId: when editing an existing place, pass its id so the place
 * itself doesn't count as its own duplicate.
 */
export function duplicatePlaceName(places, name, excludeId = null) {
  if (!Array.isArray(places)) return null;
  const want = String(name == null ? "" : name).trim().toLowerCase();
  if (!want) return null;
  const hit = places.find((p) => {
    if (!p) return false;
    if (excludeId != null && p.id === String(excludeId)) return false;
    return String(p.name || "").trim().toLowerCase() === want;
  });
  return hit ? hit.id : null;
}
