# V3I 安卓端完整功能交付 — 基线审计报告

- 日期：2026-10-15
- 分支：`feat/v3i-android-full-delivery`（worktree F:/Gorgon-Parallel/v3i，基于 8cd4ec4）
- 远端核对（开始前实测，非假定）：默认分支 `feature/gorgon-opportunity-v2` @ `8cd4ec4`，Release v0.3.6-alpha 为 Latest（非 Draft、非 Pre-release），与任务书基线一致。

---

## 1. 测试基线（实测）

| 套件 | 结果 |
| --- | --- |
| Node 全量（`CODEBUDDY_SAFE_DELETE_ENABLED=0 npm test`） | **571 项：570 PASS / 0 FAIL / 1 SKIP** |
| Python pipeline（unittest discover） | **472 项全 OK（1 skip）** |
| pipeline 数据 | 33 条真实活动（`DEMO_DATA: true` 显式布尔） |

- 首次 Node 运行 1 失败：worktree 新建后 `node_modules` 为空导致 `esbuild` 缺失（v3d-android-agent-ui 测试无法 import）。`npm ci` 后复跑全绿——**环境问题，非代码缺陷**。
- **已知测试副作用**：跑 pipeline Python 测试会把 `pipeline/data/approved/activities.json` 从 33 条真实数据重写为 17 条 demo 种子。已从 git 恢复 33 条版本；本轮结束时若再跑 Python 测试需重新恢复。

## 2. 功能完整度矩阵（代码审计 + V3H 交付状态）

### P0 基础使用体验
| 项 | 现状 |
| --- | --- |
| 页面进入 | 首页/工作台/任务中心/日程/活动/地点/笔记/AI 助手全部有 screen 组件与导航注册（App.jsx + navigation.js），12 个 workbench tab + 5 个 legacy tab |
| 任务 CRUD+恢复 | 创建（addTask）、编辑（setTaskTitle/setTaskStep）、软删除（deleteTask 30 天回收站）、恢复（restoreTask）均已实现并有测试 |
| 数据持久化 | localStorage + Android Capacitor Preferences 双写镜像（native-persistence.js，hydrate + debounce flush）；React 挂载有 3s 超时保护防白屏 |
| 导航/返回 | 底部 tabbar（工作台/搜索/任务/更多）+ MoreDrawer + 各 detail 屏 onBack |
| 中文提示 | 网络失败（SEARCH_OFFLINE/SEARCH_API_ERROR）、权限拒绝（通知授权）、后端断开（unavailable）均有中文提示 |
| 白屏防护 | main.jsx boot 全 try/catch + finally render；native-persistence 竞态超时 |

**初步判定：P0 功能链路完整，待模拟器实测确认。**

### P1 AI 智能任务闭环
| 场景 | 现状 |
| --- | --- |
| A 面试准备 | V3H 已修复 relDate 正则 + router 关键词（「明天下午我要去面试，帮我整理准备事项」→ intent=extract、抽出「明天」）。**剩余缺口：extract 只返回结构化字段（dates/times），没有把「识别时间 → 生成实用准备清单」串起来——清单生成需要 plan 技能或专用模板，当前路由 extract 单技能不会生成准备清单步骤** |
| B 活动查找 | search-skill 复用 api.searchActivities；demo 数据显式标记（DEMO DATA badge + isDemo metadata）；联网失败 SEARCH_OFFLINE/SEARCH_PROVIDER_ERROR 中文报错。**链路完整** |
| C 任务清单 | plan 技能生成步骤 → TaskDetail「保存为可编辑待办」→ pending 步骤 → 手动打勾（step complete）→ 重启恢复（localStorage）。**链路完整，但「帮我把明天的事情整理成任务清单」需要路由命中 extract（「明天」+「整理」→ extract）+ plan（「清单」不在 plan 关键词里——「整理」在 extract）。需确认多技能组合** |
| D 笔记复盘 | addNote（task/project/place 关联）+ setProjectReview 复盘 + 时间线 note_linked。**链路完整** |

### P2 AI 助手
- AgentScreen 已有：连接电脑（URL+配对码）、执行器选择、提交/取消/刷新、状态徽章（排队/执行中/完成/失败/超时/已取消）、中文文案、技术详情折叠、执行过程时间线、结果关联本地任务。
- 结果展示 presentAgentResult 易读中文；原始输出在折叠 details。
- 模型未连接提示：availability.label/detail 如实（「模型调用待验证」/「暂不可用」）。
- 不伪造结果：isTerminalRun 终态不可变、取消需电脑确认。
- **初步判定：P2 链路完整，待模拟器实测确认。**

### P3 手机与电脑联动
- Gateway 服务端（scripts/agent-gateway.mjs，724 行）：token 认证、执行器白名单（repo.status/repo.readDoc/host.stats）、60s 硬超时、audit.log、默认绑 127.0.0.1、--lan 显式开放、单并发。
- Codex 适配器只读诊断（agent-adapters/codex-adapter.mjs）。
- 手机端 client（agent-screen-model.js createAgentClient）：15s 超时、401 配对码错误提示、取消协作协议。
- **初步判定：P3 链路完整，真机联动受环境限制（需手机与电脑同网），模拟器可验证网关协议。**

## 3. 真实缺口（本轮待修复）

1. **场景 A 清单生成缺口**：extract 单技能只返回结构化字段，不产出「面试准备清单」。需要：
   - 方案一：router 对「准备/清单」类目标同时路由 extract + plan（多技能 workflow），plan 生成通用 5 步；对面试场景仍不贴切。
   - 方案二（选定）：extract 技能内对「面试/准备/清单」类目标追加「场景清单建议」——纯规则模板（面试→简历/公司研究/常见问题/着装/路线），保持确定性、无模型。清单条目通过现有「保存为可编辑待办」链路落盘。
2. **场景 C 路由确认**：「帮我把明天的事情整理成任务清单」→「整理」+「清单」命中 extract；「任务清单」需要 plan。检查 routeTask 对该句的输出，必要时把「清单」加进 plan 关键词（注意「准备清单」会同时命中两技能 → workflow，正符合场景 A 需求）。
3. **模拟器验收**：需要 Android 模拟器或真机做真实交互验收（P0 页面操作、任务 CRUD、重启恢复、网络异常）。检查本机 Android 工具链（D:/gorgon-android-toolchain）是否有 emulator/avd。

## 4. 本轮计划

1. **P1 场景修复**（核心）：extract 场景清单模板 + plan 关键词补充 + 单元测试。
2. **P0/P2 排查**：模拟器可用性检查；如无模拟器，用 `npm run build` + `vite preview` + 浏览器 mobile 视口做 Web 交互验收（如实标注 EMULATOR_PASS/BLOCKED）。
3. **P3 Gateway**：模拟器/本机 loopback 验证协议闭环。
4. **全量验收** → versionCode 12 → v0.3.7-alpha Release → 最终报告。
