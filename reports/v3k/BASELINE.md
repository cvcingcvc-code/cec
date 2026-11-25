# V3K 第一轮改版前基线

本页记录改动页面代码前的真实运行状态。来源是包含 V3J 全部修复的设计分支 `docs/v3k-mobile-ui-blueprint` @ `eeb64bc1c303359cff8b1312fb1a2ce3559e1136`，实施分支为 `feat/v3k-android-ui-redesign`。未重生成 pipeline 数据，未修改业务代码、存储模型或 Android 配置。

## 页面与入口盘点

| 入口 / 页面 | 当前实现 | 必须保留的契约 |
| --- | --- | --- |
| 工作台 | `app/src/screens/WorkbenchHome.jsx`；今日待办、项目摘要、新建真实任务使用既有回调 | `data-workbench-nav="home"`、`data-gg-screen="workbench-home"`、`workbench-hero`、`workbench-task-input`、`workbench-today` 等 test IDs |
| 搜索 | `app/src/screens/SearchScreen.jsx` + `components/ds/SearchField.jsx` / `ActivityCard.jsx` + `DistrictPicker.jsx` | `data-gg-nav="search"`、`data-gg-screen="search"`、`data-gg-card-id`、`data-gg-card-district`；关键词与地区 AND、recency、真实图片解析与 onError 回退 |
| 任务 | `app/src/screens/TasksScreen.jsx` / `TaskDetailScreen.jsx` | `data-workbench-nav="tasks"`、`data-gg-screen="workbench-tasks"`；状态机、截止时间、关联与持久化 |
| 更多 | `app/src/App.jsx` 的 `WorkbenchTabBar` / drawer；配置来自 `workbench/navigation.js` | `more` key 与「更多」标签；日程、笔记、地点、智能体、智能搜索、地图等既有入口 |
| 地图 | `app/src/screens/MapScreen.jsx`（本轮不替换页面） | `data-gg-nav="map"`、`data-gg-screen="map"`、`data-gg-pin-id`、`data-gg-map-selected`、导航 URI |

CSS 入口为 `app/src/main.jsx` 导入的根 `styles.css` 与 `ui_kits/app/responsive.css`；前者汇集 `tokens/*.css`。页面与 App 底栏仍含 inline styles。`navigation.test.mjs`、`e2e_workbench_shell.mjs`、`e2e_v1_frontend.mjs`、`android_phase4_e2e.mjs` 与 `v3j-image-e2e.mjs` 等依赖上述选择器，视觉替换不得删除这些属性。

## 真实截图

来源：Linux Chromium headless，既有零依赖 CDP 驱动；Vite 开发服务，**390 × 844 CSS px，deviceScaleFactor 1**。这不是物理 Android 真机截图。使用新建的独立浏览器 profile；没有清空任何用户已有存储，没有向应用注入虚构任务或活动。空状态和活动数据都来自当前仓库及真实页面逻辑。

| 页面 | 改版前截图 |
| --- | --- |
| 首页（本地空任务/空项目状态） | [before-home.png](screenshots/before-home.png) |
| 搜索（现有数据；远程海报不可用时显示原渐变回退） | [before-search.png](screenshots/before-search.png) |
| 任务 | [before-tasks.png](screenshots/before-tasks.png) |
| 地图 | [before-map.png](screenshots/before-map.png) |

截图时已观察到搜索紧凑卡片在窄屏横向溢出、标题被视口裁切；此为改版前实际现状。独立 profile 与捕获脚本保留在忽略目录 `work/v3k/baseline-browser-profile`、`work/v3k/capture-baseline.mjs`，可供相同状态的改版后截图使用。页面文字、视口和浏览器日志保留在 `work/v3k/baseline-capture.json`。

## 本次执行的基线检查

| 检查 | 本次真实结果 | 日志 |
| --- | --- | --- |
| App `node --test --test-concurrency=4 'tests/*.test.mjs'`，Linux Chromium 适配 | **592 tests：591 passed、0 failed、1 skipped**；真实 Codex 调用按 opt-in gate 跳过；28.217 秒 | `work/v3k/baseline-unit.log` |
| `npm run test:build`（执行真实 Vite build 与产物检查） | **18 passed、0 failed**，包括 bundle secret-pattern 检查 | `work/v3k/baseline-build.log` |

测试使用 `EDGE_BIN=/workspace/cec/work/onboarding/chromium-cloud` 与 `NODE_OPTIONS='--import=/workspace/cec/work/onboarding/linux-cdp.mjs'`。适配仅负责容器浏览器启动、Linux 清理与旧测试截图转存；没有改变断言。完整 Python 套件、APK 构建与物理真机验收不在本页本次基线执行范围，不能把历史报告数量算作本次结果。
