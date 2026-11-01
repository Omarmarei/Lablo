# Zoma mock provider: the test-signal server (Xtream/M3U/XMLTV/catch-up, fault injection, the
# LAN log collector) with its ffmpeg test channels baked in. For TV lab runs on any machine with
# Docker, and later the public test server for store testers (RELAY step 44, needs Omar).
#
# Build (from the repo root):  docker build -f apps/mock-provider/Dockerfile -t zoma-mock .
# Run:                         docker run --rm -p 8080:8080 zoma-mock
# Public server:               docker run -d -p 8080:8080 zoma-mock --no-lab-logs
# With the open movies:        docker run ... -v <repo>/.cache/media/open-movies:/app/.cache/media/open-movies zoma-mock
#                              (fetch them on the host first: pnpm mock:open-movies)
# Lab logs land in /app/artifacts/lab-logs (mount a volume there to keep them).

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

# pnpm from package.json "packageManager".
RUN corepack enable

WORKDIR /app
COPY . .
# Only the mock's own dependencies (fastify, yaml, tsx): no browsers, no build tooling.
RUN corepack install \
  && pnpm install --frozen-lockfile --prod --filter @zoma/app-mock-provider \
  && chown -R node:node /app

USER node
WORKDIR /app/apps/mock-provider
# The test channels and files, generated once at build time into /app/.cache/media.
RUN node --import tsx src/media-cli.ts generate

EXPOSE 8080
ENTRYPOINT ["node", "--import", "tsx", "src/main.ts"]
