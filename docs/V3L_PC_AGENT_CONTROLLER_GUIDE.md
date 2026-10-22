# Gorgon PC Agent Controller V1 — 使用说明与验收方案（2026-10-22）

> 分支 `feat/v3l-pc-agent-controller`（基线 `feat/v3j-device-fix`，包含已发布 v0.3.9-alpha）。
> 本文件是使用说明 + 真实验收方案，不是模拟页面展示。

## 0. 已完成的能力边界（诚实声明）

| 能力 | 状态 | 说明 |
|---|---|---|
| 发现已安装 Agent | ✅ 已验证 | WorkBuddy（E:\work\WorkBuddy\WorkBuddy.exe）+ Codex CLI（%LOCALAPPDATA%\OpenAI\Codex\bin\）真实探测 |
| 启动 WorkBuddy | ✅ 已实现 | spawn 注册 exe + 重查进程列表验证新 pid 出现；LAUNCHED ≠ 任务已执行 |
| 查看 WorkBuddy 状态 | ✅ 已验证 | 真实进程数（9）+ 窗口标题（只读枚举，非 UI Automation） |
| Codex 只读诊断 | ✅ 链路已验证 | 真实调用 codex exec --sandbox read-only；本机当前 **BLOCKED_USAGE_LIMIT**（try again at Oct 23rd 1:54 AM）|
| 任务交接（Phase D） | ✅ 已验证 | failed/timed_out 任务产生完整 handoff 材料；completed 永不重跑（409） |
| WorkBuddy 下达任务 | ❌ 明确不做 | WorkBuddy 桌面版无已验证的公开任务 API → 验收第六项的诚实阻断样例 |
| 远程加密通道 | ⏸ 未实现 | 本版本为局域网 + token；出站中继按设计文档 §7 下一阶段 |

## 1. 电脑端启动（Windows Companion）

```bash
cd F:/Gorgon-Parallel/v3i
node desktop/agent-controller/companion.mjs --port 8765 --lan
```

- 网关崩溃 5s 自动重启；任务记录持久化在 `%USERPROFILE%\.gorgon-agent-controller\`（runs.json + audit.log + token.json）。
- 登录自启（可选）：

```bash
node desktop/agent-controller/companion.mjs install-startup   # 写 Startup 目录 .bat（需 --lan）
node desktop/agent-controller/companion.mjs remove-startup
```

- 启动后控制台打印配对码位置（token.json）与手机应指向的地址。

## 2. 手机端连接（Gorgon APK）

智能体页（AgentScreen）→ 填电脑地址 `http://<局域网IP>:8765` + 配对码（token.json 全文）→ 连接。
任务列表由电脑真实返回：

- 查看项目状态 / 阅读项目文档 / 查看电脑概况（gateway 只读）
- Codex 分析项目（只读，约 3-7 分钟）
- **查看 WorkBuddy 运行状态 / 启动 WorkBuddy 桌面版**（V3L 新增）

## 3. 六项真实验收场景（对应任务书 §六）

| # | 场景 | 操作 | 通过标准 | 当前状态 |
|---|---|---|---|---|
| 1 | 启动 WorkBuddy | 手机点「启动 WorkBuddy 桌面版」 | 电脑出现新 WorkBuddy 进程，返回真实 pid 与进程数 | 待真机 |
| 2 | 只读代码分析 | 手机点「让 Codex 分析项目」 | 网关真实调起 codex exec，报告落地 runs.json | 待 Codex 额度恢复（Oct 23 1:54 AM 后重试） |
| 3 | Codex 打开指定目录 | 设 `GORGON_CODEX_WORKSPACE=<Gorgon 工作目录>` 后重启 companion，再发分析任务 | meta.workspace 为指定目录，git 快照证明只读 | 链路已验证（本机 workspace 实测） |
| 4 | 授权后小修改 | （下一增量）worktree 隔离修改执行器 | 退出码 + git diff + 产物三重验证 | 未实现，不在本版本虚报 |
| 5 | 断网重连记录保留 | 杀网关 → 重启 companion → 手机刷新 | runs.json 记录仍在；in-flight 行诚实标记 failed 不复活 | ✅ 网关重启对账已验证 |
| 6 | 无法自动操作的程序 | 手机看 WorkBuddy 任务说明 | 明示「无任务提交接口」，永不假装成功 | ✅ 已实现（availability detail + LAUNCHED note） |

## 4. 安全边界（与 V3C/V3D 一致，全部保持）

- S1 每请求带 `X-Gorgon-Token`；S2 执行器白名单（无 shell、无任意命令）；S3 硬超时；S4 audit.log JSONL；S5 失败/阻断如实上报（BLOCKED_USAGE_LIMIT / BLOCKED_AUTH / BLOCKED_NETWORK）；S6 默认 127.0.0.1，`--lan` 才暴露局域网；S7 单并发。
- 测试执行器注入仅限 `NODE_ENV=test` + 隔离 state dir（V3D 已验证）。

## 5. 自动化验证记录（2026-10-22 本机实测）

- `node --test app/tests/*.test.mjs`：见运行日志（V3L 前全量基线 591 pass）。
- gateway lifecycle 8 pass；injection security 11 pass；codex adapter 10 pass / 1 skip（真实调用受额度限制，诚实跳过）。
- 真实 E2E（本文件 §3.5/§6 对应）：网关 28765/28766/28769 三次真实启动，workbuddy.status 返回 9 进程 + 1 窗口；handoff 409（completed 不重跑）；handoff 200（failed 任务完整材料）。
- Codex 真实调用：`[BLOCKED_USAGE_LIMIT] … try again at Oct 23rd, 2026 1:54 AM` —— 真实额度状态，未伪造。

## 6. 已知限制

1. WorkBuddy 无任务 API：只能启动/看状态，不能远程下达对话任务（诚实阻断）。
2. Codex 额度：真实余额无法查询 → 手机显示 UNKNOWN；BLOCKED_* 时显示真实原因。
3. 远程（移动网络）通道未实现：本版本仅局域网；中继设计见 docs/AGENT_REMOTE_DESIGN.md §3/§7。
4. 交互桌面限制：窗口标题为只读枚举；点击/输入类操作需要前台会话，本版本不做 UI Automation。
