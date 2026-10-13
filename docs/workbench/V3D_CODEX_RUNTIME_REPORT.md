# V3D Codex 真实执行诊断与验证

日期：2026-10-13（Asia/Shanghai）。工作树：`F:\Gorgon-Parallel\gateway`。
分支：`fix/v3d-codex-runtime`。基线：`6524f44d9d1284038b68d5557d47f9d33f064d48`。

## 结论

`CODEX_REAL_EXECUTION=PASS`。本轮仅发起 **一次** 受控最小模型调用，使用真实安装的 Codex CLI、现有 ChatGPT 登录和已配置 Windows 代理，返回中文分析，退出码 0，耗时 **61,820 ms**。没有 Mock 充当真实 AI，也没有重试模型调用。

真实返回内容：

> Gorgon 通过可追溯、可核验的证据分析，将信息转化为任务与日程，再经智能体执行落实行动，并把结果记录和失败复盘沉淀为长期记忆，形成持续改进判断与行动的闭环。

这是 Adapter 的最小分析调用验收；没有额外发起 Gateway 完整六节项目诊断模型调用。Gateway HTTP 与生命周期验收使用真实 Gateway 进程、实际本地执行器和明确标注的受控子进程夹具，不消耗模型额度。

## 已证实的根因

1. **CLI 提示词输入等待 EOF**：原 Adapter 使用 `spawn` 默认 stdin 管道，传入 argv 提示词后一直没有关闭管道。安装版本的 `codex exec --help` 明确说明：提示词和 piped stdin 同时存在时，stdin 会作为附加输入。读取 EOF 的真实本地子进程回归测试在原代码上 3 秒超时；改为 `stdio: ["ignore", "pipe", "pipe"]` 后约 0.2 秒完成。该缺陷解释了提示词尚未被接收时的长时间无结果；历史报告只有 120/240 秒超时记录，没有保存 stderr，不能把历史所有超时归结为账户额度。
2. **代理环境缺失**：当前 PowerShell/Node 环境未设置 HTTP(S)/ALL/GORGON_CODEX_PROXY；Gateway 继承这个环境，Adapter 只额外指定只读模式。Windows 已配置代理 `127.0.0.1:7890`，该设置没有自动变成子进程代理环境变量。无认证直连 HTTPS 探针 15 秒超时（curl 28 / HTTP 000）；通过现有代理 CONNECT 200，目标 HTTP 403。403 仅证明未认证探针可到达 HTTPS 服务，不能作为账户认证失败证据。唯一模型调用通过现有 `GORGON_CODEX_PROXY` 子进程覆盖机制传入此代理，成功返回。
3. **Gateway 超时冲突**：原统一硬超时 60 秒，而 Codex 默认 420 秒（配置范围 30–600 秒）。实际最小模型调用耗时 61.82 秒，已经超过原 Gateway 上限。现在 Codex 的 Gateway 预算为 Adapter 预算加 25 秒，覆盖有界前后快照；普通执行器仍为 60 秒。Adapter 超时映射为 `timed_out`。

## CLI、认证、额度、旧进程

- 路径：`C:\Users\lin\AppData\Local\OpenAI\Codex\bin\2e5e00daee91c61d\codex.exe`。
- 版本：`0.162.0-alpha.17.2`；终端解析结果和 Adapter 探测一致。
- `codex login status` 退出 0，报告 `Logged in using ChatGPT`。没有读取、复制或打印认证文件或 token，没有换账户或创建 API key。
- 本地 `exec --help` 支持 `--sandbox read-only`、`-C`、`--skip-git-repo-check`、`--ephemeral`；真实调用验证了最终参数兼容性。
- 桌面用量查询当时显示普通使用可用、5 小时窗口已用 11%、周窗口已用 18%，没有触发限制。该查询本身不能证明 CLI 登录为同一账户；模型成功返回才是该 CLI 当时可用的证据。
- 初始检测到桌面 app-server 和旧 Adapter 测试的 Codex exec（PID 29944，父 PID 20964，父进程标识为 Adapter 测试）。未终止不属于本轮的进程。验证结束只剩桌面 app-server；本轮模型子进程退出。
- 本轮未占用 8765，未修改系统代理，未修改 `F:\Gorgon-Workbench` 或 `F:\Gorgon-Parallel\android`，未构建 APK。

## 最小修复及安全边界

- Adapter 关闭闲置 stdin，使用已验证的 `--ephemeral`，保留只读沙箱、固定 cwd、argv 数组和 `shell:false`。
- 保留脱敏 stderr、退出码、时长；合并 stdout/stderr 判断账户、认证、网络失败；超时保留已观察到的失败类别，但终态仍诚实记录超时。
- 实现 Adapter AbortSignal；Gateway 将已有取消请求连接到已启动子进程，阻止启动前已取消的 Adapter 请求。保留原 `finalizeRunOnce`，用运行 ID 限制迟到任务释放执行槽，超时后的迟到子进程登记也会终止。
- 默认固定工作区改为 Gateway 所属检出目录；管理员可通过既有 `GORGON_CODEX_WORKSPACE` 指定固定路径，HTTP 输入不能覆盖。提示词引用 `-C` 指定的工作区。Git 快照检查实际 Codex cwd，快照失败不声称干净，区分 `gitClean` 与 `gitUnchanged`。后者表示完整 git status 摘要不变，并非全文件内容取证；本轮输入 `readme.md` 与基线规范化换行后的内容一致，最终 diff 仅含本轮已知改动。
- 测试执行器原先只需继承路径变量即可执行 JSON 源码或 ESM 顶层代码。现在必须同时满足 `NODE_ENV=test`、`GORGON_GATEWAY_TEST_MODE=1`、显式隔离状态目录、loopback 模式；夹具真实路径必须位于该目录内，不得覆盖内置执行器。生产或 `--lan` 下两种注入都不读取、不求值、不 import。
- 常规单测默认跳过真实模型调用；只能通过显式 `GORGON_CODEX_REAL_EXECUTION=1` 启用。空的分类测试已替换为实际子进程失败证据测试。所有测试端口和状态目录隔离，状态、日志及依赖缓存位于忽略的 `work/`。

## 可复现命令与结果

在工作树根目录运行专项测试：

```powershell
node --test app/tests/v3c-codex-adapter.test.mjs
node --test app/tests/v3c-gateway-lifecycle.test.mjs
node --test app/tests/v3d-gateway-injection-security.test.mjs
node --test app/tests/v3b-system-e2e.test.mjs
```

| 验证 | 结果 |
| --- | --- |
| 原 Adapter 非模型基础项 | 3/3 PASS（原分类项为空，已补齐） |
| stdin EOF 回归，修复前 / 后 | 超时 FAIL / PASS |
| 原生命周期基线 | 6/6 PASS |
| Adapter 专项 | 10 PASS，真实调用项默认跳过 1 |
| 独立唯一真实模型调用 | 1/1 PASS，61,820 ms，退出 0 |
| Gateway 生命周期 | 8/8 PASS；含真实子 PID 取消/超时退出、迟到结果及执行槽保护 |
| 注入安全专项 | 11/11 PASS；含生产、缺失控制项、LAN、越界夹具和内置执行器保护 |
| 系统 E2E | 2/2 PASS；实际 HTTP、配对认证、任务/结果回链 |
| `cd app; npm test` | 486 项：485 PASS、0 FAIL、1 SKIP（真实模型项按设计跳过） |
| `cd app; npm run test:build` | Vite 生产构建 PASS；Build Smoke 18/18，含 bundle secret/path 扫描 |
| Git diff / 敏感信息 | diff 检查 PASS；没有真实 secret，仅脱敏测试的合成夹具命中 |

完整回归日志和唯一调用日志保留在本地忽略的 `work/frontend-tests.log`、`work/codex-real-validation.log`，不随提交推送。

## 集成启动条件

该机器需要让 Gateway **显式继承已经验证的代理**。这属于本机启动环境，不应写死在发布代码或更改系统代理。例如在启动 Gateway 的同一个 PowerShell 中设置：

```powershell
$env:GORGON_CODEX_PROXY = 'http://127.0.0.1:7890'
node scripts/agent-gateway.mjs
```

示例使用生产默认端口，仅供 WorkBuddy 集成后在确认端口空闲时启动；本轮没有启动或改动用户的 8765 实例。真实调用验收只临时设置测试子进程环境，结束后恢复。其他机器必须使用自己的有效配置，不自动猜测代理或绕过认证。

没有账户、额度或模型执行 BLOCKER。完整六节诊断、物理手机验收和现有生产 Gateway 更新留给 WorkBuddy 集成阶段；本轮不追加模型调用、不合并、不发布 Release。

官方参考：[Codex exec / login 命令](https://learn.chatgpt.com/docs/developer-commands)。参数兼容性以此次安装版本的实际帮助和真实执行为准。
