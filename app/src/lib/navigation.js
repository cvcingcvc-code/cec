// Gorgon 2.0 — navigation / map hand-off helpers (Module D).
//
// The app does NOT embed a live map SDK (no key, no unauthorised location
// tracking — task charter §III-D). Instead it hands the user's chosen place
// off to a map app the user already trusts, via URI schemes that work both
// in a browser and inside the Android WebView:
//
//   * geo: URI            — the Android standard; the system map picker
//                           (Google Maps / 高德 / 百度) opens on it.
//   * https://ditu.amap.com / uri.amap.com — 高德 web fallback.
//   * https://map.baidu.com               — 百度 web fallback.
//   * https://www.google.com/maps/dir/    — Google web fallback.
//
// We only ever BUILD a URL here. Whether the user opens it (and thus shares
// a destination with a third-party map service) is an explicit user action
// in the UI — never automatic, never backgrounded.

/** True for a plausible {lat,lng} pair. Always returns a real boolean. */
export function isValidCoord(coord) {
  return !!(
    coord &&
    typeof coord === "object" &&
    Number.isFinite(coord.lat) &&
    Number.isFinite(coord.lng) &&
    coord.lat >= -90 && coord.lat <= 90 &&
    coord.lng >= -180 && coord.lng <= 180
  );
}

/**
 * geo: URI per RFC 5870 — the Android-native "open a map here / route here"
 * scheme. With a `to` coordinate we add a query so map apps can start in
 * routing mode. Returns null without a valid coord (we never fabricate one).
 */
export function geoUri(coord, { label } = {}) {
  if (!isValidCoord(coord)) return null;
  const q = label ? `(${String(label).replace(/[()]/g, "")})` : "";
  return `geo:${coord.lat},${coord.lng}?q=${coord.lat},${coord.lng}${q}`;
}

/** 高德路线规划 web URL (driving by default). */
export function amapRouteUrl(from, to, { mode = "car", name } = {}) {
  if (!isValidCoord(to)) return null;
  // amap uri API: from is optional (defaults to current location)
  const params = new URLSearchParams({
    t: String(mode === "transit" ? 1 : mode === "walk" ? 3 : 0),
    daddr: `${to.lng},${to.lat}`,
  });
  if (name) params.set("callnative", "1");
  if (isValidCoord(from)) params.set("saddr", `${from.lng},${from.lat}`);
  return `https://uri.amap.com/navigation?${params.toString()}`;
}

/** 百度地图路线 web URL. Baidu expects lat,lng order. */
export function baiduRouteUrl(from, to, { name } = {}) {
  if (!isValidCoord(to)) return null;
  const dest = `latlng:${to.lat},${to.lng}|name:${encodeURIComponent(name || "目的地")}`;
  let url = `https://api.map.baidu.com/direction?destination=${dest}&mode=driving&output=html&src=gorgon.workbench`;
  if (isValidCoord(from)) {
    url += `&origin=latlng:${from.lat},${from.lng}|name:${encodeURIComponent("出发地")}`;
  }
  return url;
}

/** Google Maps directions web URL. */
export function googleMapsUrl(to, from) {
  if (!isValidCoord(to)) return null;
  const dest = `${to.lat},${to.lng}`;
  if (isValidCoord(from)) {
    return `https://www.google.com/maps/dir/${from.lat},${from.lng}/${dest}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
}

/**
 * Order a set of stops into a simple visit route.
 *
 * This is a greedy nearest-neighbour ordering starting from `origin` — an
 * honest, explainable heuristic, NOT a claim of optimal routing (a full TSP
 * is out of scope for the MVP and would need a routing API). The UI states
 * it is a suggested order. Stops without a coord keep their input order at
 * the end (we never invent coordinates).
 *
 * @returns {{ordered: Array, explainable: boolean}} ordered stops + flag
 */
export function suggestVisitOrder(stops, origin) {
  const withCoord = stops.filter((s) => s && isValidCoord(s.coord));
  const withoutCoord = stops.filter((s) => s && !isValidCoord(s.coord));
  if (withCoord.length === 0) {
    return { ordered: stops.slice(), explainable: false };
  }
  const remaining = withCoord.slice();
  const ordered = [];
  let current = isValidCoord(origin) ? origin : null;
  if (!current) {
    // no origin: start from the first stop as given
    current = remaining.shift().coord;
    ordered.push(withCoord.find((s) => s.coord === current));
  }
  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(current, remaining[i].coord);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    current = next.coord;
  }
  return { ordered: ordered.concat(withoutCoord), explainable: true };
}

/** Great-circle distance in km between two coords (haversine). */
export function haversineKm(a, b) {
  if (!isValidCoord(a) || !isValidCoord(b)) return Infinity;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
