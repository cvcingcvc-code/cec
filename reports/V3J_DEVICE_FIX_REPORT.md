# V3J Device Fix Report

**分支**: `feat/v3j-device-fix`（基于 `feat/v3i-android-full-delivery` @ `e2514af`）
**真机基线**: v0.3.7-alpha (versionCode 12)
**本包**: v0.3.8-alpha (versionCode 13, versionName 6.0.8)
**状态**: `DEVICE_NOT_TESTED` — 全部修复已通过单测 + E2E + 构建验证，等待真机重测。

---

## 提交清单（e2514af..HEAD）

| 提交 | 问题 | 内容 |
|---|---|---|
| `1cbfa5e` | P0 截止时间闪退 | DatePickerSheet 缺失 `formatCNTime` import — 崩溃根因 |
| `13084e2` | P0 截止时间闪退 | dueAt 时区偏移 — UTC ISO 被按本地时间切片 |
| `9c9d9b3` | P1 笔记新建 | 笔记中心新建入口 + composer + 编辑 |
| `2a8a1ff` | P1 搜索图片 | 搜索卡片渲染真实活动图片 |
| `dbd12a3` | P1 真实地图 | 真实坐标 pin + 导航入口 + 无坐标如实标注 |

---

## P0：截止时间闪退

**现象**: 真机上打开截止时间弹窗闪退/白屏；重新打开后时间偏移。

**根因**（两个独立缺陷叠加）:
1. `DatePickerSheet.jsx` 引用了未 import 的 `formatCNTime` → 渲染抛 ReferenceError → WebView 白屏/闪退。
2. `dueAt` 存储 UTC ISO 字符串，展示层用 `new Date(iso.slice(0,16))` 按本地时区重新解析 → 偏移 8 小时。

**修改文件**:
- `app/src/components/ds/DatePickerSheet.jsx`（import 修复）
- dueAt 序列化/解析链（UTC 保留，展示层显式转换）

**测试证据**:
- `app/tests/v3j-datepicker-crash.test.mjs`（单测）— PASS
- `app/tests/v3j-datepicker-render-e2e.mjs`（E2E，`reports/v3j-datepicker-flow.png`）— PASS
- 全量: app 591 pass / 0 fail；pipeline 480 OK

**真机验证**: DEVICE_NOT_TESTED — 需在真机打开任一活动的「设置截止时间」确认不再闪退、时间显示与设置值一致。

---

## P1：笔记新建

**现象**: 笔记中心只有列表，无新建入口（原型遗留缺陷）。

**修改文件**:
- `app/src/App.jsx`（路由 + FAB 入口）
- `app/src/screens/NotesScreen.jsx`（新建 composer + 编辑）

**测试证据**:
- `app/tests/v3j-note-create.test.mjs`（单测）— PASS
- `app/tests/v3j-note-create-e2e.mjs`（E2E，`reports/v3j-note-create.png`）— PASS

**真机验证**: DEVICE_NOT_TESTED — 需在真机笔记中心点 FAB → 输入 → 保存 → 确认出现在列表。

---

## P1：搜索图片

**现象**: 搜索结果卡片图片区域显示 `[object Object]` 破图；真实豆瓣海报未展示。

**根因**:
1. 数据链断裂：douban RawEvent 的 `rawData.listing.imageUrl` 在 bridge 转换时丢失，canonical 记录无 `imageUrl`。
2. 前端契约不清：`image` 字段可能是 string 或 descriptor object，`ActivityCard` 直接 `url(${image})` → object 渲染成 `[object Object]`。

**修改文件**:
- `pipeline/bridge/crawl_to_raw.py`：新增 `_listing_image_url()`，act dict 增加 `imageUrl/imageSource/imageType`（verbatim，无图留 None）
- `app/src/components/ds/ActivityCard.jsx`：`imageUrlOf()` 解析 string | descriptor | 原始记录；probe `<img>` onError 回退分类渐变
- `app/src/screens/SearchScreen.jsx`：卡片渲染走 `V.toView(a)` 规范化

**测试证据**:
- `pipeline/tests/test_bridge.py`（8 单测）— PASS
- `app/tests/v3j-image-e2e.mjs`（12 checks，`reports/v3j-search-image.png`）— PASS
  - 场景 A: 搜索卡片渲染真实豆瓣海报 URL（`loaded:175x259` 实际加载成功）
  - 场景 B: 无 `[object Object]`
  - 场景 C: 失效链接 onError 可捕获 → 分类渐变回退
  - 场景 D: dist bundle 断言（doubanio URL + listing-thumbnail）

**真机验证**: DEVICE_NOT_TESTED — 需在真机搜索页确认豆瓣海报加载、无破图。

---

## P1：真实地图

**现象**: 地图页是 CSS 网格假地图（假河流/公园/道路），pin 按数组序号撒点，无导航入口。

**根因**: 原型实现用 `layout(n)` 把第 n 个活动放到固定网格位；坐标字段从未接入真实数据。

**方案**（Android WebView 适配，无 SDK key 依赖）:
- 数据侧: `pipeline/data/locations/places.json` — 23 entries，21 条 Amap GCJ-02 真实坐标（address-first 查询 + district 交叉验证）；1 条 not_found + 1 条 district_mismatch 如实保留（坐标置 None，不造假）
- 导出侧: `gorgon_export.py` `_real_coord()` 从 places.json 读真实坐标；区县质心 fallback 删除；新增 `coordProvider/coordSystem`
- 前端: `MapScreen.jsx` 完全重写 — equirectangular 投影 + cosLat 压缩，bounds 从实际 pin 推导（±12% margin），北在上；点击 marker 显示名称/地址/详情；「打开地图导航」走 Amap marker URI（`callnative=1`）→ `geo:` URI 兜底；无坐标记录进列表标 `· 无坐标`

**禁止项验证**: 无数组序号假坐标；无区县质心假 pin；无编造图片。

**测试证据**:
- `app/tests/v3j-map-e2e.mjs`（11 checks，`reports/v3j-map.png`）— PASS
  - 假地图已移除（无 rotate(-8deg) 河流块）
  - 15 pins、6 distinct lefts（真实投影非网格）
  - marker 点击 → `douban_36988401` 卡片渲染
  - 导航 URI 捕获: `https://uri.amap.com/marker?position=121.420814,31.197524&name=...`
  - 无坐标一致性: listN=16, pinN=15, noCoordN=1
  - console errors = 0
- 数据: 31/33 记录带真实 GCJ-02 坐标（generated-data.js），0 质心假坐标

**真机验证**: DEVICE_NOT_TESTED — 需在真机地图页确认 pin 分布合理、点击出详情、导航按钮拉起高德/系统地图。

---

## 构建与发布

- 全量测试: pipeline 480 OK（skipped=1）；app 591 pass / 0 fail / skipped 1
- vite build: `dist/assets/index-CSXVYwra.js` 648.34 kB (gzip 185.53 kB) — 构建成功
- 安全检查: bundle 内无 AMAP_KEY、无 sk- API key（sk- 命中为 sk-priority 等类名）
- versionCode 12 → 13, versionName 6.0.7 → 6.0.8
- 签名: keystore.properties + `app/gorgon-release.keystore`（SHA-256 `45b44236…f47167`，v2 scheme），覆盖安装保留数据

**APK**: `gorgon-workbench-v0.3.8-alpha.apk`（GitHub Release 见交付消息）

---

## 真机重测操作

1. 下载 APK 安装（覆盖安装，数据保留）。
2. 逐项验证（对应 Issue #1 记录 PASS/FAIL/NOT_TESTED）:
   - P0: 打开活动详情 → 「设置截止时间」→ 不闪退、时间正确
   - P1: 笔记中心 → FAB 新建 → 保存出现在列表
   - P1: 搜索页 → 海报加载、无 `[object Object]`
   - P1: 地图页 → pin 分布、点击详情、导航按钮
3. 反馈写回 Issue #1。

---

## 已知限制

- 地图是轻量自绘投影（非 SDK），无缩放/拖拽交互；后续可换地图 SDK 或 WebView tile 层。
- places.json 1 条 not_found（【时光剧场】音乐剧）+ 1 条 district_mismatch（创智天地嘉定 POI）如实无坐标。
- douban 原始记录无 venueName，address 即 venue 文本。
