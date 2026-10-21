# 复现 V3K 两页

使用现有 checkout；云任务已经隔离，无需创建 worktree。保留现有用户数据，不运行 `pipeline/run.py`，不清空 localStorage。

```bash
cd /workspace/cec/app
npm ci --registry=https://registry.npmjs.org --replace-registry-host=always --cache /workspace/cec/work/onboarding/npm-cache --no-audit --no-fund
npm run test:build
```

分开启动服务，均绑定 loopback：

```bash
cd /workspace/cec
python pipeline/api/server.py --host 127.0.0.1 --port 8000 --mode demo --today 2026-09-15
```

```bash
cd /workspace/cec/app
npm run dev -- --host 127.0.0.1 --strictPort
# 或生产构建预览：
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

日期固定是为了录制 fixture 的 demo 检索，不代表真实当前活动。搜索页本地采集数据仍由原 recency 逻辑使用设备日期筛选。默认 OBSIDIAN，`?skin=orbit` 是首版 DARK ORBIT，`?legacy=1` 保留原发现页入口。

云端 Chromium 需要环境安装时保留的兼容 helper。它仅适配容器启动、Linux 进程清理和旧截图转存，不修改测试断言或关闭 TLS；新 fixture 的正式证据写到本报告目录。已有 Edge 的 Windows 可按原 CDP 驱动方式直接运行。

```bash
cd /workspace/cec/app
EDGE_BIN=/workspace/cec/work/onboarding/chromium-cloud \
NODE_OPTIONS='--import=/workspace/cec/work/onboarding/linux-cdp.mjs' \
node --test --test-concurrency=4 'tests/*.test.mjs'

EDGE_BIN=/workspace/cec/work/onboarding/chromium-cloud \
node --import /workspace/cec/work/onboarding/linux-cdp.mjs tests/v3k-search-card-e2e.mjs

# 需先启动生产 preview；BASE_URL 可覆盖默认 4173：
EDGE_BIN=/workspace/cec/work/onboarding/chromium-cloud \
node --import /workspace/cec/work/onboarding/linux-cdp.mjs tests/v3k-mobile-ui-e2e.mjs
```

原 V3J E2E 各自启动 preview，用固定端口，必须串行且不能重复启动同一套：

```bash
cd /workspace/cec/app
# 每个命令使用相同 EDGE_BIN、node --import Linux helper，TZ=Asia/Shanghai。
node tests/v3j-datepicker-render-e2e.mjs
node tests/v3j-note-create-e2e.mjs
node tests/v3j-image-e2e.mjs
node tests/v3j-map-e2e.mjs
```

当前环境也保留 `python work/v3k/run-v3j-regressions.py datepicker notes image map` 的兼容串行 runner。真实海报联网一项当前受代理 403 阻断；不得把其非零退出码报告成通过。

导出的 `work/v3k/exports/Gorgon-V3K-Design-Options.zip` 包含五版概念、首版真实页面及当前 OBSIDIAN 前后截图。云端无法直接写入用户电脑桌面，下载 ZIP 后解压保存即可。概念图明确标注为非运行截图；真实页面证据为 Chromium 渲染，并非 Android 真机。
