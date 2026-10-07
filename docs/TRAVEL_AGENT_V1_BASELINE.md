# TRAVEL_AGENT_V1_BASELINE

> Snapshot of the v1-frontend-build base commit taken into the
> `feature/travel-agent-v1` worktree. Recorded before any backend
> integration or agent code is added. Every claim below was verified
> against the worktree, not from memory.

## Worktree

```text
PATH    : C:\Users\lin\Documents\Gorgon-Travel-Agent-V1
BRANCH  : feature/travel-agent-v1
BASE    : origin/feature/v1-frontend-build @ 5d412d9d876b8f98bab418aa4f37e3dd3f5b477e
WORKTREE: clean (no uncommitted changes)
CREATED : 2026-10-07 via git worktree add from /c/Users/lin/Documents/Gorgon-Recovered
```

## Frontend baseline — verified facts

```text
package.json        : app/package.json
name                : gorgon-app
type                : module
React               : ^18.3.1
ReactDOM            : ^18.3.1
Vite                : ^5.4.19 (devDep)
@vitejs/plugin-react: ^4.3.4 (devDep)
lucide-react        : ^0.544.0

scripts.dev         : vite
scripts.build       : vite build
scripts.preview     : vite preview
scripts.test        : node --test "tests/*.test.mjs"
scripts.test:build  : node tests/build-smoke.mjs
scripts.test:e2e    : node tests/e2e_v1_frontend.mjs
```

### PWA pieces (verified present)

```text
app/index.html                                → manifest / icons / theme-color / apple-touch
app/public/manifest.webmanifest               → standalone + 256/512 icons + maskable
app/public/sw.js                              → hand-written SW (install/activate/fetch)
app/public/icons/icon-256.png                 → present
app/public/icons/icon-512.png                 → present
app/src/main.jsx                              → registers SW under import.meta.env.PROD only
```

### Source layout

```text
app/src/screens/
  ActivityDetailScreen.jsx
  DiscoverScreen.jsx
  MapScreen.jsx
  MyWeekendScreen.jsx
  NaturalSearchScreen.jsx
  SearchScreen.jsx
app/src/components/
  AppShell.jsx
  DistrictPicker.jsx
  Icon.jsx
  atoms.jsx
  ds/ActivityCard.jsx
  ds/SearchField.jsx
app/src/lib/
  activity-view.js
  api.js              ← currently exposes searchActivities()
  categories.js
  data.js
  demo-reset.js
  district.js
  ds.js
  useResponsive.js
app/src/store/
  store.js            ← localStorage-based persistence
```

### Persistence keys (store.js)

```text
gorgon_my_weekend            → string[] of activity ids
gorgon_my_weekend_items       → { [id]: activityView }   ← full snapshot, survives reload
gorgon_favorites             → string[] of activity ids
gorgon_admin_review          → { [itemId]: "approve" | "return" | "reject" }
gorgon_demo_v1               → seed flag
gorgon_selected_district     → single district selection
```

### Test inventory

```text
tests/activity-view.test.mjs    → npm test
tests/build-smoke.mjs           → npm run test:build
tests/district.test.mjs         → npm test
tests/e2e_v1_frontend.mjs       → npm run test:e2e
tests/pwa_install_check.mjs     → needs npm run preview (live check)
tests/pwa_offline_check.mjs     → needs npm run preview (live check)
tests/store.test.mjs            → npm test
```

### Verified results (2026-10-07)

```text
npm install               → added 11 packages, audited 65 packages (37s)
npm test                  → 27 passed, 0 failed
npm run test:build        → vite build OK; build-smoke 18/18 PASS
npm run test:e2e          → 58/58 PASS
                          (desktop-1920, tablet-768, mobile-390 all green)
pwa_install_check         → NOT RUN in static mode (needs vite preview)
pwa_offline_check         → NOT RUN in static mode (needs vite preview)
```

## Backend baseline — confirmed absent on this branch

```text
pipeline/store/        → does NOT exist on feature/travel-agent-v1
pipeline/location/      → does NOT exist
pipeline/crawlers/      → does NOT exist
pipeline/agent/         → does NOT exist (target of §7)
pipeline/api/server.py  → exists (master version, 920 lines, /api/search only)
pipeline/search/        → exists (master version, /api/search service)
```

These modules live only on `origin/feature/human-review-loop`
(HEAD 648d8c0) and will be integrated per §4.

## AGENTS / ROADMAP / CURRENT_STATE

```text
AGENTS.md             → 5c46aa9 docs: add AGENTS.md, ROADMAP.md and CURRENT_STATE.md
docs/ROADMAP.md       → present
docs/CURRENT_STATE.md → present
docs/V1_FRONTEND_BUILD.md      → present
docs/V1_FRONTEND_KNOWN_ISSUES.md → present
```

## What §3 says we must NOT do

- Do not invent that PWA tests "ran" when they require a live preview server.
- Do not edit app/src/lib/api.js or app/src/screens/* yet — §18 gates this.
- Do not touch pipeline/api/server.py before §4 — keep master version intact.
