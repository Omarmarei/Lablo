# Zoma IPTV

A content-free IPTV player for Samsung Tizen and LG webOS TVs. Users bring their own M3U playlist or Xtream login; Zoma ships no channels and its servers never touch provider links. Arabic (RTL) and English from day one.

**Status:** pre-alpha. The workspace scaffold exists; the TV build, data engine, player and UI are being built step by step (see [RELAY.md](RELAY.md)).

## Layout

```
packages/  core, protocol, crypto, data, player, ui, platform-api, platform-{tizen,webos,browser}
apps/      tv, web, mock-provider        (added in later steps)
tools/     build, device, fixtures, sign-config   (added in later steps)
docs/      PLAN.md, architecture.md, adr/, research/
```

## Develop

Requires Node ≥ 22 and pnpm 11 (`corepack enable` or a global pnpm 11).

```bash
pnpm install
pnpm verify      # lint (incl. package boundaries) + typecheck + tests, same as CI
```

## Docs

- [docs/PLAN.md](docs/PLAN.md): the approved product plan
- [docs/architecture.md](docs/architecture.md): detailed design
- [docs/adr/](docs/adr/): architecture decisions
- [CLAUDE.md](CLAUDE.md): working rules, Chromium 53 cheat sheet, package boundaries, definition of done
