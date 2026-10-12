# V2.2 低风险 UI 优化 — 改造前后对比证据

> 采集设备：Android 模拟器 `gorgon_test`（1080×2400，密度 **420dpi** → 1dp = 2.625px）
> 采集方式：`adb install` + `adb exec-out screencap` + `adb exec-out uiautomator dump`（读取真实控件 bounds）
> 受控启动 ×1（冷启动），采集完成后 `adb emu kill` 关闭。**无物理真机 → 真机项 NOT_TESTED**。

## APK 对照

| 版本 | SHA256 | 说明 |
|---|---|---|
| BEFORE | `ebe4ca74bb921d579ab6c775bc5834e06832231aae1746bb83dd45725bdc648b` | 改造前（HEAD `9f05f9d` 的构建产物，备份为 `BEFORE-app-release.apk`） |
| AFTER | `6427dfd1fe0ff7916d453dafda43a47c835915d3387b5994446541fb348445fe` | 本次 UI 优化后重建 |

## 证据文件

| 文件 | 内容 |
|---|---|
| `BEFORE-app-release.apk` | 改造前 APK 备份（可复装核对） |
| `BEFORE-01-home.png` / `BEFORE-02-settings.png` | 改造前首页 / 设置页截图 |
| `BEFORE-home-ui.xml` / `BEFORE-settings-ui.xml` | 改造前控件层级（含 bounds） |
| `AFTER-01-home.png` | 改造后首页 |
| `AFTER-02-settings.png` | 改造后设置页 |
| `AFTER-03-tasks.png` | 改造后任务列表（新建任务流程） |
| `AFTER-04-task-detail.png` / `AFTER-05-detail-scrolled.png` | 改造后任务详情（上下屏） |
| `AFTER-home-ui.xml` / `AFTER-settings-ui.xml` / `AFTER-detail-ui.xml` / `AFTER-detail-ui-scrolled.xml` | 改造后控件层级（含 bounds） |

## 1. 触控尺寸实测（uiautomator bounds ÷ 2.625）

### 任务详情页（AFTER）

| 控件 | 实测 (dp) | 改造前依据 | 判定 |
|---|---|---|---|
| 运行任务 | 125.0 × **45.0** | Button md = 44 | PASS |
| 保存排期 | 87.2 × **45.7** | Button **sm = 36**（A2.1） | PASS（+9.7dp） |
| 返回任务列表 | 106.7 × **45.0** | `padding: 0`（A2.5） | PASS（+~25dp） |
| 进入规划 / 准备就绪 / 标记失败 | 80-81 × **46.1** | `padding: 8px 13px` ≈ 34（A2.6） | PASS（+12dp） |
| 添加步骤 / 添加来源 / 保存结果 | 103.2 × **45.0-46.1** | `padding` 8-10px ≈ 36 | PASS |
| 记一笔 | 88.0 × **45.0** | Button md = 44 | PASS |

> 说明：`文字节点` 的 bounds 在 uiautomator 中可能返回 0（元素在视口外）；上表为滚动到可见后实测值。

### 任务列表页（AFTER）

| 控件 | 实测 (dp) | 改造前 | 判定 |
|---|---|---|---|
| 添加 | ~96 × **45.0** | Button md = 44 | PASS |

### 结论

**所有被抽检的可点控件高度 ≥ 45dp**，达到 Android 推荐触控下限（44dp 最低 / 48dp 推荐）。

## 2. 文案中文化对照（设置页，可见文本）

| 项 | BEFORE | AFTER |
|---|---|---|
| 应用 | `Gorgon Workbench（戈尔贡智能工作台）` | `Gorgon 智能工作台` |
| 版本 | `Phase 3 · Task Router + Skills` | `2.2.0` |
| 任务引擎 | `本地引擎 / 就绪（本地状态机 + 执行引擎）` | `本地引擎 / 就绪` |
| 任务路由 | `规则确定（关键词规则，零模型）` | `规则确定（关键词匹配，不依赖模型）` |
| 持久化 | `LocalStorage（gorgon_workbench_tasks_v2）` | **`数据保存：保存在本机，不会上传`** |
| Schema Version | `Schema Version / 2` | **`数据结构版本 / 2`** |
| 搜索后端 | `已接入 /api 同源代理（…）` | `已连接（演示模式可用时自动连接）` |
| 运行模式 | `本地演示（浏览器内运行，无后端任务引擎）` | `本机运行（无需后台服务）` |
| 页脚 | `任务数据保存在浏览器 LocalStorage 中（schema v2）。Phase 1 的旧任务…` | `任务数据保存在本机，不会上传；旧版本创建的任务…` |

**E2E 必需文案保持**（实测仍在页面中）：
- `本地引擎 / 就绪` ✅（`e2e_workbench_shell.mjs:402`）
- `未配置（后续阶段提供）` ✅（`:398-399`，含子串「未配置」，且首字符为「未」以满足 `workbench-setting-not-ready` 的 testid 判定）

## 3. 首页输入提示（软键盘/输入交互）

| 项 | BEFORE | AFTER |
|---|---|---|
| 输入提示 | `Enter 提交 · Shift + Enter 换行`（桌面键盘术语） | `点这里输入 · 回车即可开始`（移动端） |
| 整卡可点聚焦 | 点标题/内边距**无反应**（不弹软键盘） | 点击卡片任意位置聚焦 textarea |
| Android 键盘动作键 | 未声明 | `enterKeyHint="send"`，键盘显示「发送」 |

## 4. 其他已在代码层修复但本页未逐屏截图

| 项 | 位置 | 说明 |
|---|---|---|
| `.gg-chip` 29px → **min-height 40px** | `ui_kits/app/responsive.css` | 分类/地区/筛选 chip |
| 卡片按下反馈 `:active` | `responsive.css`（`.gg-disc-card` / `.gg-pressable`） | 触屏无 hover |
| 检索结果排序 | `responsive.css`（`.gg-smart-aside`） | 移动端内部面板从结果**之前**移到**之后** |
| 准备清单勾选框 18×18 → **44×44 热区**（视觉保持 20） | `ProjectDetailScreen.jsx` | 并补 `role="checkbox"` / `aria-checked` |
| 演示徽章英文 → 中文 | `atoms.jsx`、`TaskDetailScreen.jsx`、`ReviewCenterScreen.jsx` | `DEMO DATA`→`演示数据`、`REAL SEARCH`→`真实来源`、`DEMO / PREVIEW`→`演示 / 预览`（testid 未动） |
| 审核中心原始 JSON → 中文摘要 | `ReviewCenterScreen.jsx` | `payloadSummary()` |
| 检索失败 `HTTP 500` + 日志 → 中文可重试提示 | `NaturalSearchScreen.jsx` | — |
| ICS 导出静默失败 → 内联反馈 | `ActivityDetailScreen.jsx` | 原先 `catch(e){}` |
| 地图定位死控件 → `disabled` + 说明 | `MapScreen.jsx` | 原先无 `onClick` 却可点外观 |
| 中文字体离线回退 | `tokens/fonts.css` + `tokens/typography.css` | 系统中文栈优先，APK 离线不再掉字体 |
