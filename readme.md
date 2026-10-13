# Gorgon — From Information to Action

**个人 AI 智能行动工作台。**

发现信息、判断机会、规划任务、执行行动、积累经验。

> 产品定位冻结：2026-10-13。本 README 只描述**当前真实支持的功能**；未实现的能力如实标注，不夸大宣传。

---

## Gorgon 是什么

Gorgon Workbench 让 AI 从「回答问题的助手」，变成帮助个人**整理信息、判断机会、规划行动、协调执行和积累经验**的工作系统。

核心工作流程（信息到行动的闭环）：

```
信息发现 → 证据分析 → 任务生成 → 日程规划 → 智能体执行 → 结果记录 → 失败复盘 → 长期记忆
```

每一环都以「可追溯、可核验、可复盘」为底线：信息有来源、判断有依据、任务有状态、执行有记录、失败有复盘。

## 为什么开发它

过去，我一直希望有一个人，能够在我迷茫的时候给予指导。

后来有了 AI，我开始思考，能否把它变成一个真正能够帮助我学习、工作、生活和成长的行动助手。

因此，我开始开发 Gorgon。先从自己使用开始，解决真实问题，再逐步扩展为其他人也能使用的工具。

## 当前实际支持的功能（与代码对齐，诚实标注）

### ✅ 已实现（REAL）

| 能力 | 说明 |
|---|---|
| 任务系统 | 创建（goal 输入）、7 态状态机（非法流转拒绝）、截止时间、子任务/步骤、执行记录（timeline）、完成历史 |
| 日程系统 | 今日待办、周视图、日期选择器（DatePickerSheet）、ICS 导出 |
| 地点管理 | CRUD、走访记录、复访计划、4 态状态机、搜索与历史 |
| 笔记中心 | 文字笔记 CRUD、跨对象四向关联（活动/地点/任务/项目）、搜索/导出/过滤 |
| 自建活动 | user origin envelope + 创建入口 + 周末/项目互通 |
| 项目统一 | 项目 CRUD（软删除）、origin 诚实标注、聚合视图（任务/笔记/地点/复盘/报名/进度）、进度中心 |
| AI 行动辅助 | provider contract + Mock 兜底 + HunyuanProvider + budget/cache + eligibility gate；opt-in 接线已交付，provider 失败自动降级本地（任务仍完成） |
| Android 壳 | Capacitor 8（cn.gorgon.workbench）、离线持久化（localStorage → Preferences 镜像）、崩溃恢复（损坏存档不清除） |
| Windows 桌面壳 | pywebview onedir 打包（`desktop/build.ps1` 一键重打包） |

测试基线：**App 单测 411/411、build-smoke 18/18（含 secret 扫描）、vite build PASS。**

### ⬜ 未实现 / 未验收（如实标注）

| 项 | 状态 |
|---|---|
| 物理真机完整流程验收 | **NOT_TESTED**（Issue #1/#2 OPEN） |
| E2E 全绿 | **BLOCKED_ENVIRONMENT**（CDP 长会话 wedge，31/55 首轮） |
| 任务优先级 / 失败重试 / 标题编辑 / 任务↔地点 / 跨字段搜索 | NOT_IMPLEMENTED / PARTIAL |
| 月视图 / 系统通知 / TXT·Markdown 导入 | NOT_IMPLEMENTED |
| Android 录音 / 回放 / 转写 | NOT_IMPLEMENTED（字段形状已就绪） |
| 真实地图 | NOT_IMPLEMENTED |
| 电脑 AI 智能体远程联动 | **仅设计**（见下文规划，未开发） |
| Jev 判断引擎 / 智能记忆库 / 业务自动化 | **规划中**（未实现） |

## 核心架构

```
┌────────────────────────────────────────────────┐
│           Android / 浏览器 / Windows 桌面        │
│  app/  React 18 + Vite 5 生产构建               │
│    android/  Capacitor 8 壳（离线持久化镜像）     │
│    desktop/  pywebview Windows 壳               │
├────────────────────────────────────────────────┤
│              Python Pipeline（后端）             │
│  api/server.py   静态服务 + POST /api/search    │
│  search/         planner→provider→rank         │
│  ingest→normalize→clean→dedupe→trust→review    │
│  data/           raw→…→approved（可溯源）        │
└────────────────────────────────────────────────┘
```

- 前端与后端解耦：APK 内无后端，WebView 指向部署的检索服务（构建时 `VITE_API_BASE_URL` 注入）。
- **唯一** API 配置点：`app/src/lib/api.js`；其余禁止硬编码 API 地址。
- 详细架构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## Android 运行情况

- 当前交付 APK **v5**：debug `FF3BE332…`（含 Phase 1-7 全部新代码，指向真实检索 API）/ release `6427DFD1…`（versionCode 5，签名构建）。
- 已验证：模拟器安装与 WebView origin、公网 health/OPTIONS/search、WebView 网络层、离线持久化镜像（单测层）。
- **未验收**：物理真机完整九步链路（冷启动→检索→建任务→排期→笔记→重启保留→断网）。
- 下载：[GitHub Release v1.0.0](https://github.com/cvcingcvc-code/cec/releases/tag/v1.0.0)（以 Release 页最新 SHA256SUMS 为准）。

## AI 智能体协作的规划（未开发，仅设计）

目标：用户通过手机提交开发任务，由电脑上的 AI 智能体执行并回传结果。

- 数据模型：Device / AgentAdapter / TaskRun / Approval / Event（复用现有 7 态任务状态机与人工批准模型）。
- 安全边界：电脑端只出站连接（outbound-only，零公网入站端口）；Device 配对绑定；只读/普通写/敏感三级授权；敏感操作必须用户批准；全链路 append-only 审计。
- 工具适配：Codex / WorkBuddy 等现有工具**必须先核实真实可用的集成接口**，不假定第三方工具都有开放 API；无公开接口的工具只支持人工方式。
- 设计文档：[docs/AGENT_REMOTE_DESIGN.md](docs/AGENT_REMOTE_DESIGN.md)、[docs/REMOTE_AGENT_ARCHITECTURE.md](docs/REMOTE_AGENT_ARCHITECTURE.md)。

## Jev 判断层（规划中）

统一结构化判断引擎——**负责判断，不直接掌握高风险执行权限**。

- 应用：活动检索、副业机会评估、求职信息分析、订单异常分析、任务优先级、来源可信度。
- 输出契约：输入信息 / 来源 / 判断结果 / 可信依据 / 证据缺口 / 风险提示 / 下一步建议。
- 硬规则：证据不足时 **ABSTAIN**；判断只是建议，执行权在用户。

## 统一任务与记忆模型

- **统一对象**：Project（项目）/ Task（任务）/ Opportunity（信息机会）/ ScheduleItem（日程）/ PlaceVisit（地点走访）/ Note（笔记）/ Source（可追溯来源）/ Review（复盘）。活动/求职/学习/地推/个人项目共享同一套模型，不做五套重复系统。
- **智能记忆（规划中）**：导入其他 AI 智能体的对话摘要、项目说明、技术经验、失败记录，构建可检索的个人记忆库；保留来源/版本/时间/去重记录；支持审查、纠错、删除；**不自动把历史内容判断为真实**。

## 下一阶段路线图

完整路线图见 [docs/ROADMAP.md](docs/ROADMAP.md)，五大优先级：

1. **Android 日常可用**（P0）— 真机验收收口 + 任务系统最小增量补齐。
2. **电脑 AI 智能体远程联动**（P1）— 手机派发任务，电脑智能体执行。
3. **Jev 信息分析**（P1）— 统一结构化判断引擎。
4. **智能记忆**（P2）— 可检索、可审查的个人记忆库。
5. **业务自动化**（P3）— 授权与平台规则内的重复动作自动化。

## 已知限制

- 模拟器 E2E 存在 CDP 长会话稳定性问题（>3 分钟后 evaluate 挂起），属环境问题（BLOCKED_ENVIRONMENT），非代码缺口。
- 物理真机验收依赖设备，尚未执行。
- 检索服务的真实数据依赖部署的服务器；本地默认 DEMO/Mock 数据（诚实徽标标注）。
- 仓库历史含多阶段演进（Demo MVP → Workbench 竞赛版 → V2.x），旧文档保留在 `docs/workbench/`、`reports/`、`release/` 作为历史证据，不代表当前能力。

## 本地开发与安全说明

```bash
# 前端（app/）
cd app
npm install
npm run dev        # 开发（代理 /api → 127.0.0.1:8000）
npm test           # 单元测试（411/411）
npm run build      # 生产构建

# 后端检索服务（项目根）
python pipeline/api/server.py --port 8000

# Android APK（需 F 盘工具链或本机 SDK）
cd app && node scripts/build-apk.mjs   # vite build + cap sync
cd android && ./gradlew assembleDebug

# Windows 桌面壳
powershell -ExecutionPolicy Bypass -File desktop/build.ps1
```

**安全约定**：

- API key / 密钥永不进入仓库与前端 bundle：检索 key 只存 Python 侧；AI key 走宿主环境变量（GORGON_AI_*）；Android 签名 keystore gitignore。
- `.env` / `.env.local` / `search.env` / `local.properties` / `keystore.properties` 均 gitignore；模板（`*.example`）提供。
- 外部高风险操作（支付/发货/删除/外发）一律人工批准，产品不自动执行。
- 项目迁移说明：开发根目录已迁至 `F:\Gorgon-Workbench`（源目录保留），见 `reports/migration/MIGRATION_REPORT.md`。

---

## 历史文档

早期 Demo MVP 与设计系统说明保留于本文件历史版本（`docs/workbench/README_v1_HISTORY.md`）及 `docs/` 各 Phase 报告，不代表当前全部能力。
