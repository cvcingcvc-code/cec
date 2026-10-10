#!/bin/bash
# Windows persistence round-trip acceptance (Module A).
#
# Two SEPARATE OS processes against the IDENTICAL storage path + origin.
# The path is a forward-slash literal so no env/backslash round-trip can
# mangle it (a prior bug turned C:\... into C:... and invalidated the test).
#
# NEVER kills any process (no taskkill) — this script only launches two
# probes and lets them exit on their own.
set -u
PY="/c/Users/lin/AppData/Local/Programs/Python/Python314/python.exe"
# A UNIQUE per-run storage dir (timestamp) — never reuse a dirty profile, and
# never `rm -rf` (the sandbox's safe-delete guard blocks bulk deletions).
RUNID=$(date +%s)
STORAGE="C:/Users/lin/AppData/Local/GorgonWorkbench/wv-rt-$RUNID"
cd /c/Users/lin/Documents/Gorgon-Workbench || exit 9
rm -f /tmp/win_rt.log /tmp/win_rt_w.log /tmp/win_rt_r.log
TOKEN="gorgon-win-rt-$RUNID"
echo "TOKEN=$TOKEN" > /tmp/win_rt.log
echo "STORAGE=$STORAGE" >> /tmp/win_rt.log

echo "=== WRITE (process A) ===" >> /tmp/win_rt.log
"$PY" desktop/persistence_probe.py --pass write --storage "$STORAGE" --token "$TOKEN" --log /tmp/win_rt_w.log &
W_PID=$!
wait "$W_PID"
echo "WRITE_EXIT=$? WRITE_PID=$W_PID" >> /tmp/win_rt.log

# Confirm process A truly exited before process B starts.
if kill -0 "$W_PID" 2>/dev/null; then
  echo "WRITE_PROC_STILL_ALIVE=$W_PID" >> /tmp/win_rt.log
else
  echo "WRITE_PROC_EXITED=$W_PID" >> /tmp/win_rt.log
fi

# Let the WebView2 browser process (child of the exited python) release the
# UserDataFolder before process B initialises its own CoreWebView2Environment.
# Without this, process B hits E_UNEXPECTED (0x8000FFFF) on controller create.
sleep 8
echo "INTER_PROC_GAP_S=8" >> /tmp/win_rt.log

echo "=== READ (process B, same storage + origin) ===" >> /tmp/win_rt.log
"$PY" desktop/persistence_probe.py --pass read --storage "$STORAGE" --token "$TOKEN" --log /tmp/win_rt_r.log &
R_PID=$!
wait "$R_PID"
echo "READ_EXIT=$? READ_PID=$R_PID" >> /tmp/win_rt.log

echo "=== DISK Local Storage (INFO only) ===" >> /tmp/win_rt.log
find "$STORAGE" -ipath "*Local Storage*" >> /tmp/win_rt.log 2>/dev/null
echo "DONE_ALL" >> /tmp/win_rt.log
