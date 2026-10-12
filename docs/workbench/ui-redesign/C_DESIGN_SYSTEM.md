# C. 统一设计规范

> 原则：**复用现有 `tokens/*.css`，只做移动端补齐与规范化。** 不引入第二套色板/字体。
> 新增令牌以 `--gg-*` 前缀集中在一个新文件 `tokens/mobile.css`，避免污染既有语义别名。

## C1. 品牌与色板（保留，不改）

现有已足够且专业，**继续沿用**：indigo `#5B47E0`（主）/ mint `#00C28E`（次·完成）/ 冷调 slate 中性。
`tokens/colors.css` 的基色与语义别名保持不动。

### C1.1 必须补充的语义令牌（补 `tokens/colors.css`）

现状问题：成功/警告的**文字色**在 token 里没有别名，导致 14 个文件各自硬编码 `#047857` / `#9A6300`（见 A6.1）。
补三个"墨水色"（保证小字 4.5:1 对比）：

```css
:root {
  --success-ink: #046A4A;   /* 替代 #047857，用于小字 */
  --warning-ink: #8A5600;   /* 替代 #9A6300 */
  --info-ink:    #3F31A8;   /* 替代 #1D4ED8 */

  --success-soft: var(--mint-50);   /* 已有，保留 */
  --warning-soft: #FFF6E6;          /* 已有，保留 */
  --danger-soft:  #FFECEC;          /* 已有，保留 */

  /* 状态/来源标记专用（统一 DEMO 与真实） */
  --demo-bg: #FFF4D6;  --demo-ink: #8A5600;  --demo-border: #F0D9A0;
  --real-bg: #E6FBF5;  --real-ink: #046A4A;  --real-border: #A7E6D2;
}
```

### C1.2 DEMO / 真实 数据标记规范（硬约束：视觉必须可辨）

| 类型 | 底色/文字 | 形态 | 文案 |
|---|---|---|---|
| 真实检索 | `--real-bg` / `--real-ink` | 徽章（右上角） | `真实来源` |
| 演示数据 | `--demo-bg` / `--demo-ink` | 徽章 + 卡片左侧 3px 竖条 | `演示数据` |
| 混合 | `--brand-soft` / `--brand` | 徽章 | `含演示内容` |

规则：**徽章必须在卡片可见区内、字号 ≥ 11px、不可仅靠颜色**（必须带文字）。
现有 `ProviderBadge`（`components/atoms.jsx:143`）的英文 `DEMO DATA / REAL SEARCH` 改为上述中文。
数据来源徽章在**列表项与详情首屏都出现**，不只详情页。

## C2. 字体与排版（中文优先，重点修正）

现状：`Noto Sans SC` 从 Google Fonts CDN 引入（`tokens/fonts.css:9`）——**APK 离线时失效**。

### C2.1 字体策略（P0）

1. 中文改用**系统字体优先**：`PingFang SC`(iOS) / `Source Han Sans`·`Noto Sans CJK SC`·`Microsoft YaHei`(Android/Windows)，
   避免 CDN 依赖；拉丁字母继续用品牌字体（可选打包 woff2 子集，体积可控）。
2. 若坚持品牌中文，必须**自托管 woff2 子集**并声明 `font-display: swap` + 系统回退栈。

```css
:root {
  /* 中文优先栈：先系统中文，再品牌拉丁 */
  --font-cjk: "PingFang SC", "HarmonyOS Sans SC", "Noto Sans CJK SC",
              "Source Han Sans SC", "Microsoft YaHei", system-ui, sans-serif;
  --font-ui:  var(--font-cjk);          /* 中文界面用这套 */
  --font-num: "Space Grotesk", var(--font-cjk);  /* 数字/时间/金额 */
}
```

### C2.2 中文排版规则（新增）

| 项 | 规则 | 现状问题 |
|---|---|---|
| 正文行高 | 中文 `1.7`（现用 1.5 偏紧） | `tokens/base.css:12` |
| 中文加粗 | 用 `600/700`，避免 `800` 在系统中文字重缺失时跳变 | — |
| 字距 | 中文标题 `0`（现 `-0.02em` 会让中文挤） | `WorkbenchHome.jsx:86` |
| 数字 | 时间/数量/金额统一 `.tnum`（已有工具类） | 部分已用，部分未用 |
| 最小字号 | 正文 ≥ **14px**，次要 ≥ **12px**（现 11-11.5px 过多） | `WorkbenchHome.jsx:182,269,307` |

### C2.3 移动端字阶（收敛为 6 级）

| 令牌 | 字号/行高 | 用途 |
|---|---|---|
| `--t-display` | 24 / 32 | 页面主标题 |
| `--t-title` | 18 / 26 | 卡片标题、区块标题 |
| `--t-body` | 15 / 25 | 正文、列表主行 |
| `--t-label` | 13 / 20 | 次级说明、标签 |
| `--t-meta` | 12 / 18 | 时间、来源、辅助信息 |
| `--t-num` | 随上下文 + tabular | 数字/时间 |

## C3. 间距与布局

- **4px 网格**（沿用 `tokens/spacing.css`）。移动端常用档位收敛为 `8 / 12 / 16 / 20 / 24`。
- 页面水平内边距统一 **16px**（替代现有混用 16/20/24）。
- 区块之间 **24px**；区块标题与内容 **8px**；卡片内边距 **14px 16px**。
- **点击热区**：整行可点列表项 **≥ 56px 高**；独立按钮 **≥ 48px**；图标按钮热区 **≥ 48×48**（视觉可 24px，用 padding 撑）。
- 底部导航高度 **56px + 安全区**；页面底部预留 **安全区 + 72px** 防遮挡。

## C4. 圆角 · 阴影 · 描边（统一规则，消除 A6.3）

| 层级 | 圆角 | 阴影 | 用法 |
|---|---|---|---|
| 页面级卡片 | `--radius-lg` 20 | `--shadow-sm` | 列表项、内容卡 |
| 内嵌块 | `--radius-md` 14 | 无 | 卡片内的子块、输入框 |
| 强调卡（首页输入） | `--radius-xl` 28 | `--shadow-md` | **全站唯一一处**大圆角强调 |
| 徽章 / chip | `--radius-pill` | 无 | 状态、筛选 |
| 弹层 | 上圆角 20 | `--shadow-xl` | 底部抽屉/弹层 |

规则：**同一屏内圆角不超过 2 种**；描边一律 `1px solid var(--border-subtle)`，不用第二档灰色。

## C5. 图标

- 统一用现有 `Icon` 组件（lucide），**尺寸固定 4 档**：`16 / 20 / 24 / 28`。
- 图标 + 文字并排时 gap `6px`；纯图标按钮必须有 `aria-label`。
- 状态图标必须有**形状差异**（勾/警告/叉），不依赖颜色（解决 A5.8）。

## C6. 交互状态（每个可交互元素必须齐备 7 态）

| 状态 | 视觉规范 | 现状缺口 |
|---|---|---|
| 默认 | 见组件规范 | — |
| 按下 pressed | 缩放 0.97 + 底色加深（`--bg-sunken`），120ms | **缺**（`div onClick` 无反馈） |
| 聚焦 focus | `2px` 外描边 `--focus-ring` | 部分缺 |
| 禁用 disabled | 透明度 0.45 + `cursor:default` | 部分缺 |
| 加载 loading | 按钮内左侧 16px spinner + 文案改「处理中…」，禁用点击 | **大面积缺**（A5.2） |
| 成功 | Toast（已有）+ 元素内联确认文案 2s | 部分缺 |
| 错误 | 内联红字（`--danger`）+ 可重试操作；**禁止显示 HTTP/日志** | 缺（A4.4） |

**加载反馈规范**：任何 >400ms 的操作必须有可见反馈；>2s 显示进度步骤；不允许"点了没反应"。

## C7. 组件规范（本次需要新增/升级的 6 个）

| 组件 | 规格 | 替换对象 |
|---|---|---|
| `ListRow` 列表行 | 56dp 高，左图标 20，主标题 15/600，副行 12/`--text-muted`，右 chevron 或状态；整行 button | 各屏 `<div onClick>` |
| `Chip` 筛选片 | 高 **40px**（含 8px 纵向 padding），圆角 pill，选中态 = 实心 brand + 勾选图标（非纯色） | `.gg-chip`(29px) |
| `PrimaryAction` 主操作 | 底部固定条，高 **52px**，圆角 16，含 loading 态 | 散落的 `size="sm"` |
| `StatusBadge` 状态徽章 | 高 24，字号 12/700，7 态映射 + 图标 | 各处内联徽章 |
| `ResultSummary` 结果摘要 | 结论句（15/600）+ 条目卡；原始 JSON 折叠 | 已有（`result-summary.js`），仅排版升级 |
| `EmptyState` 空状态 | 图标 + 标题(15/600) + 说明(13) + 1 个主操作 | 各屏纯文字说明 |

## C8. 动效

- 时长：`fast 120ms`（按下/开关）、`base 200ms`（页面/抽屉）、`slow 360ms`（覆盖层）。
- 缓动：沿用 `--ease-out`；页面进入用 slide-up 12px + fade。
- **尊重 `prefers-reduced-motion`**：关闭位移，仅保留透明度。
- 列表首次加载用骨架屏（skeleton），不用空白。

## C9. 文案规范（中文优先）

1. 面向结果，不面向实现：「开始执行」而不是「进入 running」；「上次失败，原因：网络」而不是 `HTTP 500`。
2. 禁止在用户界面出现：存储键、schema、HTTP 状态码、JSON、`token`、`provider`、`mode`、`engine`、`pipeline`。
3. 按钮用动词开头：「加入行动」「安排时间」「开始执行」「记一笔」「保存结果」。
4. 空状态必须给出下一步：「还没有任务 → 在上方输入一个目标开始」。
5. 技术信息保留在「技术详情 / 关于与诊断」，用普通中文解释（「原始数据」而非 `raw JSON`）。
