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
