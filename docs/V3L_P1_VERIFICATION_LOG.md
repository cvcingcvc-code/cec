# V3L P1 验证日志 — WorkBuddy 只读任务提交（2026-10-22 本机实测）

> 全部为真实执行结果，无模拟。分支 `feat/v3l-pc-agent-controller`（HEAD b90abd6）。

## 1. wbipc 协议逆向与验证（P1 调查）

从 `E:/work/WorkBuddy/resources/app.asar`（92MB）逆向出 WorkBuddy 桌面版官方本地 IPC 协议，并在本机真机（运行中的 WorkBuddy 5.8.3）上逐步验证：

| 步骤 | 帧 | 结果 |
|---|---|---|
| 1 | → `session_hello`（protocol_min/max=1, session_id, client_nonce, ticket_id=sha256(ticket)[0:16]hex） | 连接成功 |
| 2 | ← `session_challenge`（server_nonce + server_proof） | **server_proof HMAC 验证通过** |
| 3 | → `session_prove`（client_proof=HMAC(key=ticket,"client",transcript)） | 服务端接受 |
| 4 | ← `session_hello_ack`（connection_epoch, max_inflight=8, pipes=[wb.entitlement, wb.request, wb.wecom-a2a]） | **握手完成** |

- 算法：`computeProof = base64url(HMAC-SHA256(key=ticket, encodeTranscript(role, {protocol:1, endpoint, clientNonce, serverNonce})))`；transcript 编码 = 每项 4 字节大端长度 + UTF-8 内容拼接；role tag：`wbipc-s`/`wbipc-c`。
- 调试记录：PoC v1 因帧消费时序 bug 看到重复 challenge；PoC v2 确认 ack 实际到达（时序误报）；PoC v3 干净实现 18ms 完成握手。
- 中间错误（已修）：调用 channel 时必须带 `c:` 前缀（`c:wb.request/http.fetch`），否则 `E_CHANNEL_UNKNOWN`。

## 2. 真实只读调用（wb.request/http.fetch，用户自己的登录会话）

| 路径 | 结果 |
|---|---|
| `GET /` | HTTP 200，text/html 16241 字节（真实 WorkBuddy 后端页面） |
| `GET /v2/accounts` | HTTP 200，`code:0`，真实账号「北溟(personal)」+ requestId |
| `GET /v2/user/cloudagent/agents` | HTTP 200，`total:0`（真实空列表） |
| `GET /v2/user/cloudagent/agents/granted` | HTTP 200，`total:0` |
| `GET /api/memory/profile` | HTTP 200，真实记忆档案 3667 字 |
| `GET /aily/v1/apps`、`/aily/v1/sessions` | HTTP 404 Route Not Found（代理真实，路径不存在） |
| `GET /console/as/conversation` | HTTP 403 not_authorized（真实拒绝） |

## 3. 适配器集成验证（scripts/test-wbipc-submit.mjs，7 项全过）

- discover：已安装（E:\work\WorkBuddy\WorkBuddy.exe），12 个进程运行
- `describe_ipc` → ok：HTTP 200（370ms）
- `read_accounts` → ok：真实账号「北溟(personal，当前)」
- `read_profile` → ok：3667 字记忆档案
- `list_cloud_agents` → ok：total=0
- `send_message` → **BLOCKED_UNSUPPORTED_OPERATION**（诚实拒绝，未模拟）
- `{}` 空操作 → **BLOCKED_UNSUPPORTED_OPERATION**

## 4. HTTP API 全链路 E2E（scripts/test-wbipc-e2e.mjs，模拟手机路径）

```
[+  509ms] gateway up, token acquired
[+  602ms] executors: repo.status, repo.readDoc, host.stats, codex.readonly-diagnosis,
           workbuddy.status, workbuddy.launch, workbuddy.submitTask
[+  621ms] POST read_accounts -> 202 runId=run_9efc106875813645
[+ 1641ms] read_accounts: status=completed | WorkBuddy 已登录 1 个账号：北溟(personal，当前)
[+ 2152ms] read_profile: status=completed | 已读取记忆档案（3667 字）
[+ 2663ms] send_message: status=failed | 不支持的操作（诚实拒绝）
E2E PASS: workbuddy.submitTask real execution over HTTP API verified
```

## 5. 单元测试与全量回归

- 新增 6 个 wbipc 单元测试（v3l-wbipc-submit + v3l-wbipc-client）：6 pass / 0 fail
- 全量回归 `node --test app/tests/*.test.mjs`：**591 pass / 0 fail / 1 skipped**（与 V3L P1 前基线一致）

## 6. 新测试 APK（v0.3.11-alpha）

- versionCode 16 / versionName 6.0.11（commit b90abd6）
- APK：`F:/Gorgon-Parallel/v3i/gorgon-workbench-v0.3.11-alpha.apk`（3858143 字节）
- **SHA-256：`2be9e5ee03153f1b9a46725ab8f433cf7ee4e58b799023682cf2bd040e9c1ed4`**
- 签名验证（apksigner）：`CN=Gorgon Workbench`，证书 SHA-256 `45b44236…f47167`（与历史发布一致，v2 scheme，覆盖安装保留数据）
- 包含：V3L 全部 P0 修复（CapacitorHttp 原生 HTTP 路径 + cleartext + CORS preflight；companion 自启一致性）+ P1（workbuddy.submitTask 真实只读任务）+ 配对码文档修正

## 7. 待真机验收（用户 Android 手机）

1. 安装 v0.3.11-alpha APK（覆盖安装）
2. 电脑端 `node desktop/agent-controller/companion.mjs --port 8765 --lan`
3. 手机端填 `http://<局域网IP>:8765` + token.json 中 token 字段的值
4. 验收 P0：连接成功；验收 P1：提交「读取登录账号」→ 返回真实账号名
5. 验收结果记入 GitHub Issue #1

## 8. Codex 额度恢复后重试记录（2026-10-23）

**结论：BLOCKED_NETWORK —— 额度状态无法判定。** 两次真实调用均失败于网络层，日志中无 "usage limit" / "try again at" 字样（请求未到达后端额度检查环节），也无任何模型输出（无分支名/commit hash）。网关全链路验证未执行（前置条件「额度恢复」未满足），guide §3 场景 2 状态列未更新。如实记录，不做任何伪造。

### 调用命令（两次相同）

```
cd F:/Gorgon-Parallel/v3i
echo "" | timeout 150 "C:/Users/lin/AppData/Local/OpenAI/Codex/bin/a96ca4c1eee0cf35/codex.exe" exec --sandbox read-only "report the current git branch and HEAD commit of this repository, one line only"
```

### 尝试 1（2026-10-23 02:12 GMT+8）

- 退出码 124（150s timeout 强杀）
- 真实错误（节选）：
  - `rmcp::transport::worker: worker quit with fatal: Transport channel closed, when UnexpectedServerResponse("HTTP 403: {\"error\":{\"code\":\"403\",\"message\":\"Forbidden\",\"id\":\"hnd1::stv69-1792692724342-b2bf37c13caf\"}}")`
  - `rmcp::transport::worker: http/request failed: error sending request for url (https://chatgpt.com/backend-api/ps/mcp)`（多次）
  - `Reconnecting... 2/5 → 5/5`（重连耗尽）
  - `Falling back from WebSockets to HTTPS transport. workspace routing discovery timed out`
- 无模型输出

### 尝试 2（2026-10-23 02:17 GMT+8）

- 退出码 124，错误与尝试 1 完全同型（HTTP 403 id `hnd1::stv69-1792693052840-48d222add95c`、chatgpt.com backend-api 请求失败、Reconnecting 5/5 耗尽）
- 无模型输出

### 网络环境诊断（真实探测，2026-10-23 02:13–02:20 GMT+8）

- Clash 代理 127.0.0.1:7890 **未监听**（netstat 无 LISTENING 条目，无 clash/verge/mihomo/v2ray 进程）
- chatgpt.com 直连：连接超时（10s 无响应）
- chatgpt.com DNS 解析疑似被污染：`108.160.165.141`（Dropbox 网段）、`2a03:2880:f10c:83:face:b00c:0:25de`（Facebook IPv6），非 ChatGPT 真实地址
- auth.openai.com → 403 Forbidden；api.openai.com → 超时
- 对照组：api.github.com / github.com 直连 200，www.baidu.com 200（网络本身可用，仅 OpenAI 系不可达）

### 后续

需先恢复 Clash 代理（127.0.0.1:7890）或更换可用网络出口，再重跑本节命令；出现真实模型输出（分支名/commit hash）后，继续网关全链路验证（GORGON_GATEWAY_STATE_DIR + agent-gateway.mjs + POST /v1/runs → 轮询 run.status）。
