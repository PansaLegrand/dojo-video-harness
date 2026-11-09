# Share editor components with DojoClip

This repository reuses DojoClip’s **Next.js App Router, React 18, Tailwind 3**,
editor/chat components, and shared styles. It is an English-only local editor,
with a smaller scope than the hosted product. Full product parity is not a goal.
Keep useful shared components intact so updates remain straightforward.

## What is shared

The sync manifest manages the editor, timeline, inspector, media panels, preview,
chat, clarification and review cards, motion graphics controls, project home/cards,
the English dictionary, shared global CSS, Tailwind theme, and editor page.
It currently manages 110 files. It records both source hashes and generated target hashes.

Allowed transformations are explicit and mechanical:

- Rename the product’s older engine namespace, symbols, and paths to the public
  `dojo-video-engine` names.
- Replace the home/dashboard’s Clerk import with the local-user adapter.
- Add workspace content globs to the unchanged Tailwind theme/plugin configuration.
- Normalize the final newline.

No JSX markup, styling decisions, interaction handlers, or layout are rewritten by
sync. Run `npm run check:ui-sync` to verify these files. CI uses the committed
manifest; it does not need access to the private product repository.

## Sync when you choose

```sh
# Preview only. Does not write anything.
npm run sync:ui -- --source ../dojo-video-web

# Apply the reviewed changes.
npm run sync:ui -- --source ../dojo-video-web --apply

# Compare with the current product checkout without modifying files.
npm run sync:ui -- --source ../dojo-video-web --check

npm run check
npm run test:browser
```

The tool preflights the entire plan. If a managed local file differs from its last
recorded output, it refuses to overwrite it, including when upstream also changed.
New upstream UI files are included; removed files are removed only when unchanged
locally. Files outside the managed set are untouched. No source checkout files are
written. Review newly introduced imports and run the compiler before committing;
a new product dependency may require a corresponding core or host adapter update.

Do not run Prettier over managed files as part of a general formatting sweep. Their
source formatting is intentionally retained so synchronization remains reviewable.

## English-only scope

The host serves only `/en` UI routes. It does not copy the other eight product
language dictionaries or the Japanese UI font loader. The sync inventory enforces
this boundary, so a later sync will not restore them. The root document language
is English; the old `?lang=` query no longer changes it.

The `/en` route prefix, translation hook/type contracts, and dormant translations
inside shared components/CSS stay intact. Removing those branches from every
component would make syncing harder for little benefit. There is no separate
translation-maintenance requirement for the harness. Fonts used to render video
text, ASR language selection, and caption translation remain available: an English
interface does not limit the language of the media.

Accounts, billing, marketing/SEO pages, and hosted worker infrastructure are outside
the local app. Shared home components may contain optional product props; the host
only enables the features it implements. Sync shared UI when useful, not to match
every product feature or release.

See [named local host follow-ups](managed-ui-host-followups.md) for the optional
source-inspection, generated-media and output-request registries. Their shared UI
and pure contracts do not imply local service availability.

## Where local differences belong

| Boundary                  | Local implementation                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Project context           | `packages/ui/src/contexts/ProjectContext.tsx` exposes the product context contract using local API persistence        |
| User/session              | `packages/ui/src/host/local-user.tsx` represents the single local owner; no Clerk dependency                          |
| Usage copy                | `packages/ui/src/host/editor-copy.ts` describes BYOK usage without pretending that local credit billing exists        |
| Editor text hook          | `native-editor-copy.ts` wraps the synced `native-editor-copy.product.ts`                                              |
| Caption HTTP requests     | `editor-media.ts` wraps the synced core `media.product.ts`; `host/editor-http.ts` supplies stable local operation IDs |
| Continuation state        | `publicRun()` maps local reply availability into the product clarification contract                                   |
| Persistence/provider jobs | `apps/server/src/` remains independent of product billing and production workers                                      |
| Routing                   | The editor route is synced; local navigation, provider settings, and saved-output pages are host-owned                |

The agent loop and provider interfaces remain small standalone TypeScript modules.
Next.js owns application routing/rendering, not tool authority or project commits.

## Versions and verification

The harness stays on the product’s Next.js **15.5** line and matching React/Tailwind
major versions. It currently uses Next **15.5.28** for security fixes while the
reviewed product checkout uses **15.5.25**. A security patch difference is preferable
to reverting dependency fixes; a framework major/minor migration should be reviewed
explicitly rather than performed by a UI copy operation.

`npm run test:browser` exercises the production Next application with synthetic
LLM/ASR endpoints, actual storage, actual browser encoding, and FFmpeg decode.
The optional comparison below renders the current product editor with the same
local project/i18n adapters and compares its pixels against the Next application:

```sh
npm run build
node scripts/verify-product-ui.mjs --source ../dojo-video-web
```

That comparison uses an isolated Vite reference fixture only for testing the product
source; Vite is not the application host. Both sides use the same local project,
English dictionary, BYOK usage-copy adapters and local extension panels. It covers desktop light/dark and narrow
English layouts. This optional diagnostic helps spot accidental layout drift;
pixel-for-pixel product parity is not a release requirement. Provider/billing text and local navigation are intentional host
policy differences, not forks of product UI components.
