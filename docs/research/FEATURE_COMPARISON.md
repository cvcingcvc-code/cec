# 功能对比：HackerTrip × Gorgon（FEATURE_COMPARISON.md）

> 2026-10-23。基于 HACKERTRIP_STUDY.md 的观察与 Gorgon 仓库代码事实（基线 `feat/one-shot-agent-experience-v1` @ 7699b4a）。
> 标注体系：✅ REAL（代码实现且有测试）/ ◐ PARTIAL（有骨架有缺口）/ ⬜ NOT_IMPLEMENTED / 📦 DEMO（演示数据，诚实徽标）/ BLOCKED。

## 1. 总体定位对比

| 维度 | HackerTrip | Gorgon（本任务后） |
|---|---|---|
| 定位 | 黑客松聚合平台（三方撮合：选手×主办方×平台） | 个人 AI 行动工作台（活动发现→行动闭环，单用户视角） |
| 载体 | 微信小程序 + 官网 + CLI + 桌面 | Android APK（Capacitor）+ Web（Vite）+ 桌面壳 |
| 数据 | 主办方提交 + 平台审核（人工） | 公开网页聚合 + 增量采集 + 去重 + 人工审核 |
| AI | 匹配分 + 赛道建议 + Pitch 准备 | 项目匹配 + 排序理由 + 准备清单（本轮新增） |
| 报名 | 站内报名 + 站外链接（utm 追踪） | 站外官方链接 + **显式 6 态报名状态机** |

## 2. 逐功能对比

### 2.1 活动发现

| 能力 | HackerTrip | Gorgon 现状 | 差距 → 本轮动作 |
|---|---|---|---|
| 发现首页 | 编辑精选 + 即将开始/往届双 Tab + 卡流 | ✅ DiscoverScreen（分类 Rail + 卡流 + DEMO 徽标） | 无发现页级缺 — 保留 Gorgon 布局 |
| 分类/主题 | 形式筛选（线上/线下/混合） | ✅ categories.js + CategoryRail | 增黑客松/AI 活动类别 |
| 城市/形式 | 城市 + 形式徽标 | ◐ district.js（上海区县）+ city 字段已有 | 增城市筛选 + 线上/线下筛选 |
| 排序 | 截止优先 | ◐ trustScore/时间排序已有 | 增「截止优先」排序 |
| 状态区分 | 进行中/报名已截止/X天后开始 | ◐ status 字段存在，UI 徽标部分 | 增统一状态徽标 + 倒计时 |
| 数据真实性 | 主办方提交+审核 | 📦 DEMO 数据（17 条 demo:true）+ 豆瓣真实 16 条（stash 中） | 增真实黑客松数据源 + 来源可信度 |

### 2.2 活动详情

| 能力 | HackerTrip | Gorgon 现状 | 差距 → 本轮动作 |
|---|---|---|---|
| 结构化字段卡 | 报名截止/时间/城市/形式/奖金池/赛题/团队规模 | ◐ activity-view.js 归一化：venue/price/agenda/trustScore/registrationUrl 已有；**奖金/参赛条件/截止时间字段缺** | 增 prize/eligibility/registrationDeadline 字段 + 详情卡展示 |
| 报名截止倒计时 | ✅ 天/时倒计时 | ⬜ 无 | 新增 |
| 主办方信息 | ✅ | ✅ organizer 字段已有 | 对齐展示 |
| 赛程时间线 | ✅ 3 节点 | ◐ agenda[] 字段已有 | 对齐展示 |

### 2.3 搜索与筛选

| 能力 | HackerTrip | Gorgon 现状 | 差距 → 本轮动作 |
|---|---|---|---|
| 自然语言检索 | ⬜（CLI match 按技术栈） | ✅ /api/search 自然语言 + searchActivities 客户端 | 保持 |
| 结构化筛选 | ✅ 形式/排序 | ◐ 区县筛选 + 分类筛选 | 增城市/形式/时间窗/奖金筛选 |
| AI 匹配 | ✅ 项目画像→Top5 匹配分→赛道→路径 | ⬜ NOT_IMPLEMENTED | **新增 matchModule**（诚实标注） |

### 2.4 收藏与订阅

| 能力 | HackerTrip | Gorgon 现状 | 差距 → 本轮动作 |
|---|---|---|---|
| 收藏 | ✅ 订阅制 | ✅ gorgon_favorites + 加入我的周末 | 保持 |
| 提醒 | ✅ 开赛/截止提醒 | ◐ remindAt 字段 + reminder_changed 事件已有；native-reminders.js 已实现（LocalNotifications） | 对接提醒入口 |
| 身份卡 | ✅ | ⬜ 不做（超范围，进路线图） | — |

### 2.5 报名

| 能力 | HackerTrip | Gorgon 现状 | 差距 → 本轮动作 |
|---|---|---|---|
| 报名入口 | 站内表单 + 站外链接（utm） | ✅ registrationUrl 外链 + markRegistrationOpened | 保持站外模式 |
| 报名状态 | 站内：已报名（提交后）；站外无追踪 | ✅ **6 态状态机**：none/opened_registration/in_progress/registered/failed/cancelled + 「打开报名页≠报名」诚实规则 | **Gorgon 更严格，保持**；UI 强化状态显示 |
| 报名结果记录 | ⬜ 站外模式不记录 | ◐ registered 需用户显式确认 | 增报名结果记录入口 |

### 2.6 参赛准备

| 能力 | HackerTrip | Gorgon 现状 | 差距 → 本轮动作 |
|---|---|---|---|
| 材料清单 | ✅ Haki 自动推断 | ✅ defaultPrepFor(view) + setPrep 已有 | 保持 + AI 匹配生成准备清单 |
| 倒计时提醒 | ✅ | ◐ remindAt 已有 | 对接 |
| 过程留痕 | ✅ token/commit 计量 | ◐ AgentScreen + agent-runs-mirror 已有（电脑执行记录） | 不扩大范围 |

### 2.7 主办方提交

| 能力 | HackerTrip | Gorgon 现状 | 差距 → 本轮动作 |
|---|---|---|---|
| 主办方后台 | ✅ 提交+审核+数据报告 | ⬜ 不做（任务书明确：不为组队/社区/主办方后台延迟 V1） | 进路线图 |

### 2.8 项目关联

| 能力 | HackerTrip | Gorgon 现状 | 差距 → 本轮动作 |
|---|---|---|---|
| 项目↔活动 | ✅ 作品挂赛事 | ✅ linkActivityToProject + createProjectFromActivity + getProjectBundle 聚合 | 保持 |

## 3. Gorgon 已有且比 HackerTrip 更好的（保持，勿重造）

1. **报名状态机**：6 态显式记录 + 「打开报名页≠报名成功」诚实规则（opportunity-repository.js）——HackerTrip 站外报名无状态追踪
2. **信息可信度体系**：trustScore 0-100 可解释评分 + trustReasons + 已确认/待核验/存在冲突三级 UI——HackerTrip 无公开可信度标注
3. **DEMO 诚实徽标**：demo:true 记录 + UI 角标区分——绝不把演示数据当真实数据
4. **人工审核路由**：review/queue.py 按分数路由 approved/needs_review——与 HackerTrip 平台审核理念一致但更自动化
5. **任务行动闭环**：活动→任务→日程→提醒→复盘全链路——HackerTrip 只到报名为止

## 4. Gorgon 缺口（本轮 V1 实现）

| # | 缺口 | 实现方式 |
|---|---|---|
| G1 | 黑客松/AI 活动类别 + 真实数据 | 扩展 activities 数据（黑客松记录，真实来源+可信链接），增 category |
| G2 | 城市/线上线下/时间窗/截止筛选 | DiscoverScreen 筛选条扩展 + activity-view 过滤函数 |
| G3 | 奖金/参赛条件/报名截止字段 | activity schema 增 prize/eligibility/registrationDeadline（additive） |
| G4 | 报名截止倒计时 | 详情页 + 卡片倒计时组件 |
| G5 | AI 匹配模块 | matchModule：项目简介→技术栈提取→赛事要求比对→Top N 排序理由+不匹配因素+准备清单 |
| G6 | 我的活动列表强化 | UserActivitiesScreen：报名状态显式记录 + 状态徽标 |
| G7 | 行动闭环接线 | 发现→详情→AI 匹配→收藏→创建任务→提醒→报名状态记录 全链路 |

## 5. 明确不做（进路线图，不在本轮）

组队匹配 / 社区 / 主办方后台 / 赛事直播 / 获奖作品墙 / 认证履历 / 身份卡 / 小程序。
