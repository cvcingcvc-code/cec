"""Windows persistence acceptance probe (Module A).

Reproduces the EXACT pywebview configuration the shipped desktop shell now
uses (``private_mode=False`` + a stable ``storage_path``) and asserts that
localStorage SURVIVES a full process restart — the Phase 11 defect.

Design notes (each one is a bug this probe already hit)
-------------------------------------------------------
1. HTTP origin, not inline html=. WebView2 treats inline HTML (about:blank) as
   an opaque origin where ``localStorage`` throws SecurityError by design. The
   production shell serves the app from ``http://127.0.0.1:<port>/``, so this
   probe does the same via a tiny FIXED-port server. Both passes MUST share one
   origin (localStorage is per-origin).

2. Wait for ``window.events.loaded`` — never poll ``evaluate_js``. pywebview's
   ``evaluate_js`` blocks on a semaphore with NO timeout; calling it from a
   worker thread before the WebView is initialised deadlocks the whole process
   (observed: worker hung 3+ min, nothing written). The loaded event fires on
   the GUI thread, so we set a ``threading.Event`` there and have the worker
   wait on that instead.

3. The authoritative criterion is the CROSS-PROCESS read-back, not whether
   the ``EBWebView/.../Local Storage/leveldb`` directory exists on disk.
   WebView2 commits localStorage lazily (periodic timer + on browser-process
   exit), so the directory may not exist while the window is still open. The
   write pass therefore (a) writes the token, (b) reads it back in-page to
   confirm the write, (c) lets the page settle, (d) tears the window down
   gracefully so the WebView2 browser process flushes on exit, and records
   the LevelDB directory presence as INFO ONLY — it never gates the result.

4. The ``ConnectionResetError`` from WebView2's speculative preconnect is
   benign noise; ``handle_error`` is overridden so it does not bury the result.

Protocol (two separate OS processes, like a real reboot of the app):
  pass 1 (write): write token -> poll disk until LevelDB commits -> exit.
  pass 2 (read):  same storage_path + same origin -> read token back.

Run BOTH passes:
  python desktop/persistence_probe.py --pass write --storage <DIR> --token <T>
  python desktop/persistence_probe.py --pass read  --storage <DIR> --token <T>

Exit 0 = pass. Exit 1 = persistence FAIL. Exit 3 = GUI_UNAVAILABLE (headless
shell) so the caller can mark the item NOT_TESTED instead of guessing.
"""
from __future__ import annotations

import argparse
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PROBE_PORT = 8731
SETTLE_S = 4.0            # post-write settle before graceful teardown
LOAD_BUDGET_S = 45        # max wait for window.events.loaded

_LOG_PATH: Path | None = None


def log(msg: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    if _LOG_PATH is not None:
        try:
            with _LOG_PATH.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except Exception:
            pass


PAGE = b"""<!doctype html><html><head><meta charset="utf-8">
<title>Gorgon Persistence Probe</title></head>
<body><div id="p">probe</div></body></html>"""


class _ProbeHandler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(PAGE)))
            self.end_headers()
            self.wfile.write(PAGE)
        except Exception:
            pass

    def log_message(self, fmt, *args):  # quiet
        pass


class _ProbeServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        # WebView2 opens speculative connections and resets them; benign.
        pass


def _serve_probe_page() -> _ProbeServer:
    httpd = _ProbeServer(("127.0.0.1", PROBE_PORT), _ProbeHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def _leveldb_dir(storage: Path) -> Path:
    return storage / "EBWebView" / "Default" / "Local Storage" / "leveldb"


def _run(pass_name: str, storage: Path, token: str) -> int:
    try:
        import webview
    except Exception as exc:  # pragma: no cover
        log(f"PYWEBVIEW_UNAVAILABLE: {exc}")
        return 3

    try:
        _serve_probe_page()
    except OSError as exc:
        log(f"PROBE_SERVER_FAIL(port {PROBE_PORT} busy?): {exc}")
        return 3

    url = f"http://127.0.0.1:{PROBE_PORT}/"
    ls_dir = _leveldb_dir(storage)
    loaded = threading.Event()
    outcome = {"code": 1, "pid": os.getpid()}

    window = webview.create_window("Gorgon Persistence Probe", url,
                                   width=460, height=340)

    def on_loaded():
        # Fires on the GUI thread. Do NO blocking work here.
        loaded.set()

    window.events.loaded += on_loaded

    def worker():
        """Background thread (pywebview runs func after the GUI loop starts)."""
        try:
            log(f"PID={os.getpid()} ORIGIN={url} "
                f"STORAGE_RESOLVED={storage.resolve()} (as_posix)")
            if not loaded.wait(LOAD_BUDGET_S):
                log(f"PAGE_NOT_LOADED within {LOAD_BUDGET_S}s")
                outcome["code"] = 3
                window.destroy()
                return
            log("page_loaded")

            if pass_name == "write":
                js = (f"localStorage.setItem('gorgon_persist_probe', {token!r});"
                      "localStorage.getItem('gorgon_persist_probe')")
                got = None
                for attempt in range(3):
                    got = window.evaluate_js(js)
                    log(f"write_attempt_{attempt + 1}_readback={got!r}")
                    if got == token:
                        break
                    time.sleep(1.5)
                if got != token:
                    log(f"WRITE_MISMATCH after retries: {got!r}")
                    outcome["code"] = 1
                    window.destroy()
                    return
                outcome["code"] = 0
                # Let the page settle so the renderer gets a chance to flush,
                # then tear down gracefully (browser process exits cleanly and
                # commits whatever is pending). LevelDB presence is INFO only.
                time.sleep(SETTLE_S)
                log(f"leveldb_dir_while_open_exists={ls_dir.exists()} (INFO only)")
            else:  # read
                js = "localStorage.getItem('gorgon_persist_probe')"
                got = None
                for attempt in range(3):
                    got = window.evaluate_js(js)
                    log(f"read_attempt_{attempt + 1}_readback={got!r}")
                    if got == token:
                        break
                    time.sleep(1.5)
                if got == token:
                    log("PERSIST_OK")
                    outcome["code"] = 0
                else:
                    log(f"PERSIST_FAIL (got={got!r})")
                    outcome["code"] = 1

            # Graceful teardown only AFTER the page settled / read completed.
            window.destroy()
        except Exception as exc:
            log(f"WORKER_ERROR: {exc!r}")
            outcome["code"] = 1
            try:
                window.destroy()
            except Exception:
                pass

    try:
        webview.start(worker, private_mode=False,
                      storage_path=str(storage), gui="edgechromium")
    except Exception as exc:
        log(f"GUI_UNAVAILABLE / START_FAIL(maybe no GUI session): {exc}")
        return 3

    return outcome["code"]


def main(argv=None) -> int:
    global _LOG_PATH
    p = argparse.ArgumentParser()
    p.add_argument("--pass", dest="pass_name", required=True,
                   choices=("write", "read"))
    p.add_argument("--storage", required=True)
    p.add_argument("--token", default="gorgon-persist-OK")
    p.add_argument("--log", default=None)
    args = p.parse_args(argv)
    # Canonicalize ONCE so write and read resolve to the IDENTICAL directory
    # regardless of how the caller spelled it (forward/back slashes, case).
    storage = Path(args.storage).expanduser().resolve()
    storage.mkdir(parents=True, exist_ok=True)
    if args.log:
        _LOG_PATH = Path(args.log)
    log(f"PASS={args.pass_name} STORAGE={storage} TOKEN={args.token} "
        f"STORAGE_AS_POSIX={storage.as_posix()}")
    code = _run(args.pass_name, storage, args.token)
    log(f"EXIT_CODE={code}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
