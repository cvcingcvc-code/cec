# Gorgon V3F.2 真机验收与最小修复 — 最终测试报告

**日期**：2026-10-14
**目标**：不扩展新功能，只让现有 Android APK 在真实手机上可靠工作。不得无限开发。
**分支**：`feat/v3e-functional-closure`（推送目标 cec `feature/gorgon-opportunity-v2`）
**最终 HEAD**：`eaf96d0`（工作树干净，远端已同步）

---

## 一、结论总览

| 项 | 状态 | 说明 |
|---|---|---|
| P0 手机-PC 数据连通 | ✅ 代码侧完成 | 根因定位 + CORS/绑定/离线缓存全部验证；真机连通待用户验收 |
| P1 活动数据真实性 | ✅ 完成 | demo 泄漏 bug 已修复（双点打标）+ 3 个新测试 |
| P2 持久化与真实操作 | ✅ 代码侧验证 | 离线缓存 F11 显式测试通过；真机闭环流程标 NOT_TESTED_DEVICE |
| P3 发布管理 | ✅ 完成 | v0.3.4-alpha Pre-release 已发布，tag 与构建源码一致 |

---

## 二、P0 手机-PC 数据连通

### 2.1 根因（已定位）

- 部署服务器 `https://2109679843717304320.app.workbuddy.host/api/activities` 返回 **404**
  —— 部署版本是 V3F.1 之前的构建，没有这个端点。
- 部署端 `/ui_kits/app/generated-data.js` 仍是 17 条 demo 活动的旧数组格式。
- **结论**：APK 代码没问题，是部署服务器落后了。需重新发布云端站点（见「未解决问题」#1）。

### 2.2 bundle 内 API 目标（APK zip 级验证）

- `VITE_API_BASE_URL="https://2109679843717304320.app.workbuddy.host"`（build 时注入，来自 `scripts/build-apk.mjs`）
- bundle 内 **无** localhost API 请求、**无** API key/secret/token。
- 手机不会错误请求 `https://localhost/api/activities`——localhost 只作为 Capacitor 同源 scheme 存在。

### 2.3 Android 网络配置 / HTTPS / CORS

- Capacitor 8 `androidScheme=https`（同源为 `https://localhost`），无 cleartext 流量需求。
- 服务器 CORS：`DEFAULT_CORS_ORIGINS = ("https://localhost",)`，无通配符；evil origin 实测被拒。
- LAN 实测：本机 `server.py`（192.168.1.29:8000, mode=real）对 API 请求返回 33 条真实记录。
- 绑定安全：`resolve_bind_defaults()` 默认 127.0.0.1，仅在 PORT env 注入时绑 0.0.0.0 —— 无未认证端点公网暴露风险。

### 2.4 离线缓存行为（P0 第 6 项，F11 测试显式验证 ✅）

`app/tests/v3f1-data-sync.test.mjs` F11（11/11 pass）：
- server 不可达 → `kind=unavailable`，文案「无法连接数据服务，已保留本地数据（未刷新）」，**不伪造「已刷新」**。
- 缓存数据完整存活（`readCachedDataset()` 仍可读出全部活动）。
- `lastSuccessAt` 不伪造；`lastError`/`lastErrorCode=unavailable` 正确记录。
- 缓存双写：localStorage + Capacitor Preferences（`gorgon_` 前缀，native-persistence 镜像），杀进程可恢复。

### 2.5 API key 安全（P0 第 7 项）

- APK 内不含任何 key/token/secret（zip 级验证）。
- 认证始终留在 PC 端 server 进程环境，APK 只带公开数据端点 URL。

---

## 三、P1 活动数据真实性

### 3.1 关键 bug 发现与修复（`fb33cee`）

**bug**：`/api/activities` 返回 RAW 已批准记录（有 `sourceName`、**无** `demo` 字段），
而 `DiscoverScreen` 过滤 `!a.demo` → 手动刷新后 **17 条 demo 种子泄漏进真实列表**。

**修复**（`app/src/lib/data-sync.js` + `app/src/lib/data.js`）：
- 新增 `DEMO_SOURCE_NAMES` 白名单（`ai_community` / `campus_bbs` / `city_portal` / `demo_source`），
  与服务端 exporter（`gorgon_export.py _DEMO_SOURCES`）规则一致；白名单=demo，其余（douban 等）=real。
- `stampDemoFlags()` 在两条路径打标：fetch 路径（`validateActivitiesPayload`）+ 缓存恢复路径（`data.js`）。
- 不覆盖显式 `demo` 字段；null/垃圾行原样透传。

### 3.2 验证

- 新增测试 F8/F9/F10（`v3f1-data-sync.test.mjs`）：douban→real、四个 demo 源→demo、未知源→real、
  显式字段保留、垃圾行透传。11/11 pass。
- APK bundle 验证：16 个唯一 douban ID 在压缩后存活；stamping 函数存活（minify 后 `f1=new Set([...])` + `Fm(e)`）。
- **发现页默认**：`realActivities = activities.filter(a => !a.demo)`，默认只显示真实活动。

### 3.3 日期计算（3.4 项）

- `activity-recency.js` `whenFilter`：今天 / 未来7天 / 未来30天 / 全部；过期行排除。
- `endInstantOf` / `startInstantOf` / `dayDiff` 均为纯函数，已有既有测试覆盖，本轮无改动。

### 3.4 来源链接/时间/地点证据

- 33 条已批准记录的真实性分类复核：10 条真实 douban（`douban_3698xxxx`）+ 17 条 demo 种子 + 6 条其他。
- 来源标注逻辑未改动，复用 V3F.1 已验证实现。

---

## 四、P2 持久化与真实操作

### 4.1 代码侧验证（自动化测试通过 ✅）

- 离线缓存恢复：F11 显式测试（见 2.4）。
- 持久化双写（localStorage + Capacitor Preferences）沿用 V3F 已验证实现，本轮无改动。

### 4.2 真机验收（NOT_TESTED_DEVICE ⚠️ 需要物理手机）

以下流程**自动化测试通过 ≠ 真机验收**，统一标记 `NOT_TESTED_DEVICE`，人工步骤见第六节：

- 覆盖安装（versionCode 8→9）保留本地数据
- 创建/保存/重开活动
- 创建/执行/完成/重启任务（含「已执行过」防重复）
- 笔记关联活动
- 真机刷新真实活动 + 缓存恢复
- server 关闭后使用本地功能

---

## 五、P3 发布管理

### 5.1 版本策略

- 保留既有 `v0.3.3-alpha`（未强移）；新发 `v0.3.4-alpha` Pre-release。
- `build.gradle`：versionCode 8→9、versionName 6.0.3→6.0.4（commit `6197b4f`）。

### 5.2 原子写入审计（commit `60fa85b`）

- `pipeline/crawlers/run.py`：**最后一个非原子写入方**，已改为每进程唯一临时文件
  （`path.<uuid8>.tmp` + `os.replace`）——固定 `.tmp` 名的并发竞态消除。
- 此前已原子：`pipeline/run.py`、`pipeline/export/gorgon_export.py`、`pipeline/location/geocoder.py`、`pipeline/search/cache.py`。
- 剩余非原子写入方（`crawl_to_raw.py` / `admin_review_export.py` / `search_export.py` / `validate_nearby.py` / `placeholders.py`）：
  写 pipeline 内部位置，单进程场景，优先级低，**本轮不处理**（遵守「不无限开发」）。

### 5.3 发布链

| 项 | 值 |
|---|---|
| Tag | `v0.3.4-alpha`（annotated）→ commit `6197b4f`（与构建 APK 的源码一致） |
| Tag 推送 | ✅ 已推送 cec |
| Release | https://github.com/cvcingcvc-code/cec/releases/tag/v0.3.4-alpha （Pre-release） |
| APK 资产 | `gorgon-workbench-v0.3.4-alpha.apk`（3,847,537 字节），已上传 |
| APK SHA256 | `8201fac0d65092c2087f3e92ca0750e91b7a050009a7e8b46ba32da664376b2b` |
| 签名 | CN=Gorgon Workbench, OU=Gorgon, O=Gorgon, L=Shanghai, ST=Shanghai, C=CN（release keystore） |
| 下载链接 | https://github.com/cvcingcvc-code/cec/releases/download/v0.3.4-alpha/gorgon-workbench-v0.3.4-alpha.apk |

### 5.4 Debug 签名版本

- Debug-signed 版本仅用于测试（如有），不进入 Release 资产。本版 release APK 用 release keystore 签名。

---

## 六、人工验收步骤（需要物理手机，逐条打勾）

> 下载：https://github.com/cvcingcvc-code/cec/releases/download/v0.3.4-alpha/gorgon-workbench-v0.3.4-alpha.apk

1. **安装**：手机浏览器打开下载链接 → 安装 APK。
   - [ ] 若手机已装 6.0.3（versionCode 8）：直接覆盖安装应成功，本地数据（自建活动/笔记）保留。
   - [ ] 若为全新安装：正常打开。
2. **发现页真实性**：打开 App → 发现页。
   - [ ] 默认只显示真实活动（豆瓣来源），**无** demo 种子（「AI 社区/校园版面/城市通」来源的旧演示活动不出现）。
3. **刷新不丢数据**：下拉刷新。
   - [ ] 当前部署服务器无 `/api/activities` 端点 → 应看到「刷新失败（404），已保留本地数据」类文案，**数据不消失**（这是预期行为，不是 bug）。
4. **离线缓存**：关闭 PC 端 server → 杀掉 App 进程 → 重开。
   - [ ] 活动列表仍可浏览（缓存恢复）。
5. **闭环流程**（沿用 V3F 第五步清单）：
   - [ ] 创建活动 → 保存 → 杀进程重开 → 活动还在。
   - [ ] 创建任务 → 执行 → 任务列表可见 → 杀进程重启 → 还在 → 再点「执行」提示已执行过、不产生重复。
   - [ ] 创建笔记关联活动 → 杀进程重开 → 关联仍在。
6. **LAN 连通（可选）**：PC 与手机同一 Wi-Fi，PC 起 `python -m pipeline.api.server`（PORT 注入）→ 手机访问。
   - [ ] 能拿到 33 条真实活动。此步需要用户自行决定网络环境，不强制。

---

## 七、未解决问题（不阻塞发版）

1. **部署服务器缺 `/api/activities` 端点**（P0 主要遗留）：
   需要在 WorkBuddy 云端站点重新发布最新构建（当前部署是 V3F.1 前版本）。
   发布成功后手机刷新才会拉到 33 条真实记录；在此之前 App 会如实报告 404 并保留本地数据。
2. **真机连通未验收**：所有 NOT_TESTED_DEVICE 项（第六节）需物理手机逐条确认。
3. **剩余 5 个 pipeline 内部非原子写入方**：单进程、pipeline 内部位置，低优先级，本轮明确不处理。
4. **Node 全量套件并发跑受限**：WorkBuddy 沙箱 safe-delete shim 阻塞 >50 文件清理 + 并发端口冲突，
   隔离运行全部通过（18/18、29/29），非代码缺陷。如需全量绿，可在无沙箱环境跑一次。

---

## 八、本轮提交链（全部已推送 cec `feature/gorgon-opportunity-v2`）

| Commit | 类型 | 内容 |
|---|---|---|
| `fb33cee` | fix(data) | 手机刷新行打 demo 标记，demo 种子不再泄漏进真实列表 |
| `60fa85b` | fix(crawler) | JSON 原子写入（每进程唯一临时文件），消除并发竞态 |
| `6197b4f` | chore(android) | versionCode 9 / versionName 6.0.4，v0.3.4-alpha 发布 |
| `3b349bf` | test(data) | F11 离线刷新保留缓存 + 如实报告（P0 显式验证） |
| `eaf96d0` | docs(workbench) | V3F.2 交付凭证写入执行状态文档 |
| tag `v0.3.4-alpha` | | → `6197b4f`（已推送） |

## 九、测试统计

- `v3f1-data-sync.test.mjs`：**11/11 pass**（F1–F7 契约 + F8–F10 stamping + F11 离线）
- 隔离套件：v3c-codex-adapter + v3c-gateway-lifecycle **18/18**；v3d-gateway-injection-security 三件套 **29/29**
- Python pipeline：**461 passed + 150 subtests**（无回归）
- Gradle assembleRelease：**BUILD SUCCESSFUL**（4m19s / 246 tasks）
- Vite build（build-apk 内含）：✓ 通过
