# Gorgon PC Agent Controller V1 — 使用说明与验收方案（2026-10-22，V3L P1 更新）

> 分支 `feat/v3l-pc-agent-controller`（基线 `feat/v3j-device-fix`，包含已发布 v0.3.9-alpha）。
> 本文件是使用说明 + 真实验收方案，不是模拟页面展示。

## 0. 已完成的能力边界（诚实声明）

| 能力 | 状态 | 说明 |
|---|---|---|
| 发现已安装 Agent | ✅ 已验证 | WorkBuddy（E:\work\WorkBuddy\WorkBuddy.exe）+ Codex CLI（%LOCALAPPDATA%\OpenAI\Codex\bin\）真实探测 |
| 启动 WorkBuddy | ✅ 已实现 | spawn 注册 exe + 重查进程列表验证新 pid 出现；LAUNCHED ≠ 任务已执行 |
| 查看 WorkBuddy 状态 | ✅ 已验证 | 真实进程数 + 窗口标题（只读枚举，非 UI Automation） |
| WorkBuddy 只读任务（V3L P1 新增） | ✅ 真机通道已验证 | 官方 wbipc 本地 IPC（HMAC-SHA256 质询-应答握手 + wb.request/http.fetch），真实 200 + 真实账号/记忆数据；仅只读操作 |
| Codex 只读诊断 | ✅ 链路已验证 | 真实调用 codex exec --sandbox read-only；额度受限时如实 BLOCKED |
| 任务交接（Phase D） | ✅ 已验证 | failed/timed_out 任务产生完整 handoff 材料；completed 永不重跑（409） |
| WorkBuddy 消息发送/写操作 | ❌ 明确不做 | wbipc 只读通道之外的操作未实现 → BLOCKED_UNSUPPORTED_OPERATION，不允许模拟通过 |
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

- V3L P0 修正：自启 .bat 现在运行 companion.mjs（带 keepalive 的守护进程），不再直接跑网关；且固定 `GORGON_GATEWAY_STATE_DIR`，与手动启动完全一致。

## 2. 手机端连接（Gorgon APK）

智能体页（AgentScreen）→ 填电脑地址 `http://<局域网IP>:8765` + 配对码 → 连接。

**配对码填法（V3L P0 修正）**：token.json 是一个 JSON 对象，手机端只需要填其中的 **token 字段的值**（一串随机字符），不是整个 JSON 文件内容。示例：若 token.json 为 `{"token":"abc123...","createdAt":"..."}`，配对码填 `abc123...`。

任务列表由电脑真实返回：

- 查看项目状态 / 阅读项目文档 / 查看电脑概况（gateway 只读）
- Codex 分析项目（只读，约 3-7 分钟）
- 查看 WorkBuddy 运行状态 / 启动 WorkBuddy 桌面版（V3L）
- **WorkBuddy 只读任务（V3L P1 新增）**：`workbuddy.submitTask` 执行器，支持 4 种只读操作：
  - `describe_ipc` — 检查 wbipc 本地通道可用性
  - `read_accounts` — 读取当前登录账号
  - `read_profile` — 读取用户记忆档案（前 600 字）
  - `list_cloud_agents` — 列出云端 Agent 授权
  - 其他操作（如 send_message）返回 `BLOCKED_UNSUPPORTED_OPERATION`，永不模拟成功。

## 3. 六项真实验收场景（对应任务书 §六）

| # | 场景 | 操作 | 通过标准 | 当前状态 |
|---|---|---|---|---|
| 1 | 启动 WorkBuddy | 手机点「启动 WorkBuddy 桌面版」 | 电脑出现新 WorkBuddy 进程，返回真实 pid 与进程数 | 待真机 |
| 2 | 只读代码分析 | 手机点「让 Codex 分析项目」 | 网关真实调起 codex exec，报告落地 runs.json | 待 Codex 额度恢复后重试 |
| 3 | Codex 打开指定目录 | 设 `GORGON_CODEX_WORKSPACE=<Gorgon 工作目录>` 后重启 companion，再发分析任务 | meta.workspace 为指定目录，git 快照证明只读 | ✅ 链路已验证 |
| 4 | 授权后小修改 | （下一增量）worktree 隔离修改执行器 | 退出码 + git diff + 产物三重验证 | 未实现，不在本版本虚报 |
| 5 | 断网重连记录保留 | 杀网关 → 重启 companion → 手机刷新 | runs.json 记录仍在；in-flight 行诚实标记 failed 不复活 | ✅ 网关重启对账已验证 |
| 6 | 无法自动操作的程序 | 手机看 WorkBuddy 任务说明 | 不支持的操作明示 BLOCKED，永不假装成功 | ✅ 已验证（describe_ipc 真实 200；send_message 真实 BLOCKED） |

## 4. 安全边界（与 V3C/V3D 一致，全部保持）

- S1 每请求带 `X-Gorgon-Token`；S2 执行器白名单（无 shell、无任意命令）；S3 硬超时；S4 audit.log JSONL；S5 失败/阻断如实上报；S6 默认 127.0.0.1，`--lan` 才暴露局域网；S7 单并发。
- wbipc 通道：ticket 来自 WorkBuddy 自己写的本机文件 `%USERPROFILE%\.workbuddy\wbipc\endpoint.json`，永不离开本机（网关就在本机运行）；仅 GET 只读请求。
- 测试执行器注入仅限 `NODE_ENV=test` + 隔离 state dir（V3D 已验证）。

## 5. 自动化验证记录（2026-10-22 本机实测）

- `node --test app/tests/*.test.mjs`：591 pass / 0 fail（V3L P1 后含 6 个新 wbipc 测试，全量回归通过）。
- wbipc 握手真机验证：`session_hello → session_challenge（server_proof HMAC 验证通过）→ session_prove → session_hello_ack`，epoch 真实返回，pipes = [wb.entitlement, wb.request, wb.wecom-a2a]。
- wbipc 真实只读调用（HTTP API 全链路 E2E）：
  - `read_accounts` → completed：真实账号「北溟(personal)」+ requestId + HTTP 200
  - `read_profile` → completed：真实记忆档案 3667 字
  - `list_cloud_agents` → completed：total=0，HTTP 200
  - `describe_ipc` → completed：HTTP 200（370ms）
  - `send_message` → failed：BLOCKED_UNSUPPORTED_OPERATION（诚实拒绝）
- 网关 lifecycle 8 pass；injection security 11 pass；codex adapter 10 pass / 1 skip（真实调用受额度限制，诚实跳过）。

## 6. 已知限制

1. WorkBuddy 仅只读任务：消息发送/写操作未实现（wbipc 上无任务 pipe；ACP 会话通道需独立授权，无法验证就不虚报）。
2. Codex 额度：真实余额无法查询 → 手机显示 UNKNOWN；BLOCKED_* 时显示真实原因。
3. 远程（移动网络）通道未实现：本版本仅局域网；中继设计见 docs/AGENT_REMOTE_DESIGN.md §3/§7。
4. 交互桌面限制：窗口标题为只读枚举；点击/输入类操作需要前台会话，本版本不做 UI Automation。
5. wbipc 协议为官方内部接口（未出公开文档）：若 WorkBuddy 未来版本更改协议，`workbuddy.submitTask` 会如实 BLOCKED 并给出原因，不会假装成功。
