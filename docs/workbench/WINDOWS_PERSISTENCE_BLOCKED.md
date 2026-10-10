# Windows 持久化验收 — 三轮端到端结果（BLOCKED）

> Gorgon Workbench 2.0 · Module A · 分支 `feature/gorgon-opportunity-v2`
> 日期 2026-10-10 · HEAD `41c1ca0`（未新增提交）
> 状态：**WINDOWS_PERSISTENCE = BLOCKED**（三次有效验证均 FAIL，按停止条件停止重写探针）

## 结论摘要

- **Android 侧持久化已 PASS**（模拟器 force-stop → 冷启动 → Preferences 恢复，token
  `gorgon-android-restart-v3-1791616092` 完整往返，hydratedKeys=4）。
- **Windows 侧持久化本轮 BLOCKED**：三次两进程往返均未完成跨进程读回。
  失败点**不在持久化机制本身**（更早 15:56 的 probe6 曾用相同代码成功返回 token），
  而在探针运行时环境：**WebView2 页面 `loaded` 事件在 16:10 后连续三轮不再触发**，
  导致探针连「写入」阶段都无法执行，跨进程读回无从谈起。

## 三轮证据（原始日志节选）

### Round 1（16:10，复用目录 + 无重试 + 2s 间隔）
- write：`page_loaded` 触发，`write_readback=None` → `WRITE_MISMATCH` → EXIT 1
- read：`PAGE_NOT_LOADED within 45s` + WebView2 `E_UNEXPECTED (0x8000FFFF)` → EXIT 3

### Round 2（16:26，重试 + 8s 间隔 + 复用目录）
- 沙箱 `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]` 拦截了 `rm -rf`，
  复用 round 1 的脏 profile（EBWebView 残留）。
- write：`PAGE_NOT_LOADED within 45s` → EXIT 3；read：同 → EXIT 3

### Round 3（16:29，唯一目录 + 重试 + 8s 间隔）
- write PID=9328：`PAGE_NOT_LOADED within 45s` → EXIT 3
- read PID=26184：`PAGE_NOT_LOADED within 45s` → EXIT 3
- 两进程均真实退出（WRITE_PROC_EXITED / READ 无残留），无 GorgonWorkbench WebView2 残留进程。

## 已证实原因（有日志/源码证据）

1. **`page_loaded` 未触发（三轮共 4 次）**：pywebview `loaded` 事件由 `inject_pywebview`
   在 `on_navigation_completed` 触发；`generate_js_object` 的 `except` 分支同样会
   `loaded.set()`，且 `window.events.loaded` 不是「页面可交互」的可靠信号。
   探针 worker 只等 `loaded`，一旦页面加载/注入在 WebView2 侧静默失败，worker 死等 45s。
2. **write 返回 None（round 1）**：`evaluate_js` 结果回传依赖页面注入的
   `pywebview.stringify`；注入失败时 `ExecuteScriptAsync` 完成但 `js_results` 无回传，
   `evaluate_js` 返回 None（pywebview window.py `_api_call` 只保证「webview 启动」，
   不保证「stringify 已注入」）。
3. **沙箱安全删除守卫拦截 `rm -rf`**：round 2 的 `[safe-delete]...` 日志证实
   目录清理失败 → 复用脏 profile（这是 round 2 额外引入的干扰，round 3 已用唯一目录规避）。
4. **read 的 `E_UNEXPECTED`（round 1）**：两进程连续启动，第二进程在首进程 WebView2
   browser process 释放 UserDataFolder 前初始化 CoreWebView2Environment。
   round 2/3 加 8s 间隔后该错误消失（但被 `PAGE_NOT_LOADED` 取代）。

## 待验证假设（无直接证据，不再本轮验证）

- H1：16:10 后 WebView2 运行时（v154.0.4258.62）在本 shell 会话的 GUI 线程上，
  页面加载/注入被某种会话级状态阻断（连续 4 次 loaded 不触发）。
  佐证：更早 15:56 probe6 相同代码成功、16:10 起同代码全失败；WebView2 运行时
  注册表版本正常（154.0.4258.62）。
- H2：自定义 HTTP server（固定端口 8731）与 pywebview 内置 server 的注入路径差异，
  在 16:00 后因端口 TIME_WAIT / 环境抖动暴露。probe6 与 round 1 用的是同一自定义 server，
  但仅 probe6 成功 —— 说明不是纯结构问题，而是时序/会话问题。

## 最小修复建议（供下一轮，不本轮执行）

1. **用 pywebview 内置 HTTP server**（`webview.start(http_server=True)` + 本地 URL），
   走官方注入路径，废弃自定义 8731 server；两进程天然共享固定 origin `http://127.0.0.1:42001/`。
2. **不要依赖 `window.events.loaded` 作就绪信号**；改为 `_pywebviewready` 事件
   （`window.events._pywebviewready`），它才是「pywebview JS API 已注入」的准确信号。
3. **evaluate_js 加返回 None 检测**：None 即注入未就绪，重试而非判失败。
4. **每轮唯一 storage 目录**（已采用），避免脏 profile 复用。
5. **单进程内先做「写→读回→关闭→同进程重开窗口」** 的中间验证，先隔离出
   是「跨进程」还是「页面加载」阶段的问题，再回到两进程往返。

## 已保留的失败历史（未删改）

- `/tmp/win_rt.log`、`/tmp/win_rt_w.log`、`/tmp/win_rt_r.log`（round 3，详见仓库外）
- round 1/2 日志见会话历史；`desktop/persistence_probe.py` 当前版本含
  `page_loaded` 就绪等待 + 重试 + 唯一路径规范化，均已语法校验通过。

## 本轮未做（按任务书限制范围）

- 未重写探针进入无限循环（3 次用尽即停）。
- 未开发 C/D/E/F UI、未新增模块、未 push 远端、未重建无关模块。
- Android/`app/` 前端零改动（`git diff --stat -- app/` 为空），
  Android 持久化 PASS 结果不受本轮影响。
