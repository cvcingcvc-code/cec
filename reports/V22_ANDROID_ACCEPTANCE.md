# Gorgon Workbench V2.2 — 第五阶段：Android 功能验收与稳定性报告

> 生成时间：2026-10-13（GMT+8）· 分支 `feature/gorgon-opportunity-v2`
> 范围：V2.2 代码（含 Progress/求职/进度中心）重建 APK + 模拟器受控验收（最多两次）+ 公网 API 证据链
> 纪律：模拟器最多两次受控启动尝试（已用满）；真机未验收项标 NOT_TESTED

---

## 1. APK 重建（含 V2.2 全部新能力）

| 项 | 值 |
|---|---|
| 构建 | `build-apk.mjs`（VITE_API_BASE_URL 注入）→ `gradlew assembleRelease`，全部成功 |
| APK 路径 | `app/android/app/build/outputs/apk/release/app-release.apk` |
| **SHA256** | **`63e7181dcaabed5dfa7b436e7c239497e2dec4650306f3be1b7a5e2d56b4d172`**（V2.2 新包；V2.1 旧包为 `d886450d…`） |
| 大小 | 3,783,233 B（3.78 MB） |
| bundle API 地址 | 仅 `https://2109679843717304320.app.workbuddy.host`（unzip+grep 实测，旧域名**零残留**） |
| Capacitor 插件 | filesystem@8.1.4 / preferences@8.0.1（native 持久化在包内） |

## 2. 模拟器受控验收（gorgon_test AVD，一条命令闭环 ×2 次，**上限用满**）

| 检查 | 第 1 次 | 第 2 次 |
|---|---|---|
| 清锁 → 冷启动 boot | **PASS**（49.6s） | **PASS**（48.5s） |
| APK `install -r` | **PASS**（Streamed Install / Success） | **PASS**（同左） |
| `am start` 启动应用 | **PASS** | **PASS** |
| qemu 存活至探针 | ✗（探针前死亡，日志确认） | ✓（`tasklist` 确认存活） |
| CDP WebView origin | 未及 | **PASS** — `{"origin":"https://localhost","href":"https://localhost/"}` |
| WebView 内 health fetch | — | **NOT_TESTED**（Runtime.evaluate 90s 超时，qemu 存活窗口内未返回） |
| UI 驱动 REAL SEARCH 徽标 | — | **NOT_TESTED**（同上） |
| 探针后 qemu | 已死 | 探针超时后死亡（tasklist + adb devices 确认） |

**结论**：启动链路（安装/冷启动/WebView origin）两次全 PASS；**网络层与 UI 徽标断言 NOT_TESTED**——qemu 在探针 evaluate 阶段超时后死亡，与 V2.1 报告 §6 及交接文档 §4 描述的「模拟器进程生命周期不稳定」模式一致，非产品缺陷证据。

## 3. 公网 API 证据链（替代证据，`--noproxy '*'` 全部实测）

| 检查 | 结果 |
|---|---|
| `GET /api/health`（Origin: https://localhost） | **PASS** — HTTP 200 + `{"status":"ok","providerMode":"real","demoData":false}` |
| `OPTIONS /api/search` 预检 | **PASS** — HTTP 204 + `Allow-Origin: https://localhost` + `Allow-Methods: GET, POST, OPTIONS` + `Allow-Headers: Content-Type` + `Max-Age: 600`（新 server.py 行为特征） |
| `POST /api/search` 真实查询 | **PASS** — `providerMode: real`、`status: ok`、3 条结果全部 `dataOrigin: real`，真实 meetup.com 链接（如 `https://www.meetup.com/shanghai-ai/events/316934041/`） |
| pipeline 公网服务测试 | **55/55 PASS**（含 CORS 白名单 8 条） |

**历史直接证据（仍有效）**：V2.1 轮 emu_r4 曾在 APK WebView 内实测 `health fetch: {"ok":true,"status":200,"providerMode":"real"}`——WebView 跨域 fetch 打通已有一次成功证据（`reports/GORGON_ANDROID_V21_ACCEPTANCE.md` §6）。

## 4. 测试基线汇总

| 套件 | 结果 |
|---|---|
| app 单元测试（V2.2 全部新测试在内） | **323/323 PASS** |
| pipeline 公网服务测试 | **55/55 PASS** |
| Vite 生产构建 | PASS |
| APK 构建 + gradle assembleRelease | PASS |

## 5. 验收清单汇总

| 验收项 | 结果 |
|---|---|
| APK 可安装 | **PASS**（模拟器 install -r Success ×2） |
| 冷启动无白屏 | **PASS**（模拟器 ×2，origin 探针第 2 次确认）/ 真机 NOT_TESTED |
| WebView origin 正确（https://localhost） | **PASS**（CDP 实测） |
| WebView 内真实检索 | **NOT_TESTED**（本轮 qemu 窗口内 evaluate 超时；V2.1 有一次成功历史证据 + 本轮公网侧全链路 PASS） |
| UI 驱动 REAL SEARCH 徽标 | **NOT_TESTED**（同上） |
| 保存任务/日程/笔记 + 重启保留 | **NOT_TESTED**（依赖 UI 驱动；数据层有 323/323 单测 + 三场景闭环测试凭证，native-persistence E2E 凭证仍有效） |
| 报名诚实规则 / 求职诚实规则 | 保留（代码层钉死，323/323 内含专项测试） |
| 真机（物理设备） | **整体 NOT_TESTED**（无设备；步骤沿用 V2.1 报告 §9，SHA256 更新为 `63e7181d…`） |

## 6. 模拟器稳定性结论（两轮累计 4 次闭环）

- 唯一稳定窗口仍是「清锁→启动→装 APK→am start→探针」单命令闭环；跨命令 qemu 必死。
- 本轮新增观察：**即使单命令闭环，qemu 也可能在探针 evaluate 阶段超时后死亡**（第 1 次在探针前、第 2 次在探针超时后）。boot 48-50s 一致，说明启动本身稳定，死点集中在探针窗口。
- 探针 `probe_v21.mjs` 的 origin 阶段快（秒回），网络阶段（fetch + awaitPromise）是超时高发点。后续可改探针为「逐条短 evaluate + 分阶段落盘」，在 qemu 死亡前至少抢到 health 证据。

## 7. 尚未解决 / 交接

1. **真机全链路 NOT_TESTED**（无物理设备）——Issue #1 不关单，真机步骤：下载 APK（校验 `63e7181d…`）→ 冷启动 → 智能搜索 → REAL SEARCH 徽标 → 保存任务/笔记 → 强停重启验证保留。
2. UI 驱动 REAL SEARCH 徽标断言仍未在模拟器稳定复现（环境问题，非产品缺陷证据；公网侧 real 全链路 PASS）。
3. Release v1.0.0 附件更新为 `63e7181d…` 新包（Stage 6 push 时 `gh release upload --clobber`）。
4. qemu 存活窗口内 evaluate 超时的根因未查明（Windows 环境特定，建议留给有窗口的环境复跑）。
