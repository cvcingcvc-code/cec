# Gorgon-Workbench 交接上下文（HANDOFF_CONTEXT）

> 自包含交接文档：换电脑克隆 cec 仓库后的新 AI agent / 新会话，从本文档接手。
> 生成时间：2026-10-12 22:28（HEAD `d07cf70`，已推送 cec）。
> 阅读顺序：本文档 → `AGENTS.md`（协作规则）→ `docs/workbench/V2_AUDIT_AND_RISKS.md`（审计优先级）→ `docs/workbench/DELIVERY_STATE.md`（交付状态）。

## 1. 项目与固定基线

- **项目**：Gorgon-Workbench — Android/桌面 AI 智能行动工作台（活动检索 → 行程 → 走访 → 笔记 → 复盘闭环）
- **仓库**：`github.com/cvcingcvc-code/cec`（PUBLIC，默认分支 `feature/gorgon-opportunity-v2`，HEAD `d07cf70`）
- **旧远程**：`github.com/cvcingcvc-code/geergong`（origin 仍在本地配置但**不再接收推送**）
- **技术栈**：Vite 5.4 + React 18.3 生产构建前端（mobile PWA）+ Capacitor 8 Android 壳 + Python 后台流水线 + 计划 Tauri/PyInstaller 桌面端
- **克隆命令**：`git clone https://github.com/cvcingcvc-code/cec.git`（默认分支自动 checkout）

## 2. 今天（2026-10-12）完成了什么

1. **Phase 5 最终收口 DONE**：Android E2E 55/55 全绿（marker `p4accmv5971wi`），报告 `release/PHASE5_ACCEPTANCE_REPORT.md`（PHASE5_STATUS=DONE）
2. **Module D UI（走访地点屏）**：commit `adb8292`——`PlacesScreen.jsx` 新建 + workbench-store places facade + 导航入口 + ProjectDetailScreen 增强；单测 277→289
3. **走访地点 Android E2E**：commit `56e488a`——`android_places_e2e.mjs` 独立驱动 29/29 全绿
4. **GPT 交接概述**：commit `819094b`——`release/PHASE5_GPT_HANDOFF.md`
5. **阶段 A：Android Release 安装包**：commit `d07cf70`——A1 签名 + A2 构建 + A3 冒烟 6/6 + A4 推送

## 3. 当前验证基线（恢复环境后应看到）

| 测试 | 基线 |
|---|---|
| 单测（`node --test "tests/*.test.mjs"` from app/） | **289/289** |
| build-smoke（`node tests/build-smoke.mjs`） | **18/18** |
| Android places E2E（`node tests/android_places_e2e.mjs`） | **29/29**（需模拟器+APK） |
| Android phase4 E2E（`node tests/android_phase4_e2e.mjs`） | **55/55**（需模拟器+APK） |
| Python pipeline（453/453） | 需系统 Python 3.14 + pandas |

## 4. 安装包状态（最终目的：自己可用）

- **Android release APK**：✅ 已完成。`app/android/app/build/outputs/apk/release/app-release.apk`（3.78MB，sha256 `d1a46e39…`，versionCode 5，CN=Gorgon Workbench 真签名，apksigner 验证通过，冒烟 6/6）
- **⚠️ 签名密钥**：`app/android/app/gorgon-release.keystore` + `app/android/keystore.properties`（均 gitignored）——**换电脑必须手动带走**（丢了已装 release 版无法原地升级）。密码在 keystore.properties（storepass/keypass = gorgon2026，alias = gorgon）
- **Windows 桌面包**：⬜ 未做（B 阶段）
- **构建命令**：vite build → cap sync android → `JAVA_HOME="F:/gorgon-android-toolchain/jdk-21.0.12.1+1" GRADLE_USER_HOME="F:/gorgon-android-toolchain/gradle-home" ./gradlew assembleDebug|assembleRelease`

## 5. 下一步开发规划（三阶段，每步一小步+验证+同步仓库）

### 阶段 B：Windows 桌面安装包（Tauri）
| 步 | 任务 | 门控 |
|---|---|---|
| B1 | Rust/cargo 工具链检查（cargo --version） | 工具链就绪或决策替代方案 |
| B2 | Tauri 接入（src-tauri + 指向现有 Vite dist） | 配置完成 |
| B3 | 桌面 dev 冒烟（窗口+渲染） | 渲染正常 |
| B4 | NSIS/MSI 安装包构建 | 产物+校验 |
| B5 | 本机安装验证 | 安装启动可用 |
| B6 | commit + push cec | ls-remote 验证 |

**替代方案提示**：Phase 8 已有 PyInstaller 桌面包先例（`desktop/build.ps1`，.gitignore 注释在案，onedir bundle）。若 Rust 工具链缺失且安装受阻，可复用 PyInstaller 路线（B1 时与用户确认）。

### 阶段 C：分发收尾
- C1: `release/INSTALL.md` 安装说明（APK + 桌面包安装方式 + 密钥保管警示）
- C2: commit + push；GitHub Release 传附件（与用户确认）

### 其他自然方向（B/C 之后）
- V2 审计 P2：语音转写（notes kind=audio 已有元数据形状）、AI 高级分析
- 真机验证（需真实 Android 设备）

## 6. 环境备忘（换电脑必读的坑）

- **ADB**：daemon 频繁被 reap，任何 adb 命令前 `kill-server` → `start-server` → devices 确认 device；外部进程设的 CDP forward 随 daemon reap 丢失，**CDP 驱动脚本必须自备管道**（pidof→forward→connect 单进程闭环，见 release_smoke.mjs / android_phase4_e2e.mjs）
- **沙箱**：WorkBuddy 沙箱代理拦截 Node 的 localhost 连接（curl 假象可达/502，Node fetch ECONNREFUSED）——CDP/E2E 脚本须沙箱豁免运行；GitHub 访问走 Clash 代理 127.0.0.1:7890（沙箱代理不可达）
- **Gradle**：新 shell 无 JAVA_HOME，须显式 `JAVA_HOME="F:/gorgon-android-toolchain/jdk-21.0.12.1+1" GRADLE_USER_HOME="F:/gorgon-android-toolchain/gradle-home"`（新机器路径会变）
- **Node**：`--test tests/` 目录形式报 MODULE_NOT_FOUND（Node 22），须 glob 形式 `--test "tests/*.test.mjs"`
- **CDP eval**：Runtime.evaluate 不能直接 return（Illegal return statement），脚本已用 IIFE 包装；Node 22 WebSocket 无 `ws.on`，用 `ws.onmessage`/`addEventListener`
- **安装签名**：debug → release 升级会 INSTALL_FAILED_UPDATE_INCOMPATIBLE（预期），先 uninstall 再 install
- **本地构建产物**：dist/、APK、keystore 均不入库；`release/*` gitignored 但 `!release/*.md` 文档跟踪

## 7. 一句话总结

**Android release 安装包已可用并推送 cec（d07cf70）；下一步 B1 检查 Rust 工具链开始 Windows 桌面包（Tauri，备选 PyInstaller）；每步一小步、验证门控、同步仓库。**
