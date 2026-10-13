# GATEWAY_INTEGRATION_REPORT — Phase B2 Windows 智能体网关闭环

> 生成时间：2026-10-13 15:10–15:25 GMT+8
> 结论：**Gateway 本机真实 E2E 全部通过（10 步运行检查 + 第一个真实电脑执行场景）**

## 1. 网关运行检查（§5.1）— 10 步全部真实执行

| # | 检查项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 启动网关 | ✅ | `node scripts/agent-gateway.mjs --port 8799`；`listening on 127.0.0.1:8799 (localhost only)` |
| 2 | 健康检查 | ✅ | `GET /health` → `{"ok":true,"name":"gorgon-agent-gateway","version":"0.1.0"}` |
| 3 | 版本 | ✅ | v0.1.0 |
| 4 | 验证 token | ✅ | 正确 token → 200；错误 token → **401** `{"ok":false,"error":"unauthorized"}` |
| 5 | 提交合法任务 | ✅ | `POST /v1/runs` repo.status → `202 {"runId":"run_e56de592b3920e38","status":"running"}` |
| 6 | 拒绝非法任务 | ✅ | `evil.shell` → **400** `unknown executor (allowlist only)` |
| 7 | 查看任务状态 | ✅ | `GET /v1/runs/:id` → timeline 完整（queued→running→completed） |
| 8 | 返回执行结果 | ✅ | 真实 git status 输出（分支/脏文件列表，非伪造） |
| 9 | 取消任务 | ✅ | `POST /v1/runs/:id/cancel` → 202 cancelRequested；审计记录 |
| 10 | 正常关闭/存活 | ✅ | 大 body 攻击（260KB）后 health 仍 200（连接被销毁是设计行为，服务器存活） |

## 2. 安全边界验证（§5.3）— 全部真实拒绝

| 攻击 | 结果 |
|---|---|
| 错误 token | 401，无任务信息泄漏 |
| 未知执行器（evil.shell） | 400 allowlist only |
| 路径逃逸（`../.git/config`） | run failed：`path not allowed (docs/*.md or readme.md only)` |
| 非法 JSON body | 400 invalid JSON |
| 未知 run 查询 | 404 run not found |
| 超大 body（260KB/300KB） | 连接销毁（MAX_BODY_BYTES=256KB），服务器存活 |
| 审计日志含明文 token | **0 处**（grep 验证） |

## 3. 任务生命周期（§5.4）

- 状态词汇：queued / running / completed / failed / **timed_out（本轮新增独立状态）** / cancelled
- 提交返回唯一 runId ✅；手机通过 runId 查询 ✅
- 取消：排队中取消 → cancelled；执行中取消 → 协作标记（结果丢弃）
- 超时：60s 硬超时 → **timed_out**（新记录）；旧记录保持原状（向后兼容）
- 并发：单并发（S7），多余请求排队

## 4. 第一个真实电脑执行场景（§5.5）— PASS

手机请求 → 电脑执行 `repo.status` → 返回真实项目状态：

```
status: completed
output:
## feature/gorgon-opportunity-v2...cec/feature/gorgon-opportunity-v2
 M app/src/App.jsx
 M app/src/screens/AgentScreen.jsx
 M app/src/store/workbench-store.js
 ...
```

输出为**真实 git status**（与当轮工作区一致），非模拟数据。链路在电脑端真实运行并得到真实返回值。

## 5. 局域网场景说明（§5.2）

- 网关 `--lan` 模式绑定 0.0.0.0 并打印手机应指向的局域网地址（`http://<lan-ip>:<port>`）
- **Windows 防火墙规则未配置**（需用户授权；不擅自关闭防火墙）→ 真机局域网连接 = NOT_TESTED
- 手机端 AgentScreen 已支持：网关地址 + token 输入、连接状态、错误提示（401 鉴权失败/连接失败如实显示）

## 6. E2E 自动化测试

`app/tests/v3b-system-e2e.test.mjs`（2/2 PASS）：
- 完整闭环：建任务 → 真实网关提交 → 真实执行 → 结果 → linkTaskToAgentRun → 状态机完成 → link 存活
- 真实 HTTP 401 拒绝

## 7. 已知限制

- 真机局域网连接未验证（防火墙需用户授权配置）
- 网关重启后 runs.json 持久保留（loadRuns），但未实现执行恢复（运行中任务按实际状态标记，不伪装）
