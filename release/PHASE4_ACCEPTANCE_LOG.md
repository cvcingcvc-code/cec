# Phase 4 · Android E2E 验收日志

**日期** 2026-10-10 · **驱动** `app/tests/android_phase4_e2e.mjs`（真实 WebView CDP DOM 操作，无 mock）
**最终结果**：**54 passed, 0 failed — 全 PASS**（运行 marker `p4accmv2fge6x`，2026-10-10 21:26 本地）

## 环境

- AVD `gorgon_test`（pixel_7 · android-35 google_apis x86_64），从 `F:\gorgon-android-toolchain` 启动
  （`-no-snapshot-save -no-boot-anim -gpu swiftshader_indirect`）。
- APK v4：versionCode=4 / versionName=4.0，sha256 `cbee3bf6f494e6612d7b22e0039a8f04252662b3663c831c95dc00b5be0f859c`，
  5,418,388 bytes，`adb install -r` Success（`lastUpdateTime=2026-10-10 10:33:01`）。
- CDP 桥：`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` + WebSocket Runtime.evaluate。

## 最终运行完整输出（54/54 PASS）

```
── Gorgon Phase 4 · Android E2E acceptance ──
marker: p4accmv2fge6x
PASS  step0: app cold-boots and React mounts (real WebView)  — pid=2698
PASS  step0b: clean-baseline boot after artifact cleanup  — pid=3060
PASS  step9-pre: existing localStorage keys captured  — ["gorgon_my_weekend","gorgon_my_weekend_items","gorgon_opportunities_v1","gorgon_selected_district","gorgon_workbench_log","gorgon_workbench_review","gorgon_workbench_tasks_v2"]
PASS  step1: 智能搜索 (NaturalSearchScreen) opens from the mobile 更多 drawer
PASS  step1: activity search returns results (offline demo payload)  — cards=1
PASS  step10a: search results carry the DEMO marker (honest offline data)
PASS  step1: 「详情」button present on the result card
PASS  step1: activity detail opens from the card
PASS  step1: activity title present  — 周末民谣现场:城市夜晚与吉他
PASS  step2: 「以此活动创建项目」clicked
PASS  step2: navigates to the new project detail
PASS  step2: project title = activity title  — 周末民谣现场:城市夜晚与吉他
PASS  step2: activity is linked into the project
PASS  step10b: linked DEMO activity keeps its badge inside the project
PASS  step3: Task A created inside the project
PASS  step3: Task A detail opens
PASS  step3: Task A persisted in the v2 engine store  — id=c6202c27-5a13-42f6-8223-34627c2f2afc
PASS  step4: plan skill executed → suggestions rendered with a save button
PASS  step10c: plan zone labels them 建议 and never claims completion  — 这是一份本地规划建议（5 步）。保存为待办后，它们会以「待执行」状态出现在上方步骤里，由你逐条手动推
PASS  step4: plan suggestions saved as todo steps  — planSteps=5
PASS  step4: every saved suggestion starts as 待执行 (AI never marks a suggestion done)  — pending=5 plan=5
PASS  step4: a saved suggestion is editable by the user
PASS  step5: schedule saved (planned date + due time)
PASS  step5: schedule persisted on Task A  — {"s":"2026-10-10","d":"2026-10-10","st":"completed"}
PASS  step6: Task B detail opens
PASS  step6: state machine created→ready
PASS  step6: state machine ready→running
PASS  step6: state machine running→completed
PASS  step6: Task B status = 已完成 through the legal path only  — 已完成
PASS  step6: no further transition offered on a completed task
PASS  step6: execution note attached to Task B
PASS  step6: note persisted with task + project links  — {"task":"7d1e6e30-7c73-477e-b0ab-8334e4fa059b","project":true}
PASS  step10d: project keeps the DEMO badges (detail 活动 DEMO 数据 + list 含 DEMO 活动)  — detail=true list=true
PASS  step7: review (outcome + next action) persisted  — {"o":"p4accmv2fge6x 复盘","n":"p4accmv2fge6x 下一"}
PASS  step7: project hub shows a completed task
PASS  step7: project schedule view shows the dated task
PASS  step7: project hub shows the execution note
PASS  step8: process killed (force-stop)  — pidof=[]
PASS  step8: app cold-restarts and React mounts  — new pid=3295
PASS  step8: home renders the project section after cold start
PASS  step8: the project survived the cold restart (home list)
PASS  step8: today's scheduled task restored on home (今日待办)  — todayItems=3
PASS  step8: execution note restored on home (最近记录)
PASS  step8: Task A restored (plan) with schedule  — {"planTask":true,"planStatus":"completed","sched":"2026-10-10","due":"2026-10-10","planSteps":5,"pendingSteps":5,"execTask":true,"execStatus":"completed","note":true,"review":true,"project":true,"projectActivity":1}
PASS  step8: Task A plan todos restored, still pending (not auto-completed)  — planSteps=5 pending=5
PASS  step8: Task B restored with completed status  — B=completed
PASS  step8: note restored
PASS  step8: review restored
PASS  step8: project + activity link restored
PASS  step8: persistence bridge reports native + mirrored + hydrated  — {"native":true,"mirrored":true,"hydrated":16}
PASS  step9: every pre-run localStorage key still exists (no data destroyed)  — missing=[]
PASS  step9: task engine v2 envelope intact (schemaVersion=2)  — {"n":11,"schema":2}
PASS  step9: legacy 我的周末 surface still opens
PASS  step10e: home project row keeps the DEMO tag (demo never masquerades as real)

── android-phase4-e2e: 54 passed, 0 failed ──
```

## 调试历史（失败 → 修复 → 复验，全部留档）

1. **驱动 FATAL `app did not start (pidof empty)`**（首轮）：
   根因 = 异步桥改写时 `pidOf`/`bootApp`/`force-stop` 里 8 处 `adb()` 调用漏了
   `await`——在 Promise 上读 `.stdout` 永远 undefined。修复：全部补 await。复验 PASS。
2. **5 项 DEMO 标识检查 FAIL + step1 textarea 不存在**：
   根因 = 移动端 tabbar 的 `data-gg-nav="search"` 是 **legacy「搜索」tab**
   （SearchScreen，静态关键词搜索），不是 NaturalSearchScreen；静态活动卡
   无 `dataOrigin` → 创建的项目 `isDemo=false`。修复：step1 改走「更多」抽屉
   `data-gg-nav="smart"`。复验 step10a/10b/10e PASS。
3. **step1 点卡片本体不开详情**：NaturalSearchScreen 结果卡本体无 onClick，
   详情靠卡片底部「详情」按钮。修复：点击「详情」按钮。复验 PASS。
4. **step10d FAIL**：`openProjectDetailViaDrawer` 直接落详情页（projects tab
   保留 detailProjectId），列表页专属的 `workbench-project-demo-badge` 不存在。
   修复：断言改为详情页 `workbench-project-activity-demo` + 返回列表后
   `workbench-project-demo-badge` 双检查。复验 PASS（detail=true list=true）。
5. **step2 跨轮次失败（「以此活动创建项目」按钮消失）**：demo payload 确定性
   （activity id 固定）→ 上轮遗留项目使 `findProjectByActivity` 命中 → UI 显示
   「已关联」不再渲染创建按钮。这证明关联去重逻辑正常，属测试基线污染。
   修复：新增 step0b——清除上轮验收遗留的 `gorgon_workbench_projects_v1`
   （测试产物）后重启到干净基线；step9 的 keysBefore 在清理之后捕获，
   防破坏检查依然诚实。复验 PASS。
6. **step0b 二次冷启动 WebView devtools 通道楔死（evaluate 挂起）**：
   快速 force-stop/start 循环后通道滞后。修复：新增 `bootAppRetry()`
   （mounted=false 时 force-stop → 等 3s → 完整二次启动）。
7. **模拟器彻底掉线（adb devices 空列表，qemu 进程僵死）**：
   杀掉残留 qemu/emulator 进程 → 从工具链重启 AVD（45s boot）→ 复验全 PASS。

## 环境级发现（复用价值）

- **本机 spawnSync 环境级损坏**：`spawnSync` 对任何二进制抛 EBUSY
  （与沙箱无关，Node 22/24 皆复现）；**异步 `spawn()` 完全正常**。
  驱动全量使用异步 spawn + Promise + 幂等重试（daemon 回收模式：
  第 1 次调用失败 device offline、第 2 次起成功，所有桥接命令幂等）。
- **CDP 可重连**：step8 进程死亡后 `forwardToPid` 重新 forward + `cdpClose/cdpConnect`。

## 诚实标注

- 全部为**模拟器（AVD）**验证，**REAL_DEVICE_TEST=BLOCKED**（无物理设备）。
- 验收覆盖：真实 WebView DOM 操作 10 步闭环 + 冷启动持久化 + 旧数据存活 + DEMO 诚实标识。
