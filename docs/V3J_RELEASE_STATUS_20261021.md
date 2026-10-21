# Gorgon Workbench — V3J 发布状态与 V3K 接续（2026-10-21）

> 本文是截至 2026-10-21 的增量状态记录，**不重写历史冻结报告**。参考 `reports/V3J_DEVICE_FIX_REPORT.md` 与 GitHub Release、Issue #1。

## 真实发布基线

- 源修复分支：`feat/v3j-device-fix`，HEAD `54c5c58b6be9ef65fbc49a44b0bb4c6bcd454a96`。
- 最新 Release：[`v0.3.8-alpha`](https://github.com/cvcingcvc-code/cec/releases/tag/v0.3.8-alpha)，2026-10-16 发布；Android versionCode 13 / versionName 6.0.8。
- APK：`gorgon-workbench-v0.3.8-alpha.apk`；文件 SHA256 `cf9fa707c2fde75c9c94f88133959d1f4c12b319048b5b15f56b0443690f2422`。
- 证书 SHA-256：`45b442368c7e270c5e564c704d13f23b526975329fae6b28a9bf828c70f47167`（与文件校验哈希是两种不同值）。
- 历史构建/自动化结果（来自 V3J 报告，不代表本文件重新运行）：pipeline 480 OK、app 591 pass/0 fail、E2E 33 checks pass。
- 修复：P0 截止时间崩溃 + 时区；P1 笔记创建；P1 搜索海报加载/错误回退；P1 真坐标点位 + 外部导航。
- 以上四项 **DEVICE_NOT_TESTED**，没有收到物理安卓手机的 PASS 证据时，不得改为 DONE。
- Issue [#1](https://github.com/cvcingcvc-code/cec/issues/1) 仍 OPEN，原评论主要描述旧包；V3J 验收需增量补充，不覆盖历史。
- 默认分支仍为 `feature/gorgon-opportunity-v2`，修复分支尚未合入默认分支。不要从默认分支直接展开 V3K UI 实施，以免丢失 V3J 修复。

## V3K UI 改版决策

- **本阶段产物是设计参考与 Codex 实施任务书，不是 UI 代码已替换，不是新 APK 发布。**
- 设计分支：`docs/v3k-mobile-ui-blueprint`（从 V3J 修复分支创建）。
- [四屏视觉参考图](ui/V3K_MOBILE_REFERENCE.svg)
- [设计规范 / 页面清单](ui/V3K_UI_REDESIGN_BRIEF.md)
- [交给 Codex 的实施任务书](ui/CODEX_V3K_TASK.md)

## 发布前必须完成

1. 在物理 Android 手机上安装 v0.3.8，验证截止时间/笔记/搜索海报/地图导航；以 PASS/FAIL/NOT_TESTED 记录 Issue #1。
2. V3K 先做独立开发分支与截图对比，不直接改 V3J 已发布 APK；保留旧版及数据。
3. 全量自动化 + Android 真机操作通过后，决定是否升级版本与发布。
4. 地图当前为自绘真实坐标点位，**不是完整高德 SDK 底图**；不要在 UI 样稿或文案中冒充现成的可拖拽地图。
5. pipeline 重跑若重复 ingest 生成 douban 文件，必须验证幂等；不可依赖手删 untracked 文件充当根因修复。
