# BASELINE_AUDIT — Gorgon Workbench Phase B 基线审计

> 生成时间：2026-10-13 14:35–15:00 GMT+8
> 执行人：WorkBuddy（V3 长周期自主开发任务）
> 前置条件：仓库归一化任务已完成，结果 **MIGRATION_PASS**。

---

## 0. 仓库迁移核实（启动门禁）

| 检查项 | 结果 |
|---|---|
| 本地 HEAD | `5cf79d22a13ca74eea2fb1300fa18c46fc22384d` |
| cec 远端 tip（fetch 后） | `5cf79d22a13ca74eea2fb1300fa18c46fc22384d` |
| 分支关系 | **一致，无分叉，无未合并提交** |
| 迁移结论 | **MIGRATION_PASS** → 允许开始开发 |
| git status | 干净（仅未跟踪 `GORGON_MIGRATION_AND_ROADMAP_REPORT.md`，保留） |
| remote | `cec` = github.com/cvcingcvc-code/cec.git（**唯一正式**）；`origin` = geergong.git（旧，不再推送） |
| worktree | 3 个（Gorgon-Recovered / Travel-Agent-V1 / Workbench），共享对象库 |

### F 盘工作树对 C 盘对象库的依赖（仅记录，不擅自迁移）

`F:\Gorgon-Workbench\.git` 是文件：`gitdir: C:/Users/lin/Documents/Gorgon-Recovered/.git/worktrees/Gorgon-Workbench`。
即 F 盘工作树仍通过 worktree 架构使用 C 盘 `Gorgon-Recovered` 的 Git 对象库。
本轮**只记录**该事实；对象库保持原样，不做迁移、删除或改写。

---

## 1. 环境审计

| 项 | 值 | 状态 |
|---|---|---|
| 工作目录 | `F:\Gorgon-Workbench` | ✅ |
| Node.js | v22.22.2（bash 内） | ✅ |
| Java | `F:\gorgon-android-toolchain\jdk-21.0.12.1+1\bin\java.exe`（JDK 21；**不在 PATH**，构建脚本需显式配置） | ✅ |
| Android SDK | `F:\gorgon-android-toolchain\sdk`（`app/android/local.properties: sdk.dir=F\:\\gorgon-android-toolchain\\sdk`） | ✅ |
| Gradle | 8.14.3（工具链自带）+ `gradle-8.14.3/`、`gradle-home/` | ✅ |
| Gradle 内存配置 | `org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m`（低内存验证配置，复用） | ✅ |
| Gradle 代理 | 127.0.0.1:7890（http/https，nonProxyHosts 含 dl.google.com） | ✅ |
| ADB 设备 | **无已连接设备**（`adb devices` 空）；AVD `gorgon_test` 存在 | ⚠️ 无真机 |
| GitHub 访问 | Clash 代理 127.0.0.1:7890 | ✅ |

## 2. 测试基线（本轮实际运行）

| 套件 | 命令（在 `app/` 下） | 结果 |
|---|---|---|
| 单元测试 | `node --test "tests/*.test.mjs"` | **441/441 PASS**（4.2s） |
| Build Smoke | `node tests/build-smoke.mjs` | **18/18 PASS**（无密钥泄漏、无运行时 JSX、无绝对路径入 bundle） |

注意：`npm test` 必须在 `app/` 目录执行；在仓库根目录执行会得到 0 个测试（glob 不命中）。

## 3. 当前 APK 版本

| APK | SHA256 | 大小 | 状态 |
|---|---|---|---|
| `release/Gorgon-Workbench-Android-v6.0.0-debug.apk` | `ca4f2c3e8d46d1b4e869d97a34b7c3433df87a3a742b90293026bae0e5c15b47` | 4,869,758 B | 已发布 cec Release `v0.3.0-alpha` |
| `release/Gorgon-Workbench-Android-v6.0.0-release.apk` | `2894e215c6d021c7de76a05b46107eda6c72b959d63421cfc33e3f60f55e8f29` | 3,834,665 B | 已发布 cec Release `v0.3.0-alpha` |

上一轮报告声称 v6.0 = 441/441 + 18/18 → 本轮实测一致，历史报告可信。

## 4. 项目命令

| 用途 | 命令 |
|---|---|
| 前端开发 | `npm run dev`（app/ 下，vite） |
| 前端构建 | `npm run build` |
| APK 构建 | `npm run build:apk`（`scripts/build-apk.mjs`） |
| 单测 | `npm test`（app/ 下） |
| 构建冒烟 | `npm run test:build` |
| E2E（前端壳） | `npm run test:e2e:workbench` |
| Gateway 启动 | `node scripts/agent-gateway.mjs [--port 8765] [--lan]` |

## 5. 真实模块清单（源码级核实）

| 模块 | 位置 | 状态 |
|---|---|---|
| 任务模型 | `app/src/workbench/task-model.js`（434 行，v2 schema） | REAL |
| 状态机 | task-model 内（CREATED→…，非法流转抛 InvalidTransitionError） | REAL |
| 提醒模型 | `app/src/workbench/reminder-model.js`（94 行） | REAL |
| 提醒桥（Capacitor Local Notifications） | `app/src/lib/native-reminders.js`（149 行，31-bit 通知 id 去重、过期不调度） | REAL（真机通知未验证） |
| 笔记导入 | `app/src/lib/note-import.js`（114 行，append-only，2MB 上限） | REAL |
| 统一 store | `app/src/store/workbench-store.js`（860 行：tasks/notes/places/projects/registrations/progress） | REAL |
| Agent Gateway（电脑端） | `scripts/agent-gateway.mjs`（408 行，零依赖，S1–S7 安全边界） | REAL（本机 E2E 上一轮已过） |
| Agent 手机端 | `app/src/screens/AgentScreen.jsx`（351 行，fetch + X-Gorgon-Token） | REAL（真机连接未验证） |
| 日程视图 | `app/src/screens/ScheduleScreen.jsx` + `v23-calendar/schedule-view` 测试 | REAL |
| 地点 | Places store + `linkTaskToPlace`（store L269–280） | REAL |
| 笔记↔任务关联 | note.taskId + NotesScreen 跳转（NotesScreen L211–214）+ App L673 任务笔记 | REAL |

## 6. 结论与允许的行动

- 基线可信：**441/441 + 18/18，Git 与 cec 一致，环境齐备**。
- 无 ADB 设备：所有真机项本轮保持 `DEVICE_E2E=NOT_TESTED`。
- 允许行动：进入端到端缺口分析 → Phase B1/B2/B3 最小增强 → 电脑端集成验证 → 交付。
