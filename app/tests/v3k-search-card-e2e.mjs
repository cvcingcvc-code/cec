// V3K search-card regression: actual React ActivityCard DOM and production CSS.
// The local SVG visibly says TEST IMAGE. It is a test asset, never an activity
// poster, and no fixture record is written to the app's dataset or storage.
//
// Run from app/ (Node >=22, esbuild already installed by the lockfile):
//   EDGE_BIN=/path/to/chromium node --import /path/to/linux-cdp.mjs \
//     tests/v3k-search-card-e2e.mjs
//
// The cloud adapter only supplies Linux browser cleanup. Screenshot capture
// below uses CDP directly, so historic V3J screenshot files are never replaced.

import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Session } from "../../pipeline/tests/cdp_session.mjs";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(APP, "..");
const SCREENSHOT = path.join(REPO, "reports/v3k/screenshots/search-image-fixtures.png");
const requests = [];
const results = [];
let server;
let session;

function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

// The original CDP helper leaves command timers alive after resolution. This
// local subclass clears them; command results and browser behavior are intact.
class FixtureSession extends Session {
  async goto(url) { await this.send("Page.navigate", { url }); }
  send(method, params = {}, timeout = 15000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("CDP timeout: " + method));
      }, timeout);
      this.pending.set(id, {
        res(value) { clearTimeout(timer); resolve(value); },
        rej(error) { clearTimeout(timer); reject(error); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.listen(0, "127.0.0.1", resolve).once("error", reject));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}

const HARNESS = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import { ActivityCard } from "./src/components/ds/ActivityCard.jsx";
  window.fixtureCalls = { open: [], sync: [] };
  const definitions = [
    { id: "image", label: "本地测试图 · 正常加载", image: "/test-image.svg?plain" },
    { id: "missing", label: "无图片 · image=null", image: null },
    { id: "error", label: "真实 HTTP 404 · React 回退", image: "/missing-image.svg" },
    { id: "descriptor", label: "URL descriptor 对象", image: { url: "/test-image.svg?descriptor", source: "fixture", type: "listing-thumbnail" } },
    { id: "invalid", label: "非法对象 · 禁止 object URL", image: { url: { invalid: true }, imageUrl: { invalid: true } } },
    { id: "placeholder", label: "分类占位 descriptor · 无海报", image: { url: "/test-image.svg?placeholder", source: "placeholder", type: "placeholder" } },
  ];
  function CardFixture({ definition }) {
    const [synced, setSynced] = React.useState(false);
    return React.createElement("section", { "data-fixture": definition.id },
      React.createElement("h2", { className: "fixture-heading" }, definition.label),
      React.createElement(ActivityCard, {
        variant: "search",
        title: "组件回归测试：很长的活动名称也应该完整换行并保留操作入口",
        date: "2099-12-31", time: "14:00", category: "study", categoryLabel: "测试分类",
        location: "上海市徐汇区 · 此地址仅用于组件布局测试，不是真实活动地点",
        price: "免费", sourceLabel: "本地组件测试", dataOrigin: "fixture", trustLabel: "测试来源",
        image: definition.image, synced,
        onOpen: () => window.fixtureCalls.open.push(definition.id),
        onSync: next => { window.fixtureCalls.sync.push({ id: definition.id, next }); setSynced(next); },
      })
    );
  }
  createRoot(document.getElementById("root")).render(
    React.createElement("main", { className: "fixture-page v3k-theme", "data-v3k-theme": "obsidian" },
      React.createElement("h1", null, "搜索卡片 · 图片回归测试"),
      React.createElement("p", { className: "fixture-notice" }, "以下均为组件测试场景；TEST IMAGE 不是活动海报，测试数据不进入应用。"),
      ...definitions.map(definition => React.createElement(CardFixture, { key: definition.id, definition }))
    )
  );
`;

function cssImports() {
  // Include the same stylesheets the real app entry loads. esbuild follows all
  // local CSS imports. Only remote font imports are omitted from the fixture
  // response: system fonts are used, and this local component test needs no CDN.
  const entry = fs.readFileSync(path.join(APP, "src/main.jsx"), "utf8");
  const files = new Set([...entry.matchAll(/import\s+["']([^"']+\.css)["'];/g)]
    .map(match => path.resolve(APP, "src", match[1])));
  // SearchScreen may import its stylesheet rather than main.jsx importing it.
  const searchCss = path.join(APP, "src/styles/v3k-search.css");
  if (fs.existsSync(searchCss)) files.add(searchCss);
  return [...files].map(file => `import ${JSON.stringify(file)};`).join("\n");
}

const TEST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#5140a4"/><circle cx="269" cy="37" r="64" fill="#8d7bd3"/><path d="M0 158L124 61L231 180H0" fill="#7561bc"/><text x="20" y="94" font-family="sans-serif" font-size="29" font-weight="bold" fill="white">TEST IMAGE</text><text x="21" y="121" font-family="sans-serif" font-size="12" fill="white">LOCAL COMPONENT FIXTURE / NOT AN EVENT POSTER</text></svg>`;

async function readCard(id) {
  return session.eval(`
    const root = document.querySelector('[data-fixture="${id}"]');
    const card = root?.querySelector('.v3k-activity');
    const cover = root?.querySelector('.v3k-activity__cover');
    return {
      exists: !!card, state: card?.getAttribute('data-v3k-image-state'),
      coverState: cover?.getAttribute('data-v3k-image-state'),
      background: cover ? getComputedStyle(cover).backgroundImage : null,
      text: card?.textContent || '',
      images: [...(root?.querySelectorAll('img') || [])].map(img => ({
        src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0,
        hidden: img.getAttribute('aria-hidden') === 'true' || getComputedStyle(img).opacity === '0',
      })),
    };
  `);
}

async function main() {
  const bundle = await build({
    stdin: { contents: cssImports() + "\n" + HARNESS, resolveDir: APP, sourcefile: "v3k-search-card-fixture.jsx", loader: "jsx" },
    absWorkingDir: APP, bundle: true, write: false, format: "esm", platform: "browser",
    nodePaths: [path.join(APP, "node_modules")],
    outdir: path.join(APP, "tests/.e2e-logs/v3k-card-fixture-build"),
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
    logLevel: "silent",
  });
  const script = bundle.outputFiles.find(file => file.path.endsWith(".js"));
  const styles = bundle.outputFiles.filter(file => file.path.endsWith(".css"))
    .map(file => file.text.replace(/@import\s+(?:url\()?['"]?https?:[^;]+;/g, "")).join("\n");
  assert.ok(script, "fixture must bundle the actual React component");
  server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://fixture.local");
    requests.push(request.url);
    response.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/fixture.js") {
      response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(script.contents);
    } else if (url.pathname === "/fixture.css") {
      response.writeHead(200, { "Content-Type": "text/css" }); response.end(styles + `
        html, body, #root { height: auto; min-height: 100%; overflow: visible; }
        .fixture-page { max-width: 520px; margin: 0 auto; padding: 16px; display: grid; gap: 20px; background: var(--v3k-bg); color: var(--v3k-ink); }
        .fixture-page h1 { font-size: 22px; }
        .fixture-heading { font-size: 14px; margin: 0 0 8px; }
        .fixture-notice { font-size: 13px; line-height: 1.7; }
      `);
    } else if (url.pathname === "/test-image.svg") {
      response.writeHead(200, { "Content-Type": "image/svg+xml" }); response.end(TEST_SVG);
    } else if (url.pathname === "/favicon.ico") {
      response.writeHead(204); response.end();
    } else if (url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end('<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><title>V3K component fixture</title></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
    } else {
      response.writeHead(404, { "Content-Type": "text/plain" }); response.end("Fixture intentionally missing");
    }
  });
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  session = new FixtureSession({ port: await unusedPort() });
  await session.launch({ width: 390, height: 844 });
  await session.connect();
  await session.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await session.goto(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(await session.waitFor("document.querySelectorAll('.v3k-activity').length === 6", { timeout: 8000 }), true, "all six real search-variant cards render");
  check("actual React search variants render for all six test cases", true);
  await session.waitFor("document.querySelector('[data-fixture=\"image\"] .v3k-activity')?.getAttribute('data-v3k-image-state') === 'loaded'", { timeout: 8000 });
  const image = await readCard("image");
  check("local TEST IMAGE is fetched and decoded by the real image probe", image.state === "loaded" && image.images.some(img => img.loaded));
  check("loaded image is the actual cover background", image.coverState === "loaded" && /url\(.*test-image\.svg/.test(image.background || ""));
  check("image probe remains visually hidden", image.images.length > 0 && image.images.every(img => img.hidden));
  await session.waitFor("document.querySelector('[data-fixture=\"descriptor\"] .v3k-activity')?.getAttribute('data-v3k-image-state') === 'loaded'", { timeout: 8000 });
  const descriptor = await readCard("descriptor");
  check("descriptor object resolves to a loaded URL", descriptor.state === "loaded" && /test-image\.svg\?descriptor/.test(descriptor.background || ""));
  const missing = await readCard("missing");
  check("null image renders an honest missing state", missing.state === "missing" && /暂无(图片|海报)|无图|分类占位/.test(missing.text));
  check("null image uses a category gradient with no broken image glyph", /linear-gradient/.test(missing.background || "") && missing.images.length === 0);
  await session.waitFor("document.querySelector('[data-fixture=\"error\"] .v3k-activity')?.getAttribute('data-v3k-image-state') === 'error'", { timeout: 8000 });
  const error = await readCard("error");
  check("HTTP 404 reaches the component's real React error path", requests.some(url => url === "/missing-image.svg") && error.state === "error");
  check("failed cover falls back to gradient and removes the broken probe", error.coverState === "error" && /linear-gradient/.test(error.background || "") && error.images.length === 0);
  check("failed image has an honest fallback label", /图片.*(不可用|失败)|暂无(图片|海报)|无图|分类占位/.test(error.text));
  const invalid = await readCard("invalid");
  check("invalid URL object becomes a missing image", invalid.state === "missing" && /linear-gradient/.test(invalid.background || "") && invalid.images.length === 0);
  const placeholder = await readCard("placeholder");
  check("placeholder descriptor remains a category placeholder", placeholder.state === "missing" && placeholder.images.length === 0 && !requests.some(url => url.includes("?placeholder")));
  const objectScan = await session.eval("return [...document.querySelectorAll('[style]')].some(el=>el.getAttribute('style').includes('[object Object]')); ");
  check("no unresolved object is used as a CSS image URL", !objectScan);

  check("title button is the existing detail callback entry", await session.click("document.querySelector('[data-fixture=\"image\"] .v3k-activity__title')"));
  check("detail callback fires exactly once", await session.eval("return JSON.stringify(window.fixtureCalls.open) === JSON.stringify(['image']);"));
  check("sync button can be activated", await session.click("document.querySelector('[data-fixture=\"image\"] .v3k-activity__sync')"));
  await session.waitFor("document.querySelector('[data-fixture=\"image\"] .v3k-activity__sync')?.textContent.includes('已同步')", { timeout: 2000 });
  check("sync callback persists controlled visual state without opening detail", await session.eval("return window.fixtureCalls.sync.length === 1 && window.fixtureCalls.sync[0].id === 'image' && window.fixtureCalls.sync[0].next === true && window.fixtureCalls.open.length === 1 && document.querySelector('[data-fixture=\"image\"] .v3k-activity__sync').textContent.includes('已同步');"));

  for (const width of [360, 390, 412]) {
    await session.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: true });
    const layout = await session.eval(`
      return { width: innerWidth, scroll: document.documentElement.scrollWidth,
        overflow: [...document.querySelectorAll('.v3k-activity')].some(el=>el.getBoundingClientRect().right > innerWidth + 1),
        targets: [...document.querySelectorAll('.v3k-activity__title, .v3k-activity__sync')].map(el=>{
          const r=el.getBoundingClientRect(); return {width:r.width,height:r.height};
        }) };
    `);
    check(`${width}px: long titles and venues do not cause horizontal overflow`, layout.width === width && layout.scroll <= width + 1 && !layout.overflow, JSON.stringify({ width: layout.width, scroll: layout.scroll }));
    check(`${width}px: detail and sync touch targets are at least 48×48 CSS px`, layout.targets.length === 12 && layout.targets.every(rect => rect.width >= 47.9 && rect.height >= 47.9), JSON.stringify(layout.targets));
  }

  await session.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const metrics = await session.send("Page.getLayoutMetrics");
  const content = metrics.cssContentSize || metrics.contentSize;
  const screenshot = await session.send("Page.captureScreenshot", {
    format: "png", captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 390, height: Math.ceil(content.height), scale: 1 },
  });
  fs.mkdirSync(path.dirname(SCREENSHOT), { recursive: true });
  fs.writeFileSync(SCREENSHOT, Buffer.from(screenshot.data, "base64"));
  console.log("Fixture evidence (not real activity imagery):", SCREENSHOT);
  const errors = session.errors.filter(error => !/missing-image\.svg/.test(error));
  check("no unexpected component or resource errors", errors.length === 0, errors.slice(0, 3).join(" | "));
}

try {
  await main();
} catch (error) {
  check("fixture run completes", false, error.stack || String(error));
} finally {
  if (session) {
    try { await session.send("Browser.close", {}, 2000); } catch { /* browser closes the socket */ }
    await session.close();
  }
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
const failures = results.filter(result => !result.ok);
console.log(`\n[v3k-search-card-e2e] ${results.length - failures.length} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
