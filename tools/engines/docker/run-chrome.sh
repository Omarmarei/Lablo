#!/bin/sh
# Starts the Chromium snapshot mounted at /engine.zip under Xvfb, with DevTools on port 9223.
# Chromium 53/56 have no usable headless mode, so they run headed on a virtual 1920x1080 screen.
set -eu

mkdir -p /opt/engine
unzip -q /engine.zip -d /opt/engine
CHROME=/opt/engine/chrome-linux/chrome
"$CHROME" --version 2>/dev/null || true

Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
export DISPLAY=:99
i=0
while [ ! -e /tmp/.X11-unix/X99 ] && [ "$i" -lt 100 ]; do
  sleep 0.1
  i=$((i + 1))
done

# Old Chromium binds DevTools to 127.0.0.1 only; forward it so the published port reaches it.
socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222 &

exec "$CHROME" \
  --no-sandbox \
  --user-data-dir=/tmp/profile \
  --remote-debugging-port=9222 \
  --no-first-run \
  --no-default-browser-check \
  --disable-gpu \
  --disable-dev-shm-usage \
  --disable-background-networking \
  --disable-component-update \
  --disable-default-apps \
  --disable-sync \
  --disable-translate \
  --password-store=basic \
  --window-position=0,0 \
  --window-size=1920,1080 \
  "$@" \
  about:blank
