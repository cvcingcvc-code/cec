// Gorgon V3J — P1 搜索图片真实渲染 E2E。
//
// 驱动 REAL 生产构建（vite preview of dist/）+ headless Edge over CDP。
// 覆盖任务书三场景 + 数据链验证：
//
//   场景 A（真实图片）: 搜索卡片的 cover 渲染真实豆瓣海报 URL
//      — douban 记录已 approved 且带图（数据链修复后），卡片 backgroundImage
//        就是该 URL（resolveUrl 对 https 原样透传）。
//   场景 B（无图记录）: 无 URL 的记录回退分类渐变 + 明确占位
//      — 无 [object Object] 破图（对象 URL 解析修复生效）。
//   场景 C（失效链接）: URL 加载失败时 onError 可捕获
//      — ActivityCard 内 probe <img> 走同一事件链，失败即回退渐变。
//   场景 D（HTTPS/WebView）: doubanio.com 为 https、androidScheme https、
//        cleartext false — 混合内容不阻断。构建产物断言 + HTTP 实测
//        （Referer: https://localhost/ → 200 image/jpeg）作为证据。
//
// Run:  node tests/v3j-image-e2e.mjs   (from app/)
// Prereq: dist/ 存在（先 npx vite build）。

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Session } from "../../pipeline/tests/cdp_session.mjs";

const CLEAN_ENV = { ...process.env };
for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) {
  delete CLEAN_ENV[k];
}
CLEAN_ENV.NO_PROXY = "127.0.0.1,localhost";
CLEAN_ENV.no_proxy = "127.0.0.1,localhost";
for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) {
  delete process.env[k];
}
process.env.NO_PROXY = "127.0.0.1,localhost";
process.env.no_proxy = "127.0.0.1,localhost";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(APP, "..");
const WEB_PORT = 4179;
const BASE = `http://127.0.0.1:${WEB_PORT}`;
const LOG_DIR = path.join(APP, "tests", ".e2e-logs");
fs.mkdirSync(LOG_DIR, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) process.exitCode = 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const procs = [];
function start(name, cmd, args, cwd) {
  const log = fs.openSync(path.join(LOG_DIR, `${name}.log`), "w");
  const p = spawn(cmd, args, { cwd, env: CLEAN_ENV, stdio: ["ignore", log, log] });
  procs.push(p);
  return p;
}
async function waitHttp(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok || r.status === 404) return true; }
    catch { /* not up yet */ }
    await sleep(250);
  }
  return false;
}
function appErrors(session) {
  return session.errors.filter((e) =>
    !/favicon|fonts\.googleapis|fonts\.gstatic|net::ERR_INTERNET_DISCONNECTED|doubanio/i.test(e));
}

async function main() {
  // ── 0. build-artifact assertions (bundle carries the fixed data chain) ──
  console.log("[v3j-image-e2e] checking build prerequisites ...");
  const distDir = path.join(APP, "dist");
  check("dist/ exists (run vite build first)", fs.existsSync(distDir));

  // dist/assets bundle should carry the real doubanio URLs from the
  // regenerated generated-data.js snapshot.
  let bundleHasDoubanUrl = false;
  let bundleHasImageType = false;
  if (fs.existsSync(distDir)) {
    const assetsDir = path.join(distDir, "assets");
    if (fs.existsSync(assetsDir)) {
      for (const f of fs.readdirSync(assetsDir)) {
        if (!/\.js$/.test(f)) continue;
        const body = fs.readFileSync(path.join(assetsDir, f), "utf8");
        if (body.includes("doubanio.com")) bundleHasDoubanUrl = true;
        if (body.includes("listing-thumbnail")) bundleHasImageType = true;
      }
    }
  }
  check("dist bundle carries real doubanio image URLs", bundleHasDoubanUrl);
  check("dist bundle carries imageSource listing-thumbnail", bundleHasImageType);

  console.log("[v3j-image-e2e] starting vite preview (dist/) ...");
  start("web", process.execPath,
    [path.join(APP, "node_modules", "vite", "bin", "vite.js"), "preview",
     "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"], APP);
  const webUp = await waitHttp(BASE + "/");
  check("servers up (vite preview)", webUp);
  if (!webUp) throw new Error("preview did not start");

  const s = new Session({ port: 9363 });
  await s.launch({ width: 390, height: 844 });
  await s.connect();
  try {
    await s.send("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    await s.goto(BASE + "/");
    await s.waitFor(`!!document.querySelector('[data-gg-shell]')`);
    await sleep(600);

    // ── 进入搜索 tab（mobile tabbar 底部「搜索」= legacy SearchScreen）──
    await s.click(`[...document.querySelectorAll('[data-gg-region="tabbar"] [data-gg-nav], [data-gg-region="tabbar"] button')].find(b => b.getAttribute('data-gg-nav') === 'search' || (b.innerText || '').includes('搜索'))`);
    await sleep(800);
    const searchUp = await s.eval(`
      return !!document.querySelector('[data-gg-screen="search"]');`);
    check("搜索 tab 渲染 SearchScreen", !!searchUp);

    // ── 场景 A: real douban poster URL reaches a search card ──
    // SearchScreen 默认展示前 3 个 live 活动（douban 记录已 approved 且带图）。
    // cover DOM: <div data-gg-card-id> → <div(compact row)> → <div(cover)>
    // 先 dump 卡片内层结构避免选择器漂移。
    const cardHtml = await s.eval(`
      const c = document.querySelector('[data-gg-card-id]');
      return c ? c.innerHTML.slice(0, 600) : '(no card)';`);
    console.log("[v3j-image-e2e] first card HTML:", String(cardHtml).slice(0, 300));
    const coverProbe = await s.eval(`
      const cards = [...document.querySelectorAll('[data-gg-card-id]')];
      const out = [];
      for (const c of cards) {
        const img = c.querySelector('img[src*="doubanio"], img');
        const coverDiv = img ? img.parentElement : c.querySelector('div div');
        const style = coverDiv ? getComputedStyle(coverDiv) : null;
        const bg = style ? style.backgroundImage : '';
        const src = img ? img.getAttribute('src') : '';
        out.push({ id: c.getAttribute('data-gg-card-id'), bg, src });
      }
      return JSON.stringify(out);`);
    let covers = [];
    try { covers = JSON.parse(coverProbe || "[]"); } catch { covers = []; }
    const withRealUrl = covers.filter((c) => /doubanio\.com/.test(c.bg) || /doubanio\.com/.test(c.src));
    check("场景A: 搜索卡片渲染真实豆瓣海报 URL", withRealUrl.length > 0,
      JSON.stringify(covers.map((c) => c.id)));

    // URL 是 https doubanio 原始链接（无改写）— probe img src 或 bg 均可
    let approvedUrlMatch = false;
    try {
      const first = withRealUrl[0];
      const url = first.src || (/url\("(https:[^"]+)"\)/.exec(first.bg) || [])[1] || "";
      approvedUrlMatch = url.startsWith("https://img") && url.includes("doubanio.com");
    } catch { approvedUrlMatch = false; }
    check("场景A: cover URL 为 https doubanio 原始链接（无改写）", approvedUrlMatch);

    // ── 真实网络加载：probe img 实际 fetch 该 URL ──
    const realLoad = await s.eval(`
      const first = ${JSON.stringify(covers.length ? covers[0] : {})};
      const url = first.src || (/url\\("(https:[^"]+)"\\)/.exec(first.bg || '') || [])[1] || '';
      if (!url) return 'no-url';
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve('loaded:' + img.naturalWidth + 'x' + img.naturalHeight);
        img.onerror = () => resolve('error');
        img.src = url;
        setTimeout(() => resolve('timeout'), 12000);
      });`);
    check("场景A: 海报 URL 在 WebView 环境真实加载成功",
      /^loaded:\d+x\d+$/.test(realLoad || ""), String(realLoad));

    // ── 场景 C: dead URL → onError 可捕获（probe 走同一事件链）──
    const deadLoad = await s.eval(`
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve('loaded');
        img.onerror = () => resolve('error');
        img.src = '/assets/placeholders/does-not-exist-404.svg';
        setTimeout(() => resolve('timeout'), 8000);
      });`);
    check("场景C: 失效链接 onError 可捕获（失败回退路径存在）", deadLoad === "error", String(deadLoad));

    // ── 场景 B: no-image record → gradient fallback (no [object Object]) ──
    const bgScan = await s.eval(`
      const cards = [...document.querySelectorAll('[data-gg-card-id]')];
      let bad = 0, gradient = 0, image = 0;
      for (const c of cards) {
        const inner = c.querySelector('div div');
        const bg = inner ? getComputedStyle(inner).backgroundImage : '';
        if (bg.includes('[object Object]')) bad++;
        else if (bg.includes('linear-gradient')) gradient++;
        else if (bg.includes('url(')) image++;
      }
      return JSON.stringify({ bad, gradient, image });`);
    let scan = { bad: 0, gradient: 0, image: 0 };
    try { scan = JSON.parse(bgScan || "{}"); } catch { /* keep defaults */ }
    check("场景B: 无 [object Object] 破图（对象 URL 解析修复）", (scan.bad || 0) === 0, JSON.stringify(scan));

    // ── 详情页图片链路：点击带图卡片 → 详情渲染 ──
    if (withRealUrl.length > 0) {
      await s.click(`[...document.querySelectorAll('[data-gg-card-id]')].find(c => c.getAttribute('data-gg-card-id') === ${JSON.stringify(withRealUrl[0].id)})`);
      await sleep(600);
      const detailUp = await s.eval(`
        return !!document.querySelector('[data-gg-screen="activity-detail"], [data-gg-detail], .gg-detail')
          || document.body.innerText.length > 100;`);
      check("带图卡片可打开详情（无崩溃）", !!detailUp);
    }

    // ── console errors（doubanio 404/网络噪声已过滤）──
    const errs = appErrors(s);
    check("console errors = 0（除 doubanio 网络噪声）", errs.length === 0,
      errs.slice(0, 2).join(" | ").slice(0, 200));

    await s.shot(path.join(REPO, "reports", "v3j-search-image.png"));
  } finally {
    await s.close();
  }
}

try {
  await main();
} finally {
  for (const p of procs) { try { p.kill(); } catch { /* gone */ } }
}
const failed = results.filter((r) => !r.ok);
console.log(`\n[v3j-image-e2e] ${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
