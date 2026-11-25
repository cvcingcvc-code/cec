# V3I 交付报告 — v0.3.7-alpha（2026-10-15）

> 本报告为 V3I 交付轮（保存、同步、验证、打包、发布）的实际执行记录。所有数字为本轮实测所得，非继承历史报告。

## 1. 最终状态

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/cvcingcvc-code/cec |
| 开发分支 | `feat/v3i-android-full-delivery`（worktree F:/Gorgon-Parallel/v3i） |
| 最新提交 | 见 §2（功能提交 2b7f6ea + 本轮 versionCode bump + 本报告） |
| APK 版本 | **v0.3.7-alpha**（versionCode **12** / versionName **6.0.7**） |
| GitHub Release | v0.3.7-alpha（Alpha 测试版） |
| 历史版本 | v0.3.0 ~ v0.3.6 全部保留，未删除、未覆盖 |

## 2. 开发现场核对（开始前实测）

- 9 个 worktree 全部存在：Gorgon-Recovered（human-review-loop）、Gorgon-Travel-Agent-V1、Gorgon-Workbench（feature/gorgon-opportunity-v2，有他人未提交改动，**本轮未触碰**）、F:/Gorgon-Parallel/{android, functional, gateway, reviewer, v3g, v3i}。
- `feat/v3i-android-full-delivery` @ `2b7f6ea`（feat(v3i): interview prep checklist + numbered todo extraction），与远端完全一致（0 ahead / 0 behind），工作树除临时文件外 clean。
- **V3H 完成情况核对**：场景 A 路由修复（5aa5579）+ versionCode 11（62eab43）+ 最终交付报告（804e895）均已入库并推送；v0.3.6-alpha Release 为 Latest，APK SHA256 `726d8d58…` 回验一致，下载 6 次。
- **V3I 完成情况核对**：场景 A 清单生成（extract-skill 面试场景规则模板，5 条具体准备项）+ 场景 C 编号待办识别（1. / 2、 / 3）+ 9 个新测试，已在 2b7f6ea 提交。
- 其他分支未推送提交检查：仅 `feat/v3e-functional-closure` 本地领先 7 commits，**逐个核对全部已通过 v3g→v3i 链路进入远端**（merge-base --is-ancestor 全部为真），无需补推。

## 3. 本轮测试（实测，提交 2b7f6ea）

| 套件 | 结果 |
|---|---|
| V3I 核心单测（skills + result-summary） | **40/40 PASS** |
| Node 全量（`CODEBUDDY_SAFE_DELETE_ENABLED=0 npm test`） | **580 项：579 pass / 1 SKIP / 0 FAIL**（SKIP = Codex 真实调用 P1，设计如此） |
| Python pipeline（`unittest discover -s pipeline -t .`） | **472 tests OK（1 skip）** |
| 构建冒烟 `npm run test:build` | **18/18 PASS**（含 no secret pattern、无服务端路径、无绝对路径） |
| Vite 生产构建 | PASS（chunk >500kB 警告为既有情况） |
| Gradle assembleRelease | **BUILD SUCCESSFUL**（4m34s，246 tasks） |

### 测试副作用记录（已恢复，非代码缺陷）

- Python 测试会把 `pipeline/data/approved/activities.json` 等 9 个数据文件重写为 demo 种子（DEMO_DATA: true, 3 条）。已 `git checkout --` 恢复到 HEAD 的 33 条真实版本（DEMO_DATA: true 显式布尔 + count 33）。**后续跑 Python 测试后需重新恢复。**
- 构建环境修复（非代码问题）：旧 `D:/gorgon-android-toolchain/gradle-home` 的 native-platform.dll 锁文件损坏导致 `Could not initialize native services`，改用全新 GRADLE_USER_HOME（`C:/Users/lin/Documents/Gorgon-Workbench/.gradle-home-v3i`）后正常；SDK 路径写入 `app/android/local.properties`（gitignored）。

## 4. APK 构建与安全检查

| 项 | 值 |
|---|---|
| 构建来源 | `feat/v3i-android-full-delivery` @ versionCode 12（含 2b7f6ea 全部 V3I 功能） |
| versionCode | **12**（> 11，不覆盖历史；可直接覆盖安装 v0.3.3 ~ v0.3.6） |
| versionName | 6.0.7 |
| applicationId | `cn.gorgon.workbench` |
| 签名 | 原有正式 `gorgon-release.keystore`，cert SHA-256 `45b442368c7e270c5e564c704d13f23b526975329fae6b28a9bf828c70f47167`（与历史版本完全一致） |
| 签名 scheme | v2 scheme verified（与历史版本一致）→ 覆盖升级保留本地数据 |
| APK SHA256 | `98d09c3d0ecfe6cbe18deabe34b026bc50ca17f1be8215224100228a345ade22` |
| 敏感扫描 | test:build 18/18 含密钥模式检查，PASS；无 SEARCH_API_KEY 进 bundle |
| Capacitor 插件 | filesystem 8.1.4 / local-notifications 8.3.1 / preferences 8.0.1（cap sync 正常） |

## 5. 本次 APK 包含的 V3I 功能

1. **场景 A（面试准备）闭环**：`明天下午我要去面试，帮我整理准备事项` → 引擎抽出「明天」→ 自动附「面试准备清单」5 条具体准备项（简历 / 公司研究 / 常见问题回答思路 / 向面试官提问 / 时间地点着装与路程）→ 一键保存为可编辑待办。
2. **场景 C（任务清单）增强**：编号行（`1.` `2、` `3）` `一、`）自动识别为待办条目，带日期片段歧义保护（`10.12` 不会被拆成假待办）；清单在结果摘要中独立分组、一行一条，适合手机阅读。
3. **保存为可编辑待办**：清单条目沿用现有保存按钮与 testid，保存后进 pending 步骤、可打勾、重启恢复。

## 6. 真机验收（待用户执行）

**DEVICE_NOT_TESTED** — 验收清单见 Release 说明与 `docs/DEVICE_ACCEPTANCE_V3_ALPHA.md`。验收结果按 PASS / FAIL / NOT_TESTED 记录，反馈入口：

- GitHub Issues: https://github.com/cvcingcvc-code/cec/issues （Issue #1 真机验收入口 / #3 界面语言问题）
- GitHub PR #6（Draft，待真机验收合并）

## 7. 剩余问题

**P1**：
1. 全部设备相关行为（覆盖安装、Wi-Fi 连电脑、刷新、持久化、通知）等待真机确认。
2. Codex 真实调用 SKIP by design（本机 CLI 可用性/配额未核实；不可用时如实显示 UNAVAILABLE）。

**P2**：
1. 「整理一份资料清单」类目标仍会同时命中 search+extract（search 部分冗余）。
2. 主仓库工作树（Gorgon-Workbench）落后远端 36 commits 且有他人未提交改动，需一次受控对账（本轮未触碰）。
3. Gateway 连接页 URL 占位 `http://192.168.1.100:8765`，可加局域网扫描辅助。

**BLOCKED**：物理真机不在本轮环境（用户手机实测是唯一出路）。

## 8. 退出门槛对照

- `SOURCE_SYNC=CONFIRMED`（2b7f6ea 及本轮提交均在 GitHub）
- `CODE_REGRESSION=PASS`（Node 580 项 0 fail + Python 472 OK + 构建 18/18）
- `APK_DELIVERED=PASS`（v0.3.7-alpha，versionCode 12，正式签名 v2 verified，SHA256 回验一致）
- `RELEASE_PUBLISHED=PASS`（v0.3.7-alpha Release 上线，历史 Release 全保留）
- `DEVICE_ACCEPTANCE=NOT_TESTED`（等待用户手机实测）
- `V3I_STATUS=CODE_LEVEL_PASS / WAITING_FOR_DEVICE_RESULTS`
