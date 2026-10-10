# Release Checksums — Gorgon Workbench `1.0.0-competition`

**生成日期** 2026-10-10 · **HEAD** 见 git log（Phase 10 验收，含 1 处数据准确性修复）

> 用 `sha256sum` 计算。复现方式：`desktop/build.ps1` 重建 EXE，再
> `python -c "import shutil; shutil.make_archive(...)"` 打包 ZIP。

```text
# ZIP（整个 Gorgon-Workbench-Windows/ 目录）
35f6c0622d9886863dd28c83c615b5f3588a4948427239d953f782581f7fd642  Gorgon-Workbench-Windows-v1.0.0-competition.zip

# EXE 本体
fb8edb483d71b4273863c00c077cf849bd651fd8d4c0b30823d64890f9822ec9  Gorgon-Workbench-Windows/Gorgon Workbench.exe
```

## 说明

- `release/Gorgon-Workbench-Windows/` 与 ZIP 是**构建产物**（`.gitignore` 已忽略），
  可随时用 `desktop/build.ps1` 复现，故不进 git、不生成额外版本号。
- 前端 bundle hash：`index-CT8rx1Rm.js`（420.36 kB / gzip 123.85 kB），
  对应 HEAD 之后包含 Phase-10 metadata 持久化修复的构建。
- EXE 自检：`--selftest` 8/8 全绿（frozen=true, python=3.14.2）。

---

# Release Checksums — Gorgon Workbench `2.0.0-android-debug`（V2 追加）

**生成日期** 2026-10-10 · **HEAD** `ffaf5b1`（feature/gorgon-opportunity-v2）

```text
# Android debug APK（Capacitor 8 壳 + app/dist 前端产物）
202825ebb0bb4c1a0c914fbf6d4062afc8e084f72df61c24fcda1baed3399e7e  Gorgon-Workbench-Android-v2.0.0-debug.apk
```

## V2 Android 说明

- 包名 `cn.gorgon.workbench`，minSdk 24（Android 7.0+），targetSdk 36，体积 4.77 MB。
- 用户权限仅 `android.permission.INTERNET`；**无位置、无录音权限**（模块 D/E 实现时按需增补并说明）。
- APK 内 JS 扫描：明文 API 密钥 0、`localhost/127.0.0.1` 硬编码 0（不依赖开发机服务，离线可运行）。
- 前端 bundle：`index-DqDpOsRe.js`（423.08 kB / gzip 124.80 kB）+ `index-DZZIh6we.js` + `web-krbKFYVj.js`，
  含模块 A 持久化桥接（native-persistence.js）。
- 构建步骤见 `release/ANDROID_BUILD.md`；工具链位于 `F:\gorgon-android-toolchain`（C 盘 99% 满、D 盘中途变只读）。
- **REAL_DEVICE_TEST=NOT_TESTED**：构建机上 `adb devices` 无设备，实机安装/启动/重启持久化待真机验证。
  在完成真机验证前，安卓端状态 = **BLOCKED（APK 已构建，实机未验收）**。
- debug 签名 = Android SDK debug keystore，仅限测试安装；正式发布前需换 release 签名（见 ANDROID_BUILD.md §9）。

---

# Release Checksums — Gorgon Workbench `2.0.0-android-debug` v3（白屏修复版，当前有效）

**生成日期** 2026-10-10 14:51（本地）· **分支** `feature/gorgon-opportunity-v2`

```text
# Android debug APK v3（含 P0 白屏修复：native-persistence.js 优先原生插件桥 + main.jsx boot 超时兜底）
1cc50a13ccf2dfc80589c339699a34db3c7ac791c360842d90b927a08830da43  app-debug.apk
# 大小 4,918,117 bytes · versionCode=1 · versionName=1.0 · minSdk=24 · targetSdk=36
```

> 上一条目（`202825eb…`，bundle `index-DqDpOsRe.js`）已作废：该版存在 P0 白屏缺陷
> （`await import("@capacitor/preferences")` 在 Capacitor 原生环境挂起，阻塞 React 挂载）。

## v3 修复内容

- `app/src/lib/native-persistence.js`：`loadPreferences()` 优先使用同步可得的
  `window.Capacitor.Plugins.Preferences` 原生插件桥，不再依赖运行时动态 import。
- `app/src/main.jsx`：`boot()` 增加 3 秒超时竞态 + try/catch/finally，
  **保证 `createRoot(...).render(<App />)` 在任何情况下都执行**（持久化失败不再白屏）。
- 前端 bundle：`index-Cubwn80D.js`。

## 模拟器验证记录（AVD gorgon_test · pixel_7 · android-35 google_apis x86_64 · 2026-10-10）

| 验证项 | 结果 | 证据 |
|---|---|---|
| `adb install -r` 安装 | ✅ PASS | `lastUpdateTime=2026-10-10 06:51:59`（UTC），与 v3 构建时间吻合 |
| 启动 + MainActivity 焦点 | ✅ PASS | `mCurrentFocus=…cn.gorgon.workbench/.MainActivity` |
| React 挂载（白屏修复） | ✅ PASS | CDP diag：`rootChildren:1`、`rootHTMLlen:15249`（修复前为 0） |
| Capacitor 桥 + 离线加载 | ✅ PASS | `capNative:true`，`https://localhost/` 加载本地 bundle，零 localhost 服务依赖 |
| **重启持久化闭环（模块 A）** | ✅ PASS | 见下方三阶段记录 |
| 单元测试 | ✅ PASS | 244/244（node --test） |

### 重启持久化三阶段（token `gorgon-android-restart-v3-1791616092`）

1. **write**：localStorage 写入 token → PASS（PID 5472）
2. **verify-native**：Capacitor Preferences 原生层读回同 token → PASS
3. **force-stop（真实进程死亡）→ 冷启动**：PID 5472 → 5750，
   **read-after**：`hydratedKeys:4`，localStorage 与原生层均精确读回 token → PASS

结论：数据完整穿越进程死亡；hydrate（Preferences → localStorage）在冷启动时生效。

## 诚实标注

- 以上全部为 **模拟器（AVD）** 验证，非物理真机。**REAL_DEVICE_TEST=BLOCKED**（无物理设备）。
- 模拟器验证覆盖安装/启动/渲染/持久化全链路，x86_64 AVD 与 ARM 真机的差异风险低
  （纯 WebView 应用，无 NDK 原生代码），但按任务书要求，物理真机验收完成前不虚报。
- debug 签名仅限测试；发布需换 release 签名。
