# 电脑 AI 智能体远程联动设计（AGENT_REMOTE_DESIGN）

> 更新日期：2026-10-13（GMT+8）
> 状态：**设计文档，不是已交付功能**。上游设计 `docs/REMOTE_AGENT_ARCHITECTURE.md`（V2.4 预留）保留为技术基础；本文件按统一路线图第二优先级，落成可执行的阶段设计。
> 本文件不实现、不启用、不宣传任何远程执行能力。

---

## 1. 目标

用户通过手机提交开发任务，由电脑上的 AI 智能体执行并回传结果：

- 手机创建开发任务，指定项目和执行目标。
- 选择获授权的智能体。
- 查看执行状态、代码修改摘要、测试结果、失败原因。
- 审批后继续（敏感操作）。
- 暂停或取消任务。
- 接收执行结果通知。

## 2. 核心对象（复用现有模型，不重复造）

| 对象 | 说明 | 复用来源 |
|---|---|---|
| `Device` | 常开电脑（Agent 宿主）：deviceId、名称、平台、公钥指纹、lastSeenAt、online/offline/revoked | REMOTE_AGENT_ARCHITECTURE.md |
| `AgentAdapter` | 按工具能力适配的智能体运行时：agentId、能力清单、版本、心跳 | task-runner 能力概念 |
| `TaskRun` | 一次派发执行：runId、taskId、状态机、结果产物、时间线 | task-model.js TASK_STATUS + TRANSITIONS（同表复用） |
| `Approval` | 高风险操作批准：提议内容快照、pending/approved/rejected | proposal-repository 状态词汇 |
| `Event` | 审计事件（append-only，可导出） | task timeline + activity log 模式 |

关键对齐：TaskRun 复用现有 7 态状态机——`review_required` 天然对应「等用户批准」，手机端已实现的推进按钮、诚实规则、timeline 原样适用。

## 3. 通信拓扑（出站优先）

```
手机 App（指挥端）          中继（Relay）             电脑 Agent（执行端）
────────────────           ──────────────            ──────────────────
  发起 TaskRun ──────────→ 排队 + 权限校验 ───────→ 出站长轮询取任务
  审批 Approval  ────────→ 推送给 Agent ─────────→ 收到批准才执行敏感步
  查进度/结果    ←──────── 事件流（append-only）←─── 上报 Event/摘要/产物
```

- 电脑端永远出站连接（outbound-only HTTPS/WSS），不开放公网入站端口。
- 手机不保存电脑直连地址；Device 绑定经一次性配对码（60s 过期，单次使用）。
- 中继无状态，可先复用现有公网托管服务模式（workbuddy.host 部署 + 受控 CORS 先例）。

## 4. 安全边界（S1–S7，全部满足才可启用）

| # | 边界 | 说明 |
|---|---|---|
| S1 | 身份 | Device 绑定发密钥对；双向挑战应答；撤销立即生效 |
| S2 | 授权分级 | 只读（自动放行）/ 普通写（执行后回报）/ 敏感（删除/支付/外发/覆盖文件，**必须 Approval**） |
| S3 | 超时与撤销 | 软超时 10min、硬超时 30min 强停；用户可随时取消 |
| S4 | 审计 | Event append-only，可导出完整时间线 |
| S5 | 诚实规则 | Agent 从不冒充用户；进度只按已定义里程碑计算；失败如实上报 |
| S6 | 端口 | 电脑端零公网监听；中继不存产物明文（端到端加密预留） |
| S7 | 速率 | 每 Device 并发 TaskRun 上限（默认 1）；中继每分钟命令数上限 |

## 5. 现有工具集成能力核实（开发前必须完成）

**不能假定第三方工具都有开放的远程控制 API。**

| 工具 | 核实项 | 通过标准 |
|---|---|---|
| Codex | 是否有可编程的 headless 执行接口（CLI 非交互模式 / API） | 能以受控方式启动、传入任务、读回结果与 diff 摘要 |
| WorkBuddy | 是否有外部可调用的任务/对话 API | 同上 |
| 其他工具 | 公开接口存在性 | 无公开接口 → 不可宣称可自动控制，只支持人工复制任务 |

只允许经过**身份认证、权限隔离及明确授权**的操作；核实结论落文档后方可开发对应 Adapter。

## 6. 接口草案（评审用，未实现）

```
# 手机 → 中继
POST /v1/devices/pair          # 一次性配对码
POST /v1/runs                  # 发起 TaskRun（敏感操作自动挂 Approval）
GET  /v1/runs/:id/events       # 审计事件流
POST /v1/approvals/:id/decide  # 批准/拒绝

# 电脑 Agent → 中继（全部出站）
GET  /v1/agent/poll            # 长轮询取任务/取消/批准指令
POST /v1/agent/events          # 上报 Event/心跳
POST /v1/agent/results         # 回传结果摘要（分块，加密预留）
```

所有请求带 Device 签名头；Agent 侧执行前二次校验 Approval 状态（不信任手机端单方面声明）。

## 7. 实施顺序（第二优先级启动时）

1. Device 绑定 + 配对码 + 密钥交换（最小可验证）。
2. 只读级 TaskRun（查进度/列任务）打通中继。
3. 普通写级（创建任务/笔记）+ Event 流回显。
4. Codex/WorkBuddy Adapter（核实通过的工具先行）。
5. 敏感级 Approval 流（复用 proposal-repository UI）。
6. 超时/取消/撤销 + 审计导出。
7. 真机 + 真电脑双端验收（九步链路模式，沿用 V2.1 §9 诚实验收清单风格）。

## 8. 明确不做

1. 不实现、不启用、不宣传任何远程执行能力（启动前）。
2. 不开放电脑端入站端口；不做内网穿透。
3. 不把模拟器测试充当真机/真实 Agent 通过证据。
4. 不给 Agent 任何「自动批准」路径——敏感级永远等用户。
5. 不存储比任务必需更久的产物（默认 7 天滚动清理）。
