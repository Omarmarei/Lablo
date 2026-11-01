# Runtime for the old-engine harness (RELAY step 2b, tools/engines).
# One container runs one Chromium snapshot (mounted at /engine.zip) under Xvfb and exposes
# its DevTools port on 9223. The built TV apps are mounted read-only at /app and loaded from
# file://, the way a packaged TV app loads.
#
# Debian 9 "stretch" (2017) on purpose: it is the system these 2016–2018 builds were made for.
# Chromium 53/56 export their bundled HarfBuzz symbols, and a modern system Pango (Debian 12)
# calls into them with a newer ABI and segfaults at startup (seen in gdb:
# hb_face_reference_table ← pango_shape_item ← libgtk2ui::NativeThemeGtk2). Stretch's
# HarfBuzz 1.4 / Pango 1.40 match, and it still has GTK 2 + GConf (53/56) and GTK 3 (68).
# Stretch is end-of-life, so packages come from archive.debian.org (still signed; the Release
# file's expiry date is the only check relaxed).
FROM debian:stretch-slim@sha256:abaa313c7e1dfe16069a1a42fa254014780f165d4fd084844602edbe29915e70

RUN echo 'deb http://archive.debian.org/debian stretch main' > /etc/apt/sources.list \
 && apt-get -o Acquire::Check-Valid-Until=false update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      fonts-dejavu-core \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libgconf-2-4 \
      libgtk-3-0 \
      libgtk2.0-0 \
      libnss3 \
      libpango-1.0-0 \
      libx11-xcb1 \
      libxcomposite1 \
      libxcursor1 \
      libxdamage1 \
      libxrandr2 \
      libxss1 \
      libxtst6 \
      socat \
      unzip \
      xvfb \
 && rm -rf /var/lib/apt/lists/*

COPY run-chrome.sh /usr/local/bin/run-chrome.sh

EXPOSE 9223
ENTRYPOINT ["/bin/sh", "/usr/local/bin/run-chrome.sh"]
