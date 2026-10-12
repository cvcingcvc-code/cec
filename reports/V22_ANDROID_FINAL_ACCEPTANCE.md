# Gorgon Workbench V2.2 — Android 交付验收与真实行动闭环验证报告

> 执行时间：2026-10-13 03:44 – 04:30（GMT+8）
> 执行 HEAD：`a6577bf`（feature/gorgon-opportunity-v2，工作树干净，已先行核实）
> 结论一览：**APK 一致性 PASS（发现并修复旧包问题）· 模拟器验收多项 PASS · 真机仍 NOT_TESTED（Issue #1/#2 保持 OPEN）**

## 0. Git 状态恢复与基线核实

- HEAD 实测 `a6577bf`（与已知基线一致），分支 `feature/gorgon-opportunity-v2`，工作树干净。
- 构建产物存在：`app/android/app/build/outputs/apk/{debug,release}/`、`release/Gorgon-Workbench-Android-v{2.0.0,4.0.0}-debug.apk`。

## 1. 关键发现：APK 与源码不一致（已修复）

**发现**：文档记录的 V2.2 APK SHA256 为 `63e7181d…`，与磁盘 release APK 逐字节一致——
但该包构建于 **2026-10-13 02:13**，而 Issue #3 中文摘要代码（`result-summary.js` + TaskDetailScreen 改造）
提交于 **03:22**（`c0f59bb`）。解包验证：旧包 bundle（`index-BKpbItpQ.js`）中 grep "技术详情" = **0 处**。

**结论：`63e7181d…` 是 Issue #3 之前的旧包，不能用于验收 Issue #3 功能。** 此前的执行记录未发现该时序问题。

**修复（重建）**：

1. `node scripts/build-apk.mjs` — vite build PASS，cap copy PASS（新 bundle `index-CcUugBDz.js` 同步进 Android 工程）。
   - cap sync 的 update 阶段被沙箱批量删除守卫拦截（`capacitor-cordova-android-plugins` 目录 1332 文件超阈值 50），
     该目录为 Capacitor 自动生成、内容无实质变化，copy 已完成，不影响打包。
2. gradle assembleRelease（F 盘工具链：JDK 21.0.12.1 + Gradle 8.14.3 + SDK 36）BUILD SUCCESSFUL（3m18s，199 up-to-date）。

**新 APK 验证**：

| 项 | 结果 |
|---|---|
| SHA256 | `ebe4ca74bb921d579ab6c775bc5834e06832231aae1746bb83dd45725bdc648b` |
| 构建时间 | 2026-10-13 03:52（晚于 `c0f59bb`/`a6577bf`，与 HEAD 源码一致） |
| bundle 内 "技术详情" | 1 处（Issue #3 中文摘要确认打入） |
| bundle API 域名 | `2109679843717304320.app.workbuddy.host` 1 处，无旧域名残留 |
| 密钥扫描 | 0 明文密钥（sk-/api_key 模式无匹配） |
| localhost 依赖 | 0 处 |
| 包信息 | `cn.gorgon.workbench` versionCode 5 / versionName 5.0，minSdk 24，权限仅 INTERNET + DYNAMIC_RECEIVER_NOT_EXPORTED |
| build-smoke | **18/18 PASS** |

> 注意：V2.2 交付摘要中记录的 `63e7181d…` 自此作废，**当前有效 APK 为 `ebe4ca74…`**。

## 2. 测试基线复验（a6577bf HEAD，未重跑已通过的既有套件之外的部分）

- app 单测：**333/333 PASS**（含 6/6 场景 + 10 result-summary）
- build-smoke：**18/18 PASS**
- workbench E2E：**93/93 PASS**（本 HEAD 新鲜执行，console errors = 0）
- pipeline unittest：461 OK（未触碰 pipeline/，无影响，不重跑）

## 3. 模拟器验收（新 APK `ebe4ca74…`，受控启动 ×1，emulator gorgon_test）

| 验收项 | 状态 | 证据 |
|---|---|---|
| 冷启动 + 安装 | **PASS** | `adb install -r` → Success；pm list packages 见 cn.gorgon.workbench |
| 应用首次启动 | **PASS** | am start 后 topResumedActivity=MainActivity；无 AndroidRuntime FATAL |
| 首页完整渲染 | **PASS** | uiautomator dump 40 个文本节点：标题/输入框/快捷任务/项目卡/工作台状态全部渲染 |
| 中文结果显示（Issue #3） | **PASS** | 状态条「就绪/规则确定/未连接/就绪 / 按需」、任务路由面板、时间线中文标签全部可见 |
| 创建任务 | **PASS** | 输入"zhao huodong"→ 开始任务 → 详情页「已创建」 |
| 任务执行（状态机） | **PASS（有保留）** | 「开始执行」→ ready→running；因模拟器 DNS 解析公网 API 失败，检索未返回（见 §4） |
| 状态机转换 | **PASS** | 时间线 7 条：created→planning→ready→running→completed（标记完成），每步中文时间戳 |
| 任务列表筛选 | **PASS** | 全部/今日待办/待完成/进行中/待审核/已完成/失败 全部渲染 |
| 活动检索页（内置数据） | **PASS** | 搜索页：地区筛选/热搜词/活动卡（大模型工作坊/民谣现场等）完整渲染 |
| 活动同步日程 | **PASS** | 活动「同步」→「已同步」，状态保持 |
| 关闭重启 + 数据持久化 | **PASS** | force-stop ×2 + 重启后：任务「已完成」状态保持、活动「已同步」状态保持、时间线完整 |
| 异常退出恢复 | **PASS（等同项）** | 以 force-stop 模拟（无原生崩溃可复现）；重启后数据完整 |
| 设置页 | **PASS** | 应用/版本/引擎/路由/技能/持久化/Schema Version 2 全部中文渲染 |

**已知边界（模拟器环境限制，如实记录）**：

- 软键盘：需点击 textarea 中心（540,830）才触发 `mInputShown=true`；点击输入框上沿不弹键盘。
  真机触控体验待确认（用户实测时注意）。
- 模拟器 ICMP 全禁（ping 8.8.8.8 / 10.0.2.2 外网域名均 100% loss），WebView fetch 公网 API
  无法在模拟器内完成——「网络异常与恢复」只能验证到 DNS 失败后 UI 不崩溃、状态机保持一致，
  完整网络闭环（fetch 返回→中文摘要渲染→来源列表）**模拟器无法证明**。
- uiautomator dump 显示 1 个 NAF EditText（bounds [0,0][0,0]）为 WebView 无障碍桥接的已知伪影，
  实际 textarea（bounds [94,739][987,928]）正常可用。

## 4. 三个真实场景验收

| 场景 | 层面 | 状态 | 证据 |
|---|---|---|---|
| A：发现活动→查看来源→创建任务→安排日程→记录结果 | 数据层 | **PASS** | `v22-life-scenarios.test.mjs` 场景 A 6/6（真实 store 闭环） |
| A：发现活动→同步日程（UI 闭环） | 模拟器 | **PASS** | 搜索页活动卡→「同步」→「已同步」→ 重启后保持 |
| A：检索→中文结果摘要（完整网络链路） | 模拟器 | **BLOCKED（模拟器）** | 模拟器 DNS 无法解析公网 API；fetch→中文摘要渲染无法在模拟器证明；E2E §40-42（93/93）已覆盖浏览器侧 |
| B：发现机会→保存信息→创建行动计划→跟踪进度 | 数据层 | **PASS** | 场景 B / B-2 / B-3（求职八态状态机 + 诚实规则）单测通过 |
| B：求职管线管理屏 | UI | **NOT_IMPLEMENTED** | 进度中心只读摘要已就绪；专用管理屏未实现（记录在案，不冒充） |
| C：地推地点记录→标记已去/未去→记录笔记→查看后续 | 数据层 | **PASS** | 场景 C 走访闭环单测通过 |
| C：地点走访完整 UI 流程 | 模拟器 | **NOT_TESTED** | 需真机/后续专项验证 |

## 5. Issue 状态（不擅自关闭）

| Issue | 状态 | 说明 |
|---|---|---|
| #1 真机九步验收 | **OPEN，NOT_TESTED** | 无物理 Android 设备。新 APK SHA256 待真机校验：`ebe4ca74…`（注意：非旧记录的 63e7181d） |
| #2 V2.2 生活场景真机验收 | **OPEN，NOT_TESTED** | 同上 |
| #3 结果中文化 | **代码完成 + 模拟器渲染 PASS** | 中文摘要模拟器可见；真机最终确认后可关 |

## 6. 仍阻断的事项

1. **物理 Android 设备缺失**：九步验收（安装/首启/渲染/CRUD/检索中文/日程关联/地点笔记记录/网络异常恢复/重启持久化）
   仅完成模拟器等效验证，Issue #1/#2 保持 OPEN。
2. **模拟器无法验证完整网络闭环**：DNS 解析失败导致 fetch→中文摘要→来源列表无法在模拟器内证明
   （浏览器 E2E 93/93 已覆盖逻辑层）。
3. 求职管线专用管理屏未实现（NOT_IMPLEMENTED，记录在案）。

## 7. 下一阶段行动项（最多三个）

1. **物理真机验收（Issue #1/#2）**：USB 连接安卓设备，`adb install -r` 安装 `ebe4ca74…` 包，
   按 §3 九步清单执行；通过后关闭 Issue #1/#2/#3。
2. **真机网络闭环确认**：在真机上创建检索任务（如"找周末的活动"），验证 fetch 公网 API →
   中文摘要卡片渲染 → 来源链接展示的完整链路。
3. **（可选）求职管线管理屏**：按需排入；进度中心只读摘要已可用，不阻塞交付。
