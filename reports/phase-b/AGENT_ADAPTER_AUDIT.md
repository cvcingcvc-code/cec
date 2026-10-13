# AGENT_ADAPTER_AUDIT — Phase B4 AI 执行器真实能力审计

> 生成时间：2026-10-13 15:25–15:35 GMT+8
> 结论：**Codex CLI 接口已验证存在，但受用量限制阻断 → ADAPTER_BLOCKED_USAGE_LIMIT**
> （接口真实可用性已确认，非 UNVERIFIED_INTERFACE；待用量恢复后可推进）

## 1. 环境审计（本机真实检查）

### Codex CLI — 已安装，接口已验证

| 项 | 值 |
|---|---|
| 版本 | codex-cli 0.155.0-alpha.16.4 |
| 主程序 | `C:\Users\lin\.codex\.sandbox-bin\codex.exe` |
| 非交互入口 | `codex exec [OPTIONS] [PROMPT]`（**已验证存在**） |
| 沙箱模式 | `--sandbox read-only / workspace-write / danger-full-access`（已验证） |
| 工作区 | `-C <DIR>` / `--worktree`（已验证） |
| 状态查询 | `codex agents`（浏览共享 daemon 会话）/ `resume --last`（已验证存在） |
| 会话管理 | `queue` / `archive` / `fork`（CLI 帮助确认） |
| 登录态 | `~/.codex/auth.json` 存在（已登录） |

**真实运行验证**（`codex exec --sandbox read-only` 最小提示词）：
- 会话已创建（session id 返回、workdir/model/approval/sandbox 头正常打印）
- **模型调用被阻断**：`ERROR: You've hit your usage limit ... try again at 6:48 PM`（ChatGPT 用量限额）
- 网络层异常（沙箱代理 502 / chatgpt.com MCP 403）随附，但最终错误为**用量限制**，非接口缺失

### WorkBuddy — 桌面应用，无已验证 CLI

| 项 | 值 |
|---|---|
| 安装 | `E:\work\WorkBuddy\WorkBuddy.exe`（桌面 GUI） |
| CLI | **未发现已验证的命令行任务执行入口**（无 workbuddy/claude 命令在 PATH） |
| 本地 LLM 路由 | FreeLLMAPI（127.0.0.1:31415）当前**未运行**（connection refused） |

## 2. Adapter 判定

按任务书 §7.2：

- Codex：调用接口**真实且已验证**（`codex exec` 非交互 + read-only 沙箱 + 固定工作区），
  但**当前用量限额阻断真实模型调用**（2 次有证据的尝试：沙箱代理路由失败 + Clash 代理路由后命中限额）。
- WorkBuddy：无已验证 CLI → 不建 Adapter（不发明 API）。

**标记：`ADAPTER_BLOCKED_USAGE_LIMIT`**（Codex 接口已验证；等用量窗口恢复后，按 §7.2 设计建
codex.readonly-diagnosis Adapter：`codex exec --sandbox read-only -C <固定工作区> <预批准提示词>`，
超时+输出上限+日志脱敏。本轮不实现，不阻塞主系统交付。）

## 3. 当前阶段最低目标（§7.3）— 已达成

**手机能够可靠地派发安全任务到电脑，电脑真实执行，并把可核查结果返回手机**：
- 手机端 AgentScreen → 网关 HTTP API（token 鉴权）→ 白名单执行器（repo.status / repo.readDoc / host.stats）真实执行 → 结构化真实结果返回 → 手机显示 + 关联回任务（Phase B3）
- 系统级 E2E 测试证明（v3b-system-e2e 2/2）
- AI Adapter 为**有条件推进项**，未阻塞主系统交付

## 4. 安全边界（重申）

- 即使未来接入 Codex Adapter，也默认只允许**预先批准的只读诊断任务**
- 修改代码、提交 Git、外部网络、付费服务调用——**不开放手机远程执行权限**
- 客户端不能传原始命令冒充 Adapter（白名单 + 固定提示词模板）
