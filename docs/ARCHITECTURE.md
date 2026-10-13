# Gorgon Workbench 核心架构（ARCHITECTURE）

> 更新日期：2026-10-13（GMT+8）
> 本文件描述**当前真实架构**（以代码为准，不是以愿景为准）。产品定位见 `docs/PRODUCT_VISION.md`。

## 1. 总览

```
┌─────────────────────────────────────────────────────────┐
│                    Android / 浏览器 / 桌面                │
│  app/  React 18 + Vite 5 生产构建（Phase 1 起正式前端）    │
│    src/            前端源（screens / lib / components）   │
│    android/        Capacitor 8 壳（cn.gorgon.workbench）  │
│    tests/          Node .mjs 单测 + E2E + build-smoke     │
│  ui_kits/ components/  legacy 前端（Babel 运行时，稳定）   │
│  desktop/          Windows 桌面壳（pywebview + build.ps1）│
├─────────────────────────────────────────────────────────┤
│                      Python Pipeline                     │
│  pipeline/api/server.py   静态服务 + POST /api/search     │
│  pipeline/search/         planner→provider→fetch→rank    │
│  pipeline/ingest|normalize|clean|dedupe|trust|review/     │
│  pipeline/data/           raw→normalized→work→review     │
│                           →approved（12 个 JSON 业务数据） │
└─────────────────────────────────────────────────────────┘
```

## 2. 关键模块

| 模块 | 位置 | 说明 |
|---|---|---|
| 前端正式入口 | `app/src/` | React 18 + Vite 5；`npm run dev/build/preview/test` |
| API 配置层 | `app/src/lib/api.js` | **唯一** API 地址配置点（VITE_API_BASE_URL），其余禁止硬编码 |
| AI 行动辅助 | `app/src/lib/ai/` | provider contract / Mock 兜底 / Hunyuan / budget / cache / eligibility gate |
| AI key 注入 | hostEnv（GORGON_AI_* 环境变量） | key 不进 bundle/APK（build-smoke 18/18 含 secret 扫描） |
| 状态与持久化 | `app/src/lib/workbench-store.js` | 任务/日程/地点/笔记/项目统一状态 |
| 原生持久化 | `app/src/lib/native-persistence.js` | localStorage → Capacitor Preferences 镜像 |
| 任务模型 | `app/src/lib/task-model.js` | 7 态状态机 + TRANSITIONS 白名单 |
| 检索服务 | `pipeline/api/server.py` | 单进程静态服务 + POST /api/search；白名单只放行 App 资源 |
| 数据管线 | `pipeline/` | 纯 Python 标准库，零第三方依赖 |
| APK 构建 | `app/scripts/build-apk.mjs` | vite build（VITE_API_BASE_URL→部署服务器）+ cap sync |
| Windows 壳 | `desktop/main.py` + `desktop/build.ps1` | pywebview onedir 打包（gitignore，可再生） |

## 3. 数据流

```
信息发现：web sources → pipeline (ingest→normalize→clean→dedupe→trust→review→approved)
    ↓ approved/activities.json
检索：POST /api/search → planner → provider(real/mock) → fetcher → ranker → 结果
    ↓
行动闭环：任务创建 → 日程排期 → 地点走访 → 笔记记录 → 项目聚合 → 复盘
    ↓ （opt-in）
AI 辅助：runTask(aiClient) → provider → 失败 fallback 本地（任务仍完成）
```

## 4. 安全模型

| 层 | 机制 |
|---|---|
| API key | 只存 Python 侧（search.env / GORGON_AI_*）；浏览器 bundle 死代码分支，无法编译进前端 |
| VITE_* | 仅 PUBLIC 变量；`.env` / `.env.local` gitignore |
| Android 签名 | keystore + keystore.properties gitignore（丢失即无法覆盖安装，模板提供） |
| 服务端 | 白名单静态放行；反扫描断言（test_public_server.py）验证不含密钥/路径 |
| 诚实降级 | provider 失败/限流/断网 → deterministic 路径，任务仍完成、fallbackReason 上报 |
| 外部副作用 | 全部走人工批准（proposal-repository pending/approved/rejected） |

## 5. Git 架构

- 主仓：`C:\Users\lin\Documents\Gorgon-Recovered`（共享对象库）
- 工作树：
  - `F:\Gorgon-Workbench`（**主开发**，feature/gorgon-opportunity-v2）
  - `C:\Users\lin\Documents\Gorgon-Travel-Agent-V1`（feature/travel-agent-v1）
- 远端：`origin` = geergong.git（旧）/ `cec` = cec.git（**主推送目标**）
- 项目已于 2026-10-13 迁移至 F 盘（见 `reports/migration/MIGRATION_REPORT.md`）

## 6. 测试体系

| 套件 | 命令 | 基线 |
|---|---|---|
| App 单测 | `cd app && npm test`（node --test） | 411/411 |
| build-smoke | `npm run test:build` | 18/18（含 secret 扫描） |
| vite build | `npm run build` | PASS |
| pipeline Python | unittest（需系统 Python） | 453 断言 |
| E2E（浏览器/Android） | `npm run test:e2e` / `test:e2e:workbench` | 需模拟器，BLOCKED_ENVIRONMENT |
