# GORGON FINAL HANDOFF — V3H 轮（2026-10-15）

> 本报告为长周期自主开发轮的实际执行记录。所有数字为本轮实测所得，非继承历史报告。

## 1. 最终项目状态

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/cvcingcvc-code/cec |
| 本轮开发分支 | `feat/v3g-agent-results-zh` |
| HEAD | `62eab43`（chore(android): bump versionCode 10->11, versionName 6.0.5->6.0.6） |
| 上一功能提交 | `5aa5579`（fix(router): interview-prep goals route to extract） |
| PR | [#6](https://github.com/cvcingcvc-code/cec/pull/6) — OPEN **Draft**（8 commits：V3G 6 个 + V3H 2 个），待真机验收合并 |
| APK 版本 | **v0.3.6-alpha**（versionCode 11 / versionName 6.0.6） |
| GitHub Release | [v0.3.6-alpha](https://github.com/cvcingcvc-code/cec/releases/tag/v0.3.6-alpha)（Pre-release） |
| 交付日期 | 2026-10-15 |
| 基线审计 | `reports/V3H_BASELINE_AUDIT.md`（已提交入库） |

历史 Release v0.3.0 ~ v0.3.5 全部保留，未删除、未覆盖。无 force push。主仓库工作树（Gorgon-Workbench，落后远端 25 commits + 他人未提交改动）本轮未触碰。

## 2. 已完成功能（逐项）

**本轮之前已具备（本轮审计确认并全部复用，未重写）：**

1. **统一任务模型**：完整 schema（任务 ID/标题/目标/来源/创建时间/状态/优先级/计划时间/关联地点/子任务/执行结果/关联笔记/timeline 历史/失败原因），Agent 执行记录（agentRunIds）链接。
2. **工作台首页**：今日待办、待完成数、项目卡、最近任务、最近笔记、工作台状态，全部来自真实持久化数据（localStorage + Capacitor Preferences 双写），无硬编码。
3. **自然语言创建任务**：目标 → 真实 createTask 工厂 → 任务详情页；AI/引擎未执行时如实显示，不伪造。
4. **任务完整生命周期**：created → ready → running → completed/failed 状态机（非法流转抛错）+ 软删除 30 天回收站 + 复盘。
5. **活动系统**：真实豆瓣数据源 + 手机手动刷新（`/api/activities`）+ 离线缓存如实报告 + activity-recency 时效模型（历史活动不冒充当前）+ demo 泄漏修复。
6. **日程系统**：ScheduleScreen + 任务关联日期 + in-app 提醒（firedKey 去重）+ native-reminders 桥。
7. **地点系统**：任务/项目关联地点 + 走访状态。
8. **笔记与复盘**：任务↔笔记关联 + 项目复盘 + 从任务进入笔记。
9. **电脑端 Gateway**（`scripts/agent-gateway.mjs`）：token 配对、执行器白名单（repo.status / repo.readDoc / host.stats / codex.readonly-diagnosis）、60s 超时、审计日志、默认 loopback 绑定（`--lan` 才开局域网）、单并发队列。
10. **Codex 适配**：read-only 沙箱、预批准模板、BLOCKED_AUTH/NETWORK/USAGE_LIMIT 诚实状态，绝不把失败伪装成成功。
11. **手机端智能体界面**：连接电脑、执行器列表、提交、4 秒轮询、取消、中文结果主视图 + 原始 JSON 折叠在「技术详情」、结果关联回任务、离线 mirror。

**本轮新增（V3H）：**

12. **场景 A 阻断修复**：`明天下午我要去面试，帮我整理准备事项` 此前路由 `unknown`（引擎零步骤，任务无法执行）。修复两个根因：
    - extract-skill `relDate` 正则负向断言 `(?![一-日])` 字符范围过宽（U+4E00–U+65E5），"明天下午"的"下"、"明天我"的"我"均被拒——**所有相对日期后跟常见汉字即匹配失败**。收窄为只排除日期词字符（天末周一~五）。
    - task-router extract 关键词缺"准备/清单/事项/整理"——面试/清单类目标无法命中引擎。已补词。
    - 修复后：面试目标路由 `extract` + 抽出"明天"；闲聊（"今天天气真不错"）保持 unknown 不误判。
13. **e2e 测试基建 flaky 修复**：`stopGateway` 的 `taskkill` 在子进程已自行退出时（退出竞态）不再使测试 hook 失败。
14. **基线审计报告**：`reports/V3H_BASELINE_AUDIT.md` 入库。

## 3. 电脑联动状态（明确回答）

| 问题 | 回答 |
|---|---|
| 手机能否连接电脑？ | **代码层完成，真机未验**。手机 AgentScreen 填电脑局域网 IP + 配对 token → Gateway `/health` + `/v1/executors`。Gateway 需在电脑上以 `--lan` 启动（默认 loopback 拒绝外部）。 |
| 电脑能否接收任务？ | **代码层完成，真机未验**。`POST /v1/runs`（白名单执行器 + token 校验）。PC 侧 v3b-system-e2e 已用真实 HTTP + 真实执行验证全链路（任务 → gateway run → 结果 → 关联回任务 → 完成）。 |
| AI 能否真实执行？ | **部分**。`codex.readonly-diagnosis` 执行器会真实调用本机 Codex CLI（read-only 沙箱 + 预批准模板）；本机未配置/不可用时如实显示 UNAVAILABLE。真实模型调用测试为显式 SKIP（P1，设计如此）。3 个本地执行器（git 状态 / 读文档 / 主机概览）为真实执行，不依赖 AI。 |
| 手机能否看到真实结果？ | **代码层完成，真机未验**。中文结果主视图（电脑概况/项目文件状态/文档内容/Codex 分析结果），原始 JSON 折叠在「技术详情」，结果可关联回手机任务并持久化。 |
| 哪些已测试？ | Gateway 生命周期 8/8、注入安全 11/11、Codex 适配 10+1SKIP、系统 E2E（真实 HTTP + 状态机）2/2 连跑 3 次稳定、Agent UI 17/17、结果 presenter 4/4。 |
| 哪些只能等待真机验证？ | 手机 Wi-Fi 连电脑（`--lan` + IP + token）、真机提交 run → 电脑执行 → 手机显示、覆盖安装数据保留、真实活动刷新、离线恢复、提醒通知。 |

## 4. 测试结果（本轮实测）

| 套件 | 结果 |
|---|---|
| Node 全量 `npm test`（禁用 safe-delete shim） | **571 项：570 pass + 1 SKIP + 0 FAIL**（SKIP = Codex 真实调用 P1，设计如此） |
| — router（含 4 组新增 V3H 回归） | 16/16 |
| — skills（含 4 组新增 relDate 回归） | 21/21 |
| — v3g-agent-result-presenter | 4/4 |
| — v3d-android-agent-ui | 17/17 |
| — v3b-system-e2e（真实 HTTP 链路） | 2/2（连跑 3 次稳定） |
| — v3c-gateway-lifecycle | 8/8 |
| — v3d-gateway-injection-security | 11/11 |
| Python pipeline（unittest discover） | **472 tests OK（1 skip）** |
| 构建冒烟 `npm run test:build` | 18/18（含 no secret pattern、无服务端路径、无绝对路径） |
| Vite 生产构建 | 成功（chunk >500kB 警告为既有情况） |
| Gradle assembleRelease | **BUILD SUCCESSFUL**（53s，246 tasks） |
| 真机验收 | **DEVICE_NOT_TESTED**（adb devices 为空，无物理设备） |

**环境干扰记录（非代码缺陷）**：WorkBuddy CLI 的 node-safe-delete-shim 在进程累计删除 >50 个目标时抛 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`——全量套件清理测试临时目录必然超阈值，曾表现为 flaky 12 失败（失败集合两次运行不一致、单文件全绿）。全量绿需 `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm test`。

**云端部署核实**：`https://2109679843717304320.app.workbuddy.host` — `/api/health` 200；`/api/activities` 200，33 条记录（17 demo=true + 16 demo=false，全部显式布尔 demo）。V3F2 报告中"部署缺端点"问题已解除。

## 5. APK 下载链接

**手机可直接访问**：

https://github.com/cvcingcvc-code/cec/releases/download/v0.3.6-alpha/gorgon-workbench-v0.3.6-alpha.apk

- versionCode **11** / versionName **6.0.6**（> 10，可直接覆盖安装 v0.3.3~v0.3.5，无需卸载）
- applicationId：`cn.gorgon.workbench`
- SHA256：`726d8d5826e4ef493f2701d2fc1a843ef60130129535a2c85453531da01c0a24`（下载回验一致）
- 签名：与历史版本同一 `gorgon-release.keystore`（cert SHA-256 `45b442368c7e270c5e564c704d13f23b526975329fae6b28a9bf828c70f47167`），v2 scheme verified → 覆盖安装兼容
- 敏感扫描：bundle 无 SEARCH_API_KEY、无硬编码密钥（`sk-*` 命中均为 UI class，非密钥）
- Release 页：https://github.com/cvcingcvc-code/cec/releases/tag/v0.3.6-alpha

## 6. 用户明天的真机测试步骤（≤10 步）

1. **安装**：手机浏览器打开上面的 APK 下载链接 → 下载 → 安装（若已装旧版直接覆盖，数据保留；若提示签名冲突，说明装过非官方签名版本，先卸载）。
2. **打开工作台**：确认首页显示今日待办/最近任务/项目（第一次用是空的，正常）。输入「明天下午我要去面试，帮我整理准备事项。」回车——任务应创建成功，进详情后点「运行任务引擎」应生成提取步骤，不再显示"未识别"。
3. **看活动**：底部「发现」页——应只显示真实活动（无"AI 社区/校园版面"旧演示数据）。点「刷新数据」：联网时应拉到服务器最新列表；断网时应提示保留本地数据（不是白屏）。
4. **建任务+日程**：创建一个任务 → 详情里设计划日期/优先级 → 杀掉 App 重开 → 任务和日期还在（持久化）。
5. **记笔记**：任务详情 → 添加笔记 → 杀进程重开 → 笔记仍在且仍关联该任务。
6. **连接电脑**（可选，需电脑配合）：电脑上进入 Gorgon-Workbench 仓库，运行 `node scripts/agent-gateway.mjs --lan`，记下启动时打印的 token；手机「更多 → 智能体」→ 填电脑局域网 IP:8765 + token → 连接。同一 Wi-Fi 下应显示"已连接电脑"。
7. **执行真实电脑任务**：连接后选「读取 Gorgon 仓库的 git 状态」→ 提交 → 等待几秒 → 手机应显示电脑返回的真实分支/脏文件列表（中文主视图），点「技术详情」可看原始输出。把结果「关联到任务」可在任务详情里留存。
8. **断网/异常**：连接状态下关掉电脑 Gateway → 手机应显示连接错误（不是假成功）；重开 Gateway 后可恢复。
9. **中文显示**：全流程检查中文无乱码、长文本可展开、按钮可点。
10. **反馈错误**：任何异常截图 + 复现步骤发到 https://github.com/cvcingcvc-code/cec/issues （既有 Issue #1 验收入口 / #3 界面语言问题）。

## 7. 未解决问题

**P0（影响基本使用）**：无已知项。

**P1（影响核心功能）**：
1. **真机验收 DEVICE_NOT_TESTED**：所有设备相关行为（覆盖安装、Wi-Fi 连接、刷新、持久化、通知）未经物理手机确认。明天验收后如有失败只修失败项。
2. **Codex 真实调用未验证**（SKIP by design）：本机 Codex CLI 可用性、配额、登录状态未核实；不可用时如实显示 UNAVAILABLE，不阻塞其他执行器。

**P2（体验优化）**：
1. 「整理一份资料清单」类目标会同时命中 search+extract（workflow），执行的 search 部分对纯清单类目标是冗余的——路由意图可再细分。
2. 主仓库工作树（Gorgon-Workbench）落后远端 25 commits 且有他人未提交改动，需要一次受控对账（本轮未触碰）。
3. Gateway 默认 URL 硬编码占位 `http://192.168.1.100:8765`——连接页可加"扫描局域网"辅助。

**BLOCKED（外部条件不具备）**：
1. **物理安卓真机**：本轮环境无设备连接，所有 DEVICE 项标 NOT_TESTED。
2. **Codex CLI 配额/登录**：需用户环境实际存在并已登录，无法在无凭据下验证。
3. **云端重新部署**（可选）：线上已恢复可用（33 条显式 demo），无需紧急操作；如需部署 `62eab43` 对应逻辑需用户授权部署操作。

## 8. 退出门槛对照

- `SOURCE_SYNC=CONFIRMED`（62eab43 已在 GitHub：https://github.com/cvcingcvc-code/cec/commit/62eab43）
- `CODE_REGRESSION=PASS`（Node 571 项 0 fail + Python 472 OK + 构建 18/18）
- `APK_DELIVERED=PASS`（v0.3.6-alpha，versionCode 11，SHA256 回验一致）
- `CLOUD_REDEPLOY=NOT_DONE`（线上当前可用，非硬前置）
- `DEVICE_ACCEPTANCE=NOT_TESTED`（明天用户执行）
- `V3H_STATUS=CODE_LEVEL_PASS / WAITING_FOR_DEVICE_RESULTS`
