# Gorgon Workbench 2.0 — 仓库审计与依赖风险清单（一页）

> 审计时间：2026-10-10 12:43 GMT+8 ｜ 方法：只读当前磁盘状态，不信任历史报告结论。
> 审计人：WorkBuddy（产品/技术/交付验收负责人）

## 1. 仓库现状（已核实）

| 项 | 值 |
|---|---|
| 本地路径 | `C:\Users\lin\Documents\Gorgon-Workbench` |
| 审计前 HEAD | `9c21d87`（feature/workbench-competition，工作树 clean，与 origin 同步） |
| V2 开发分支 | `feature/gorgon-opportunity-v2`（已从 9c21d87 新建，master/比赛分支/Release 全部保留未动） |
| 前端 | `app/`：Vite 5.4 + React 18.3，已有 12 个 screens、workbench 任务引擎（router/skills/runner）、AI 适配层（provider/budget/cache/fallback/eligibility） |
| 后端 | `pipeline/api/server.py`（920 行，纯标准库 HTTP，无 CORS，检索+规划）；桌面壳 `desktop/main.py`（372 行，pywebview + 双线程服务） |
| 测试基线 | 19 个测试文件；Phase 10 记录 206 单测 + 18 build + 93 workbench E2E + 58 legacy E2E + 19 desktop smoke。**本轮以实测为准，不引用历史数字** |
| Windows 交付物 | `release/Gorgon-Workbench-Windows-v1.0.0-competition.zip`（EXE sha256 `fb8edb…`，保留） |

## 2. Phase 11 报告核对（关键缺陷已定位到代码）

- **持久化缺陷（模块 A 目标）**：`desktop/main.py:318-319` 调用 `webview.create_window(...)` + `webview.start()` **未传 `private_mode=False` 与 `storage_path`**。已核实本机 pywebview **6.2.1** 的 `start()` 签名默认 `private_mode: bool = True` → WebView2 走 InPrivate → localStorage 不落盘 → 重启丢任务。根因确认，修复面小。
- 前端存储现状：`app/src/store/store.js`、`task-repository.js`、`proposal-repository.js` 直接读写 `localStorage`；screens 不直接碰存储（符合分层）。**Android 侧需要一个存储适配层**（Capacitor Preferences / SQLite），否则 WebView localStorage 在 Android 上同样不可靠且无法跨版本迁移。
- Phase 11 其余诚实标记（SmartScreen NOT_TESTED、WebView2 硬依赖未写入 release 文档、赛规 UNVERIFIED）本轮沿用其诚实原则。

## 3. Android 可行性（第一阶段即验证，不等业务开发完）

| 检查项 | 结果 |
|---|---|
| 前端可复用性 | **高**。Vite 产物为纯静态 SPA，API 层已统一收敛到 `app/src/lib/api.js`（单点，无硬编码 URL），检索失败已有 `kind:"unavailable"` → Demo 降级并显式标记的机制。Capacitor 可直接托管 `app/dist` |
| 后端依赖 | **不能把 Windows EXE / Python server 当 Android 后端**，也不能依赖开发机 localhost。Android 首版走**本地优先**（存储+任务引擎+Demo 检索离线可用），联网检索作为可选适配器 |
| Capacitor | 8.5.3 稳定版可获取（npmmirror 直连 1.1s / Clash 代理可用） |
| JDK | 已装 Temurin **21.0.12.1** → `D:\gorgon-android-toolchain\jdk-21.0.12.1+1` |
| Android SDK | cmdline-tools 已就位，platform-tools + android-35/36 + build-tools 35/36 安装中 → `D:\gorgon-android-toolchain\sdk` |
| Gradle | 待由 Capacitor Android 工程 wrapper 拉取（需代理） |

## 4. 环境与依赖风险（阻塞级优先）

| # | 风险 | 等级 | 应对 |
|---|---|---|---|
| R1 | **C 盘仅剩 2.9G（99%）**，Android SDK+Gradle+构建缓存装不下 | 高 | 工具链全部装到 **D 盘（94G 可用）**；`ANDROID_HOME`/`JAVA_HOME`/Gradle user home 指向 D；构建缓存也放 D |
| R2 | **npmjs.org 直连超时**（15s 无响应） | 高 | 用 `registry.npmmirror.com`（1.1s）或 Clash 代理 `127.0.0.1:7890`（沙箱代理 60306 不可用） |
| R3 | Gradle / AndroidX 依赖需联网拉取，可能被墙 | 中 | 走 Clash 代理；预置 `gradle.properties` 代理项；失败则记录可验证原因，不无限重试 |
| R4 | 无真机时的实机验证 | 中 | 优先真机 USB（adb）；无真机则 AVD 模拟器；**两者都不可用 → APK 状态如实标 BLOCKED，不宣称已交付** |
| R5 | 检索/AI 需要 API Key | 中 | Key **不入包不入仓**，运行时从环境/安全存储读取；无 Key 走 Demo 且显著标记；保留无 Key 可运行演示 |
| R6 | 语音转写成本/风险高 | 低 | 转写列 **P1**，首版只做录音+本地保存+播放，**不声称支持语音转写** |
| R7 | 官方赛规无法获取 | 低 | 标 **UNVERIFIED**，不自行宣称满足国赛资格/评分 |

## 5. 执行边界（本轮遵守）

- 保留 Search→Plan 结果复用，不引入重复搜索；最小 diff；不删旧功能；不为过测伪造结果。
- 线上发布 / 第三方报名提交 / 付费 / 数据共享 → **必须用户明确授权**。
- 每个最小可运行阶段：构建→测试→存证→git commit（conventional 前缀）。
- 7 天冲刺目标 = Android MVP；时间不足主动砍功能，**不以加架构/测试/文档替代交付**。

## 6. 交付优先级

1. **P0**：APK 能在真实安卓设备安装、启动，核心本地数据可靠持久化。
2. **P1**：真实活动检索 + 行程 + 地点走访 + 笔记 闭环。
3. **P2**：语音转写、AI 高级分析、复杂 API 集成。
