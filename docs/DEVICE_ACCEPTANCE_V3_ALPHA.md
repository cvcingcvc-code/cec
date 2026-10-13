# Gorgon Workbench V3 ALPHA — 真机验收清单（DEVICE_ACCEPTANCE_V3_ALPHA）

> 状态：**APK 已构建，等待真机验证**（全部门禁在真机上执行，不假装通过）。
> 构建日期：2026-10-13。APK：v6.0（versionCode 6）。

## 0. 安装包

| 变体 | 文件 | SHA256 |
|---|---|---|
| debug（日常自用推荐，无需签名校验） | `release/Gorgon-Workbench-Android-v6.0.0-debug.apk` | `ca4f2c3e8d46d1b4e869d97a34b7c3433df87a3a742b90293026bae0e5c15b47` |
| release（签名构建；keystore.properties 缺失时回退 debug 签名） | `release/Gorgon-Workbench-Android-v6.0.0-release.apk` | `2894e215c6d021c7de76a05b46107eda6c72b959d63421cfc33e3f60f55e8f29` |

安装：把 APK 传到手机（微信文件传输助手/USB/网盘均可），点击安装（允许未知来源）。

## 1. 本轮新增功能验收

### A. 本地提醒（V3 Phase A 缺口 1）

| # | 步骤 | 通过标准 | 结果 |
|---|---|---|---|
| R1 | 打开一个任务 → 详情页 | 出现「本地提醒」卡片，显示「提醒时间：未设置」 | ☐ |
| R2 | 点击「提醒时间」 | 弹出日期时间选择器（DatePickerSheet） | ☐ |
| R3 | 选择未来时间（如 2 分钟后）确认 | toast「提醒已保存」；卡片显示所选时间 | ☐ |
| R4 | 首次设置提醒 | 系统弹出通知授权对话框 → 点允许 | ☐ |
| R5 | 等到提醒时间（手机息屏） | 收到系统通知：标题=任务名 | ☐ |
| R6 | 点快捷预设「30分钟后」 | toast 确认；卡片显示新时间 | ☐ |
| R7 | 点「清除提醒」 | toast「提醒已清除」；卡片回到「未设置」 | ☐ |
| R8 | 设置过去时间的提醒 | toast「提醒已保存（时间已过，不再通知）」 | ☐ |
| R9 | 杀掉 App 重开 | 提醒设置仍在（remindAt 持久化） | ☐ |

### B. 笔记导入（V3 Phase A 缺口 2）

| # | 步骤 | 通过标准 | 结果 |
|---|---|---|---|
| N1 | 笔记页 → 右上角「导入」按钮 | 弹出系统文件选择器 | ☐ |
| N2 | 选一个 .txt 文件 | toast「已导入 1 条笔记（未覆盖任何已有数据）」；列表出现新笔记 | ☐ |
| N3 | 选一个 .md 文件 | 同上；笔记内容与文件原文一致 | ☐ |
| N4 | 选一个 .pdf 文件 | toast「仅支持 .txt / .md 文件」（拒绝） | ☐ |
| N5 | 重复导入同一文件 | 导入两条（追加，不覆盖、不去重——数据安全优先） | ☐ |
| N6 | 导入后杀掉 App 重开 | 导入的笔记仍在（Preferences 镜像持久化） | ☐ |

### C. 智能体网关（V3 Phase A Task #3/E）

前置：电脑端启动 `node scripts/agent-gateway.mjs --port 8765 --lan`（首次启动生成 token，控制台打印位置：`scripts/.agent-gateway/token.json`）。手机与电脑同一 Wi-Fi。

| # | 步骤 | 通过标准 | 结果 |
|---|---|---|---|
| G1 | 智能体页 → 输入电脑 LAN IP + 端口 + token → 连接 | 显示「已连接 · 3 个执行器」 | ☐ |
| G2 | token 故意填错 → 连接 | 显示「连接失败：token 不正确」 | ☐ |
| G3 | 选 host.stats → 提交执行 | 记录出现，状态从执行中变已完成 | ☐ |
| G4 | 点「查看结果」 | 显示本机概览 JSON（平台/CPU/内存） | ☐ |
| G5 | 提交 repo.status → 查看结果 | 显示 git 分支与脏文件列表 | ☐ |
| G6 | 提交 repo.readDoc（path=readme.md） | 显示文档内容前 20000 字符 | ☐ |
| G7 | 提交 repo.readDoc（path=../etc/passwd） | 结果显示「失败：path not allowed」 | ☐ |
| G8 | 提交一个执行中的任务 → 点取消 | 状态变已取消 | ☐ |
| G9 | 电脑端 Ctrl+C 停止网关 → 手机刷新 | 显示连接失败（如实报错） | ☐ |

### D. 回归确认（旧功能不被破坏）

| # | 步骤 | 通过标准 | 结果 |
|---|---|---|---|
| D1 | 新建任务 → 状态推进（准备就绪→开始执行→完成） | 与 v5 一致 | ☐ |
| D2 | 设置截止时间 + 排期 | 与 v5 一致 | ☐ |
| D3 | 笔记 CRUD + 搜索 + 导出 | 与 v5 一致 | ☐ |
| D4 | 日程周视图 + 月历 | 与 v5 一致 | ☐ |
| D5 | 杀 App 重开 | 全部数据保留 | ☐ |

## 2. 已知问题（诚实记录）

1. **电脑端网关默认 localhost-only**：手机访问必须 `--lan` 启动并手动输入电脑 LAN IP；首次配对为手动复制 token（设计文档中的配对码机制属后续阶段）。
2. **提醒在 App 被杀后是否触发依赖 Android 厂商**：部分厂商（小米/华为等）会杀死后台应用阻止通知；若 R5 失败，检查电池优化白名单。
3. **repo.readDoc 只允许 docs/*.md 与 readme.md**：其他路径如实拒绝（白名单纪律）。
4. **执行器仅 3 个只读任务**：Codex/WorkBuddy Adapter 未开发（其真实接口未核实，不宣称）。
5. **release APK 当前为 debug 签名回退**（若 keystore.properties 未配置）；安装时 Android 可能提示未知签名。

## 3. 验收结论模板（真机执行后填写）

- 状态：DEVICE_PASS / DEVICE_FAIL / PARTIAL
- 通过项：R_ N_ G_ D_
- 失败项与现象：
- 环境备注（手机型号/Android 版本/厂商系统）：
