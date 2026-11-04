#!/bin/sh
# Starts the webOS TV Simulator mounted at /sim.appimage on a virtual 1920x1080 screen and
# opens the app folder mounted at /app in it. Extra arguments go to the Simulator.
set -eu

# Extract the AppImage instead of mounting it: a container has no FUSE.
cp /sim.appimage /tmp/sim.appimage
chmod +x /tmp/sim.appimage
cd /opt
/tmp/sim.appimage --appimage-extract >/dev/null
# AppRun looks for its own folder through its first argument, which fails for an absolute
# app path, so start the Simulator's binary directly with AppRun's library path.
BIN=$(ls /opt/squashfs-root/webos-tv-*-simulator)
export LD_LIBRARY_PATH=/opt/squashfs-root/usr/lib

Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
export DISPLAY=:99
i=0
while [ ! -e /tmp/.X11-unix/X99 ] && [ "$i" -lt 100 ]; do
  sleep 0.1
  i=$((i + 1))
done

# The arguments ares-launch passes (the app folder, then the launch parameters as JSON).
# Electron runs as root here, so Chromium's sandbox is off.
exec "$BIN" /app '{}' --no-sandbox --disable-gpu --disable-dev-shm-usage "$@"
