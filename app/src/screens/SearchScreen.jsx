// Gorgon — local activity search. V3K changes presentation while the existing
// recency, view and district models continue to own filtering semantics.
import React from "react";
import { ActivityCard } from "../components/ds/ActivityCard.jsx";
import { SearchField } from "../components/ds/SearchField.jsx";
import * as V from "../lib/activity-view.js";
import * as R from "../lib/activity-recency.js";
import * as D from "../lib/district.js";
import { DistrictPicker } from "../components/DistrictPicker.jsx";
import { GORGON_DATA } from "../lib/data.js";
import { Icon } from "../components/Icon.jsx";
import "../styles/v3k-search.css";

// Suggested keywords, never fabricated search history or popularity data.
const SUGGESTIONS = [
  { label: "全部", query: "" }, { label: "AI 科技", query: "AI" },
  { label: "黑客松", query: "黑客松" }, { label: "展览", query: "展览" },
  { label: "免费", query: "免费" },
];

function catLabel(key) {
  const c = GORGON_DATA.categories.find((x) => x.key === key);
  return c ? c.label : key;
}
function haystack(a) {
  return [a.title, a.desc, a.venue, a.location, a.district, a.address, a.host,
    a.price, catLabel(a.category), (a.tags || []).join(" ")]
    .filter(Boolean).join(" ").toLowerCase();
}
function matches(a, q) {
  const needle = q.trim().toLowerCase();
  if (!needle) return false;
  if (needle === "免费" && a.price === "免费") return true;
  return haystack(a).indexOf(needle) >= 0;
}

function EmptyResults({ q, title, district, onClearDistrict }) {
  return (
    <div data-gg-region="search-empty" className="v3k-search__empty">
      <div className="v3k-search__empty-icon" aria-hidden="true"><Icon name="search-x" /></div>
      <h2 data-gg-empty-title>{title}</h2>
      <p>试试其他关键词，或扩大区域。已结束的活动和演示数据不会混入结果。</p>
      {q ? <span className="v3k-search__empty-query">当前搜索：「{q}」</span> : null}
      {!D.isAll(district) && onClearDistrict ? (
        <button type="button" onClick={onClearDistrict} className="v3k-search__reset">
          在整个上海范围内搜索<Icon name="arrow-up-right" />
        </button>
      ) : null}
    </div>
  );
}

export function SearchScreen({ synced, onSync, onOpen, district, onDistrictChange, onGoSmart }) {
  const { activities } = GORGON_DATA;
  const [q, setQ] = React.useState("");
  const keyword = q.trim();

  // V3F/V3J: no expired or demo rows. The same keyword pool supplies the
  // district picker's counts and the AND-filtered cards/empty state.
  const liveActivities = React.useMemo(
    () => activities.filter((a) => !a.demo && !R.isExpired(V.toView(a))), [activities]
  );
  const keywordPool = React.useMemo(
    () => (keyword ? liveActivities.filter((a) => matches(a, q)) : liveActivities),
    [liveActivities, q, keyword]
  );
  const scoped = React.useMemo(() => D.filter(keywordPool, district), [keywordPool, district]);
  const results = keyword ? scoped : scoped.slice(0, 3);
  const empty = results.length === 0;

  return (
    <div data-gg-screen="search" className="v3k-search v3k-page">
      <div className="v3k-search__inner">
        <header className="v3k-search__heading">
          <span className="v3k-search__eyebrow"><span aria-hidden="true" />发现 · 连接行动</span>
          <h1>发现下一步<span aria-hidden="true">↗</span></h1>
          <p>找到值得参与的活动，让想法有处落地。</p>
        </header>

        <section className="v3k-search__controls" aria-label="活动搜索与区域筛选">
          <div className="v3k-search__field-row">
            <label className="v3k-search__label">
              <span className="v3k-search__sr-only">搜索活动、地点、标签</span>
              <SearchField className="v3k-search__field" value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="搜索活动、地点、标签" size="lg" style={{ borderRadius: "var(--v3k-radius, 20px)" }} />
            </label>
            {keyword && <button type="button" className="v3k-search__clear" onClick={() => setQ("")} aria-label="清除搜索关键词"><Icon name="x" />清除</button>}
          </div>
          <div className="v3k-search__scope">
            <DistrictPicker value={district} onChange={onDistrictChange} activities={keywordPool} />
            {onGoSmart && <button type="button" className="v3k-search__smart" onClick={onGoSmart}><Icon name="sparkles" />用一句话智能搜索</button>}
          </div>
          <div className="v3k-search__suggestions" aria-label="搜索建议">
            {SUGGESTIONS.map((item) => (
              <button key={item.label} type="button" aria-pressed={keyword === item.query}
                onClick={() => setQ(item.query)} className="v3k-search__suggestion">{item.label}</button>
            ))}
          </div>
        </section>

        <section className="v3k-search__results" aria-label="本地活动搜索结果">
          <div className="v3k-search__results-heading">
            <div>
              <h2>{keyword ? "搜索结果" : "活动预览"}</h2>
              <p className="v3k-search__count" role="status" aria-live="polite">
                {keyword ? <>找到 <b>{results.length}</b> 场相关活动</> : <><b>{results.length}</b> 场预览 · 筛选范围内共 <b>{scoped.length}</b> 场</>}
                {!D.isAll(district) ? ` · ${district}` : ""}
              </p>
            </div>
            <span className="v3k-search__local"><span aria-hidden="true" />本地数据</span>
          </div>
          <p className="v3k-search__data-note">来自已采集的活动记录，非实时检索；参加前请核对来源与时间。</p>
          {empty && <EmptyResults q={q} district={district} title={D.emptyTitle(district, !!keyword)}
            onClearDistrict={onDistrictChange ? () => onDistrictChange(D.ALL) : null} />}
          <div className="v3k-search__grid gg-card-grid--two">
            {results.map((a) => {
              const view = V.toView(a);
              const source = typeof a.sourceName === "string" ? a.sourceName : typeof a.source === "string" ? a.source : "来源待补充";
              const origin = a.demo === true ? "DEMO" : a.demo === false || a.providerMode === "real" ? "REAL" : null;
              return (
                <div key={a.id} className="v3k-search__card" onClick={() => onOpen(a)}
                  data-gg-card-id={a.id} data-gg-card-district={D.districtOf(a) || ""}>
                  <ActivityCard variant="search" title={view.title} category={view.category || a.category} categoryLabel={catLabel(view.category || a.category)}
                    date={view.dateText || "日期待定"} time={view.timeText || "时间待定"}
                    location={view.locationText || view.venue || "地点待定"} distance={view.distance} price={view.priceLabel}
                    image={view.image} sourceLabel={source} dataOrigin={origin} trustLabel={view.trustLabel}
                    synced={!!synced[a.id]} onSync={() => onSync(a.id)} onOpen={() => onOpen(a)} />
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
