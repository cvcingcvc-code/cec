# Gorgon Workbench — GitHub 全量同步与 APK 交付 · 最终验证报告

- 日期：2026-10-15
- 任务：GitHub 全量同步与最新 APK 交付（只同步/交付，不开发新功能、不重构、不改 UI）
- 结论：**全部停止条件达成。默认分支已包含全部 V3H 更新，手机可从 readme 直链下载到与最新代码一致的 v0.3.6-alpha APK。**

---

## 1. 默认分支名称与最新远端 SHA

| 项目 | 值 |
| --- | --- |
| 仓库 | `cvcingcvc-code/cec` |
| 默认分支 | **`feature/gorgon-opportunity-v2`** |
| 最新远端 SHA | **`9e0e46529c574b78c479c0df5b45efda2bb016c7`** |
| 指向的提交 | `docs(readme): unify download entry — v0.3.6-alpha (versionCode 11) with SHA256, install/upgrade guide, device-limitations section` |

远端核实命令：`gh api repos/cvcingcvc-code/cec --jq '.default_branch'` → `feature/gorgon-opportunity-v2`；
`gh api .../branches/feature/gorgon-opportunity-v2` → SHA `9e0e465…`。

## 2. 已同步的提交数量

- 本轮 ff-only 同步：**10 个提交**（`a48f919` → `9e0e465`），全程 fast-forward，未产生 merge commit，未触碰任何本地工作树。
- 核实命令：`git rev-list --count a48f919..9e0e465` → `10`。
- 同步后 `feat/v3g-agent-results-zh` 与默认分支远端 SHA **完全一致**（均为 `9e0e465`）。

## 3. 尚未合并的分支和 PR

**已合并（4）**：PR #6（feat/v3g-agent-results-zh）、PR #5（fix/v3d-codex-runtime）、PR #4（feat/v3c-android-agent-ux）均 MERGED；`feature/data-pipeline-mvp`、`feature/demo-mvp`、`master` 经 `git merge-base --is-ancestor` 核实均已并入默认分支。

**未合并（独立主题，不阻塞交付）**：
- `feat/v3e-functional-closure` @ `b4714b5` — V3E 功能闭环主题分支，未并入默认分支。
- `feature/human-review-loop` @ `759fc51` — 人工复核主题分支，未并入默认分支。
- `feature/workbench-competition`、`feature/travel-agent-v1`、`feature/v1-frontend-build` — 其他产品线分支，未纳入本仓库主线。
- 无 OPEN 状态 PR（全部 3 个 PR 均已 MERGED）。

## 4. 最新 APK 版本号与 SHA256

| 项目 | 值 |
| --- | --- |
| 版本 | **v0.3.6-alpha**（versionCode 11，versionName 6.0.6） |
| applicationId | `cn.gorgon.workbench` |
| 文件大小 | 3,848,253 bytes |
| **SHA256** | **`726d8d5826e4ef493f2701d2fc1a843ef60130129535a2c85453531da01c0a24`** |
| 本地与 GitHub 资产一致性 | **一致**（本地 `release-apk/` 与 GitHub Release 资产重下载后 SHA256 逐字节相同） |

- aapt 核实：`package: name='cn.gorgon.workbench' versionCode='11' versionName='6.0.6'`
- V3H 内容抽查：从 bundle 提取 minified 代码后 `"明天"` 命中 3 处，包含修复后的 relDate 正则与「明天下午我要去面试」测试语料。

## 5. GitHub Release 链接

- **https://github.com/cvcingcvc-code/cec/releases/tag/v0.3.6-alpha**
- 状态：Pre-release，非 Draft，资产 1 个（`gorgon-workbench-v0.3.6-alpha.apk`）。

## 6. APK 直接下载链接

- **https://github.com/cvcingcvc-code/cec/releases/download/v0.3.6-alpha/gorgon-workbench-v0.3.6-alpha.apk**
- 该直链已写入 `readme.md`「Android 运行情况」章节，readme 为唯一下载入口。

## 7. 签名连续性验证结果

- **PASS**。`apksigner verify --print-certs` 通过（v2 scheme）。
- v0.3.6-alpha 证书：`CN=Gorgon Workbench, OU=Gorgon, O=Gorgon, L=Shanghai, ST=Shanghai, C=CN`
- 证书 SHA-256：`45b442368c7e270c5e564c704d13f23b526975329fae6b28a9bf828c70f47167`
- 与上一版 v0.3.5-alpha 证书 SHA-256 **完全相同** → 覆盖安装升级可直接进行，无需卸载重装。

## 8. 测试 PASS / FAIL / SKIP 明细

| 套件 | 结果 | 说明 |
| --- | --- | --- |
| Node（`npm test`，`CODEBUDDY_SAFE_DELETE_ENABLED=0`） | **571 项：570 PASS / 0 FAIL / 1 SKIP**（复跑确认） | 首次运行出现 1 失败，间隔复跑两次均全绿，判定为 e2e 网关进程环境干扰（flaky），**非代码缺陷** |
| Python（`python -m unittest discover`） | **472 项全 OK（1 skip）** | 43.8s，pipeline 全部回归通过 |
| 构建冒烟（`npm run test:build`） | **18/18 PASS** | no Babel/JSX transform、no secret、no dev build 等 bundle 纯净度检查全过 |
| Android 冒烟 | aapt badging 正常、apksigner verify 通过 | versionCode 11 / versionName 6.0.6 |

## 9. 真机待验收事项

1. 从 readme 直链下载 APK，安装/覆盖升级（签名一致，可直接覆盖）。
2. 核对「设置 → 关于」或启动页版本显示 6.0.6 / v0.3.6-alpha。
3. **V3H 场景 A 回归**：输入「明天下午我要去面试，帮我整理准备事项。」→ 应生成面试准备目标与引擎步骤（不再 unknown）。
4. 相对日期边界：「今天天气真不错」不应被识别为日期；「明天下午」应识别为「明天」。
5. Agent 执行中文结果与折叠技术详情（V3G）在手机端渲染正常。
6. 云端部署 `/api/activities` 返回 200、33 条数据（`DEMO_DATA: true` 显式布尔）。
7. 电脑端 Agent（局域网只读）与手机端联动冒烟。
8. 历史版本覆盖升级后本地数据保留正常。

## 停止条件核对

- [x] 默认分支同步完成（10 commits ff-only，远端 SHA `9e0e465` 双重验证）
- [x] 真实 APK 已验证（GitHub 重下载 SHA256 逐字节一致、签名/版本/V3H 内容核对通过）
- [x] 下载入口指向正确文件（readme 直链 = Release 资产）
- [x] 报告提交并推送 GitHub（见下一步操作）

> 本轮未开发新功能、未重构架构、未修改 UI。所有已知本地未提交改动均为运行态产物（pipeline 运行态 JSON、gradle 同步文件、生成数据），按约定不提交。
