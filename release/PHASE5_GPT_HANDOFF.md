# Gorgon Phase 5 交接概述（WorkBuddy → GPT）

> 本文自包含：读完即可理解 WorkBuddy 在 Phase 5 做了什么、当前状态是什么、
> 你（GPT）接下来要执行什么、必须遵守哪些边界。无需重扫仓库。

---

## 1. 项目与固定基线

| 项 | 值 |
|---|---|
| 项目 | Gorgon Workbench（Android AI 智能行动工作台，Capacitor + React + WebView） |
| Git 根 | `C:\Users\lin\Documents\Gorgon-Workbench` |
| app 目录 | `C:\Users\lin\Documents\Gorgon-Workbench\app` |
| 分支 | `feature/gorgon-opportunity-v2` |
| 最终提交 | `59ea484` feat(phase5): source traceability on the project detail activity card |
| 提交链 | `b6bac9c`(Phase 4 核心) → `4286656`(today 修复) → `4bc2870`(E2E 守卫) → `59ea484`(来源追溯) |
| push 状态 | **未 push**（用户明确边界） |
| 最终候选 APK | `app/android/app/build/outputs/apk/debug/app-debug.apk`，5,417,388 bytes，sha256 `988987ee9324a10dbd97386a911722684f9246bd9a7797e1200acb310581984d`（Oct 11 00:46 构建，versionCode=4/versionName=4.0，含全部 Phase 5 改动） |
| 验收报告 | `release/PHASE5_ACCEPTANCE_REPORT.md`（§11 是最终验收 run 记录） |

**工作树注意**：当前有 9 个修改文件——`pipeline/data/**` 8 个数据运行时文件 +
`ui_kits/admin/generated-review-data.js`，是 API server（real 模式）与测试套件
运行的**数据副作用，非代码改动**；另有未跟踪的 `release/PHASE5_ACCEPTANCE_REPORT.md`。
**不要 checkout/restore/clean 这些文件**（禁止破坏性 git 操作）。

**勿混淆**：`docs/PHASE5_FINAL_REPORT.md` 是早期 human-review-loop 分支的旧
Phase 5 报告（桌面检索侧），与本次 Android Phase 5 无关。

---

## 2. WorkBuddy 在 Phase 5 做了什么

### P5-A 现状审计
区分了 Feed / Review / 智能搜索 / API Provider 四个模块的真实实现状态：
Feed 走真实检索链路（`pipeline/search/webproviders.py`，SegmentFault/活动行/
豆瓣/Meetup，全部 dataOrigin="real"，无需 API key）；Review 是真实写入；
智能搜索是真实链路 + 离线 demo fallback **显式标识**（DEMO 徽章）；API Provider
同源设计，bundle 扫描 0 密钥、0 localhost 依赖（sk- 前缀是 CSS 动画 token 非密钥）。

### P5-B 真实信息闭环
真实检索 HTTP 200 闭环验证：68 raw → **29 real / 0 demo**，providerMode=real，
provenance 完整（每条活动带 title/startDate/venue/sourceUrl/dataOrigin/retrievedAt）。
样本存档于 WorkBuddy 工作区 `.workbuddy/p5/real_search_sample.json`。
**缺失字段不编造**：快照无 sourceUrl 时 UI 渲染 NOTHING。

### P5-C 行动与复盘链路
完整链路逐项验证：发现信息 → 保存项目 → 生成待办（**AI 从不代标完成**，
suggestions 一律以待执行状态落库）→ 安排日期 → 合法路径状态机
（created→ready→running→completed）→ 记录笔记 → 手写复盘 → 冷启动恢复。
来源可从项目详情追溯（活动卡「查看来源」链接，仅当快照有 sourceUrl 时渲染）。

### P5-D Android 验收
- v5 APK 构建成功 + 覆盖安装数据保留验证 PASS（p5_diag3）。
- E2E **55/55 全 PASS**（54 原项零回归 + 1 新增守卫）——修复后实测。
- bundle 安全扫描通过。

### 修复的 3 个缺陷（各一个提交）
1. **`4286656`** — today 透传缺陷：nearby 过滤用了未钉住的 today，导致日期腐烂。
2. **`4bc2870`** — step2 七连锁失败的根因（CDP 双向确证）：force-stop SIGKILL
   进程时 Chromium 尚未把 localStorage 删除刷盘 → 重启后从磁盘 LevelDB 复活
   旧项目 → 活动「已关联」→ 创建按钮不渲染。修复：step0b 显式 await 原生
   Preferences 删除 + 新增 **step0c 磁盘复活守卫**（重启后在运行中的 WebView
   里再清一次并断言）。
3. **`59ea484`** — 项目详情活动卡无来源追溯入口 → 新增「查看来源」链接。

---

## 3. 当前验证状态（全部实测，非推断）

| 项 | 状态 |
|---|---|
| Python pipeline (unittest) | **453/453 OK**（2026-10-12 19:1x 实测，exit 0，89.6s） |
| App JS unit (node --test) | **277/277 OK**（同日实测，4.4s） |
| Android E2E | **55/55 PASS**（修复后实测）——但**最终 APK 上的形式验证 run 尚未完成**，这是唯一未收口项 |
| 覆盖安装/冷启动数据保留 | PASS（p5_diag3） |
| 真实/DEMO 隔离 | PASS（DEMO 徽章 + demoResults=0） |
| 真机测试 | **BLOCKED**（无物理设备） |

---

## 4. 唯一阻断项（诚实记录）

**模拟器在 WorkBuddy 沙箱内无法启动**。共 7 轮尝试：1 轮长跑 16 分钟但 ADB
一直 offline + 6 轮 spawn 后静默退出（exit code 1，无 stderr，仅 3 行 INFO）。
模拟器二进制本身健康（`-version` exit 0、`-list-avds` 返回 gorgon_test），
判定为 **WorkBuddy 沙箱对子进程的限制**（spawnSync 抛 EBUSY、后台进程被回收、
detached 进程退出），非工具链或项目问题。

2026-10-12 19:13 最终验收尝试：`adb devices -l` 返回 0 台设备、无 qemu 进程
→ 按停止条件立即停止，E2E 未执行，PHASE5_STATUS 保持 **MOSTLY_DONE**。

日志路径：WorkBuddy 工作区 `.workbuddy/p5/emulator2–7.log`（7 轮诊断）、
`.workbuddy/p5/pipeline_final_run_1012.log`（今日回归实测）。

---

## 5. 你（GPT）要执行的规划：P5-D 最终 Android E2E

**当前阶段只做最终验收，不得扩展功能。**

### 第一步：ADB 设备检查
```bash
adb devices -l
# adb 位于 F:/gorgon-android-toolchain/sdk/platform-tools/adb.exe
```
只有当目标模拟器显示为 `device` 时才继续。**如果不可用，停止，不要循环重启
模拟器**（沙箱内已 7 轮确认无法启动；若你在非沙箱终端，可用 Phase 4 验证过
的方式启动：从 `F:\gorgon-android-toolchain` 执行
`emulator -avd gorgon_test -no-snapshot-save -no-boot-anim -gpu swiftshader_indirect`）。

### 第二步：确认 Git 基线
```bash
git rev-parse --short HEAD    # 必须是 59ea484
git status --short            # 预期：9 个 pipeline 数据文件 + 未跟踪验收报告
```
不要覆盖用户文件，不要还原数据运行时文件。

### 第三步：执行既有完整验收驱动
```bash
cd C:\Users\lin\Documents\Gorgon-Workbench
node app/tests/android_phase4_e2e.mjs
```
**使用现有测试，不重写测试，不修改已通过的业务逻辑。** 确保 E2E 针对当前
最终代码和候选 APK（59ea484 + sha256 988987ee…）。

### 通过后的收尾
1. 更新 `release/PHASE5_ACCEPTANCE_REPORT.md` §11：记录最终 HEAD、APK SHA256、
   运行时间、55 项断言结果及实际环境。
2. `PHASE5_STATUS` 更新为 **DONE**，明确 `REAL_DEVICE_TEST=BLOCKED`。
3. 检查报告与最终代码、APK 的对应关系（commit 链、sha256、55 项列表）。
4. 检查 Git 工作树并保留全部历史证据。
5. **不 push，不擅自创建新分支，不启动 Phase 6。**

### 失败停止条件（必须遵守）
- ADB 设备不可用 → 停止，不循环重启。
- 同一种外部环境故障最多尝试两次。
- E2E 出现真实业务回归 → 只定位并修复该缺陷，然后运行必要回归测试。
- **不得将旧版本的 55/55 结果冒充最终版本的验收结果。**
- **不得将环境故障标记成业务测试通过。**

---

## 6. 环境备忘（执行时需要）

- **ADB**：`F:/gorgon-android-toolchain/sdk/platform-tools/adb.exe`
- **AVD**：`gorgon_test`（pixel_7 · android-35 · google_apis · x86_64 · 2560MB RAM）
- **Gradle**：增量构建约 26 秒（`--no-daemon`，GRADLE_USER_HOME/JAVA_HOME/
  ANDROID_HOME 指向 `F:\gorgon-android-toolchain` 下的 jdk-21/gradle-8.14.3/sdk）
- **Python**（跑 pipeline 测试）：系统 Python
  `C:\Users\lin\AppData\Local\Programs\Python\Python314\python.exe`（3.14.2）
  ——WorkBuddy 托管 Python 没装 pandas，别用错
- **Node**：`C:/Users/lin/.workbuddy/binaries/node/versions/22.22.2-6/node.exe`
- **磁盘**：C 盘接近满（约 1.1GB 可用），F 盘 65GB 可用——大产物放 F 盘
- **git refs 陷阱**：本机 `.git/refs` 有静默丢写问题——commit 后核实用
  `git rev-parse HEAD` + ref 文件读回，别只看命令返回
- **E2E 机制**：CDP 驱动真实 WebView DOM（`adb forward tcp:9222
  localabstract:webview_devtools_remote_<pid>`），无 mock；脚本含 step0b/step0c
  双守卫处理 localStorage 磁盘复活问题

---

## 7. 一句话总结

Phase 5 的代码与验证工作已全部完成并有实测证据（453/453 + 277/277 + 55/55 +
真实检索 29 real/0 demo + v5 APK），唯一剩余动作是**在能启动模拟器的终端里对
最终候选 APK 跑一次完整 E2E**（55/55 形式验证），通过后把
`PHASE5_STATUS` 从 MOSTLY_DONE 升为 DONE 并更新验收报告 §11——不得扩展功能、
不得 push、不得冒充或虚报结果。
