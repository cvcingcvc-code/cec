# AGENTS.md — Gorgon Lite 仓库工程与协作准则

> 面向负责或协助维护本仓库的工程智能体与人类开发者。只记录**与代码一致的真实事实**与不可违背的安全边界。

## 1. 产品定义（Gorgon Lite）

Gorgon 已从早期的周末活动聚合实验与多功能膨胀的 Workbench，收敛精简为 **Gorgon Lite（个人 AI 行动助手）**。

唯一核心产品闭环：

```
用户创建任务 → AI / 电脑端在获授权只读范围内辅助执行 → 返回真实结果与失败原因 → 保存记录与复盘
```

- **主导航仅保留三入口**：`首页 (home)` / `任务 (tasks)` / `智能体 (agent)`。
- **次级保留能力**（顶部「工具」抽屉 / 任务页快捷栏 / 任务详情可达）：`日程 (schedule)`、`笔记 (notes)`、`项目 (projects)`、`工作记录与回收站 (history)`、`人工确认 (review)`、`模型与设置 (settings)`。
- **冻结与隐藏模块**：早期上海大学生周末活动发现、地图、地点走访、自建活动、进度中心、黑客松抓取与 Python 数据采集管线（`pipeline/`）均处于**冻结归档状态**——默认不在主导航展示，但源码与本地历史数据键全部保留，通过设置页历史入口、`/?legacy=1` 与 `/?nav=classic` 保持可访问与可回滚。

## 2. 真实代码目录结构

```
app/                        主前端与 Android Capacitor 8 工程（React 18 + Vite 5）
  src/components/LiteChrome.jsx   Gorgon Lite 顶栏、三入口底栏、次级工具面板与侧栏
  src/workbench/navigation.js     Lite 三入口配置、次级/归档路由映射、classic 回滚开关
  src/workbench/one-shot.js       一句话原子创建→路由→执行编排、幂等去重、中文错误解释
  src/workbench/task-*.js         7 态任务状态机、确定性路由器、部分成功与单步重试执行器
  src/screens/                    首页、任务、任务详情、智能体及次级/归档页面
  src/store/                      localStorage 版本化仓储门面（禁止页面直写 localStorage）
  src/lib/native-persistence.js   Android Capacitor Preferences 双向持久化镜像
  tests/                          Node 单元测试、Gateway 生命周期/安全测试、Edge CDP E2E
scripts/
  agent-gateway.mjs               零依赖电脑端受控网关（默认 127.0.0.1，Token 配对，白名单执行器，JSONL 审计）
  agent-adapters/                 codex-adapter.mjs（只读沙箱）、workbuddy-adapter.mjs + wbipc-client.mjs（只读 IPC）
desktop/agent-controller/         Windows 电脑端网关守护脚本 companion.mjs
pipeline/                         [冻结归档] Python 标准库活动检索与数据处理管线
ui_kits/ + components/ + tokens/  共享设计 Token 与早期遗留参考前端（勿破坏性删除）
docs/GORGON_LITE_AUDIT.md         当前真实基线、分支拓扑、能力矩阵、持久化键清单与回滚指南
```

## 3. 绝对不可破坏的工程红线

1. **分支与发布纪律**：
   - **禁止直接修改或强推 `master`**；一切开发在独立分支（如 `refactor/gorgon-lite-mvp`）推进。
   - 未经用户明确许可，禁止合并 PR、推送远端、部署服务或打包发布 APK。
2. **用户数据零丢失**：
   - 严禁删除或破坏任何 `gorgon_*` 本地持久化键及 Android `Preferences` 镜像键（完整清单见 `docs/GORGON_LITE_AUDIT.md` §3）。
   - 任何数据结构演进必须提供向后兼容读取与无损迁移；损坏 JSON 必须隔离备份，不得静默清空。
3. **Agent 安全与诚实原则**：
   - `scripts/agent-gateway.mjs` 默认仅监听 `127.0.0.1`，必须显式带 `--lan` 才可监听局域网；必须保留 `X-Gorgon-Token` 鉴权、执行器白名单、超时强杀、取消确认与 `audit.log` 追加审计。
   - **严禁为了简化 UI 绕过安全控制或人工审批（`Proposal` / `review_required`）**。
   - **严禁造假**：未连接、离线、配额耗尽、网络阻断或未真机测试时，必须如实展示原因或标注 `NOT_TESTED` / `BLOCKED_*`，绝不把 Mock、进程启动或局域网测试包装成真机/远程已完成能力。
4. **密钥隔离**：
   - 任何 API Key、配对码、签名证书或个人隐私配置严禁写入源码、前端构建产物、日志、截图或文档。
5. **冻结算法保护**：
   - 未经明确授权，不改动 `pipeline/trust/`、`pipeline/dedupe/`、`pipeline/review/`、`pipeline/normalize/` 与 `pipeline/search/ranker.py`。

## 4. 修改代码前后的必跑验证

每次动手前阅读：`readme.md` → `docs/GORGON_LITE_AUDIT.md` → 目标模块源码与对应测试。每次修改后必须运行并核验：

```bash
cd app
npm test            # 全量单元与网关安全测试
npm run test:build  # 生产构建 + 18 项产物与密钥安全冒烟检查
npm run build       # 验证生产分包无异常
```

若修改涉及 UI 布局或导航，还须运行浏览器 E2E（含 360 / 390 / 412px 移动窄屏防溢出检查）；无法在物理手机上执行的项必须标为 `NOT_TESTED` 并给出简明人工验收步骤。
