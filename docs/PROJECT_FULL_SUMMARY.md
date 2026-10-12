# Gorgon Workbench — 项目全量总结

> 生成日期：2026-10-13 · 本地路径 `/c/Users/lin/Documents/Gorgon-Workbench` · 当前分支 `feature/gorgon-opportunity-v2`（HEAD `a67185d`）

---

## 一、项目是什么（一句话）

**Gorgon Workbench（戈尔贡工作台）** 是一个面向上海大学生的「发现你的周末」活动平台，最终形态是**可审计的任务工作台**：用一句自然语言提需求，它把需求拆成任务、由**确定性规则**决定用哪些工具、真的去公网检索、给出计划——每一步可见、可核对、可追溯。

**三条核心主张**（区别于聊天机器人）：

1. **确定性优先**——路由、状态机、执行顺序由显式规则决定，不靠模型自由发挥；未知意图返回空且不猜。
2. **AI 按需接入**——闸门 `shouldUseAI()` 先硬拒绝（检索/去重/校验永久禁止交给模型），再按复杂度判定；模型不可用时降级回本地并写明原因，绝不编造；Mock 输出记 `simulated:true` 且丢弃内容。
3. **人始终在回路里**——外部动作先变成待批准提议，没有人的批准不会执行；批准会真的创建后续任务。

---

## 二、演进历程（六条分支的时间线）

| 阶段（分支） | HEAD | 交付内容 |
|---|---|---|
| **设计系统恢复** | — | Gorgon Design System（原设计语言）+ 恢复审计报告（`GORGON_RECOVERY_*.md`） |
| **Demo MVP**（`feature/demo-mvp`） | — | React 18 + Babel Standalone 交互原型：24 条活动、搜索、详情、我的周末、收藏、示意地图、审核后台（`readme.md` 上半部分） |
| **数据管道 MVP**（`feature/data-pipeline-mvp`） | — | Python `pipeline/`：ingest → clean → normalize → dedupe → trust → search → route → planning → review → export/location |
| **Workbench 竞赛版**（`feature/workbench-competition`，9c21d87） | Phase 0–11 | 见下节（本文档重点） |
| **Opportunity V2 安卓方向**（`feature/gorgon-opportunity-v2`，**当前**，a67185d） | — | Capacitor 安卓壳 + 持久化 + Phase 4/5 + Module C + 公网检索接入 |
| **并行工作树** | `feature/human-review-loop`（759fc51）：SQLite/crawler/本地索引/location 后端模块；`feature/travel-agent-v1`（3a9f114）：Travel Agent（属 Gorgon Recovered 仓库另一条线） |

### Workbench 竞赛版 Phase 0–11（全部 Gate 全绿）

| Phase | 内容 |
|---|---|
| 1A/1B | Vite 前端迁上 workbench 基线 + 应用外壳 |
| 2 | 统一任务引擎 + 持久化（状态机 `已创建→规划中→就绪→执行中→已完成/失败`，转移走显式白名单） |
| 3/3A/3B | 确定性任务路由 + 五技能框架（智能搜索/本地提取/本地摘要/本地规划/模板写作）+ UI 接线与 E2E |
| 4A | AI Provider 基础（离线、无付费 API） |
| 4B | AI 资格闸门 + Hunyuan Provider（注入式 fetch，离线可测） |
| 5 | AI 辅助技能回退（缓存→确定性→明确失败 降级链） |
| 6 | 人工审核行动模型（提议状态机 + 审计历史） |
| 7 | 比赛演示链路稳定（`?demo=1` 幂等预置；「处理方式」面板；演示链路 AI_CALLS=0） |
| 8 | Windows 桌面打包（PyInstaller onedir + pywebview winforms 原生窗口） |
| 9 | 发布 QA + 比赛交付物（测试矩阵 393 断言全绿 + 文档四件套 + 安全核查 0 密钥） |
| 10 | 比赛最终验收（冻结 + Windows 实机验收 + 5/5 真实场景验证 + 材料 + SHA256SUMS） |
| 11 | 交付报告（GUI 验收 + 能力矩阵 + 提交清单） |

---

## 三、架构与技术栈

```
┌─ 前端 app/ ────────────── Vite 5.4 + React 18.3 生产构建（1737 modules, 420 kB）
│    ├─ src/lib/api.js          唯一 API 配置层（VITE_API_BASE_URL 构建时注入）
│    ├─ src/lib/native-persistence.js  Capacitor 持久化桥（原生插件优先 + 超时兜底）
│    └─ workbench core          任务/项目/排期/笔记/复盘/审核 状态层
├─ 后端 pipeline/ ────────── Python 标准库单端口 HTTP 服务（零第三方依赖）
│    ├─ api/server.py           界面 + /api/search + 安全头 + 受控 CORS + 限流（30次/分/访客）
│    ├─ search/webproviders.py  真实检索源：SegmentFault/活动行/豆瓣/Meetup（免 API key）
│    └─ route/planning/review   确定性路由/规划/审核
├─ 安卓 app/android/ ─────── Capacitor 8 壳（WebView origin https://localhost）
│    └─ scripts/build-apk.mjs   VITE_API_BASE_URL 注入 + cap sync
├─ 桌面 desktop/ ─────────── PyInstaller onedir + pywebview（winforms 原生窗口，免安装）
└─ 公网部署 ──────────────── 平台「发布应用」：源码上传、沙箱起服务、固定域名
```

**安全设计**：静态文件白名单（pipeline/.git/admin/docs 全 404）、无明文密钥（仓库 0、bundle 0）、密钥只走宿主环境变量、`--debug` 只认服务端开关、输入校验（query≤300 字符等）、40s 检索上限、限流、CORS 白名单精确匹配永不通配 `*`。

---

## 四、两条产品线与交付物

### 线 A：Windows 桌面程序（竞赛版 1.0.0-competition）

- `release/Gorgon-Workbench-Windows/Gorgon Workbench.exe`（5.87 MB，双击即用，免 Node/Python）
- 打包 ZIP：`Gorgon-Workbench-Windows-v1.0.0-competition.zip`
- SHA256：EXE `fb8edb48…` / ZIP `35f6c062…`（`release/SHA256SUMS.md`）
- 自带 `--selftest` 无头自检 8/8（frozen=true, Python 3.14.2）
- 验收：EXE 8/8 + desktop 19/19 + 真实场景 5/5（`WINDOWS_ACCEPTANCE.md` / `REAL_WORLD_EVALUATION.md`）
- 比赛材料：3分钟/90秒脚本、8 页 PPT 大纲、10 Q&A、录屏大纲（`COMPETITION_MATERIALS.md`）
- 诚实标记：SmartScreen/独立 Win 机器验收 NOT_TESTED；赛题规则 UNVERIFIED（仓库无官方赛题，不编造）

### 线 B：Android APK（Opportunity V2）

| 版本 | sha256 | 内容 | 状态 |
|---|---|---|---|
| v2.0.0-debug | `202825eb…` | Capacitor 壳 + 模块 A 持久化桥 | 已被 v3 取代 |
| v3-debug | `1cc50a13…` | P0 白屏修复（原生桥优先 + boot 兜底）+ 模拟器持久化闭环 PASS | 已被 v4 取代（存档） |
| v4.0.0-debug | `cbee3bf6…` | Phase 4 核心闭环（项目/排期/笔记/复盘 UI 全接线）+ 54/54 E2E | 有效（Phase 4 凭证） |
| **v1.0.0-release**（GitHub Release） | `d886450d…`（最新） | release 签名 + 受控 CORS + VITE_API_BASE_URL 指向公网新域名 | 最新，附件待更新 |

- GitHub Release：`cvcingcvc-code/cec` 仓库 v1.0.0「Android 安装包」（2026-10-12）
- 真机验收：**NOT_TESTED**（无物理设备，诚实标记；模拟器全链路已验证）

### 公网部署（两条域名并存）

| 域名 | 代码 | CORS | 说明 |
|---|---|---|---|
| 旧：`shanghai-activity-search.app.workbuddy.host` | 旧 server.py | 无 | 同源网页用户不受影响；下线与否待用户决定 |
| 新：`2109679843717304320.app.workbuddy.host` | 新 server.py | **生效** | 本次部署产物；ACAO 回显 + 预检 Methods/Headers/Max-Age 实测通过 |

---

## 五、测试基线（全部实测，非推断）

| 套件 | 结果 |
|---|---|
| pipeline 单元测试 | **298/298**（原 206 基线 + 持久化/CORS 增量） |
| app 单元测试 | 277/277（V2 分支侧） |
| 构建冒烟（含密钥扫描） | 18/18 |
| Workbench E2E | 93/93 |
| 遗留前端 E2E | 58/58 |
| Phase 4 Android E2E | 55/55（marker `p4accmv5971wi`） |
| Places Android E2E | 29/29（走访地点闭环） |
| Registrations Android E2E | 28/28（报名诚实链路：opened_registration 永不记为 registered） |
| 桌面冒烟 + EXE 自检 | 19/19 + 8/8 |
| 公网服务测试 | 55/55（原 47 + 8 条 CORS 白名单测试） |

**Module C 诚实规则**：`opened_registration` 永不记为 registered；REGISTERED 仅显式确认（confirmedAt 随 REGISTERED 盖章、降级清除）。

---

## 六、修复过的重要缺陷（精选）

1. **Android 白屏 P0**：`await import("@capacitor/preferences")` 在 Capacitor 原生环境挂起阻塞 React 挂载 → 原生插件桥优先 + 3 秒超时兜底，保证渲染必执行。
2. **Android boot 挂死**：持久化初始化阻塞启动 → 修复 + 机会数据层（Modules C/D/E/F）。
3. **localStorage 磁盘复活**：force-stop SIGKILL 时 Chromium localStorage 删除未刷盘 → 重启后从 LevelDB 复活 → step0b 显式 await 原生 Preferences 删除 + step0c 运行中 WebView 再清守卫。
4. **演示链路点击目标错误**：任务行外壳无 onClick，可点击的是行内「详情」按钮 → Phase 7 七条 E2E 失败主因。
5. **CDP waitFor 不抛错**：超时返回 false 导致测试在空列表上继续 → 改为「等待结果当断言」。
6. **Mock 污染真实输出**：一次「模拟替换」曾把定制 4 步计划污染成模板腔 → 只有真实 provider 才允许替换技能内容 + 永久回归测试。
7. **metadata 链路断裂**：task-runner 成功分支丢弃 Skill 返回的 metadata → 「处理方式」面板读不到原因 → 最小 diff 修复 + 回归测试。
8. **手机检索不可用（本轮）**：公网跑旧版 server.py 无 CORS 头，WebView 跨域 fetch 被拦 → 受控 CORS 白名单 + 重新发布 + APK 重建，WebView 内实测 `health fetch 200 real` 打通。

---

## 七、当前状态（2026-10-13 01:09）

- **分支** `feature/gorgon-opportunity-v2`，HEAD `a67185d`，工作树有未提交改动：
  - `pipeline/api/server.py`（受控 CORS，M）
  - `pipeline/tests/test_public_server.py`（8 条 CORS 测试，M）
  - `app/package.json`（build:apk script，M）
  - `app/scripts/`（build-apk.mjs，未跟踪）
  - `docs/HANDOFF_PHONE_REAL_SEARCH.md`（交接文档，未跟踪）
- **远端**：`origin` = geergong.git、`cec` = cec.git（GitHub 访问走 Clash 代理 127.0.0.1:7890）
- **模拟器**：qemu 进程生命周期不稳定（只在「清锁→启动→装 APK→am start→探针」一条命令闭环内存活）；CORS 已有 WebView 内直接证据，UI 驱动搜索断言待稳定复现
- **最新 APK**：release 签名 sha256 `d886450d…`，已装入模拟器并验证 CORS 打通

---

## 八、已知限制（诚实声明）

- 演示数据是内置样例（每条标 DEMO），真实检索需宿主配置
- 真机（物理设备）验收 NOT_TESTED——模拟器覆盖全链路，x86_64 AVD 与 ARM 真机差异风险低（纯 WebView 无 NDK）
- 未做：安装器、代码签名（SmartScreen 提示选「仍要运行」）、自动更新
- 单机单人：数据存本地，不跨设备同步
- 比赛规则 UNVERIFIED（仓库无官方赛题原文）
- 平台网关改写响应头：X-Frame-Options 丢失、frame-ancestors 放宽（托管环境行为，不在仓库控制范围）

---

## 九、待办与下一步

1. **提交 4 文件**（CORS + build-apk，conventional 前缀拆两笔）→ push cec → `gh release upload --clobber` 更新 APK 附件（`d886450d…`）→ Release 说明补「真实检索（公网服务接入）」
2. **UI 驱动真实检索断言**在本环境稳定复现（环境配方见 `docs/HANDOFF_PHONE_REAL_SEARCH.md` §5）
3. **旧公网域名下线决策**（设置 → 数据管理 → 应用，由用户决定）
4. **真机验收**（有物理设备时）
5. 后续可选：B 阶段 Windows 桌面包更新（Rust 工具链待装）、V2 审计 P2 项（语音转写、AI 高级分析）

---

## 十、关键文档索引

| 文档 | 用途 |
|---|---|
| `docs/workbench/DELIVERY_STATE.md` | 竞赛版连续交付主状态（每阶段覆盖更新） |
| `docs/PUBLIC_DEPLOYMENT.md` | 公网部署/验证/安全全指南 |
| `docs/HANDOFF_PHONE_REAL_SEARCH.md` | 手机检索接入交接（含模拟器环境配方） |
| `release/README.md` / `RELEASE_NOTES.md` | 交付包说明 / 版本与限制 |
| `release/TEST_REPORT.md` / `SHA256SUMS.md` | 测试矩阵 / 校验和 |
| `release/PHASE4_ACCEPTANCE_LOG.md` / `PHASE5_ACCEPTANCE_REPORT.md` | 安卓阶段验收凭证 |
| `release/FINAL_ACCEPTANCE_REPORT.md` / `COMPETITION_MATERIALS.md` | 比赛终验 / 演示材料 |
