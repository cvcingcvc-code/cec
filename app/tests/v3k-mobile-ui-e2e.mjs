// Real built-app regression. Run with preview + demo API already running.
// BASE_URL overrides the local preview origin; all storage is a fresh test profile.
import assert from "node:assert/strict";
import { Session } from "../../pipeline/tests/cdp_session.mjs";

const base = process.env.BASE_URL || "http://127.0.0.1:4173";
const session = new Session({ port: 9388 });
let passed = 0;
function check(value, description) { assert.ok(value, description); passed++; console.log("PASS " + description); }
const wait = expression => session.waitFor(expression, { timeout: 10000 });
const click = selector => session.click(`document.querySelector(${JSON.stringify(selector)})`);
const home = () => click('[data-gg-region="tabbar"] [data-workbench-nav="home"]');
const search = () => click('[data-gg-region="tabbar"] [data-gg-nav="search"]');
async function viewport(width, height = 844) {
  await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
}
async function input(selector, value) {
  await session.eval(`
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('input missing');
    const type = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(type.prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', {bubbles:true}));
  `);
}
async function openMore(key, legacy = false) {
  await click('[data-gg-region="tabbar"] [data-workbench-nav="more"]');
  check(await wait(`!!document.querySelector('[data-testid="workbench-more-drawer"]')`), "More drawer opens");
  await click(`[data-testid="workbench-more-drawer"] [${legacy ? "data-gg-nav" : "data-workbench-nav"}="${key}"]`);
}

async function main() {
  try {
    await session.launch({ width: 390, height: 844 });
    await session.connect();
    await viewport(390);
    await session.goto(base);
    check(await wait('!!document.querySelector(".v3k-home")'), "real V3K homepage renders");
    check(await session.eval("return document.querySelector('[data-v3k-theme]').dataset.v3kTheme === 'obsidian';"), "selected OBSIDIAN skin is active on home");
    check(await session.eval("return document.body.innerText.includes('今天还没有安排');"), "new-profile empty state is honest");
    for (const width of [360, 390, 412]) {
      await viewport(width);
      for (const page of ["home", "search"]) {
        if (page === "home") await home(); else await search();
        check(await wait(`!!document.querySelector('.v3k-${page}')`), `${width}: ${page} navigation`);
        const geometry = await session.eval(`
          const page=document.querySelector('.v3k-page');
          const buttons=[...document.querySelectorAll('[data-gg-region="tabbar"] button')];
          return {width:innerWidth, doc:document.documentElement.scrollWidth, page:page.scrollWidth,
            labels:buttons.map(b=>b.textContent.trim()).join('/'),
            touch:buttons.every(b=>{const r=b.getBoundingClientRect();return r.width>=48&&r.height>=48;})};
        `);
        check(geometry.doc <= width + 1 && geometry.page <= width + 1, `${width}: ${page} has no horizontal overflow`);
        check(geometry.labels === "工作台/搜索/任务/更多" && geometry.touch, `${width}: four original navigation labels and 48px touch targets`);
      }
    }
    await viewport(390);
    const record = await session.eval(`
      const card=document.querySelector('[data-gg-card-id]');
      return card && {title:card.querySelector('.v3k-activity__title').textContent, district:card.dataset.ggCardDistrict};
    `);
    check(record && record.title && record.district, "current real dataset has a searchable activity");
    await input('.v3k-search__field input', record.title);
    check(await wait(`[...document.querySelectorAll('[data-gg-card-id]')].length>0 && [...document.querySelectorAll('.v3k-activity__title')].every(b=>b.textContent.includes(${JSON.stringify(record.title)}))`), "keyword search returns matching real records");
    await click('[data-gg-region="district-picker"]');
    check(await wait(`!!document.querySelector('[data-gg-district-option="${record.district}"]')`), "district sheet remains reachable");
    await click(`[data-gg-district-option="${record.district}"]`);
    check(await wait(`[...document.querySelectorAll('[data-gg-card-id]')].length>0 && [...document.querySelectorAll('[data-gg-card-id]')].every(c=>c.dataset.ggCardDistrict===${JSON.stringify(record.district)})`), "district and keyword are combined with AND");
    check(await session.eval(`return document.querySelector('.v3k-search__count').textContent.includes(String(document.querySelectorAll('[data-gg-card-id]').length));`), "result count matches rendered cards");
    await input('.v3k-search__field input', 'V3K-no-such-activity-唯一回归词');
    check(await wait("!!document.querySelector('[data-gg-region=\"search-empty\"]') && document.querySelectorAll('[data-gg-card-id]').length===0"), "no-result search never pads with unrelated records");
    await click('.v3k-search__reset');
    check(await wait("document.querySelector('[data-gg-region=\"district-picker\"]').textContent.includes('全上海')"), "empty-state action clears the region through its original callback");
    await click('.v3k-search__clear');
    check(await wait("document.querySelector('.v3k-search__field input').value==='' && document.querySelectorAll('[data-gg-card-id]').length>0"), "clear keyword restores the preview");
    await click('.v3k-search__smart');
    check(await wait("!!document.querySelector('[data-gg-screen=\"smart\"]')"), "natural-language search remains a separate reachable screen");

    for (const [key, screen, legacy] of [["schedule","workbench-schedule",false],["notes","workbench-notes",false],["map","map",true],["agent","workbench-agent",false]]) {
      await openMore(key, legacy);
      check(await wait(`!!document.querySelector('[data-gg-screen="${screen}"]')`), `${key} remains reachable`);
      check(await session.eval("return !document.querySelector('[data-v3k-theme]');"), `${key} retains its V3J presentation`);
    }
    await home();
    check(await wait('!!document.querySelector(".v3k-home")'), "return to home");
    await input('[data-testid="workbench-task-input"] textarea', '规划本周学习计划');
    await click('.v3k-home-start');
    check(await wait("!!document.querySelector('[data-gg-screen=\"workbench-task-detail\"]')"), "home creates a real task and opens detail");
    const task = await session.eval("return JSON.parse(localStorage.getItem('gorgon_workbench_tasks_v2')).tasks.find(t=>t.goal==='规划本周学习计划');");
    check(task && task.status === "created", "original task schema and created state persist");
    await click('[data-testid="workbench-detail-run"]');
    check(await wait("document.querySelector('[data-testid=\"workbench-detail-status\"]')?.textContent.includes('已完成')"), "original local task engine completes the planning task");
    await session.goto(base);
    check(await wait('!!document.querySelector(".v3k-home")'), "application reloads");
    check(await session.eval(`return JSON.parse(localStorage.getItem('gorgon_workbench_tasks_v2')).tasks.some(t=>t.id===${JSON.stringify(task.id)}&&t.status==='completed');`), "completed task survives reload");
    await session.goto(base + '/?skin=orbit');
    check(await wait("document.querySelector('[data-v3k-theme]')?.dataset.v3kTheme==='orbit-dark'"), "first DARK ORBIT skin is still available");
    check(await session.eval(`return JSON.parse(localStorage.getItem('gorgon_workbench_tasks_v2')).tasks.some(t=>t.id===${JSON.stringify(task.id)});`), "changing the visual skin preserves task data");
    await session.goto(base);
    check(await wait('!!document.querySelector(".v3k-home")'), "return to selected OBSIDIAN skin");
    await viewport(390, 460);
    await session.eval("document.querySelector('.v3k-goal-input').focus(); document.querySelector('.v3k-home-start').scrollIntoView({block:'center'});");
    check(await session.eval("const action=document.querySelector('.v3k-home-start').getBoundingClientRect();const nav=document.querySelector('[data-gg-region=tabbar]').getBoundingClientRect();return action.top>=0&&action.bottom<=nav.top;"), "submit remains scroll-reachable with a reduced keyboard-sized viewport");
    await viewport(390);
    await session.goto(base + '/?legacy=1');
    check(await wait("!!document.querySelector('[data-gg-screen=\"discover\"]')"), "legacy=1 boot contract is intact");
    const errors = session.errors.filter(e=>!/fonts\.(googleapis|gstatic)|img\d*\.doubanio\.com|favicon/i.test(e));
    check(errors.length === 0, "no application console errors: " + JSON.stringify(errors));
    console.log(`[v3k-mobile-ui-e2e] ${passed} passed, 0 failed`);
  } finally { await session.close(); }
}
main().then(()=>process.exit(0),error=>{console.error(error);console.error(`[v3k-mobile-ui-e2e] ${passed} passed before failure`);process.exit(1);});
