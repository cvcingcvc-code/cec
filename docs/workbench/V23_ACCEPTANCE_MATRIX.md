# V2.3 验收矩阵（V23_ACCEPTANCE_MATRIX）

> 每项功能实现后，按下表验收：通过才标 REAL，未验收保持 NOT_TESTED。
> 生成：2026-10-13 05:40。

## 1. Phase 1 — 完整任务系统

**主验收（任务书原文）**：用户能创建实际任务 → 设置日期 → 关联地点 → 添加笔记 → 修改 → 完成 → **应用重启后查看所有记录**。

| # | 验收项 | 方法 | 状态 |
|---|---|---|---|
| A1-1 | 创建任务（goal 输入） | 手动 + e2e | ✅ 已有测试覆盖 |
| A1-2 | 状态流转合法性（非法流转拒绝） | store.test.mjs + v22-core-model.test.mjs | ✅ 333/333 内 |
| A1-3 | 排期（dueAt/scheduledDate 无效拒绝） | workbench-store-phase4.test.mjs | ✅ |
| A1-4 | 笔记添加 + 四向关联 | opportunity-repository.test.mjs | ✅ |
| A1-5 | **重启后数据完整** | e2e_workbench_shell.mjs + android E2E | ✅（localStorage+Preferences） |
| A1-6 | 任务优先级（新增） | 新单测：normalize 填 normal、UI 显示、排序 | ⬜ 未实现 |
| A1-7 | 失败重试（failed→ready） | 新单测：TRANSITIONS 合法流转 + UI 重试按钮 | ⬜ 未实现 |
| A1-8 | 任务标题编辑 | 新单测 + 手动 | ⬜ 未实现 |
| A1-9 | 任务↔地点关联 | 新单测：task.placeId additive | ⬜ 未实现 |
| A1-10 | 跨字段搜索 | 新单测：标题/goal/笔记命中 | ⬜ 未实现 |

## 2. Phase 2 — 日程系统

| # | 验收项 | 方法 | 状态 |
|---|---|---|---|
| A2-1 | 周视图显示带日期任务 | 新 e2e + 手动 | ⬜ |
| A2-2 | 月视图渲染 | 新 e2e | ⬜ |
| A2-3 | 日期选择器（含 android_phase4_e2e.mjs:451-455 更新，:456-459 localStorage 断言保留） | android E2E | ⬜ |
| A2-4 | 系统通知（提醒时间触发） | 模拟器手动 | ⬜ |

## 3. Phase 3 — 地点系统

| # | 验收项 | 方法 | 状态 |
|---|---|---|---|
| A3-1 | 添加地点 + 到访记录 | android_places_e2e.mjs 29/29 | ✅ |
| A3-2 | 复访计划自动 REVISIT | 同上 | ✅ |
| A3-3 | 任务↔地点关联显示 | 新单测 + 手动 | ⬜ |

## 4. Phase 4 — 笔记与语音

| # | 验收项 | 方法 | 状态 |
|---|---|---|---|
| A4-1 | 录音保存 + audioPath 持久化 | 新 e2e（模拟器） | ⬜ |
| A4-2 | 回放 | 手动 | ⬜ |
| A4-3 | 转写（依赖 Phase 7） | 手动 | ⬜ BLOCKED until Phase 7 |

## 5. Phase 5 — 活动发现

| # | 验收项 | 方法 | 状态 |
|---|---|---|---|
| A5-1 | 检索返回结果 + DEMO 徽标 | e2e + 手动 | ✅ |
| A5-2 | 报名状态诚实（opened ≠ registered） | workbench-store-registrations.test.mjs | ✅ |
| A5-3 | 真实 Feed 一类数据 | 手动 + 新 e2e | ⬜ |

## 6. Phase 7 — AI 端到端

| # | 验收项 | 方法 | 状态 |
|---|---|---|---|
| A7-1 | 无 key 时永远 mock（bundle 无 key） | ai.test.mjs + build-smoke | ✅ |
| A7-2 | gate 规则（search 永不调模型） | ai-eligibility.test.mjs | ✅ |
| A7-3 | 有 key + 复杂任务 → 真实调用 | 需接线后手动 + 新 e2e | ⬜ NOT_TESTED |
| A7-4 | 处理方式面板显示真实 provider/token | 手动 | ⬜ NOT_TESTED |

## 7. Phase 8 — Android 稳定性

| # | 验收项 | 方法 | 状态 |
|---|---|---|---|
| A8-1 | 强杀进程 → 重启数据无损 | 模拟器手动 | ⬜ NOT_TESTED |
| A8-2 | 拒绝权限 → 核心可用 | 模拟器手动 | ⬜ NOT_TESTED |
| A8-3 | 离线启动 | pwa_offline_check.mjs | ✅ |

## 8. Phase 9 — 五个真实场景（最终验收）

| 场景 | 步骤链 | 状态 |
|---|---|---|
| A 参加活动 | 搜活动→报名→日程→到访→笔记→复盘 | ⬜ |
| B 求职 | 线索→投递→面试日程→录音→复盘 | ⬜ |
| C 地推 | 地点→走访→笔记→复访 | ⬜ |
| D 学习 | 计划→任务→历史 | ⬜ |
| E 个人日常 | 待办→提醒→完成 | ⬜ |

每个场景通过标准：模拟器全程不崩溃、重启数据不丢、诚实徽标准确。

## 9. 测试命令速查

```bash
cd app && node --test "tests/*.test.mjs"        # 单测（当前 333）
cd app && node tests/build-smoke.mjs             # 冒烟（当前 18）
cd app && node tests/e2e_workbench_shell.mjs     # Workbench E2E（需 dev server）
node -m unittest discover -s pipeline -t .       # pipeline（从仓库根，需系统 Python）
node tests/android_phase4_e2e.mjs                # Android E2E（需模拟器+APK）
node tests/android_places_e2e.mjs                # 走访地点 E2E（需模拟器+APK）
```
