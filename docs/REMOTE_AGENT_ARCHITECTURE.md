# 远程 Agent 架构预留（V2.4 设计文档 · 不默认启用）

> 版本：V2.4 预留 · 日期：2026-10-13（GMT+8）
> 状态：**设计文档，不是已交付功能**。本文件定义数据模型与接口，供评审；不开放任何远程控制端口，不默认启用远程执行。
> 上游依据：`docs/ROADMAP.md` V2.4 阶段（「定义 Device / Agent / TaskRun / Approval / Event 接口与安全边界；不默认启用远程执行」）。

---

## 0. 原则（先读）

1. **本文件不实现任何远程执行**。当前产品（V2.2）的全部能力都在设备本地；本文只预留接口与安全边界。
2. 电脑端永远**出站连接**（outbound-only）到中继，不开放公网入站端口；手机永远通过中继，不直连电脑。
3. 一切敏感/破坏性操作必须经**用户显式批准**（Approval），与现有 Human Review 模型（proposal-repository 的 pending/approved/rejected）同构。
4. 全链路审计：每个 TaskRun 的每次状态变更都落 Event，不可篡改顺序，可回放。

## 1. 核心对象（与现有模型对齐）

| 对象 | 说明 | 现有映射 |
|---|---|---|
| `Device` | 一台常开电脑（Agent 宿主）。字段：deviceId（绑定生成）、名称、平台、公钥指纹、lastSeenAt、状态（online/offline/revoked） | 新增 |
| `Agent` | 电脑上运行的智能体运行时。字段：agentId、deviceId、能力清单（skills）、版本、心跳 | 复用 task-runner 能力概念 |
| `TaskRun` | 一次派发执行。字段：runId、taskId（本机任务）、deviceId、状态机、结果产物、时间线 | 复用 task-model.js TASK_STATUS + TRANSITIONS（同表复用，不新造状态机） |
| `Approval` | 高风险操作的批准记录。字段：approvalId、runId、提议内容快照、决定（pending/approved/rejected）、decidedAt、decidedBy | 复用 proposal-repository 状态词汇 |
| `Event` | 审计事件。字段：eventId、runId、type、payload、at（append-only，MAX 上限滚动） | 复用 task timeline + activity log 模式 |

**关键对齐**：TaskRun 复用现有 TASK_STATUS 状态机（created/planning/ready/running/review_required/completed/failed）与 TRANSITIONS 白名单——手机端已实现的推进按钮、诚实规则、timeline 全部原样适用，`review_required` 状态天然对应「等用户批准」。

## 2. 通信拓扑（出站优先）

```
手机 App（指挥端）          中继（Relay）             电脑 Agent（执行端）
────────────────           ──────────────            ──────────────────
  发起 TaskRun ──────────→ 排队 + 权限校验 ───────→ 出站长轮询取任务
  审批 Approval  ────────→ 推送给 Agent ──────────→ 收到批准才执行敏感步
  查进度/结果    ←───────── 事件流（append-only）←──── 上报 Event/产物
```

- 中继是无状态消息队列（可先复用现有公网托管服务模式：`workbuddy.host` 部署 + 受控 CORS 白名单先例）。
- 电脑端**只有出站 HTTPS/WSS**；中继地址可配置；证书钉扎（pinning）预留。
- 手机端不保存电脑直连地址；Device 绑定经一次性配对码（short-lived，60s 过期，单次使用）。

## 3. 安全边界（必须全部满足才可启用）

| # | 边界 | 说明 |
|---|---|---|
| S1 | 身份 | Device 绑定后发长期密钥对；每次会话双向挑战应答；撤销列表（revoked）立即生效 |
| S2 | 授权分级 | 操作分三级：只读（进度/列表，自动放行）、普通写（创建任务/笔记，Agent 可执行后回报）、敏感（删除/支付/发送外发消息/覆盖文件，**必须 Approval**） |
| S3 | 超时与撤销 | TaskRun 有软超时（默认 10 分钟）与硬超时（30 分钟强停）；用户可随时取消（手机端撤销 → Agent 下一次轮询收到取消指令） |
| S4 | 审计 | 全部 Event 落盘 append-only；用户可导出完整审计时间线 |
| S5 | 诚实规则 | Agent 从不冒充用户完成操作；进度百分比只按已定义里程碑/任务计算（ROADMAP V2.3 原则）；失败如实上报 |
| S6 | 端口 | 电脑端不监听任何公网端口（出站-only）；中继不存储产物明文（端到端加密预留） |
| S7 | 速率 | 每 Device 并发 TaskRun 上限（默认 1）；中继每分钟命令数上限 |

## 4. 接口草案（评审用，未实现）

```
# 手机 → 中继
POST /v1/devices/pair          # 生成一次性配对码
POST /v1/runs                  # 发起 TaskRun（含敏感操作时自动挂 Approval）
GET  /v1/runs/:id/events       # 审计事件流
POST /v1/approvals/:id/decide  # 批准/拒绝

# 电脑 Agent → 中继（全部出站）
GET  /v1/agent/poll            # 长轮询取任务/取消/批准指令
POST /v1/agent/events          # 上报 Event/心跳
POST /v1/agent/results         # 回传产物（分块，加密预留）
```

所有请求带 Device 签名头；中继验签后排队；Agent 侧执行前二次校验 Approval 状态（不信任手机端单方面声明）。

## 5. 明确不做（本文件承诺）

1. 不实现、不启用、不宣传任何远程执行能力（V3.0 之前）。
2. 不开放电脑端入站端口；不做内网穿透。
3. 不把模拟器测试充当真机/真实 Agent 通过证据。
4. 不在数据模型里给 Agent 任何「自动批准」路径——S2 敏感级永远等用户。
5. 不存储比任务必需更久的产物（可配置保留期，默认 7 天滚动清理）。

## 6. 实施顺序建议（V3.0 启动时）

1. Device 绑定 + 配对码 + 密钥交换（最小可验证）。
2. 只读级 TaskRun（查进度/列任务）打通中继。
3. 普通写级（创建任务/笔记）+ Event 流回显。
4. 敏感级 Approval 流（复用 proposal-repository UI）。
5. 超时/取消/撤销 + 审计导出。
6. 真机 + 真电脑双端验收（九步链路模式，沿用 V2.1 §9 的诚实验收清单风格）。
