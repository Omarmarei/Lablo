# Store documents (RELAY step 44)

The submission pack of PLAN.md §7, drafted from what the app does today. Store accounts, the domain, counsel's legal text, the real screenshots and the test server are Omar's (steps 34, 46, 47); these files are what goes into them.

| File | For | Status |
|---|---|---|
| `listing-en.md`, `listing-ar.md` | Name, descriptions, keywords, disclaimer, age-rating answers (both stores) | Draft. Arabic needs the native review (step 46) |
| `screenshots.md` | Shot list, rules, capture method | Method only; images are made at step 47 |
| `lg-submission.md` | LG UX scenario + self-checklist answers | Draft; re-map to LG's current checklist at step 47 |
| `samsung-submission.md` | UI Description outline (for the PPTX), package fields, self-checks | Draft; PPTX built at step 47 |
| `samsung-tester-notes.md` | Test info for both stores | Template; credentials filled from the live server |
| `test-server.md` | Public test server runbook | `[needs Omar]`, nothing done |

## Listing lines that depend on other steps
- **Accessibility paragraph** (Voice Guide, captions, larger text): true only after step 43 ships it. Cut or edit the paragraph in both languages if 43 slips.
- **Privacy/terms links:** need the domain (step 34) and counsel's text (`LEGAL_DRAFT` false). `pnpm build:tv --release` refuses until then.
- **Search tags, rating, categories:** re-check against each store's form when it is opened; store fields change.

## Rules that never change
No provider, broadcaster or league names; no real logos in any screenshot; no "free channels", "unlimited" or "codes"; no link to anyone's panel; the line "Lablo provides no content" stays in every listing. Real credentials never go in this repo.
