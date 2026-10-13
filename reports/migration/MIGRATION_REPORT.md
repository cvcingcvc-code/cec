# 迁移报告（MIGRATION_REPORT）

> 生成时间：2026-10-13 12:19–12:35 GMT+8
> 执行人：WorkBuddy（Gorgon Workbench 迁移任务 · Phase 1）
> 迁移方式：**源目录保留 → 完整复制 → 验证 → 切换开发目录**（原始 C 盘目录未删除、未修改）

## 1. 迁移概要

| 项 | 值 |
|---|---|
| 源目录 | `C:\Users\lin\Documents\Gorgon-Workbench`（**保留，未动**） |
| 目标目录 | `F:\Gorgon-Workbench`（**新开发根目录**） |
| 复制工具 | robocopy //E //COPY:DAT //R:2 //W:2 |
| 复制结果 | **641 文件 / 48.46 MB / 0 失败 / 0 跳过异常** |
| 迁移后 F 盘体积 | 59 MB（不含 node_modules / 构建缓存） |

**排除目录（全部为可再生内容，按任务书 1.2 分类属于第 3 类）**：
- `app/node_modules/`（152 MB）— npm install 可再生
- `app/android/.gradle/`、`.kotlin/`、`app/android/app/build/`、`app/android/build/`、`app/android/capacitor-cordova-android-plugins/` — Gradle/构建缓存可再生
- `build/`、`app/dist/` — 构建输出可再生
- `__pycache__/`（desktop、pipeline/api）— Python 字节码缓存
- `pipeline/data/cache/`（212 KB）— 检索元数据缓存（gitignore 注明"safe to delete at any time"）
- `app/tests/.e2e-logs/`、`*.log` — 瞬时 E2E 日志
- `release/Gorgon-Workbench-Windows/`（39 MB onedir 打包件）— 按 gitignore 说明可由 `desktop/build.ps1` 随时重打包；**单独说明见 §5**
- `UserslinAppDataLocal/GorgonWorkbench/webview-probe6` — 空探针目录（0 文件）

## 2. 完整性校验（全部通过）

| 校验项 | 源（C 盘） | 目标（F 盘） | 结果 |
|---|---|---|---|
| Git HEAD | `55f876682362837c1fafa89fc07d9f77fbc8f24c` | 同 | ✅ 一致 |
| 分支 | `feature/gorgon-opportunity-v2` | 同 | ✅ 一致 |
| Remote | origin=geergong / cec=cec.git | 同 | ✅ 一致 |
| 本地 git config | md5 `c55295f9` | 同 | ✅ 一致 |
| 全部 ref（for-each-ref） | md5 `8d4c9be7` | 同 | ✅ 一致 |
| 提交总数（--all） | 105 | 105 | ✅ 一致 |
| Git 对象库 | count 691 / in-pack 1152 | 同 | ✅ 一致 |
| git fsck | — | 通过（0 错误） | ✅ |
| git index（模式+blob，605 文件） | — | — | ✅ 逐条一致 |
| 605 个跟踪文件 SHA256 | — | — | ✅ **逐字节一致**（diff=0） |
| 12 个业务数据 JSON（pipeline/data） | — | — | ✅ SHA256 逐一相同 |
| 3 个密钥文件（keystore/properties/local.properties） | — | — | ✅ git blob 哈希相同 |
| 4 个 release 二进制（v2.0.0/v4.0.0 APK、competition zip） | — | — | ✅ SHA256 相同 |
| 2 个当前 APK（debug v5 `FF3BE332` / release `6427DFD1`） | — | — | ✅ 单独补拷后 SHA256 相同 |
| 17 份 release 交付文档（.md） | — | — | ✅ 已跟踪且哈希一致 |

**未提交修改**：源为 0；目标为 `?? reports/migration/`（本任务自己生成的审计/迁移报告目录，属预期新增，非差异）。
**未跟踪有效文件**：源为 0（`--untracked-files=all` 验证），无需迁移。

## 3. 分类落地情况（任务书 1.2 四分类）

| 类别 | 处理 |
|---|---|
| ① 项目源代码 | ✅ 全部复制（app/、pipeline/、components/、ui_kits/、desktop/、tokens/、assets/ 等，605 跟踪文件哈希级一致） |
| ② 项目业务数据 | ✅ 12 个 JSON（raw→normalized→work→review→approved→search）全部复制且哈希一致；**密钥/业务数据均未入 GitHub**（git ls-files 确认） |
| ③ 可再生构建缓存 | ⏸ 排除（node_modules / Gradle 缓存 / build / dist / __pycache__ / data/cache），迁移后按需重建 |
| ④ 外部密钥与环境配置 | ✅ keystore、keystore.properties、local.properties 复制到 F 盘（保持 gitignore，不入库） |

## 4. Git 架构说明（重要发现）

`Gorgon-Workbench` 是 `Gorgon-Recovered` 主仓的 **git worktree**（非独立仓库）：

- F 盘 `.git` 为指针文件：`gitdir: C:/Users/lin/Documents/Gorgon-Recovered/.git/worktrees/Gorgon-Workbench`
- worktree 元数据（HEAD/index/logs/refs）位于 Gorgon-Recovered 主仓的 `.git/worktrees/` 下
- `git fsck` 通过、`git status`/`git log`/`git diff` 在 F 盘全部正常工作
- **含义**：F 盘工作树的 Git 元数据仍指向 C 盘 Recovered 主仓的共享对象库。这不影响日常开发（所有 git 读写经该指针正常），但意味着 **C 盘 Gorgon-Recovered 主仓仍承担 git 存储角色**，未来如需彻底独立可在 F 盘做 `git clone` 迁移（须另行任务授权，本轮按「源目录保留」原则不动）。

**风险提示（诚实标注）**：C 盘 Recovered 主仓若被删除，F 盘工作树的 git 功能将受损。当前 Recovered 主仓保留且健康（HEAD 759fc51，feature/human-review-loop，27 处脏文件原样保留未动）。

## 5. Windows 打包件（release/Gorgon-Workbench-Windows/，39 MB）

按 gitignore 设计属可再生构建产物（`desktop/build.ps1` 一键重打包），且其内容与已跟踪的 `release/*.md` 交付文档分离。本轮**未复制**该目录（59 MB 源体积中占 39 MB）。F 盘保留了 `release/Gorgon-Workbench-Windows-v1.0.0-competition.zip`（19 MB，SHA256 `35f6c0622d98` 两边一致）——即比赛交付的打包件本体已在 F 盘。如需 onedir 解包版，可在新目录重跑 build.ps1。

## 6. 路径与脚本修复（任务书 1.4）

审计结论：**项目代码自身零 C 盘硬编码，无需修复**。

| 检查对象 | 结果 |
|---|---|
| Node 脚本（build-apk.mjs 等） | `fileURLToPath(import.meta.url)` 相对推导；API 基址走 `GORGON_APK_API_BASE` 环境变量 ✅ |
| Python pipeline | `REPO = Path(__file__)` 相对推导（desktop_smoke.py:63 等）✅ |
| E2E 驱动 / 测试 | 相对路径推导，无绝对路径 ✅ |
| Git hooks | 全部为 sample，无自定义 hook ✅ |
| `app/android/local.properties` | `sdk.dir=F:\gorgon-android-toolchain\sdk` — **已指向 F 盘工具链**，迁移后依然正确 ✅ |
| 代码中出现的 `C:\Users` 字样 | 仅 3 处，均为注释示例或**反扫描断言**（test_public_server.py 验证 server.py 不含 C 盘路径的防护代码本身），非路径依赖 ✅ |

## 7. 切换开发目录

**后续所有开发命令统一使用 `F:\Gorgon-Workbench`。**

- 原始目录 `C:\Users\lin\Documents\Gorgon-Workbench` 保留为只读快照（源目录保留原则），**禁止再在其中修改代码**。
- C 盘 `Gorgon-Recovered` 主仓保留（承担共享 git 对象库角色 + 其他 worktree）。
- 下一步（Phase 5）将在 F 盘执行测试/构建验证。

## 8. 状态判定

**PARTIAL_MIGRATION → 实际校验结果：迁移本身 COMPLETE（本轮范围内）**

- 代码/文档/业务数据/密钥/APK：✅ 全部迁移且哈希级一致
- Git 历史与配置：✅ 完整（fsck 通过，105 提交，对象库一致）
- 唯一保留项：Git 对象库物理上仍由 C 盘 Recovered 主仓承载（worktree 架构，§4）；node_modules 与构建缓存未复制（可再生，Phase 5 重建）

按任务书状态选项（MIGRATION_COMPLETE / PARTIAL_MIGRATION / BLOCKED）：**MIGRATION_COMPLETE**（源保留 + 复制完整 + 校验全过 + 新目录可用）；worktree 依赖作为已知限制记录，不构成阻塞。
