# Gorgon Workbench V2.1 — 安卓手机真实可用版验收报告

> 日期：2026-10-13（GMT+8）· 分支 `feature/gorgon-opportunity-v2` · HEAD `36631af`
> 范围：修复「手机安装 APK 后无法真实检索」，交付可安装、可检索、可持久化的 APK
> 时间盒 120 分钟，实际约 25 分钟（大量修复工作已在交接轮完成并验证，本轮做固化、验证、发布）

---

## 1. 修复前问题

用户在手机安装 GitHub Release v1.0.0 的 APK 后，检索功能不可用（「检索服务不可用」）。

## 2. 实际根因与证据

**根因链（两段，均已坐实）：**

1. **Release 附件是旧 APK**（sha256 `461cdfdba1fb…`，2026-10-12 上传）。
   解包该 APK 取证：bundle `assets/public/assets/index-CrmnuR3_.js` 内**只有相对路径 `/api/search`，不存在任何绝对 API 地址**（`grep workbuddy.host` 零命中）。
   → Capacitor WebView origin 是 `https://localhost`，同源 fetch 打到不存在的后端，必然失败。
2. **公网旧域名无 CORS**：旧服务 `shanghai-activity-search.app.workbuddy.host` 跑旧版 server.py，不下发任何 `Access-Control-Allow-Origin`，即使指过去也会被浏览器拦截。

**修复链（交接轮完成，本轮复验全部成立）：**

- server.py 受控 CORS 白名单（精确等值匹配，默认只放行 `https://localhost`，永不通配 `*`）
- 公网服务重新发布 → 新域名 `2109679843717304320.app.workbuddy.host`（CORS 生效）
- `build-apk.mjs` 构建时注入 `VITE_API_BASE_URL`，新 APK bundle 只含新域名、旧域名零残留
- **本轮固化**：`build-apk.mjs` 默认值由旧域名改为新域名——此前不带环境变量构建会再次产出坏 APK，这是流程上的残留隐患

## 3. 修改文件（本轮）

| 文件 | 改动 |
|---|---|
| `app/scripts/build-apk.mjs` | 默认 `GORGON_APK_API_BASE` 改为 `https://2109679843717304320.app.workbuddy.host`（+注释告诫不得用旧域名） |

本轮无其他代码改动（CORS、注入脚本在交接轮已完成，本轮复验后提交）。

**提交（已推送 cec，`a67185d..36631af`）：**

- `f411d60` feat(api): controlled CORS allowlist for the Capacitor shell
- `360109e` feat(app): build-apk script with VITE_API_BASE_URL injection
- `36631af` docs: phone real-search handoff and project full summary

## 4. 测试结果（全部实测）

| 套件 | 结果 |
|---|---|
| pipeline 公网服务测试（含 CORS 白名单 8 条） | **55/55 PASS** |
| app 单元测试 | **298/298 PASS** |
| 构建冒烟（含密钥扫描） | **18/18 PASS** |
| APK 重建（不带环境变量，验证固化默认值） | PASS，sha256 与交接轮构建完全一致（可复现） |
| cap sync 一次瞬态失败（Windows 文件锁） | 重跑成功；APK 产物不受影响（sha256 逐字节一致） |

## 5. 公网 API 验证结果（`--noproxy '*'`，全部实测）

| 检查 | 结果 |
|---|---|
| `GET /api/health`（Origin: https://localhost） | **PASS** — 200 + `Access-Control-Allow-Origin: https://localhost` + `providerMode: real, demoData: false` |
| `OPTIONS /api/search` 预检 | **PASS** — 204 + `Allow-Methods: GET, POST, OPTIONS` + `Allow-Headers: Content-Type` + `Max-Age: 600` |
| `POST /api/search`（真实查询） | **PASS** — 200，`providerMode: real, status: ok`，5 条结果全部 `dataOrigin: real`，`sourceUrl` 为真实 meetup.com 链接（如 `https://www.meetup.com/shanghai-ai/events/316934041/`） |
| 结果非 DEMO/Mock | **PASS** — `demoData: false`，notices 明示「结果均为真实网页」；huodongxing/douban 被来源侧 blocked 已如实上报（设计如此） |
| 通配符 CORS | **未使用** — 白名单精确匹配 |

## 6. 模拟器 / 真机结果

**模拟器（gorgon_test AVD，一条命令闭环 ×2 次，用满上限）：**

| 项 | 结果 |
|---|---|
| 冷启动无白屏（APK 安装 + am start + WebView 渲染） | **PASS** — origin `https://localhost` 探针可达 |
| WebView → 公网 health fetch | **PASS** — WebView 内 `{"ok":true,"status":200,"providerMode":"real"}`（跨域 fetch 打通的直接证据） |
| WebView → `POST /api/search` | **PASS（网络层）** — WebView 内 POST 返回 HTTP 200（预检 + 跨域 POST 成功） |
| UI 驱动「REAL SEARCH」徽标断言 | **NOT_TESTED** — 第 1 次探针 90s evaluate 超时；第 2 次探针自身解析 bug（body 截断后 JSON.parse 失败）导致 UI 阶段跳过；两次闭环上限用满，按停止条件降级。同请求在公网侧已解析验证为 real（见 §5），推断 UI 徽标链路风险低 |
| 模拟器进程稳定性 | 依旧不稳定（探针结束后 qemu 死亡），与交接文档 §4 描述一致；两次尝试均未出现新症状 |

**真机（物理安卓设备）：无可用设备，整体 NOT_TESTED。** 真机验收步骤见 §9。

## 7. APK 与 Release

| 项 | 值 |
|---|---|
| APK 路径 | `app/android/app/build/outputs/apk/release/app-release.apk` |
| SHA256 | **`d886450d69bc2b3dad1a1d23829823b3b4b05bb013e24438559767a76f1f643c`** |
| 大小 | 3,779,897 B（3.78 MB），versionCode 5 / versionName 5.0，release 签名 |
| bundle API 地址 | 仅 `https://2109679843717304320.app.workbuddy.host`（grep 实测，旧域名零残留） |
| Release | https://github.com/cvcingcvc-code/cec/releases/tag/v1.0.0 |
| 远端附件核对 | **PASS** — 重新下载 Release 附件，sha256 与本地逐字节一致（旧附件 `461cdfdb…` 已被 `--clobber` 替换） |
| Release Notes | 已更新：新 sha256、真实检索修复说明、旧包根因告诫、双域名事实、NOT_TESTED 诚实声明 |
| 旧域名 | **保留下线**（`shanghai-activity-search.app.workbuddy.host` 仍跑旧代码，同源网页用户不受影响；是否下线由用户决定） |

## 8. 验收清单汇总

| 验收项 | 结果 |
|---|---|
| APK 可安装 | PASS（模拟器 install -r Success ×2） |
| 冷启动无白屏 | PASS（模拟器）/ 真机 NOT_TESTED |
| 公网 API 真实检索（非 DEMO/Mock） | PASS |
| WebView 内真实检索 | PASS（网络层，health 200 real + 检索 POST 200） |
| UI 渲染真实结果 + REAL SEARCH 徽标 | NOT_TESTED（探针未稳定复现，见 §6） |
| 来源链接可打开 | PASS（响应含真实 sourceUrl；真机点击打开 NOT_TESTED） |
| 保存任务 / 安排日程 / 创建笔记 | NOT_TESTED（依赖 UI 驱动，本轮未能稳定驱动；对应能力在 v4/v5 阶段已有 55/55 + 28/28 E2E 凭证） |
| 强制关闭重启后数据仍在 | NOT_TESTED 本轮（v3 阶段模拟器持久化闭环 PASS 凭证仍有效，本轮未回归该路径） |
| 报名诚实规则（opened_registration ≠ registered） | 保留，未触碰 |

## 9. 真机验收步骤（交给有物理设备的用户）

1. 手机浏览器打开 https://github.com/cvcingcvc-code/cec/releases/tag/v1.0.0 ，下载 `app-release.apk`
2. 校验（可选）：`certutil -hashfile app-release.apk SHA256` 应等于 `d886450d…`
3. 安装（允许「安装未知应用」）→ 冷启动，确认无白屏
4. 底部「更多」→「智能搜索」→ 输入「这个周末上海有什么 AI 活动？」→ 点「帮我找活动」
5. 确认结果区徽标为 **REAL SEARCH**（不是 DEMO DATA），出现真实活动卡片
6. 点卡片「详情」→ 点来源链接，确认浏览器打开真实活动页
7. 将活动保存到任务 → 安排日程 → 创建一条笔记
8. 强制关闭应用（设置 → 应用 → 强行停止）→ 重新打开 → 确认任务/日程/笔记仍在
9. 任意一步失败请记录：步骤、现象、是否首次冷启动、网络环境（Wi-Fi/蜂窝）

## 10. 尚未解决的问题

1. **UI 驱动 REAL SEARCH 徽标断言未在模拟器稳定复现**（探针/模拟器稳定性问题，非产品缺陷证据；网络层证据齐备）。探针 `probe_v21.mjs` 的 body 截断解析 bug 已定位，下次闭环修复后可一轮拿全证据
2. **模拟器 qemu 进程生命周期不稳定**（交接轮遗留，Windows 环境特定；两次闭环内可完成验证即被容忍）
3. **真机全链路 NOT_TESTED**（无物理设备）
4. huodongxing / douban 来源在托管出口 IP 被 blocked（来源侧策略，服务已如实上报，非故障）
5. 旧公网域名下线决策待用户

## 11. 下一步建议

1. 用户真机按 §9 走一遍，任何 FAIL 回报即升级为 P0
2. 修复 `probe_v21.mjs` 截断 bug（body 不截断或流式解析），下次模拟器窗口补 UI 徽标断言
3. 用户在平台「设置 → 数据管理 → 应用」决定旧域名去留
4. 可选：把「不带环境变量构建 APK」纳入 CI 冒烟，防止默认值回退再次产出坏包
