// Vendored from components/core/ActivityCard.jsx — ONLY edit:
// `<i data-lucide="...">` -> <Icon name="..." /> (4 occurrences).
//
// Why a copy instead of editing the original: the legacy app still compiles
// components/core/*.jsx in the browser via _ds_bundle.js + Babel
// Standalone, and that runtime cannot resolve an npm import like
// "lucide-react". Editing the shared source would break the legacy build.
// Once the legacy app is retired, this file goes away and the original
// takes the same change.
//
// V3J (P1 搜索图片) adds TWO behaviours, both additive:
//   * imageUrlOf() — the image prop is resolved to a URL string first
//     (plain URL | activity-view descriptor | raw record object). A
//     non-string used to flow into `url(${image})` and render the literal
//     text "[object Object]".
//   * a 1×1 probe <img> per cover — if the URL fails to load (404 /
//     hotlink block / offline), the card collapses to the category
//     gradient instead of showing a silently-broken cover. No fake
//     placeholder, no invented artwork.

import React from "react";
import { CATEGORIES } from "../../../../components/core/CategoryDot.jsx";
import { Tag } from "../../../../components/core/Tag.jsx";
import { Icon } from "../Icon.jsx";

/**
 * Resolve the image prop to a URL string, or null.
 *
 * V3J (P1 搜索图片): the prop arrives in several shapes across callers —
 * a plain URL string, the normalised view descriptor { url, source, slug,
 * type } from activity-view.js imageOf(), or a raw record that carries an
 * image object ({ url, ... }). A non-string used to flow straight into
 * `url(${image})` and rendered the literal text "[object Object]".
 * Only a real URL string is used — anything else falls back to the
 * gradient (never a fake photo, never an invented URL).
 */
function imageUrlOf(image) {
  if (!image) return null;
  if (typeof image === "string") return image;
  if (typeof image === "object") {
    if (typeof image.url === "string" && image.url) return image.url;
    if (typeof image.imageUrl === "string" && image.imageUrl) return image.imageUrl;
  }
  return null;
}

/**
 * Gorgon's signature activity card. Full-bleed image (or category-tinted
 * gradient fallback), category dot, title, time/place meta, price, and a
 * sync toggle that flips to the mint "已同步 ✓" reward state.
 */
export function ActivityCard({
  title = "活动标题",
  category = "music",
  date = "周六 6.15",
  time = "19:30",
  location = "上海·静安",
  distance = null,
  price = "免费",
  image = null,
  tags = [],
  synced = false,
  hot = false,
  onSync,
  compact = false,
  variant = "default",
  categoryLabel = null,
  sourceLabel = null,
  dataOrigin = null,
  trustLabel = null,
  onOpen,
  style = {},
  ...rest
}) {
  const cat = CATEGORIES[category] || CATEGORIES.music;
  const catColor = variant === "search" && !CATEGORIES[category] ? "var(--v3k-primary, #a397ff)" : cat.color;
  // V3J: resolve the image prop first (string | descriptor object | raw
  // record shape); an object here used to render as "[object Object]".
  const resolvedUrl = imageUrlOf(image);
  // A generated category placeholder is not an event photograph. The V3K
  // search surface states that distinction and uses its category gradient.
  const placeholder = image && typeof image === "object" && image.source === "placeholder"
    || typeof resolvedUrl === "string" && resolvedUrl.includes("/assets/placeholders/");
  const imgUrl = variant === "search" && placeholder ? null : resolvedUrl;
  const [imgFailed, setImgFailed] = React.useState(false);
  const [imgLoaded, setImgLoaded] = React.useState(false);
  React.useEffect(() => { setImgFailed(false); setImgLoaded(false); }, [imgUrl]);
  // A failed load (404 / hotlink block / offline) falls back to the same
  // category gradient — a broken-image glyph is never shown, and a dead
  // URL never masquerades as a working one.
  const cover = imgUrl && !imgFailed
    ? { backgroundImage: `url(${imgUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
    : { background: `linear-gradient(150deg, color-mix(in oklch, ${catColor} 90%, #fff) 0%, color-mix(in oklch, ${catColor} 65%, var(--indigo-700)) 100%)` };

  // Probe the URL once with a real <img> so a dead link collapses the
  // background to the gradient. No fake placeholder is rendered over it.
  const probe = imgUrl && !imgFailed ? (
    <img
      src={imgUrl}
      data-testid={variant === "search" ? "v3k-activity-image-probe" : undefined}
      alt=""
      aria-hidden="true"
      onLoad={() => setImgLoaded(true)}
      onError={() => setImgFailed(true)}
      style={{
        position: "absolute", width: 1, height: 1, opacity: 0,
        pointerEvents: "none", border: "none",
      }}
    />
  ) : null;

  const SyncBtn = (
    <button
      type="button"
      className={variant === "search" ? "v3k-activity__sync" : undefined}
      aria-label={synced ? "取消同步活动：" + title : "同步活动：" + title}
      aria-pressed={synced}
      onClick={(e) => { e.stopPropagation(); onSync && onSync(!synced); }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: "none",
        cursor: "pointer",
        fontFamily: "var(--font-sans)",
        fontWeight: "var(--weight-semibold)",
        fontSize: "var(--text-sm)",
        padding: compact ? "8px 12px" : "9px 16px",
        borderRadius: "var(--radius-pill)",
        background: synced ? "var(--accent)" : "var(--brand)",
        color: synced ? "#06241B" : "#fff",
        boxShadow: synced ? "var(--shadow-mint)" : "var(--shadow-brand)",
        transition: "all var(--dur-base) var(--ease-spring)",
        whiteSpace: "nowrap",
      }}
    >
      <Icon name={synced ? "check" : "plus"} style={{ width: 16, height: 16 }} />
      {synced ? "已同步" : "同步"}
    </button>
  );

  if (variant === "search") {
    const imageState = !imgUrl ? "missing" : imgFailed ? "error" : imgLoaded ? "loaded" : "loading";
    const searchCover = imgUrl && !imgFailed ? cover : {
      background: `linear-gradient(135deg, color-mix(in oklch, ${catColor} 45%, #15172d), #27203e 65%, #18293a)`,
    };
    return (
      <article className="v3k-activity" data-v3k-image-state={imageState} style={style} {...rest}>
        <div className="v3k-activity__cover" data-testid="v3k-search-card-cover" data-v3k-image-state={imageState}
          role="img" aria-label={imgUrl && !imgFailed ? title + "的来源图片" : imgFailed ? "来源图片暂时无法加载，显示分类占位" : "未提供活动图片，显示分类占位"}
          style={searchCover}>
          {probe}
          <span className="v3k-activity__category"><span aria-hidden="true" />{categoryLabel || cat.label}</span>
          {(!imgUrl || imgFailed) && (
            <div className="v3k-activity__fallback" aria-hidden="true">
              <Icon name={imgFailed ? "image-off" : "image"} />
              <span>{imgFailed ? "图片暂时无法加载" : "暂无活动图片"}</span>
              <small>分类占位 · 活动信息仍可查看</small>
            </div>
          )}
        </div>
        <div className="v3k-activity__body">
          <div className="v3k-activity__provenance">
            {dataOrigin && <span className="v3k-activity__origin">{dataOrigin}</span>}
            <span className="v3k-activity__source">{sourceLabel || "来源待补充"}</span>
            {trustLabel && <span className="v3k-activity__trust">{trustLabel}</span>}
          </div>
          <h3><button type="button" className="v3k-activity__title"
            onClick={(event) => { event.stopPropagation(); onOpen && onOpen(); }}>{title}</button></h3>
          <p className="v3k-activity__meta"><Icon name="calendar" /><span>{date || "日期待定"} · {time || "时间待定"}</span></p>
          <p className="v3k-activity__meta"><Icon name="map-pin" /><span>{location || "地点待定"}{distance ? ` · ${distance}` : ""}</span></p>
          <div className="v3k-activity__footer"><span className="v3k-activity__price">{price || "价格待定"}</span>{SyncBtn}</div>
        </div>
      </article>
    );
  }

  if (compact) {
    return (
      <div
        style={{
          display: "flex",
          gap: 14,
          alignItems: "center",
          background: "var(--surface-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-lg)",
          padding: 12,
          boxShadow: "var(--shadow-sm)",
          position: "relative",
          ...style,
        }}
        {...rest}
      >
        {probe}
        <div style={{ width: 76, height: 76, borderRadius: "var(--radius-md)", flex: "none", ...cover }} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: catColor, flex: "none" }} />
            <span style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "var(--tracking-wide)", color: "var(--text-muted)" }}>{date} · {time}</span>
          </div>
          <h4 style={{ fontSize: "var(--text-md)", fontFamily: "var(--font-sans)", fontWeight: "var(--weight-bold)", color: "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</h4>
          <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>
            <Icon name="map-pin" style={{ width: 13, height: 13 }} />
            <span>{location}{distance ? ` · ${distance}` : ""}</span>
          </div>
        </div>
        {SyncBtn}
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--surface-card)",
        borderRadius: "var(--radius-lg)",
        overflow: "hidden",
        boxShadow: "var(--shadow-sm)",
        border: "1px solid var(--border-subtle)",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
      {...rest}
    >
      <div style={{ position: "relative", height: 168, ...cover }}>
        {probe}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(12,13,18,0) 45%, rgba(12,13,18,0.55) 100%)" }} />
        <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 6 }}>
          <Tag tone="ink" size="sm" dotColor={catColor}>{cat.label}</Tag>
          {hot && <Tag tone="danger" size="sm">🔥 热门</Tag>}
        </div>
        <div style={{ position: "absolute", bottom: 12, left: 14, color: "#fff", display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="calendar" style={{ width: 15, height: 15 }} />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: "var(--weight-semibold)", fontSize: "var(--text-sm)", letterSpacing: "var(--tracking-wide)" }}>{date} · {time}</span>
        </div>
      </div>

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <h3 style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-sans)", fontWeight: "var(--weight-bold)", color: "var(--text-strong)", lineHeight: 1.3 }}>{title}</h3>

        <div style={{ display: "flex", alignItems: "center", gap: 14, color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="map-pin" style={{ width: 15, height: 15 }} />{location}
          </span>
          {distance && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Icon name="navigation" style={{ width: 14, height: 14 }} />{distance}
            </span>
          )}
        </div>

        {tags.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {tags.map((t) => <Tag key={t} tone="neutral" size="sm">{t}</Tag>)}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: "var(--weight-bold)", fontSize: "var(--text-lg)", color: price === "免费" ? "var(--accent-strong)" : "var(--text-strong)" }}>{price}</span>
          {SyncBtn}
        </div>
      </div>
    </div>
  );
}
