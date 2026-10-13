# 迁移前审计（PRE_MIGRATION_AUDIT）

> 生成时间：2026-10-13 12:04–12:20 GMT+8
> 审计人：WorkBuddy（Gorgon Workbench 迁移任务 · Phase 0）
> 本文件只记录已验证事实。所有状态采用诚实标注体系。

## 0. 循环终止检查

| 检查项 | 结果 |
|---|---|
| ADB / 模拟器 / QEMU 进程 | **无运行实例**（`Get-CimInstance Win32_Process` 扫描 `gorgon|emulator|qemu|adb` 命令行，0 条匹配） |
| 待终止子进程 | 无 — 无 Gorgon 专属进程在运行，无需终止任何进程 |
| CDP 重连循环 | 无进程在跑，循环未启动 |

结论：**本轮从干净状态开始，无进程终止动作。** Android 模拟器问题标记为：

## `BLOCKED_ENVIRONMENT`（不是 FAILED_PRODUCT）

- CDP 长会话 evaluate 挂起（>3min 后 WebView devtools 通道 wedge）— 环境问题，非代码缺口
- E2E 31/55 首轮完成，剩余未跑完 — 归因 `BLOCKED_ENVIRONMENT`
- 物理真机验收 — `NOT_TESTED`（无物理设备，Issue #1/#2 OPEN）
- Android 录音 — `NOT_IMPLEMENTED`（插件未装）+ `NOT_TESTED`

未验证的产品功能一律保留 `NOT_TESTED`，不降级为 FAILED。

## 1. 项目现场快照

| 项 | 值 |
|---|---|
| 项目根目录 | `C:\Users\lin\Documents\Gorgon-Workbench` |
| Git 分支 | `feature/gorgon-opportunity-v2` |
| HEAD commit | `55f876682362837c1fafa89fc07d9f77fbc8f24c`（docs(v23): update execution state — Android delivery round (APK v5 + E2E sync)） |
| Git remote | `origin` = https://github.com/cvcingcvc-code/geergong.git（旧）<br>`cec` = https://github.com/cvcingcvc-code/cec.git（**主推送目标**） |
| 未提交修改 | **0**（`git status --porcelain` 干净） |
| 未跟踪文件 | **0**（`--untracked-files=all` 亦为 0；所有有效文件均已跟踪或被有意 ignore） |
| 远端同步 | 本地 HEAD = `cec/feature/gorgon-opportunity-v2` = `cec/HEAD` = `55f8766`（已推送，无领先/落后） |
| 本地分支 | master / feature/data-pipeline-mvp / feature/demo-mvp / **feature/gorgon-opportunity-v2（当前）** / feature/human-review-loop（worktree） / feature/travel-agent-v1（worktree） / feature/workbench-competition |

### 1.1 关联 Gorgon 目录（C 盘 Documents，仅记录，本轮不动）

| 目录 | 说明 |
|---|---|
| `C:\Users\lin\Documents\Gorgon-Workbench` | **本次迁移主体** |
| `C:\Users\lin\Documents\Gorgon-Recovered` | 恢复审计来源（历史） |
| `C:\Users\lin\Documents\Gorgon-Travel-Agent-V1` | travel-agent-v1 worktree |
| `C:\Users\lin\Documents\Gorgon-Export-Work` | 导出工作区 |
| `C:\Users\lin\Documents\gorgon-babel` | babel 原型历史 |

## 2. APK 现状

| APK | 路径 | SHA256（前 8 位） | 说明 |
|---|---|---|---|
| **debug APK v5（当前交付）** | `app/android/app/build/outputs/apk/debug/app-debug.apk` | `FF3BE332` | Oct 13 10:06，versionCode 5，含 Phase 1-7 全部新代码，VITE_API_BASE_URL→部署服务器 |
| release APK（签名） | `app/android/app/build/outputs/apk/release/app-release.apk` | `6427DFD1` | Oct 13 05:10，versionCode 5 |
| 历史 v2.0.0 debug | `release/Gorgon-Workbench-Android-v2.0.0-debug.apk` | `202825EB` | Oct 10 |
| 历史 v4.0.0 debug | `release/Gorgon-Workbench-Android-v4.0.0-debug.apk` | `CBEE3BF6` | Oct 10 |
| 证据快照 | `docs/screenshots/ui-v22-touch/BEFORE-app-release.apk` | — | V2.2 前后对比证据（gitignore，SHA256 记录于同目录 README） |

**v5 = debug `FF3BE332`（最新交付）+ release `6427DFD1`（签名版）**。迁移若不触碰构建链，沿用 v5 并如实标注。

## 3. 文档 / 日志 / 数据目录

| 目录 | 内容 | 体积 |
|---|---|---|
| `docs/` | 17 个 Phase 报告 + workbench/ 23 个状态文档 + screenshots | 12 MB |
| `reports/` | Android V2.1/V2.2 验收报告 8 份 | 84 KB |
| `release/` | 17 份交付文档（.md，已跟踪）+ APK/Windows 构建（未跟踪/ignore） | 67 MB |
| `pipeline/data/` | **业务数据**：raw×3 + normalized + approved + review + search + work×6 = 12 个 JSON（全部 git 跟踪）+ cache（可再生） | 532 KB（cache 212 KB） |
| `app/tests/.e2e-logs/` | E2E 瞬时日志（可再生，gitignore） | 16 KB |
| `build/`、`app/dist/`、`app/android/*/build/`、`.gradle/`、`.kotlin/`、`__pycache__/` | 构建缓存（可再生，gitignore） | ~60 MB |
| `app/node_modules/` | 依赖（可再生） | 152 MB |
| `UserslinAppDataLocal/GorgonWorkbench/webview-probe6` | 空探针目录（0 文件） | 0 |

**密钥文件（本地存在，gitignore 已覆盖，绝不入 GitHub）**：
- `app/android/app/gorgon-release.keystore`（2744 B）— release 签名密钥
- `app/android/keystore.properties`（98 B）— 密钥凭据
- `app/android/local.properties`（sdk.dir=F:\gorgon-android-toolchain\sdk）
- `app/.env` / `search.env`（如存在）

## 4. 工具链与外部依赖（F 盘已有，迁移时复用）

| 项 | 路径 | 状态 |
|---|---|---|
| Android SDK | `F:\gorgon-android-toolchain\sdk`（build-tools / platforms / platform-tools / emulator / cmdline-tools / licenses 齐全） | ✅ 已在 F 盘 |
| JDK 21 | `F:\gorgon-android-toolchain\jdk-21.0.12.1+1` | ✅ 已在 F 盘 |
| Gradle 8.14.3 | `F:\gorgon-android-toolchain\gradle-8.14.3` | ✅ 已在 F 盘 |
| Gradle home | `F:\gorgon-android-toolchain\gradle-home` | ✅ 已在 F 盘 |
| AVD | `F:\gorgon-android-toolchain\avd` | ✅ 已在 F 盘 |
| `local.properties` | 已指向 `F:\gorgon-android-toolchain\sdk` | ✅ 迁移后无需改 |

**结论：Android 工具链已在 F 盘，迁移项目本体后无需移动/重装任何 SDK/JDK。**

## 5. 磁盘空间

| 盘 | 总量 | 可用 | 评估 |
|---|---|---|---|
| C: | 150G | 16G（90% 已用） | **迁移源** — 项目 ~460 MB（不含 node_modules ~305 MB 纯内容），移出后缓解 |
| **F:** | 80G | **69G** | ✅ **首选目标**（工具链同盘，自带协同） |
| D: | 98G | 91G | 备选 |
| E: | 150G | 128G | 备选 |

`F:\Gorgon-Workbench` 目前不存在（无冲突）。F 盘为 NTFS，Git/开发操作正常。

## 6. 代码内硬编码路径扫描

扫描范围：`app/tests`、`app/scripts`、`pipeline`、`desktop`、`.git/hooks`（全部为 sample，无自定义 hook）。

| 文件 | 性质 | 迁移影响 |
|---|---|---|
| `pipeline/search/textnorm.py:47` | 注释示例（`C:\Users` 转义说明） | 无 — 非路径引用 |
| `pipeline/tests/test_public_server.py:254,271` | **反扫描断言**（验证 server.py 不含 `C:\Users` 等字符串） | 无 — 是防护代码本身 |
| `pipeline/tests/test_textnorm.py:109,136` | 注释/断言示例 | 无 |
| `pipeline/tests/desktop_smoke.py:63` | `REPO / "release" / ...` **相对路径**（REPO 由 `__file__` 推导） | 无 — 已相对化 |
| `app/scripts/build-apk.mjs` | `fileURLToPath(import.meta.url)` 推导，API 基址走 `GORGON_APK_API_BASE` 环境变量 | 无 — 已可配置 |
| `app/android/local.properties` | `sdk.dir=F:\gorgon-android-toolchain\sdk` | ✅ 指向 F 盘，迁移后依然正确 |

**结论：项目代码自身无 C 盘硬编码路径依赖；Node/Python 脚本均以 `__file__`/`import.meta.url` 相对推导；API 地址已环境变量化。迁移后路径风险≈0。**

## 7. 测试基线（供 Phase 5 对照）

| 套件 | 基线 | 状态 |
|---|---|---|
| App 单元测试（`node --test tests/*.test.mjs`，47 个文件 37 test + 10 e2e/smoke 脚本） | **411/411**（V23_EXECUTION_STATE：403 + ai-client 8） | 待新目录复跑 |
| build-smoke | 18/18 | 待新目录复跑 |
| vite build | PASS（7.93s） | 待新目录复跑 |
| Android E2E | 31/55 首轮（CDP wedge） | **BLOCKED_ENVIRONMENT**，本轮不跑 |
| pipeline Python 测试 | 453（需系统 Python + pandas） | 待新目录复跑 |

## 8. 停止条件预检（任务书「严格停止条件」逐项）

| # | 条件 | 当前状态 |
|---|---|---|
| 1 | 新目录存在无法确认归属的重要文件 | F:\Gorgon-Workbench 不存在 — 不适用 |
| 2 | 复制/哈希校验失败 | 待 Phase 1 执行后判定 |
| 3 | Git HEAD / 工作区不一致 | 当前干净且与远端一致 ✅ |
| 4 | 数据迁移可能不可逆损失 | 复制式迁移 + 源目录保留 — 风险受控 |
| 5 | 需要删除原始 C 盘项目 | **不会发生**（源目录保留） |
| 6 | GitHub 远端冲突 | 当前本地=远端，无冲突 ✅ |
| 7 | 密钥泄露 | keystore/properties 均 gitignore，`git ls-files` 确认未跟踪 ✅ |
| 8 | 项目路径无法确定 | 已确定 |
| 9 | 关键配置无法恢复 | .env.example / keystore.properties.example / local.properties 齐全 ✅ |

## 9. Phase 0 结论

- **无进程终止需要**（模拟器/ADB 循环未在运行）。
- **现场完整可冻结**：HEAD `55f8766`、工作树干净、与 cec 远端一致。
- **迁移可行性高**：F 盘空间充足、工具链已在 F 盘、代码无 C 盘硬编码。
- **分类**：Android 模拟器 E2E 阻断 = `BLOCKED_ENVIRONMENT`；真机/录音等 = `NOT_TESTED`/`NOT_IMPLEMENTED`；产品功能未验证项不标 FAILED。
- 可以进入 Phase 1（完整复制 → 校验 → 切换）。
