# G. P0 · 日期选择器重设计（Date Picker）

> 用户反馈：现有日期选择器 UI 太老旧 → 本轮 UI 优化 **P0**。
> 可交互原型：[`prototype/date-picker.html`](prototype/date-picker.html)（单日 / 日期+时间 / 范围三变体可切换）

## G1. 现有日期选择入口清单（真实代码，共 2 处）

| # | 位置 | 控件 | 绑定字段 | 存储格式 | 备注 |
|---|---|---|---|---|---|
| 1 | `screens/TaskDetailScreen.jsx:393` | `<input type="date">`（原生） | `task.scheduledDate` | 本地 `"YYYY-MM-DD"` | 经 `setTaskSchedule` → `normDateStrOrNull` 校验 |
| 2 | `screens/TaskDetailScreen.jsx:399` | `<input type="datetime-local">`（原生） | `task.dueAt` | 本地时间 → `toISOString()`（UTC ISO） | `new Date(value).toISOString()`，时区语义见 `TaskDetailScreen.jsx:307` |

### 只有显示、没有选择的日期位置（本次不改交互，仅确认）

| 位置 | 用途 |
|---|---|
| `TasksScreen.jsx:168-176` | 任务列表「计划 / 截止」文案 |
| `ProjectDetailScreen.jsx:115,261-298` | 项目详情的排期行 |
| `ProgressCenterScreen.jsx:124` | 进度中心「下一个安排」 |
| `WorkbenchHome.jsx:183` | 首页今日待办排期 |
| `NaturalSearchScreen.jsx:51-52` | 检索计划里的日期范围**标签**（只读展示） |

**结论**：全项目**没有自定义日历组件**，两处都是**原生 `input`**——这正是"老旧"的根因：
原生控件在 Android WebView 里由系统绘制，样式不受设计令牌控制，日期/时间被拆成两个割裂控件，且无范围选择能力。

### 现况问题（P0）

1. 原生 `input[type=date]` 在 Capacitor WebView 中依赖系统弹窗，**无法使用品牌视觉**，与全站风格断裂。
2. 「计划日期」与「截止时间」是两个独立字段，用户要**分别**操作，且语义关系（截止应 ≥ 计划）无任何约束。
3. 无「今天 / 明天 / 本周末」快捷选择，日常最高频操作要多点 2-3 次。
4. 无法限制可选范围（如禁止选过去的日期），也不能禁用特定星期。
5. 小屏上原生日期控件触控区不足 48dp，符合 A2 触控问题清单。

## G2. 组件规格：`DatePickerSheet`

**一个组件，三种模式**（`mode="date" | "datetime" | "range"`），不复制多套日历。

### G2.1 结构（自下而上）

```
遮罩（rgba(12,13,18,.45)，点击关闭 = 取消）
└─ Bottom Sheet（圆角 22px 上圆角，最大高 88%）
   ├─ 抓柄（38×4）
   ├─ 头部：标题（左） + 关闭按钮 48×48（右，aria-label="关闭日期选择"）
   ├─ 月导航：[‹ 48×48] 2026年10月（aria-live=polite） [› 48×48]
   ├─ 星期表头：一 二 三 四 五 六 日（周一为首日，aria-hidden）
   ├─ 日期网格：7 列 × 6 行，**每格 48×48**，gap 2
   ├─ [datetime] 时间行：小时/分钟步进（每按钮 44×44 + 值显示 62×44）
   ├─ [range]    快捷预设：未来 7 天 / 未来 30 天 / 本周末（高 40，含 8px 上下 padding）
   ├─ 错误行（role=alert，默认隐藏，仅在校验失败时显示）
   └─ 底部操作：清除 | 今天 | 确定（每按钮 **min-height 48**，flex:1）
```

### G2.2 尺寸规范（对应 A2 触控问题）

| 元素 | 尺寸 | 说明 |
|---|---|---|
| 日期格 | **48×48** | Android 推荐最小触控 |
| 月切换 / 关闭 / 头部图标按钮 | **48×48** | 视觉图标 16-17px，用 padding 撑热区 |
| 底部三个按钮 | **高 48** | `确定` 为主操作（实心 brand） |
| 时间步进按钮 | **44×44** | 次级操作，仍 ≥44 |
| 日期触发字段（页面内） | **高 ≥48**，整块可点 | 修复"点输入框不弹"的问题 |

### G2.3 状态

| 状态 | 视觉 |
|---|---|
| 默认 | 无底色，`--font-num` 15/600，`--text-strong` |
| 今天 | 底部加 5×5 圆点（brand），`aria-current="date"` |
| 选中（单日） | 实心 brand 圆角 12px + 白字 + **白色圆点**（不靠颜色单一维度）+ `aria-selected` |
| 范围起/止 | 实心 brand，内侧圆角方（`rstart` / `rend`） |
| 范围内 | `--brand-soft` 填充，方角 |
| 其他月日期 | `--slate-300`（弱化但可点） |
| 禁用 | `--slate-300` + `disabled`（不可点、不进 Tab 序列），`aria-disabled` |
| 按下 | `--indigo-100` 底色（触屏反馈，替代 hover） |

### G2.4 交互

| 行为 | 规则 |
|---|---|
| 月份切换 | ‹ / ›；到达限制边界时**按钮禁用**（`disabled`），不允许滑出范围 |
| 今天 | 直接定位到本月并选中今天（范围模式下把今天设为起点） |
| 清除 | 写入 `null`（与 `setTaskSchedule` 清空语义一致），并关闭 |
| 确定 | 校验通过才回填；不通过则显示内联错误（`role=alert`），**不关闭** |
| 取消 | 关闭按钮 / 点遮罩 / **安卓返回键（Esc）** / 侧滑 → 一律**不写入任何值** |
| 返回键 | 必须消费返回事件（Capacitor `App.backButton` 或 `keydown Escape`），不得退出应用 |
| 软键盘 | 日历本身不需要键盘；若从日期字段唤出后键盘仍开着，打开 Sheet 前先 `blur()` 收起，避免遮挡 |
| 无障碍 | 每格 `aria-label="2026年10月14日 周三"`；月标题 `aria-live="polite"`；Sheet `role="dialog" aria-modal="true" aria-labelledby` |

### G2.5 中文与本地化

| 项 | 规范 |
|---|---|
| 月标题 | `2026年10月` |
| 字段值（单日） | `2026年10月14日 周三` |
| 字段值（日期+时间） | `2026年10月14日 周三 14:00` |
| 字段值（范围） | `2026年10月14日 周三 — 2026年10月20日 周二` |
| 周首日 | **周一**（中文习惯；`lead = (getDay()+6) % 7`） |
| 星期表头 | `一 二 三 四 五 六 日` |

## G3. 数据契约（硬约束：不得改变）

| 字段 | 写入值 | 规则 |
|---|---|---|
| `scheduledDate` | `"YYYY-MM-DD"`（**本地**日历日） | 由所选年月日拼装；必须通过 `normDateStrOrNull`（拒绝 2026-02-30 这类不存在的日期） |
| `dueAt` | ISO 8601 UTC 字符串 | `new Date(y, m-1, d, hh, mm).toISOString()`——**与现状 `new Date("YYYY-MM-DDTHH:mm").toISOString()` 语义一致**（都按本地时区解释） |
| 清除 | `null` | 与 `setTaskSchedule(id, {scheduledDate:null})` 一致 |
| 范围 | *不新增字段* | 范围模式仅用于筛选类场景；任务排期仍只写 `scheduledDate` + `dueAt`（范围起点→`scheduledDate`，终点→`dueAt` 的本地时间） |

**不变**：不改 `task-model.js`、不改 `task-repository.js`、不改存储键、不改 `setTaskSchedule` 签名。

## G4. 实施步骤（Codex 优先项）

| 步 | 内容 | 文件 | DoD |
|---|---|---|---|
| G-1 | 新增纯函数模块 `app/src/lib/calendar.js`：月网格生成、日期比较、禁用判定、中文格式化（无 DOM） | 新增 | 单测 ≥20 条全绿（见 G5） |
| G-2 | 新增组件 `app/src/components/mobile/DatePickerSheet.jsx`（三模式） | 新增 | 新增组件单测/快照 |
| G-3 | 任务详情接入：替换两个原生 `input`，**保留 testid** `workbench-detail-schedule-date` / `-due` 与 `aria-label` | `TaskDetailScreen.jsx` | E2E `workbench-detail-schedule-*` 断言不红 |
| G-4 | 无障碍与返回键：`role=dialog`、`Escape`、字段 `aria-haspopup` | 同上 | 手动验证 Esc 关闭不写入 |
| G-5 | 范围变体接入检索（可选，后续）：仅替换 `NaturalSearchScreen` 的日期范围标签来源 | 可选 | 不阻塞 |

**DoD（每步）**：`npm test`（333+新增）、`npm run test:e2e:workbench`（93）、`npm run test:build`（18）、pipeline 461 全绿。

### G4.1 ⚠️ 对现有 E2E 的实际影响（硬证据，实施前必读）

`app/tests/android_phase4_e2e.mjs` **用键盘把值敲进原生输入框**，替换控件后会失败：

```
:451  await typeInto('[data-testid="workbench-detail-schedule-date"]', today);
:452  await typeInto('[data-testid="workbench-detail-schedule-due"]', today + "T18:30");
:453  await click('[data-testid="workbench-detail-schedule-save"]');
:454  waitFor('[data-testid="workbench-detail-schedule-current"]')
:456-459  // 读取 localStorage 断言 scheduledDate / dueAt(前10位) / status
```

**处置（必须同一次提交完成）**：

1. `typeInto` → 改为 `打开日期字段 → 点日期格 → 点「确定」`；
   建议日期格加稳定钩子：`data-testid="gg-datepicker-day"` + `data-date="YYYY-MM-DD"`。
2. **`:456-459` 的 localStorage 断言原样保留**——它正是"存储格式与时区语义未变"的护栏，
   不得删除或放宽（删除即等于伪造测试结果）。
3. 保留原 testid 作为**日期字段触发器**（`workbench-detail-schedule-date` / `-due`），
   使其从"输入框"变为"打开日历的按钮"——这样 `:453` 之后的断言与 `:454` 的
   `workbench-detail-schedule-current` 全部继续有效。
4. 建议同时新增 5 条单测覆盖 G5 的 #1–#5、#14（纯函数层，无需 E2E）。

## G5. 测试清单（必须覆盖）

| # | 用例 | 期望 |
|---|---|---|
| 1 | 月份边界：1 月点 ‹ | 跳到上一年 12 月，标题 `2025年12月` |
| 2 | 月份边界：12 月点 › | 跳到下一年 1 月 |
| 3 | 闰年：2028-02 | 出现 2月29日（2028 是闰年） |
| 4 | 非闰年：2027-02 | 无 2月29日，28 天 |
| 5 | 跨年：2026-12-31 选 2027-01-01 | 两次点击都能选中，值正确 |
| 6 | 周首日 | 2026-10-01（周四）排在"四"列；首行左侧为上月日期（弱化） |
| 7 | 禁用过去 | 勾选后，昨天及更早的格子 `disabled`，点击无效果 |
| 8 | 范围限制 | 勾选 30 天上限后，超出月份的下月按钮 `disabled` |
| 9 | 仅允许特定星期 | 非法星期格子禁用，点不动 |
| 10 | 约束变化导致已选非法 | 立即清空并提示，不静默保留 |
| 11 | 取消（Esc / 遮罩 / 关闭） | 关闭且**字段值不变**，无任何写入 |
| 12 | 清除 | 写入 `null`，列表排期行消失 |
| 13 | 时间步进 | 23:55 +5 分钟 → 00:00（跨日），小时步进回绕 23→0 |
| 14 | 回填格式 | `scheduledDate` 匹配 `/^\d{4}-\d{2}-\d{2}$/`；`dueAt` 为合法 ISO 且 `Date.parse` 后本地时分与所选一致 |
| 15 | 持久化 | 选择后 force-stop + 重启应用，任务排期仍为所选值 |
| 16 | 时区语义 | 做 `new Date(dueAt)` 还原的本地日期时间 == 所选值（与现有实现一致） |

## G6. 验收清单

- [ ] 日期格与所有按钮实测 ≥ **48dp**（用 `uiautomator dump` 读 bounds 校验）
- [ ] 三种模式共用同一组件（同一文件、mode 参数），无第二套日历
- [ ] 中文显示全部正确（月标题 / 字段值 / 星期表头）
- [ ] 安卓返回键关闭且不写入（真机验证；模拟器用 `adb shell input keyevent 4`）
- [ ] `scheduledDate` / `dueAt` 写入格式与改造前**逐字节一致**（对比改造前后同一操作的存储值）
- [ ] 任务状态机、API 契约、存储键零改动（`git diff` 只涉及 UI 文件 + 新增文件）
- [ ] E2E 93/93、单测全绿、build-smoke 18/18、pipeline 461 OK
- [ ] 真机未测项标 **NOT_TESTED**
