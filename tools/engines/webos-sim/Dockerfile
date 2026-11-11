# LG's webOS TV Simulator (Linux AppImage) under Xvfb, for running the Lablo Lab without a TV
# (RELAY step 15e; docs/runbooks/tv-setup.md 2.4).
#
# Why Docker: Smart App Control on the dev PC refuses the Simulator's unsigned Windows .exe.
# The Linux build runs here instead, with a virtual display. LG's SDK license forbids
# redistributing the Simulator, so the image holds only the runtime libraries: the AppImage
# is mounted at /sim.appimage when the container starts. Build and keep this image locally;
# never push it.
#
# The lab folder (dist/tv-lab/webos, built with --lab-server http://host.docker.internal:8080)
# is mounted read-only at /app. The lab runs every spike at launch and posts its records to
# the mock on the host.
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      fonts-dejavu-core \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libgbm1 \
      libgtk-3-0 \
      libnss3 \
      libpango-1.0-0 \
      libx11-xcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxkbcommon0 \
      libxrandr2 \
      libxshmfence1 \
      libxss1 \
      libxtst6 \
      x11-apps \
      xvfb \
 && rm -rf /var/lib/apt/lists/*

COPY run-sim.sh /usr/local/bin/
ENTRYPOINT ["/bin/sh", "/usr/local/bin/run-sim.sh"]
