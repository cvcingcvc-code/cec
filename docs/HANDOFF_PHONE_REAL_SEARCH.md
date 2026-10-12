# HANDOFF — 手机 APK 接入公网检索：CORS 已打通，验证卡在模拟器进程生命周期

> 交接时间：2026-10-13 01:00 (GMT+8)
> 交接自：WorkBuddy 会话（任务 #27-31）
> 接手建议：先读 §3 核心结论与 §5 环境配方，再按 §6 下一步执行

## 1. 任务背景（一段话）

Gorgon Workbench 的 Android APK（Capacitor，WebView origin `https://localhost`）没有自己的后端：检索靠公网服务 `pipeline/api/server.py`。用户手机装 APK 后「检索服务不可用」。根因链已查明并修复了大半：

1. APK 内 fetch 同源 `/api/*` 找不到后端 → 需要 `VITE_API_BASE_URL` 指向公网（C2 已做）
2. 公网 server.py 有意不下发 CORS 头（旧版安全 posture）→ WebView 跨域 fetch 被浏览器拦截 → 需要受控 CORS 白名单（C1 已做）
3. **公网服务要重新发布才会生效**（`docs/PUBLIC_DEPLOYMENT.md` §C：「改动代码后要重新发布，线上才会变」）→ 已重新发布，但平台创建了**新应用/新域名**（见 §2.3，重要）

## 2. 已完成（全部已验证）

### 2.1 C1 — server.py 受控 CORS（本地 55/55 全绿）

- `pipeline/api/server.py`（+66 行，**未提交**）：`cors_headers_for()` 白名单精确等值匹配，默认只放行 Capacitor origin `https://localhost`；`GORGON_CORS_ORIGINS` 环境变量可追加（逗号分隔）；**永不通配 `*`**；无 Origin 或外来 origin 保持历史 no-CORS 行为；`do_OPTIONS` 白名单 origin 回 204 + `Allow-Methods/Headers/Max-Age=600`
- `pipeline/tests/test_public_server.py`：新增 `CorsAllowlistTest` 8 测试（Capacitor 回显 / evil origin 拒绝 / env 可加但 `*` 拒绝 / 预检头 / health 不泄漏）
- 本地 4/4 矩阵实测通过（复跑方法见 §5.6）

### 2.2 C2 — APK 构建注入 VITE_API_BASE_URL（bundle 已验证）

- `app/scripts/build-apk.mjs`（新增，**未提交**）+ `app/package.json` scripts 加 `build:apk`
- `GORGON_APK_API_BASE` 环境变量可覆盖默认公网地址；Vite **build 时**注入；`src/lib/api.js` 是唯一 API 配置层（别处不得硬编码 URL）
- bundle 实测：新 URL 在 `android/app/src/main/assets/public/assets/index-X-YrR3Wj.js`，旧 URL **零残留**

### 2.3 公网服务已重新发布（注意：新域名！）

用 WorkBuddy 平台「发布应用」重新发布成功，但平台返回的是**新应用**：

| 域名 | 代码 | CORS | 状态 |
|---|---|---|---|
| **新**：`https://2109679843717304320.app.workbuddy.host/` | 新 server.py | 生效 | 本次部署产物 |
| 旧：`https://shanghai-activity-search.app.workbuddy.host/` | 旧 server.py | 无 | 仍活着（同源网页用户不受影响） |

- domainPrefix `shanghai-activity-search` 未生效：被旧应用占用，平台新建了应用而不是覆盖。两个域名并存，是否下线旧应用**由用户决定**
- 新链接宿主 curl 实测（一律 `--noproxy '*'`）：
  - `GET /api/health` + `Origin: https://localhost` → 200 + `Access-Control-Allow-Origin: https://localhost` ✅
  - `OPTIONS /api/search` 预检 → 204 + `Allow-Methods: GET, POST, OPTIONS` + `Allow-Headers: Content-Type` + `Max-Age: 600` ✅（这正是新 server.py 的行为特征，旧版不会有）
  - `POST /api/search` → 首次 `search_timeout`（40s 上限，沙箱冷启动），重试 → `status: ok, providerMode: real` ✅
  - health body → `{"status":"ok","providerMode":"real","demoData":false}` ✅

### 2.4 新 APK 已构建并多次装入模拟器

- `gradlew assembleRelease` 成功 → `app/android/app/build/outputs/apk/release/app-release.apk`（3.78 MB）
- **sha256 `d886450d69bc2b3dad1a1d23829823b3b4b05bb013e24438559767a76f1f643c`**

## 3. 核心结论（最重要）

**CORS 方案本身已被证实有效。** 在 emu_r4 那次启动（「启动+装 APK+探针全在一条 bash 命令内闭环」），CDP 探针在 APK WebView 内实测：

```
origin: {"origin":"https://localhost","href":"https://localhost/"}
health fetch: {"ok":true,"status":200,"providerMode":"real"}
```

这是 WebView 内跨域 fetch 成功打到公网新服务、拿到 200 real 的**直接证据**。剩余问题不在 CORS、不在 bundle、不在公网服务——**在模拟器进程生命周期不稳定**（§4）。

## 4. 当前卡点：模拟器进程频繁死亡 + 网络症状

现象（多次启动，日志在 `C:\Users\lin\.workbuddy\p5\emu_*.log`，emu_r4 是成功那次）：

- **bash 后台 `&` 方式**：命令一结束 qemu 就被连带杀（Windows 下 bash 后台进程随会话终止）。唯一稳定窗口 = 「清锁 → 启动 → 轮询 boot → 装 APK → am start → 探针」**全部在一条命令内完成**
- **PowerShell Start-Process 分离方式**也死（两次均无 qemu 进程、重定向日志为空，原因未查明）
- 网络症状（`ip route` 空输出、`connect: Network is unreachable`、ping 10.0.2.2 不通、DNS getprop 空）**大概率是 qemu 已死的症状而非独立网络故障**——每次这些症状出现时 `tasklist` 里 qemu 已不在。需要 Codex 复核确认
- r10 日志出现过 `WARNING | Client disappeared while connecting to port: 5555`（adb client 中断）
- **不要被带偏的点**：
  - 模拟器 ping 8.8.8.8/1.1.1.1 100% loss 是 Android 模拟器 NAT 正常行为（不转发 ICMP）。判断外网连通用 HTTP fetch，不是 ping；`-dns-server` 参数大概率不需要
  - 宿主机直连公网始终 200（0.5s），宿主网络无问题
- 已排除：CSP meta（dist/index.html 无）；bundle 旧 URL 残留（零）；公网 CORS 缺失（§2.3 已验证）

## 5. 环境配方（照抄即用）

### 5.1 模拟器唯一稳定配方（一条命令闭环）

```bash
# 0) 清 stale lock（qemu 死后必留，不清会静默退出）
ls "F:/gorgon-android-toolchain/avd/gorgon_test.avd/" | grep -i lock && { \
  rm -f "F:/gorgon-android-toolchain/avd/gorgon_test.avd/hardware-qemu.ini.lock/pid" \
        "F:/gorgon-android-toolchain/avd/gorgon_test.avd/multiinstance.lock"; \
  rmdir "F:/gorgon-android-toolchain/avd/gorgon_test.avd/hardware-qemu.ini.lock"; }
# 1) 启动（必须 env -u 清全部代理；C 盘 ~/.android/avd/gorgon_test 是坏副本，必须 ANDROID_AVD_HOME 指 F 盘）
EMU="F:/gorgon-android-toolchain/sdk/emulator/emulator.exe"
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u all_proxy -u ALL_PROXY \
  ANDROID_AVD_HOME="F:\\gorgon-android-toolchain\\avd" \
  "$EMU" -avd gorgon_test -no-snapshot-save -no-boot-anim -gpu swiftshader_indirect -no-window > LOG 2>&1 &
# 2) 轮询（60 次 x 2s）：adb -s emulator-5554 shell getprop sys.boot_completed == 1
# 3) 装 APK + am start + 探针 —— 必须同一条命令内完成，不要跨命令
ADB="F:/gorgon-android-toolchain/sdk/platform-tools/adb.exe"
"$ADB" -s emulator-5554 install -r <apk>
"$ADB" -s emulator-5554 shell am start -n cn.gorgon.workbench/.MainActivity
node <probe.mjs>
```

### 5.2 adb 陷阱

- daemon 间歇重启（"daemon not running" / "device offline" / 偶发 "more than one device"）：`kill-server` → sleep 2-3 → `start-server` → 重试；命令都带 `-s emulator-5554`

### 5.3 构建配方

```bash
cd app && GORGON_APK_API_BASE="https://2109679843717304320.app.workbuddy.host" node scripts/build-apk.mjs
cd android && JAVA_HOME="F:/gorgon-android-toolchain/jdk-21.0.12.1+1" \
  GRADLE_USER_HOME="F:/gorgon-android-toolchain/gradle-home" ./gradlew assembleRelease --console=plain -q
```

### 5.4 本地 curl 陷阱

- 本机环境变量有沙箱代理（`https_proxy=127.0.0.1:51119` 等），curl 对 localhost 和公网都会走代理导致假性失败——**一律加 `--noproxy '*'`**

### 5.5 探针脚本

- `C:\Users\lin\.workbuddy\p5\probe_real_search.mjs`：自备 adb/CDP 管道（pidof 重试 → forward tcp:9222 → WebSocket → Runtime.evaluate）；检查 WebView origin + 直连 health fetch + UI 驱动智能搜索断言 REAL SEARCH 徽标
- send timeout 已调 90s，但 UI 阶段（60 次 x 2s 轮询）仍出现过 `Runtime.evaluate` timeout——必要时简化为只做 health fetch 验证
- UI 驱动成熟路径参考 `app/tests/android_registrations_e2e.mjs` 的 `openSr001Detail()`（drawer → more → smart → typeInto DEMO_QUERY → 帮我找活动 → 卡片「详情」按钮）

### 5.6 本地 CORS 验证矩阵（4/4 已通过，可复跑）

```bash
cd /c/Users/lin/Documents/Gorgon-Workbench && python pipeline/api/server.py --port 8901 --mode demo > LOG 2>&1 &
# 等 /api/health 200 后（curl 一律 --noproxy '*'）：
# 1. OPTIONS 预检（Origin: https://localhost + Access-Control-Request-Method: POST）→ 204 + ACAO + Methods/Headers/Max-Age
# 2. GET 带 Capacitor origin → ACAO 回显
# 3. GET evil origin（https://evil.example.com）→ 无 ACAO
# 4. GET 无 Origin → 无 ACAO
```

## 6. 建议下一步（给 Codex）

### 焦点 1：稳定拿到一次「UI 驱动真实检索」的成功证据

1. 用 §5.1 配方**一条命令闭环**跑：清锁 → 启动 → 装 APK → am start → 探针。health fetch ok:true 已成功过一次，重跑有成功率（看 qemu 存活运气）
2. 跑探针前先 `tasklist //FI "IMAGENAME eq qemu-system-x86_64.exe"` 确认 qemu 活着，把网络症状和进程死亡区分开
3. 若探针 UI 阶段仍 timeout：改探针只做 health fetch + 简化 UI 断言，或加大轮询间隔
4. 可选深挖：为什么 Start-Process 分离方式也死（Windows Job Object 连带终止？）；为什么网络症状总伴随 qemu 死亡出现

### 焦点 2：C3 收尾（验证通过后）

- commit（conventional 前缀，拆两笔）：
  - `feat(api): controlled CORS allowlist for the Capacitor shell`（server.py + test_public_server.py）
  - `feat(app): build-apk script with VITE_API_BASE_URL injection`（app/scripts/build-apk.mjs + app/package.json）
- push 到 cec 远端（GitHub 需走 Clash 代理 `127.0.0.1:7890`）
- `gh release upload --clobber` 更新 APK 附件（sha256 `d886450d…`）
- Release 说明加「真实检索（公网服务接入）」+ 更新测试基线（单测 298/298 + build-smoke 18/18 + places E2E 29/29 + registrations E2E 28/28 + phase4 E2E 55/55）
- **两个域名的事实**写进 Release/文档：新 `2109679843717304320.app.workbuddy.host` CORS 生效；旧 `shanghai-activity-search.app.workbuddy.host` 仍跑旧代码（同源网页用户不受影响）；是否下线旧应用由用户决定
- 若模拟器 UI 驱动验证始终无法在本环境稳定复现，可降级收口：以 §3 的一次成功证据 + §2.3 公网 curl 验证作为 CORS 生效凭证，真机验证留给用户

### 明确不做（边界）

- 不放宽 CORS 到通配符 `*`（安全面）
- 不动 Module C 诚实规则（opened_registration 永不记为 registered）
- 不因 ping 8.8.8.8 不通误判网络故障（NAT 不转发 ICMP）
- 不直接改 `reports/demo/`（除非 MAIN_RESEARCH 明确要求）
- 不在工作树脏时执行破坏性 git 操作

## 7. git 状态快照（交接时刻）

- 分支 `feature/workbench-competition`，HEAD `a67185d`（Module C E2E 28 checks）
- 未提交：`app/package.json`（M）、`pipeline/api/server.py`（M）、`pipeline/tests/test_public_server.py`（M）、未跟踪 `app/scripts/`
- 测试基线：单测 298/298 + build-smoke 18/18 + places E2E 29/29 + registrations E2E 28/28 + phase4 E2E 55/55
