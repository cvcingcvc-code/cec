# Gorgon V3F.2 → V3G 交接与仓库同步（2026-10-14）

> 状态：V3F.2 源码已推送；V3G 等待**物理安卓真机验收**。本文为阶段快照，不代表重新构建、部署或真机测试已经完成。旧历史报告保留，不覆盖。

## 一、远端可核实的基线

- 唯一正式仓库：`cvcingcvc-code/cec`。
- 当前研发分支及仓库默认分支：`feature/gorgon-opportunity-v2`。
- V3F.2 提交：`bf25893f4fc3c9374589c8601c7c023c8d93f9c7`，父提交 `cb3df4b`；仅修改 `pipeline/api/server.py`（41 增/1 删）及 `pipeline/tests/test_public_server.py`（182 增）。
- GitHub Release：[`v0.3.4-alpha`](https://github.com/cvcingcvc-code/cec/releases/tag/v0.3.4-alpha)，资产 `gorgon-workbench-v0.3.4-alpha.apk`（3,847,537 bytes）；历史 `v0.3.3-alpha` 不替换、不删除。
- **根据 V3F.2 执行方的验收报告（本次未重新跑本地测试）**：后端测试 65 passed + 98 subtests、Node data-sync 11/11；本地冒烟 33 条活动，其中 demo=true 17、demo=false 16；所有记录有显式布尔 `demo`。
- 新云端地址：`https://2109679843717304320.app.workbuddy.host`。报告确认当前运行旧提交对应的逻辑，**`bf25893` 尚未重新部署**；不要将 GitHub 推送等同于线上生效。旧站 `shanghai-activity-search` 保留，未纳入此次修改。

## 二、下一步：V3G P0 真机验收（先验证，不增加无关功能）

1. 在已安装 v0.3.3（versionCode 8）的手机上**直接覆盖安装** v0.3.4（versionCode 9），不要先卸载；确认以前的自建活动、笔记保留。若签名不匹配或安装失败，明确记录，不删除用户数据绕过问题。
2. 发现页首次打开：确认正常加载可解释来源，默认过滤 demo；当前 33 条服务端记录中应显示 16 条 `demo=false`。这表示“非 demo”，**不保证活动仍未过期或报名有效**，需要打开来源逐一核对。
3. 点击 v0.3.4 手机发现页的「刷新数据」，确认真实网络交互和列表结果；v0.3.3 手机布局无此按钮，桌面 bundle 有相同字符串不等于手机 UI 可见。
4. 断网、强制停止/重启：原缓存可恢复；刷新失败必须如实提示“已保留本地数据”之类文案，不得假报成功。
5. 真实操作建活动 → 建任务 → 加笔记 → 强制停止/重启，检查三种数据持久化；重复执行任务应出现“已执行过”。
6. 对每项填写 PASS/FAIL/BLOCKED/NOT_TESTED，并记录设备 Android 版本、操作步骤、错误信息和必要截图。没有物理设备就保留 NOT_TESTED，**不得标记 DEVICE_PASS**。

验收入口：既有 [Issue #1](https://github.com/cvcingcvc-code/cec/issues/1)。涉及界面给人看“原始 JSON / 代码语言”的问题继续使用 [Issue #3](https://github.com/cvcingcvc-code/cec/issues/3)，先明确复现路径，再按页面修。

## 三、仅在需要发布时：云端部署 `bf25893`

- 核对部署目标、实际使用的分支和 SHA；备份可回滚版本。
- 在本地重跑 API / data-sync 测试并通过后，进行一次受控重新部署。不要误部署旧站或关闭历史站。
- 部署后实际请求 `/api/health` 和 `/api/activities`，检查 HTTP 状态、33 条记录、`demo` 布尔值以及 CORS 允许清单和拒绝非法 Origin。
- 如果环境无法部署，标为 BLOCKED_DEPLOYMENT；**不要虚构发布成功**。部署不是 V3G 真机验收的硬前置条件（旧逻辑当前可用）。

## 四、电脑联动：不要把“已有局域网网关”写成“公网远控已完成”

仓库已有 `scripts/agent-gateway.mjs`（默认 loopback、显式 `--lan` 才允许局域网访问）、`scripts/agent-adapters/codex-adapter.mjs`（预批准只读诊断模板、固定工作区、读沙箱）及专项测试。这里与旧 `readme.md` 中“仅设计，未开发”的描述存在**文档滞后**。

目前已经有局域网/只读实现的源码及 Codex 最小真实调用报告，但**手机→电脑完整真实交互仍须真机验证**，也**不具备无限制远程操控、自动提交代码、公开公网控制**的交付结论。WorkBuddy 可编程适配接口未核实；无可用 API 不假装实现。

先完成上述 V3G P0。随后在独立 Issue/工作分支里按 `docs/AGENT_REMOTE_DESIGN.md` 收口设备身份验证、撤销、审批与审计，电脑端优先 outbound-only；不得直接把局域网 token 网关无保护地暴露到公网。Codex 写操作、支付、发货、账号修改及对外发送均不得自动授权。

## 五、Git 与交付规则

- 更新源码前先 `git fetch cec` 并核实最新 SHA、差异和本地 dirty；不得重置或覆盖他人未提交成果；仅同步应提交的源码、测试与文档。
- 禁止提交 `*.bak`、部署备份目录、运行产物时间戳、API key、token、keystore、签名文件以及 `app/dist` 等不该进版本库的内容。
- P0 发现缺陷时，最小修复 + 对应回归测试 + Android 打包；先走代码验证，真机通过后再考虑新 Release。
- 保留 `v0.3.3-alpha`、`v0.3.4-alpha` 的 tag、签名、资产和预发布状态；不要做未经用户要求的 Release 覆盖或强推。
- 每轮结束报告 commit、branch、测试、部署状态及真机状态，明确 REAL / PARTIAL / BLOCKED / NOT_TESTED。时间盒结束即停止，不无限开发。

## 六、当前退出门槛

`SOURCE_SYNC=CONFIRMED`（`bf25893` 可在 GitHub 查询）；
`CLOUD_REDEPLOY=NOT_DONE`；
`ANDROID_V034_DEVICE_ACCEPTANCE=NOT_TESTED`；
`V3G_STATUS=WAITING_FOR_DEVICE_RESULTS`。

最短下一动作：**在个人物理手机上覆盖安装 v0.3.4 并按第二区逐项验收；有失败即只修失败项。**
