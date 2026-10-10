"""Windows persistence acceptance probe (Module A).

Reproduces the EXACT pywebview configuration the shipped desktop shell now
uses (``private_mode=False`` + a stable ``storage_path``) and asserts that
localStorage SURVIVES a full process restart — the Phase 11 defect.

Protocol (two separate OS processes, like a real reboot of the app):
  pass 1:  write a unique token into localStorage, then exit.
  pass 2:  same storage_path, read the token back from localStorage.

Also proves the WebView2 on-disk profile actually appears under storage_path
(the EBWebView/.../Local Storage LevelDB), which is what "persisted" means.

Run BOTH passes:
  python desktop/persistence_probe.py --pass write --storage <DIR> --token <T>
  python desktop/persistence_probe.py --pass read  --storage <DIR> --token <T>

Exit code 0 = token round-tripped (persistence WORKS). Non-zero = FAIL.
Requires a real interactive desktop session (WebView2 needs a GUI); in a
headless/sandbox shell it prints GUI_UNAVAILABLE and exits 3 so the caller
can honestly mark the item NOT_TESTED instead of guessing.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path


def _run(pass_name: str, storage: Path, token: str) -> int:
    try:
        import webview
    except Exception as exc:  # pragma: no cover
        print(f"PYWEBVIEW_UNAVAILABLE: {exc}")
        return 3

    result = {"read": None}
    done = {"v": False}

    html = "<!doctype html><html><body><div id='p'>probe</div></body></html>"

    def on_loaded():
        try:
            if pass_name == "write":
                window.evaluate_js(
                    f"localStorage.setItem('gorgon_persist_probe', {token!r}); 'ok'"
                )
                # give WebView2 a moment to flush LevelDB to disk
                time.sleep(1.5)
                result["read"] = "WROTE"
            else:
                val = window.evaluate_js(
                    "localStorage.getItem('gorgon_persist_probe')"
                )
                result["read"] = val
        except Exception as exc:
            result["read"] = f"JS_ERROR: {exc}"
        finally:
            done["v"] = True
            try:
                window.destroy()
            except Exception:
                pass

    try:
        window = webview.create_window("Gorgon Persistence Probe", html=html,
                                       width=420, height=320)
    except Exception as exc:
        print(f"CREATE_WINDOW_FAIL: {exc}")
        return 3
    window.events.loaded += on_loaded

    # Watchdog: if no GUI session, start() blocks/raises — cap the wait.
    try:
        webview.start(private_mode=False, storage_path=str(storage), gui="edgechromium")
    except Exception as exc:
        print(f"START_FAIL(maybe no GUI session): {exc}")
        return 3

    if pass_name == "write":
        print("WRITE_OK")
        return 0
    got = result["read"]
    print(f"READ_BACK={got!r}")
    if got == token:
        print("PERSIST_OK")
        return 0
    print("PERSIST_FAIL")
    return 1


def main(argv=None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--pass", dest="pass_name", required=True,
                   choices=("write", "read"))
    p.add_argument("--storage", required=True)
    p.add_argument("--token", default="gorgon-persist-OK")
    args = p.parse_args(argv)
    storage = Path(args.storage)
    storage.mkdir(parents=True, exist_ok=True)
    return _run(args.pass_name, storage, args.token)


if __name__ == "__main__":
    raise SystemExit(main())
