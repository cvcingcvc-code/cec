# Gorgon Workbench V2.2 — 第三阶段：三个真实生活场景报告

> 生成时间：2026-10-10（V2.2 长周期自主开发 · Stage 3）
> 范围：三个真实生活场景（A 活动参加 / B 求职学习 / C 地点走访）全部走真实 store 数据；补齐求职阶段词汇（审计缺口 #2）。

---

## 1. 交付内容

### 1.1 求职阶段模型（新文件 `app/src/workbench/job-model.js`）

纯模块（无 DOM/React/localStorage），镜像 task-model.js 惯例：

**JOB_STAGE 八态词汇表**：collecting（收集中）→ applied（已投递）→ assessment（笔试/测评）→ interview（面试）→ offered（Offer）→ accepted（已接受）；rejected（被拒）/ ghosted（无回音）为诚实终态。

**TRANSITIONS 白名单**（唯一合法路径）：
- 正向：collecting→applied→assessment→interview→offered→accepted（applied 可跳过笔试直达 interview/offered）
- 诚实退出：任何活动态可到 rejected / ghosted
- 终态封闭：accepted / rejected / ghosted **无任何移出**（被拒不能复活）

### 1.2 求职仓库（新文件 `app/src/store/job-repository.js`）

| 项 | 值 |
|---|---|
| 持久化键 | `gorgon_workbench_jobs_v1`（schemaVersion 1） |
| 容错 | 损坏隔离 `<key>.corrupt-<n>`（永不销毁）；内存兜底 |
| 接口 | listApplications（newest first + stage 过滤）/ getApplication / addApplication / transitionStage / updateApplication / removeApplication / countByStage / getStorageHealth |

**诚实规则（代码层落实）**：
1. 新申请**起始必须 COLLECTING**，永不跳段；非法跳段安全拒绝（`transitionStage` 返回 null）。
2. offered / accepted 只经**显式用户确认**路径（镜像报名诚实规则）；本层从不自动推进。
3. rejected / ghosted 是**诚实记录**——被拒是数据，不隐藏、不转换、不可复活。
4. 每次推进追加 `stageHistory` 审计轨迹。

## 2. 三个真实场景验证（`app/tests/v22-life-scenarios.test.mjs`，6/6 PASS）

### 场景 A：活动参加（真实闭环）
从活动视图创建项目（DEMO 标记保留）→ 打开报名页（opened_registration ≠ registered）→ 用户显式确认（registered + confirmedAt 盖章）→ 默认准备清单种子 + 勾选 → 关联任务 + 日程 → 统一进度记录 → 重新进入：bundle 聚合完整（registrations/tasks/progress/prep 全部真实数据）。

### 场景 B：求职学习（审计缺口 #2 补齐）
- **B1 管线诚实推进**：星尘科技前端工程师 — collecting 起始 → 非法跳段 collecting→offered 被拒 → applied→assessment→interview 白名单推进 → rejected 终态 → 终态不可复活（interview/offered 均被拒）→ stageHistory 5 条完整审计。
- **B2 offer 显式确认 + 学习联动**：远山数据 — applied→interview→offered→accepted 唯一合法路径；求职学习项目（SQL 刷题任务）状态机走完 completed；进度 kind=done 不改状态（诚实钉死）。
- **B3 ghosted + 统计**：无回音诚实记录；countByStage 三态计数正确（ghosted=1/applied=1/collecting=1）。

### 场景 C：地点走访（真实闭环）
调研项目下规划两家公司走访 → 真实到访（todo→visited 自动翻转 + visits 记录）→ 复访判断（revisit → 二次到访翻回 visited）→ 不适合诚实记录（unsuitable 不隐藏不删除）→ 进度记录 → 重新进入：3 地点 2 visited 1 unsuitable 全部真实。

### 跨场景共存
四份新键（progress/jobs）+ 既有键（projects/places/registrations）互不干扰，storage health 全部健康（corrupted=0）。

## 3. 测试与构建结果

| 检查 | 结果 |
|---|---|
| 本轮新增 v22-life-scenarios | 6/6 PASS |
| 完整套件 | **317/317 PASS，零回归**（基线 298 → Stage 2 +13 → Stage 3 +6） |

## 4. 不做什么（已遵守）

- 不混用词汇表：JOB_STAGE 独立于 REG_STATUS / PLACE_STATUS / TASK_STATUS。
- 不做求职 UI 屏（任务指令未要求；数据层 + 场景验证先行，UI 可在 Stage 4 进度中心顺带呈现）。
- 不自动推进任何阶段 / 状态（全部诚实规则钉死）。

## 5. 遗留与下一阶段

- 求职数据层已就绪但无专用 UI 屏——Stage 4 进度中心可把 countByStage() 纳入跨项目摘要。
- **Stage 4**：多项目进度中心（面向普通人的中文摘要 UI）→ `reports/V22_PROJECT_PROGRESS_REPORT.md`。
