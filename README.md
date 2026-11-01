# Zoma IPTV

A content-free IPTV player for Samsung Tizen and LG webOS TVs. Users bring their own M3U playlist or Xtream login; Zoma ships no channels and its servers never touch provider links. Arabic (RTL) and English from day one.

**Status:** pre-alpha. The workspace scaffold, the TV build pipeline and a hello app exist; the data engine, player and UI are being built step by step (see [RELAY.md](RELAY.md)).

## Layout

```
packages/  core, protocol, crypto, data, player, ui, platform-api, platform-{tizen,webos,browser}
apps/      tv (hello app); web, mock-provider come later
tools/     build (pnpm build:tv), device (pnpm device), engines (pnpm verify:engines); fixtures, sign-config come later
platforms/ tizen/config.xml, webos/appinfo.json, icons
e2e/       Playwright smoke tests
docs/      PLAN.md, architecture.md, adr/, research/
```

## Develop

Requires Node ≥ 22 and pnpm 11 (`corepack enable` or a global pnpm 11).

```bash
pnpm install
pnpm exec playwright install chromium   # once, for pnpm e2e
pnpm dev         # desktop loop: the TV app in a browser, keyboard = remote
pnpm build:tv    # Tizen + webOS bundles, ES2016 syntax gate, budgets, .ipk
pnpm verify      # lint + typecheck + tests + build:tv + e2e, same as CI
pnpm verify:engines --self-test   # built apps in Chromium 53/56/68 (Docker); CI job "engines"
```

Packaging and device commands: [docs/runbooks/tv-build.md](docs/runbooks/tv-build.md).

## Docs

- [docs/PLAN.md](docs/PLAN.md): the approved product plan
- [docs/architecture.md](docs/architecture.md): detailed design
- [docs/adr/](docs/adr/): architecture decisions
- [CLAUDE.md](CLAUDE.md): working rules, Chromium 53 cheat sheet, package boundaries, definition of done
