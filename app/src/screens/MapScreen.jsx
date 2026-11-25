// Gorgon — Map view (V3J P1 真实地图 rewrite).
//
// V3J CHANGES (was: a CSS-grid FAKE map with pins spread by array index —
// the layout(n) heuristic placed pin #1 wherever there was a grid slot,
// which fabricated geography):
//
//   * REAL coordinates only — a pin is drawn when the record carries a
//     resolved coord (Amap geocode, GCJ-02, district cross-validated, from
//     pipeline/data/locations/places.json via gorgon_export). Records
//     without one are listed below the map but NEVER get a fabricated pin.
//   * Pin positions are a real equirectangular projection of (lng, lat)
//     into the map's viewport bounds — north is up, longitude runs
//     left→right. Same venue → same point, always.
//   * Tap a pin → name / address / date / price card;「打开地图导航」
//     hands the coordinate to the device's real map app (Amap on Android,
//     geo: URI fallback), never an in-app fake.
//   * Rent-a-house (租房) data does not exist in this dataset — no
//     rental layer is rendered and nothing pretends otherwise.
//
// Kept from the previous screen: district scoping (the map renders ONLY
// the activities inside the current district selection), the shared
// DistrictPicker, the live count badge, the tappable location list, and
// focus support from the detail screen.

import React from "react";
import { Tag, CATEGORIES } from "../lib/ds.js";
import { SearchField } from "../components/ds/SearchField.jsx";
import * as C from "../components/atoms.jsx";
import * as D from "../lib/district.js";
import { DistrictPicker } from "../components/DistrictPicker.jsx";
import { GORGON_DATA } from "../lib/data.js";
import { Icon } from "../components/Icon.jsx";

function catColor(key) {
  const c = CATEGORIES[key];
  return (c && c.color) || "var(--brand)";
}

/**
 * Equirectangular projection of the pinned records into viewport %.
 *
 * lng → x (west→east), lat → y flipped (north→top). Bounds come from the
 * actual pins with a symmetric margin so no pin sits on the edge; a single
 * pin (or several sharing one point) centers it. Shanghai-scale spreads
 * (~0.1° lng) map to visible separation; the projection is deterministic
 * from the data — same input, same layout, no array-index noise.
 */
function projectPins(placed) {
  const pts = placed.map((a) => ({ id: a.id, lng: a.coord.lng, lat: a.coord.lat }));
  const lngs = pts.map((p) => p.lng);
  const lats = pts.map((p) => p.lat);
  const cosLat = Math.cos((Math.max(...lats) + Math.min(...lats)) / 2 * Math.PI / 180);
  let minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  let minLat = Math.min(...lats), maxLat = Math.max(...lats);
  // 12% margin on each side; when everything shares a point, a ±0.01°
  // window centers it instead of dividing by zero.
  const lngSpan = maxLng - minLng || 0.02;
  const latSpan = maxLat - minLat || 0.02;
  minLng -= lngSpan * 0.12; maxLng += lngSpan * 0.12;
  minLat -= latSpan * 0.12; maxLat += latSpan * 0.12;
  const spanLng = maxLng - minLng;
  const spanLat = maxLat - minLat;
  // cosLat compresses longitude so east-west km read like north-south km.
  const w = spanLng * cosLat, h = spanLat;
  const scale = Math.max(w, h);
  return Object.fromEntries(pts.map((p) => {
    const x = ((p.lng - minLng) * cosLat) / scale;
    const y = 1 - ((p.lat - minLat) / scale);   // north on top
    // Keep inside 6–94% so a pin label never clips.
    return [p.id, { x: 6 + Math.min(0.88, Math.max(0, x)) * 100, y: 6 + Math.min(0.88, Math.max(0, y)) * 100 }];
  }));
}

/**
 * Hand the coordinate to the device's REAL map app.
 *
 * Amap first (the installed Android app via its deep link), then the
 * generic geo: URI, then the Amap web fallback — each in a new window
 * so the app keeps its state. No in-app map SDK: this is the honest
 * "打开地图导航" the task asks for.
 */
export function openNavigation(lng, lat, name) {
  const label = encodeURIComponent(name || "");
  const urls = [
    "https://uri.amap.com/marker?position=" + lng + "," + lat + "&name=" + label + "&src=gorgon&callnative=1",
    "geo:" + lat + "," + lng + "?q=" + lat + "," + lng + "(" + label + ")",
  ];
  for (const u of urls) {
    try {
      window.open(u, "_blank");
      return true;
    } catch (e) { /* next fallback */ }
  }
  return false;
}

/** Inline pin glyph. Deliberately NOT an icon-library node: this element is
 *  conditionally swapped by React, and a node React does not own would
 *  break reconciliation. React must own it fully. */
function PinGlyph({ color }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function MapPin({ a, pos, selected, onClick }) {
  const c = catColor(a.category);
  return (
    <button data-gg-pin-district={a.__district || ""} data-gg-pin-id={a.id}
      onClick={onClick}
      style={{ position: "absolute", left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%,-100%)", border: "none", background: "transparent", cursor: "pointer", zIndex: selected ? 5 : 2 }}>
      {selected ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: c, color: "#fff", padding: "7px 12px 7px 9px", borderRadius: "var(--radius-pill)", boxShadow: "var(--shadow-lg)", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>
          <span style={{ width: 18, height: 18, borderRadius: "50%", background: "rgba(255,255,255,0.28)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <PinGlyph color="#fff" />
          </span>
          {a.price}
        </span>
      ) : (
        <span style={{ width: 30, height: 30, borderRadius: "50% 50% 50% 0", background: "#fff", transform: "rotate(-45deg)", display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-md)", border: `2px solid ${c}` }}>
          <span style={{ width: 11, height: 11, borderRadius: "50%", background: c, transform: "rotate(45deg)" }} />
        </span>
      )}
    </button>
  );
}

function MapEmpty({ district, onClear }) {
  return (
    <div data-gg-region="map-empty" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 12 }}>
      <div style={{ width: "min(420px, 100%)", background: "var(--surface-card)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-xl)", padding: 4 }}>
        <C.NoticeBlock
          icon="map-pin-off" tone="warning"
          title={D.emptyTitle(district, false)}
          body={"当前地区没有带真实坐标的活动。地图只画有真实经纬度的活动，不会生成假坐标或用其他区域的结果把它填满。"}
          action={D.isAll(district) ? null : (
            <button className="gg-chip" onClick={onClear}>查看全上海</button>
          )}
        />
      </div>
    </div>
  );
}

export function MapScreen({ synced, onSync, onOpen, focusId, district, onDistrictChange }) {
  // ONE filtered dataset for the whole screen.
  // V3F.1: demo activities are excluded from the map by default — pins show
  // real crawled rows (demo=false) only.
  const acts = React.useMemo(
    () => D.filter(GORGON_DATA.activities.filter((a) => !a.demo), district)
      .map((a) => Object.assign({}, a, { __district: D.districtOf(a) })),
    [district]
  );

  // V3J: only records with a REAL resolved coord are pin-able. Records
  // without one appear in the list below but never get a fabricated pin.
  const pinable = React.useMemo(
    () => acts.filter((a) => a.coord && typeof a.coord.lng === "number" && typeof a.coord.lat === "number"),
    [acts]
  );
  const noCoord = acts.length - pinable.length;

  const pos = React.useMemo(() => projectPins(pinable), [pinable]);
  const placed = pinable.map((a) => Object.assign({}, a, { _pos: pos[a.id] }));

  const [sel, setSel] = React.useState(null);
  const selected = placed.find((a) => a.id === sel) || placed[0] || null;

  // A district change re-scopes the set: keep the focus only when it survived
  // the filter, otherwise fall back to the first pin in range.
  React.useEffect(() => {
    if (focusId && placed.some((a) => a.id === focusId)) setSel(focusId);
    else if (!placed.some((a) => a.id === sel)) setSel(placed[0] ? placed[0].id : null);
  }, [focusId, district]);

  return (
    <div data-gg-screen="map" style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden", background: "#eaeef6" }}>
      {/* Map base — a neutral graticule, NOT fake roads/parks/river. The
          geography is carried by the REAL projected pins. */}
      <div style={{ position: "absolute", inset: 0 }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(#dfe5f0 1px,transparent 1px),linear-gradient(90deg,#dfe5f0 1px,transparent 1px)", backgroundSize: "44px 44px" }} />
        <div style={{ position: "absolute", left: 12, bottom: 10, fontSize: 11, color: "var(--text-faint)", background: "rgba(255,255,255,0.85)", padding: "3px 8px", borderRadius: "var(--radius-pill)" }}>
          真实坐标 · 高德 GCJ-02 · 上北下南
        </div>
      </div>

      {/* Floating search + the shared district picker */}
      <div className="gg-map-search">
        <div style={{ flex: 1 }}><SearchField placeholder="在地图上找活动" readOnly /></div>
        <button disabled aria-label="定位（规划中）" title="定位能力规划中，尚未接入"
          style={{ width: 48, height: 48, borderRadius: "var(--radius-pill)", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", boxShadow: "var(--shadow-sm)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "default", flex: "none", opacity: 0.5 }}>
          <Icon name="locate-fixed" style={{ width: 20, height: 20, color: "var(--text-faint)" }} />
        </button>
      </div>

      {/* Legend — live count of the FILTERED set, next to the same picker the
          other screens use, so the region is visible and changeable here. */}
      <div style={{ position: "absolute", top: 70, left: 16, right: 16, zIndex: 9, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span data-gg-map-count={acts.length} style={{ display: "inline-flex" }}>
          <Tag tone="ink" size="sm">{D.isAll(district) ? "附近" : district} {acts.length} 场{noCoord > 0 ? ` · ${noCoord} 场无坐标` : ""}</Tag>
        </span>
        <DistrictPicker value={district} onChange={onDistrictChange}
          activities={GORGON_DATA.activities.filter((a) => !a.demo)} size="sm" />
      </div>

      {pinable.length === 0 && <MapEmpty district={district} onClear={() => onDistrictChange(D.ALL)} />}

      {/* Pins — REAL projected coordinates only */}
      {placed.map((a) => <MapPin key={a.id} a={a} pos={a._pos} selected={a.id === sel} onClick={() => setSel(a.id)} />)}

      {/* Location list — chip rail on mobile, right-hand panel on desktop.
          Records without a coord appear here too (they are real, just not
          pin-able); tapping one selects it in the card dock when it has a
          pin, otherwise opens it directly. */}
      <div className="gg-map-list">
        {acts.map((a) => {
          const on = a.id === sel;
          const hasPin = !!(a.coord && typeof a.coord.lng === "number");
          return (
            <button key={a.id} onClick={() => { hasPin ? setSel(a.id) : onOpen(a); }} style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 6, border: on ? "1px solid var(--brand)" : "1px solid var(--border-subtle)", background: on ? "var(--brand)" : "var(--surface-card)", color: on ? "#fff" : "var(--text-body)", fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 12.5, padding: "7px 12px", borderRadius: "var(--radius-pill)", cursor: "pointer", boxShadow: "var(--shadow-sm)", whiteSpace: "nowrap", opacity: hasPin ? 1 : 0.65 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: on ? "#fff" : catColor(a.category), flex: "none" }} />
              {a.venue}{hasPin ? "" : " · 无坐标"}
            </button>
          );
        })}
      </div>

      {/* Bottom card — docks bottom on mobile, bottom-left on desktop.
          Nothing selected (no pins in range) means no card at all.
          V3J: 「打开地图导航」hands the REAL coordinate to the device's
          map app (Amap deep link → geo: URI). 租房数据不存在 — 不渲染、
          不假装。 */}
      {selected && (
        <div className="gg-map-card">
          <div data-gg-map-selected={selected.id} style={{ background: "var(--surface-card)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-xl)", padding: 14, display: "flex", gap: 14, alignItems: "center" }}>
            <div onClick={() => onOpen(selected)} style={{ cursor: "pointer", width: 84, height: 84, borderRadius: "var(--radius-lg)", flex: "none", background: `linear-gradient(150deg, color-mix(in oklch, ${catColor(selected.category)} 88%, #fff), color-mix(in oklch, ${catColor(selected.category)} 60%, var(--indigo-800)))` }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: catColor(selected.category) }} />
                <span style={{ fontFamily: "var(--font-display)", fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", fontWeight: 600 }}>{selected.date} · {selected.time}</span>
              </div>
              <div onClick={() => onOpen(selected)} style={{ cursor: "pointer", fontSize: 16, fontWeight: 700, color: "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected.title}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5, color: "var(--text-muted)", fontSize: 12.5 }}>
                <Icon name="map-pin" style={{ width: 13, height: 13 }} />{selected.address || selected.venue}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <button
                  data-testid="gg-map-navigate"
                  onClick={() => openNavigation(selected.coord.lng, selected.coord.lat, selected.address || selected.venue || selected.title)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid var(--brand)", color: "var(--brand)", background: "var(--surface-card)", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 12.5, padding: "7px 13px", borderRadius: "var(--radius-pill)", cursor: "pointer", minHeight: 36 }}>
                  <Icon name="navigation" style={{ width: 14, height: 14 }} />打开地图导航
                </button>
                <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                  {selected.coord.lng.toFixed(4)}, {selected.coord.lat.toFixed(4)}
                </span>
              </div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); onSync(selected.id); }} aria-label="加入我的周末" style={{ flex: "none", width: 50, height: 50, borderRadius: "50%", border: "none", cursor: "pointer", background: synced[selected.id] ? "var(--accent)" : "var(--brand)", color: synced[selected.id] ? "#06241B" : "#fff", boxShadow: synced[selected.id] ? "var(--shadow-mint)" : "var(--shadow-brand)", display: "inline-flex", alignItems: "center", justifyContent: "center", transition: "all var(--dur-base) var(--ease-spring)" }}>
              <Icon name={synced[selected.id] ? "check" : "plus"} style={{ width: 22, height: 22 }} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
