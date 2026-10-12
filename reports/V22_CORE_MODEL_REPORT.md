# Gorgon Workbench V2.2 — 第二阶段：统一工作台核心能力报告

> 生成时间：2026-10-10（V2.2 长周期自主开发 · Stage 2）
> 范围：补齐 Progress 统一概念（审计缺口 #1），完成「创建项目→创建任务→安排日程→添加笔记→记录进度→重新进入查看」闭环。全部 ADDITIVE，不破坏旧数据。

---

## 1. 交付内容

### 1.1 新增 Progress 统一概念（数据层）

**新文件 `app/src/store/progress-repository.js`**（照 opportunity-repository 容器化模式）：

| 项 | 值 |
|---|---|
| 持久化键 | `gorgon_workbench_progress_v1`（schemaVersion 1，独立于所有既有键） |
| 容错 | 损坏数据隔离到 `<key>.corrupt-<n>`（永不销毁）；存储不可用时内存兜底 |
| 主体词汇 | PROGRESS_SUBJECT：project / task / place / registration |
| 类型词汇 | PROGRESS_KIND：note（记录）/ milestone（里程碑）/ blocked（受阻）/ done（完成） |
| 接口 | listProgress（newest first + 过滤）/ addProgress / updateProgress / removeProgress / countProgress / getStorageHealth |

**诚实规则（代码层落实）**：
1. 进度条目由用户（或显式动作）写入——本层**从不自动生成**进度文本（空文本/缺主体直接拒绝）。
2. `kind` 仅为描述性词汇——**不改变任何主体的真实状态**。任务状态变更仍必须走 task-model.js 的 TRANSITIONS 状态机（有专项测试钉死：`kind=done` 的进度记录不会把任务变成 completed）。
3. 主体身份（subjectType + subjectId）创建后不可变——updateProgress 不接受劫持。

### 1.2 Facade 接线（workbench-store.js，ADDITIVE）

新增导出：`PROGRESS_SUBJECT` / `PROGRESS_KIND` / `PROGRESS_LABEL` / `getProgress` / `addProgress` / `updateProgress` / `removeProgress` / `getProjectProgressBundle`。

- `addProgress` 对 task 主体同步追加 timeline 事件 `progress_logged`（History 可追溯）；对 project 主体记录 activity log `progress_create`。
- `getProjectBundle()` 扩展：返回值新增 `progress` 字段（项目侧进度 + 该项目全部任务的进度，合并按时间倒序）。既有字段（project/tasks/notes/places/review/registrations）不变。

### 1.3 UI 接线（ProjectDetailScreen.jsx + App.jsx）

- ProjectDetailScreen 新增 **「进度记录」区块**（testid `workbench-project-progress`，位于项目笔记之前）：类型选择（记录/里程碑/受阻/完成）+ 内容输入 + 条目卡片（类型徽标 / 任务侧标记 / 时间 / 删除按钮）。
- App.jsx 新增 `addProjectProgress` / `removeProjectProgress` 处理函数并接线（store facade → UI 刷新 → flash 提示「进度已记录」）。

## 2. 闭环验证（Stage 2 交付物核心）

新增测试文件 `app/tests/v22-core-model.test.mjs`（13 项断言全过）：

**完整闭环测试**：创建项目 → 创建任务（关联项目）→ 安排日程 → 添加笔记 → 记录进度（项目 + 任务两侧）→ 重新进入查看——直接从 localStorage 验证四份 envelope（projects_v1 / tasks_v2 / opportunities_v1 / progress_v1）六步产物全部真实落盘，facade 重新聚合 bundle 完整。

单元契约 12 项：主体身份不可变、空文本拒绝（从不伪造）、未知 kind 归一化为 note、newest first、过滤、删除精准、损坏隔离（quarantine 槽存在）、冷重启等价（fresh read = 重进页面语义）、facade 日志 + timeline、进度不改状态（诚实）、bundle 过滤正确。

## 3. 测试与构建结果

| 检查 | 结果 |
|---|---|
| 本轮实跑基线（Stage 1 开始时） | 298/298 PASS |
| 新增 v22-core-model 测试 | 13/13 PASS |
| 完整套件（含全部新测试） | **311/311 PASS，零回归** |
| Vite 生产构建（npm run build） | ✓ 9.29s（chunk >500kB 警告为既有现象，非本轮引入） |

## 4. 不做什么（已遵守）

- 不重写既有 repository（progress 独立新键，全部 ADDITIVE）。
- 不动 task-model.js 状态机与 REG_STATUS 诚实词汇。
- 不改既有 UI 区块结构（新区块追加）。
- 不做后端 / AI / LLM。

## 5. 遗留与下一阶段

- `kind` 词汇当前为描述性；Stage 4 多项目进度中心可在其上做摘要（每项目最新进度 + 开放任务计数）。
- 求职场景 B 状态词汇未建模（审计缺口 #2）→ **Stage 3 处理**。
- 完整改动见本轮 commit（progress-repository / v22-core-model.test / workbench-store / ProjectDetailScreen / App.jsx / V22_EXECUTION_STATE.md）。
