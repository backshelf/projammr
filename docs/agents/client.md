# Reference: Next.js client app (`apps/client`)

_Updated 2026-11-27._ Next.js 16.4, React 19.3, App Router, RSC-first. Read `node_modules/next/dist/docs/` before
writing Next.js code. Design language: `DESIGN.md`. Work tracking is Jira project PROJ
(`.claude/docs/jira.md`).

## Route tree (`src/app/`)

```
layout.tsx                        Root: `<body>` is the flex column that owns the shell height; four next/font/local
                                  loaders, metadata (title template "%s · Projammr",
                                  manifest, appleWebApp), viewport (viewportFit cover, theme colours), an explicit
                                  theme's class and the accent fallback on `<html>` and `THEME_SCRIPT` in `<head>`
                                  (Settings → The theme). SettingsProvider (`cachedEffectiveSettings()`, `userId` for
                                  a member, for every page) > BrandProvider (`cachedBrand()`) > AppThemeProvider
                                  (binds the `d` hotkey itself only for signed-out visitors — signed-in users get it
                                  from `commands/settings.ts`'s `toggle-theme`) > MotionProvider (`@workspace/ui/components/motion-provider`) > TooltipProvider >
                                  SettingsHapticsProvider > SettingsFormatProvider (`viewerFormat()`'s prefs and
                                  zone) + SettingsToaster + ZoneCookie. No app shell here. Reads
                                  the session, `viewerFormat()`, `cachedEffectiveSettings()` and `cachedBrand()`
                                  together and spreads the settings' `documentAttributes` onto `<html>` and its
                                  `documentProperties` onto `<html>`'s inline `style` (see Settings).
(app)/layout.tsx                  Signed-in shell. getCachedSession(); signed-out/guest → bare <main>{children}.
                                  Otherwise CopyTextProvider >
                                  PoliciesProvider (`cachedPolicies()`) > MusicPlayerProvider
                                  (`initial={playerInitial(policies)}`) > JobsProvider >
                                  CommandPaletteProvider > AppSidebarProvider (defaultOpen from the
                                  `sidebar_state` cookie; `--sidebar-width` from the shell policy's
                                  `sidebarWidthRem`) > CommandProvider (ShortcutsOverlay) [AppSidebar,
                                  MusicPlayer, Dock, <main h-dvh>,
                                  Suspense(CommandPaletteRecents, fallback CommandPaletteMount)].
(app)/page.tsx                    "/": shells only. `unavailable` session → "Can't reach Projammr" shell; signed
                                  out → SignInPrompt (CenteredPageShell + AuthWrapper, shared with
                                  `(app)/sign-in`). Otherwise reads the `currentProject` cookie and
                                  `cachedMyProjects()` + `cachedEffectiveSettings()` (no project) in parallel and
                                  redirects to `lib/landing.ts`'s `landingHref(...)` (Settings, below).
(app)/projects/page.tsx           "/projects": the list, moved out of `/` unchanged; `proxy.ts` gates it like
                                  `/notes`, so it has no session guard of its own. `cachedMyProjects()`: none
                                  → "No project open" empty state (NEW_PROJECT_HREF); otherwise PageHead "Projects"
                                  (ghost "Create a project" action) + HomeProjectList, a hairline row per project
                                  (cover, track count, relative last-activity date, falling back to `updatedAt`
                                  when `lastActivityAt` is null).
(app)/sign-in/page.tsx            Public; the OAuth provider's `loginPage`. SignInPrompt, unconditionally, unless the
                                  visitor is already a member with no OAuth query on the URL (`hasOAuthQuery`,
                                  `lib/oauth-query.ts` — the provider's `sig` param is what marks a request as
                                  mid-flow), in which case redirect to "/": `oauthProviderClient()` (B3) signs that
                                  query onto the sign-in request as `oauth_query`, and the provider resumes the
                                  authorization on its own once the session exists. A member with a `next` param
                                  goes to that path instead (`lib/next-path.ts`'s `nextPath`: only a path on this
                                  origin survives, an absolute URL, `//host`, a backslash or `javascript:` falls
                                  back to "/", and so does a path whose parsed form is `//…` or holds a backslash
                                  once dot segments collapse (`/..//host`); `signInUrlFor(path)` builds the link);
                                  `/device` is the user.
(app)/consent/page.tsx            Public; the OAuth provider's `consentPage`, arriving with `client_id`, `scope` and
                                  optionally `claims`. Signed out → redirect to `/sign-in` with the same query
                                  (`searchParamsToQueryString`); otherwise CenteredPageShell wrapping `ConsentForm`
                                  (`components/auth/`), which reads the client's name off `authClient.oauth2
                                  .publicClient` (falling back to `client_id`), lists one checkbox per requested scope
                                  (`read` fixed, everything else optional — `lib/consent-scopes.ts`'s
                                  `consentChoices`/`grantedScope`) and posts `authClient.oauth2.consent` on Allow/Deny,
                                  following the redirect URL it returns.
(app)/device/page.tsx             Where `dit login` sends the person (`?user_code=…`; the server's verification URI).
                                  Signed out or a share-page guest → `/sign-in?next=/device?user_code=…`
                                  (`signInUrlFor`), which returns here with the code intact; otherwise
                                  CenteredPageShell "Connect dit" wrapping `DeviceApproval` (`components/auth/`).
                                  `DeviceApproval` looks the code up on arrival through the shared client's
                                  `authClient.device(...)` (the server claims it for the caller there), or asks for
                                  it when the link carries none; then Approve / Deny through `device.approve` /
                                  `device.deny`. States: checking, review (the code and a "check it matches your
                                  terminal" line; no machine name, the code row carries none), approved ("dit is
                                  signed in. You can close this tab."), denied, and the invalid / expired /
                                  other-account / rate-limited errors back on the code field. A code already approved
                                  or denied lands straight in that state. An approve or deny refused as expired,
                                  invalid or other-account looks the code up again and shows what that answers (a
                                  code decided in another tab lands in approved / denied; an expired, unknown or
                                  other-account code returns to the code field with the lookup's copy), while any
                                  other failure keeps the review view with the buttons live, showing the server's
                                  `error_description`, else its `message`, else "Something went wrong (<status>).
                                  Try again." (a rate limit says to wait); "Could not
                                  reach the server" is for a thrown network error only. One mount looks a code up
                                  once (a ref keyed by the code, so StrictMode spends one token). "Checking the
                                  code…" is a `role="status"`; the code is `aria-hidden` beside an `sr-only` spelled-out
                                  copy. The shared client's `oauth_query` hook
                                  sends nothing here: it signs only a query carrying a `sig`, which `/device` has
                                  not.
(app)/forgot-password/page.tsx    Public, email mode only: getInstance() → redirect "/sign-in" if `!emailEnabled`
                                  (`disabledPaths` 404s the API route regardless — this is the client's own
                                  belt). CenteredPageShell + ForgotPasswordForm (authClient.requestPasswordReset,
                                  generic post-send confirmation, no enumeration).
(app)/reset-password/page.tsx     Public, both modes: `searchParams.token` → ResetPasswordForm (invalid-link
                                  state when absent; authClient.resetPassword on submit; success state links to
                                  "/sign-in"). Reached from a reset link's `redirectTo`, including one an
                                  instance admin hands out from the settings hub's Instance → Users pane.
(app)/admin/[[...tab]]/page.tsx   Redirects only: `/admin` → `/settings/instance`, `/admin/registration` →
                                  `/settings/instance/instance-access`, any other `/admin/<tab>` → the Instance
                                  pane of that id; deeper is a 404. The hub's Instance page is the admin gate.
(app)/not-found.tsx               `notFound()` and any unmatched route under the shell: CenteredPageShell "Not
                                  found" + a link back to "/".
(app)/error.tsx                   Client component (error boundaries must be); CenteredPageShell + "Try again"
                                  (calls the `retry` prop — the Next 16.3 replacement for `reset` that re-fetches
                                  the segment) and a link back to "/".
(app)/profile/page.tsx            getCachedSession + cachedMe → ProfilePage; TopStrip back.
(app)/settings/page.tsx           The settings hub (see Settings → The hub): redirects to `/settings/personal`.
(app)/settings/personal/[[...group]]/page.tsx, instance/[[...group]]/page.tsx, project/[[...rest]]/page.tsx,
devices/page.tsx                  One `HubPage` each; Instance is `notFound()` for anyone `cachedIsInstanceAdmin()`
                                  (the `instanceRole` on the request's `GET /me` read, never a client-side guess)
                                  says is not an admin, so whether an instance has an admin surface at all is not a
                                  non-admin's business; bare `/settings/project` redirects to the current
                                  project's. `loading.tsx` beside them is the hub's skeleton. Reached from the
                                  sidebar's Settings item, the account menu, the phone account sheet, `g ,` and the
                                  palette on every signed-in page. TopStrip back.
(app)/invite/[token]/page.tsx     Public; session + getInvitePreview + cachedInstance (the password rule) → InviteFlow; a 401 preview (guest access off) → SignInPrompt.
(app)/notes/layout.tsx            Redirects signed-out to "/"; cachedMyNotes →
                                  LyricsProvider > NotebookShell(list=<NoteList/>); TopStrip.
(app)/notes/page.tsx              "Select a note" placeholder (desktop right pane).
(app)/notes/new/page.tsx          Blank NotebookNote (static segment so `/notes/new` never hits `[id]` as NaN).
(app)/notes/[id]/page.tsx         cachedNote(id) → notFound() on error → NotebookNote.
(app)/project/new/page.tsx        Renders modules/project/new directly; TopStrip back.
(app)/project/[projectId]/error.tsx
                                  Client component; RouteError reads useCurrentRoute() for errorCopy(route) and
                                  renders CenteredPageShell inShell inside the layout below, so TopStrip and the
                                  role provider stay mounted.
(app)/project/[projectId]/layout.tsx
                                  parseId(projectId) → notFound() on a non-canonical id → loaded() → cachedEffectiveSettings(project.id)
                                  (after `loaded`, so a non-member 404s before the read; read together with
                                  `cachedPolicies(project.id)` and `viewerFormat(project.id)`) → ProjectProvider {id,name,role} >
                                  SettingsProvider projectId (nested; see Settings) > PoliciesProvider >
                                  SettingsFormatProvider (both rebuild from the nested store, so a project's format and
                                  playback conventions reach everything under the project);
                                  JobsRole (hands the role up to JobsProvider); TopStrip project; wraps children in `flex h-full min-h-0 flex-col`.
(app)/project/[projectId]/not-found.tsx
                                  RouteNotFound reads useCurrentRoute() for notFoundCopy(route) and renders
                                  CenteredPageShell inShell inside the layout below, the same way; a `notFound()`
                                  thrown by the layout itself is above this file and still reaches `(app)/not-found.tsx`.
(app)/project/[projectId]/page.tsx
                                  projectRoutes.project.Page({route:{kind:"project"}, searchParams}) — forwards
                                  searchParams, so `?view=board` works on the project root. The page is the today
                                  page: `TodayReadout` in the masthead, then the NEW, GONE QUIET, JOBS and ACTIVITY
                                  blocks (`components/project-home/`) ahead of DESCRIPTION.
(app)/project/[projectId]/[...route]/page.tsx
                                  CUSTOM ROUTER: parseRoute(segments) → routeModuleFor(kind) → entry.Page({route,
                                  searchParams}); no module → notFound(). generateMetadata: title ?? loadTitle(route).
offline/page.tsx                  Outside `(app)`, so no session dependency: CenteredPageShell "You're offline" +
                                  a ghost "Try again" that reloads. `public/sw.js` precaches it on install and
                                  serves it for any navigation that cannot reach the network.
media/[...path]/route.ts          GET/HEAD proxy to `${serverApiBaseUrl()}/static/<path>` forwarding cookie,
                                  Range, If-None-Match and If-Modified-Since (so the API's 304 path fires),
                                  `?download` passthrough. Every uploaded-file URL goes through mediaProxyUrl()/
                                  imageUrl()/assetUrl()/mediaDownloadUrl() in lib/utils.ts; a `/share/` path
                                  passes through untouched, since a share's own routes authenticate a guest.
share/[token]/layout.tsx          Public, outside (app): MusicPlayerProvider only (`DEFAULT_PLAYER_INITIAL`, `perProjectTarget={false}`; no
                                  PoliciesProvider, so every policy hook reads its defaults), no shell.
share/[token]/page.tsx            getSharelink + session → ShareRoomProvider around the share parts (or a dead-link shell by status/code; a 401 — the instance keeps share links to accounts — renders SignInPrompt).
                                  generateMetadata: lib/request-origin.ts requestOrigin(headers) (host + requestProtocol), then lib/share-metadata.ts —
                                  shareMetadata (facts description, OG/Twitter, noindex, no `images`), posterCover, and
                                  SHARE_UNAVAILABLE_METADATA (title + noindex) for a dead link. The page, its metadata
                                  and the poster's generateImageMetadata read the share through lib/share-read.ts's one
                                  `cache()`d `loadSharelink`, so a page view reads it once.
share/[token]/opengraph-image.tsx The unfurl poster, `/share/<token>/opengraph-image/poster` (`generateImageMetadata`: one
                                  1200×630 image whose alt is the title, none for a share that cannot be read). Satori
                                  `ImageResponse`: the first playable's cover fetched from the API as JPEG
                                  (`format=jpeg`, forwarding `x-forwarded-for`), blurred as the field, plus a square
                                  cover, the title (two lines), shareFacts and logoMark(); dark paper with no cover.
                                  `Cache-Control: private, max-age=3600`, as the cover route (a turned-off link's
                                  title and art must not stay in a shared cache); 404 for a dead token. `dynamic =
                                  "force-dynamic"`: `generateImageMetadata` gets a Next-generated
                                  `generateStaticParams`, which would make the route ISR, render a live token's first
                                  request with no share to read, and cache the 404. Fonts are the TTFs
                                  (`public/fonts/{Redaction35,DepartureMono-Regular,SplineSansMono}.ttf`, decompressed
                                  from the woff2 beside them; Satori refuses woff2), read once at module scope.
share/[token]/loading.tsx         Skeleton streamed while the share is read.
share/[token]/error.tsx           "Can't reach Projammr" boundary for a read that is not a dead link.
share/[token]/stream/route.ts     Same-origin proxies to /api/share/{token}/stream and /cover/{id} via
share/[token]/cover/[id]/route.ts lib/share-proxy.ts proxyShareMedia — forwards Range, X-Forwarded-For and the session cookie (a member's pass while guest access is off), nothing else.
manifest.ts, icon.tsx, apple-icon.tsx, icon-ids.ts, logo-image.tsx
                                  PWA manifest + icons (`/icon/default`, `/icon/maskable` at 512px, `/icon/small`
                                  at 192px, 180px apple icon) drawn with logoImage() (its mark is logoMark(size, fill),
                                  also the poster's) from @workspace/ui/lib/logo-paths; `ICONS` in icon-ids.ts (id, size, purpose) feeds
                                  both the manifest and the icon route. Shortcuts: Projects (`/`) and Notes
                                  (`/notes`), each with the 192px icon. The splash is the brand's background
                                  colour, and an uploaded icon or logo is drawn on it; the generated mark sits on
                                  PAPER_DARK (the colour's default); `appleWebApp.statusBarStyle` is `default` (gotcha 22).
public/sw.js                      The service worker (not a route): cache-first `/_next/static/**`,
                                  stale-while-revalidate icons and the manifest (they follow the brand; one entry
                                  per route in `pj-shell-v1`) and `/media/images/**` in `pj-images-v1` capped at
                                  200 entries, network-first navigations falling back to `/offline`, and no
                                  `respondWith` for anything else. No `skipWaiting()`.
```

No `loading.tsx`, except `share/[token]/loading.tsx` (the share page's skeleton) and `(app)/settings/loading.tsx`
(the hub's); Suspense is manual. `(app)/error.tsx` and `(app)/not-found.tsx` catch everything outside a
project's own tree. `project/[projectId]/error.tsx` and `project/[projectId]/not-found.tsx` are the pair for
everywhere under a project: Next renders a segment's own `error.js`/`not-found.js` inside that segment's
layout, so these two keep `TopStrip`, `ProjectProvider` and `JobsRole` mounted while a module page's
`notFound()` or thrown error replaces only the page area below them (the layout's own `notFound()`, for a
project that fails to load, sits above both files and still renders `(app)/not-found.tsx`). Both are
`RouteNotFound`/`RouteError` (`components/project/RouteState.tsx`), reading the URL through
`useCurrentRoute()` since `not-found.tsx` takes no props and `error.tsx` gets only `error`/`retry`, and
wording their copy from `lib/route-copy.ts`'s `notFoundCopy`/`errorCopy` — per the route's own entity kind
and whether it shows one row or a list, from `routeDeclaration` and the entity registry's `nouns`/`listRoute`.
The root view-transition is opted out
(`packages/ui/src/styles/globals.css`), so the only navigation morph is the running-order step between adjacent
tracks (`ArtMorph`, `name="masthead-art"`); a `loading.tsx` on the catch-all would break it.
`src/proxy.ts` (Next 16's middleware file)
exports `proxy`, matcher `["/project/:path*", "/projects", "/notes/:path*", "/profile/:path*", "/admin/:path*",
"/settings/:path*", "/api/:path*", "/.well-known/:path*"]`. Two unrelated jobs share the file because both need
to run this early: on `/project`, `/projects`, `/notes`, `/profile`, `/admin` and `/settings` it is the session gate — `isSignedOut(session)`
(true for `signed-out` and `guest`) → redirect "/"; an `unavailable` session is let through for the route
to reject. The Instance section's admin-or-404 check lives in its own page (`/admin` only redirects there), not
here — this gate only rules out a caller who is not signed in at all. `/forgot-password` and `/reset-password` are
deliberately absent from the matcher: they have to stay reachable while signed out. On `/api` and
`/.well-known` (`/api`, `/.well-known` and anything under them, the `API_PATH` pattern) it is instead the
forward to the API, `forwardToApi`: `NextResponse.rewrite` to `${serverApiBaseUrl}${pathname}${search}`, so every
browser→API request is same-origin and the HttpOnly session cookie rides along, and the RFC 9728/8414 discovery
documents Better Auth serves on the API are reachable at the origin the MCP resource identifier names. The target
is `INTERNAL_API_URL`, read when the server starts; a `next.config.ts` `rewrites()` entry cannot do this job,
because `output: "standalone"` serialises the config at build time and would fix the target in the image. Next
makes the forward with its own proxy (`proxyRequest`, the same one config rewrites use), which adds no
`X-Forwarded-For` hop, and `forwardToApi` passes the caller's chain on **unchanged** through
`{ request: { headers } }`. It deliberately adds no hop of its own: Caddy and the Tailscale node proxy `/api/*`
and `/media/*` straight to `api:8080`, so a request that came through this service has to read at the same
position as one that did not, and the server's `TRUSTED_PROXY_HOPS = 1` counts the front proxy alone. A hop
added here would move the real caller on some paths and not others, and `clientAddress` would fall back to the
socket — collapsing every unauthenticated caller into a single rate-limit bucket. The explicit re-set pins the
pass-through here rather than depending on that internal. Because proxy runs for `/api/*`, Next buffers every
request body on it, uploads included (`proxyClientMaxBodySize` below). This branch runs before the session gate
and skips it entirely — an API or discovery request needs no redirect, and the API authorizes itself.
`proxy.test.ts` checks the forward's target, query and matcher coverage with `next/experimental/testing/server`.

`next.config.ts`: `output: "standalone"`, `outputFileTracingRoot` = repo root, `transpilePackages:
["@workspace/ui"]`, `images.unoptimized: true` (the optimizer has no session cookie for `/media`),
`allowedDevOrigins` from `FALLBACK_API_URL`, `experimental.proxyClientMaxBodySize` = `MAX_UPLOAD_CEILING_MB` from
`@workspace/settings/bounds` (the body buffer for every upload through `proxy.ts`'s forward; a fixed ceiling, not a
build argument: the instance's upload limit is a server setting; the module imports nothing, since Next loads a
config's imports with plain `require`, which cannot follow the settings package's `.js` specifiers),
`experimental.useOffline` (holds and retries framework requests over a dead network, and gives `useOffline` from
`next/offline` its value), a `headers()` rule sending `securityHeaders({ scriptHashes })` from
`@workspace/security-headers` (the set the API's `securityHeaders` middleware sends, with `script-src` allowing
`THEME_SCRIPT` by the sha256 the config computes from it at load; `next.config.test.ts` checks it) on `/:path*` in
every build but `next dev` (React's dev build evals,
which the report-only CSP would report on every load), and rules sending `/sw.js` and `/dsp-processor.js` with
`no-cache, no-store, must-revalidate` and the JS content type. It has no `rewrites()`: the forward to the API is
`proxy.ts`'s. Nothing about where the app is served is inlined at build time, so one build serves any hostname: the browser calls only its own origin, the API's address is
`INTERNAL_API_URL` at start-up, and the public origin and scheme come from each request (`lib/request-origin.ts`).

## The custom sub-router

`src/lib/route-parser.ts` `parseRoute(segments): ParsedRoute`, kinds:
`project | track | track-new | track-all | track-archived | collection | collection-new | collection-all | session |
session-new | session-all | session-history | plugins | samples | repo | not-found`. URL shapes under `/project/:projectId`:
`/collection/:id|new|all`, `/collection/:cid/track/:tid`, `/track/:tid|new|all|archived`,
`/collection/:cid/track/:tid/session/:sid[/history]`, `/session/:sid|new|all`, `/plugins`, `/samples`, `/repo/:repoId`. A project's
settings are the settings hub's (`/settings/project/:id`): the `[...route]` page redirects `settings[/<pane>]` there
before it parses anything (`page.test.ts` beside it), so no route kind covers them. Reverse: `routeSegments(route)` (round-tripped in
`route-parser.test.ts`), wrapped by `hrefFromParsedRoute(route, projectId)` in `lib/utils.ts`. Both `parseRoute` and `routeSegments` are total and
derived: they hold no URL shape of their own, only a lookup over the `{match, build}` declarations in
`entities/routes.ts`'s `ROUTES` — `parseRoute` returns the first declaration whose `match` accepts the segments,
else `{kind: "not-found"}`; `routeSegments` looks the route's own kind up and calls its `build`. A malformed URL
(wrong parent order, a parent named `all`, `settings` under an entity, a non-canonical id) is `not-found`; nothing
redirects. `useCurrentRoute` (`hooks/use-current-route.ts`) reads `useParams<{projectId?, route?}>()` from
`next/navigation` — not the pathname with its own regex — and returns `null` when `projectId` is missing or not
canonical. Routes outside a project are constants in `lib/utils.ts`:
`NEW_PROJECT_HREF`, `NOTES_HREF`, `NEW_NOTE_HREF`, `noteHref(id)`; `isNotesPath(pathname)` requires a segment
(`startsWith(NOTES_HREF)` matches `/notesomething`). The settings hub's URLs come from `lib/settings/href.ts`:
`settingsHref(…)`, `SETTINGS_HREF` (where every Settings entry point opens it), `isSettingsPath(pathname)` and
`settingsProjectId(pathname)`. **No component writes a `/project/…`, `/notes/…` or `/settings/…` string by hand.**

`src/lib/route-pattern.ts` holds the total pattern language a route kind's declaration is built from:
`RoutePart` (`{ literal, param?, optional? }`), `matchParts`/`buildParts` (walk a part list against a whole
segment list — every part matches or the part list rejects the input entirely, never a prefix), `parseId`
(a canonical positive integer only: no sign, no leading zero, no exponent, no magnitude past
`Number.isSafeInteger`), `pattern(parts)` (a `{match, build}` pair typed to one `RouteKind`), and
`declareRoute<K>` (binds a declaration to that kind — `K` inferred from its `kind` literal — then widens it
to `RouteDeclaration`, the way `routeModule<K>` widens to `RouteModule`). Each entity owns its kinds'
declarations in its own `routes.ts`, exporting `readonly RouteDeclaration[]`; a new URL shape is added by
declaring it there, not by editing a shared matcher:

| File                            | kind              | parts                                                                    | entity / shows    |
| ------------------------------- | ----------------- | ------------------------------------------------------------------------ | ----------------- |
| `entities/project/routes.ts`    | `project`         | none (the empty segment list)                                            | project / row     |
|                                 | `plugins`         | `plugins`                                                                | —                 |
|                                 | `samples`         | `samples`                                                                | —                 |
|                                 | `repo`            | `repo/:repoId` (`RouteParam` `repoId`)                                   | —                 |
| `entities/collection/routes.ts` | `collection`      | `collection/:collectionId`                                               | collection / row  |
|                                 | `collection-new`  | `collection/new`                                                         | collection / row  |
|                                 | `collection-all`  | `collection/all`                                                         | collection / list |
| `entities/track/routes.ts`      | `track`           | `[collection/:collectionId/]track/:trackId`                              | track / row       |
|                                 | `track-new`       | `[collection/:collectionId/]track/new`                                   | track / row       |
|                                 | `track-all`       | `track/all`                                                              | track / list      |
|                                 | `track-archived`  | `track/archived`                                                         | track / list      |
| `entities/session/routes.ts`    | `session`         | `[collection/:collectionId/][track/:trackId/]session/:sessionId`         | session / row     |
|                                 | `session-new`     | `[collection/:collectionId/][track/:trackId/]session/new`                | session / row     |
|                                 | `session-all`     | `session/all`                                                            | session / list    |
|                                 | `session-history` | `[collection/:collectionId/][track/:trackId/]session/:sessionId/history` | session / row     |

`entity`/`shows` word a route's not-found and error copy for the entity it names; a page that names no
entity (plugins, samples, repo, settings) omits both. A repo is not an `EntityKind` and never becomes one. `entities/routes.ts` concatenates the four arrays into `ROUTES` and
exposes `routeDeclaration(kind)`, the lookup `route-parser.ts` builds `parseRoute`/`routeSegments` from.

Modules are async server components in `src/modules/{project,collection,track,session,settings}/`: `page.tsx`
(detail), `new.tsx`, plus `project/plugins.tsx`, `project/samples.tsx`, `project/repo.tsx` and `session/history.tsx`; the "All …" list pages are
`modules/entity-list`, not a per-module file. Each folder's `index.tsx`
exports route entries (`title` | `loadTitle`, `Page`) built with `routeModule<K>()` from `modules/route-module.ts`;
`modules/routes.ts` merges them into `routeModuleFor(kind)`. The registry is server-only (it imports the pages);
the href half stays in `route-parser.ts` for client components. `Page` adapters own search-param mapping
(`parseTableQuery` on list pages, `?title=` → `NewTrack`, `?name=` → `NewSession`, `?view=board`,
`?from=&to=` on history, `?origin=`/`?stock=1`/`?device=` on plugins, `?show=`/`?library=1`/`?stock=1`/`?sample=` on
samples). Notes pages are plain file routes, not modules.

## Entity registry (`src/entities/`)

One module per `EntityKind` (`project | collection | track | session`) says what its kind is, in
`src/entities/<kind>/index.ts`: its nouns (`{ singular, plural }`), whether rows carry a `statusId`
(`hasStatus`), how a row is labelled (`labelOf`), the route to a row's own page (`pageRoute(id, parents)`,
where `parents` is whichever of `collectionId`/`trackId` the row was reached through), the route that lists
every row of the kind (`listRoute`, null for project), the route of its create page (`newRoute`, null for
project), and the drop-zone prompt for uploads attached to a row of that kind (`dropPrompt`).
`src/entities/index.ts` collects them into `ENTITIES`, typed
`satisfies { [K in EntityKind]: EntityModule<K> }` so a missing kind is a compile error, plus
`entityModule(kind)` and `isEntityKind(value)`. Types live in `src/entities/types.ts`.

Each of the four modules ends `} satisfies EntityModule<K>;` and **never** carries a
`: EntityModule<K>` annotation. The annotation widens every literal in the object — `hasStatus`, `kind`,
`listRoute.kind` — to its base type before `ENTITIES` ever sees it, which breaks any type derived from
those literals downstream. `satisfies` checks the shape and keeps the literals.

Nothing under `src/entities/` may import `@/modules/*`, `@/lib/server-data`, `@/lib/server-api`, or
anything marked `server-only` — every module must stay importable from a client component. The registry
holds no API calls or route declarations of its own: per-kind API calls and `<kind>/routes.ts` are sibling
records keyed by the same `EntityKind`, gathered in their own files, and neither they nor `index.ts` import
each other. That is what keeps a module's file small enough to be written once and never revisited.

`src/entities/api.ts` holds the generic entity calls (`patch`, `remove`, and, for the table kinds —
everything but `project` — `create`, `bulkPatch`, `bulkRemove`, `bulkSetLabels`, `bulkMove`, `move`,
`setLabels`) as one typed record,
`ENTITY_API`, keyed the same way as `ENTITIES` and `satisfies`-checked against `EntityKind` so
`ENTITY_API.project` is an `EntityApi` and the table kinds are `TableEntityApi`s. Each call takes the
`ApiClient` (from `@workspace/api/lib/authed-client`) as its first argument rather than importing
`serverApi` or `browserApi` itself, so one definition in `src/entities/<kind>/api.ts` serves both the
server action layer and browser mutations; callers pass whichever client is theirs. A kind's `api.ts` also
carries any calls that are its own and not part of the shared shape — `track/api.ts`'s `addRelation` /
`removeRelation`, `collection/api.ts`'s `linkTracks`, `project/api.ts`'s `createSavedView` /
`deleteSavedView`.

The same file owns `BulkSelection`, the type every bulk call takes: either `{ ids: number[] }`, an explicit
list of rows, or `{ all: true }` spread with the active filter params, which is what the table sends once the
user picks "select all N" past a single page — the client cannot enumerate ids it was never sent, so the
server rebuilds the same `where` clause the list query used. `selectedIdsOf(selection)` is the reader: the
ids when the selection names them, `undefined` when it stands for every row matching the filter.

Consumers read the registry instead of naming a kind's four literals by hand: `components/uploads/drop-prompt.ts`'s
`dropPromptFor` indexes `ENTITIES[attachTo].dropPrompt` (`ENTITIES.project.dropPrompt` when `attachTo` is
undefined); `components/command-palette/CommandPalette.tsx`'s `kindLabel` capitalises `entityModule(kind).nouns
.singular` for a search result that is neither a comment nor an asset (those two keep their own labels, since a
comment and an asset are not entity kinds); `components/command-palette/action-context.ts`'s `resultHref` reads
`ENTITIES[result.type].pageRoute(result.id, {})` for the same three kinds, and sends an asset to the project's
Assets pane in the settings hub; `lib/utils.ts`'s `createBreadcrumbs` walks `["collection", "track", "session"]`, calling
`entityModule(kind).labelOf` and `.pageRoute` for whichever of the three rows it was given, and building up
`RouteParents` as it goes. `entityModule(kind)` is the accessor a union-typed kind must go through — it reads a
`REGISTRY` binding typed `{ [K in EntityKind]: EntityModule<K> }`, so the lookup keeps the type `K` invited in
without a cast; indexing `ENTITIES[kind]` directly with a union of kinds only works for a field whose type does
not vary per kind (`dropPrompt`, `pageRoute`'s parameters), never for `labelOf`, whose parameter type is
per-kind.

### Table definitions

A table kind (`track | session | collection`, `TableEntityKind`) also has a client-only table definition,
`EntityTableDefinition<K>`: its `identityField`, `href`, `toPeekRow`, `pageQuery` (the kind's own `pageQueryOf`,
`entities/<kind>/api.ts` — the paginated route's query for a view and an optional scope, dropped of `page`) and
`useParts`, the hook that returns the per-kind half of the `DataTable` root's props (`EntityTableParts`) from an
`EntityTableContext<K>` (project, edit rights, statuses, labels, the project's priority scale as
`priorityLevels`, the kind's `EntityTableScope[K]` and the page of rows). The types live in
`src/entities/table-types.ts`. A kind's columns
are `src/entities/<kind>/columns.tsx` and its definition `src/entities/<kind>/table.tsx`; the definitions are
gathered in `ENTITY_TABLES` in `src/entities/tables.ts` (`"use client"`), a record typed total over
`TableEntityKind` so a new table kind does not compile until it has a definition, and read through
`entityTable(kind)`, which returns the definition typed for `kind`. Nothing
server-safe imports any of it: `<kind>/index.ts` and `src/entities/index.ts` never import `columns.tsx`,
`table.tsx`, `table-types.ts` or `tables.ts`.

`assembleEntityTableProps` (`components/tables/entity-table-props.ts`) spreads a kind's parts whole into the
root props (`...fromParts`), so a `DataTableProps` member added to the `EntityTableParts` pick reaches the table
with no assembly change; `DataTable` then withholds every write prop from a viewer (`canEdit`) before it goes on
the config context. Row operations are one optional handler each on `RowActionsConfig`
(`components/tables/RowActions.tsx`), and `ActionItems` is the one renderer the row menu, the context menu, the
pinned action bar and the phone action sheet share; the bulk bar (`BulkActionsBar`, fed by `parts/Selection.tsx`)
takes its own handler props. A kind declares its own operations as `actions` in its parts
(`TableAction<TData>`, `components/tables/generic-table-types.ts`: `id`, `label`, optional `icon`, `offered(row)`
and `run(selection)`, which resolves to a `TableActionResult`); `DataTable` withholds `actions` from a viewer and
carries them on the config context, and `toastActionResult(result, undoWindowMs)` (`lib/action-toast.ts`) is
the one helper that toasts a result, with an Undo button when the result has an `undo` — that toast stays up
for the feedback policy's `undoWindowMs`, so the Undo is on offer that long — whose own result goes through the
same function. A toast offering Undo is also an entry in the module's undo stack for exactly as long as it is up
(dropped on dismiss, timeout or its Undo running): `undoLast()` closes the newest live one and runs what its button
runs, `hasUndo()`/`subscribeUndo()` are the getter and subscription `commands/history.ts`'s `u` and the registry
read. Declared actions render in every row surface through `RowActionsConfig.actions` (after the open
actions, Set status, Add to collection, Rename and Copy link, and before Move and Delete, which stay hardcoded)
and in the bulk bar as outline buttons just before "Move to project…", disabled while any bar action runs.
`components/tables/table-actions.ts` holds the two rules both sides share: `offeredActions` offers an action
when at least one of the target's loaded rows passes `offered` (for an all-matching bulk selection, any loaded
row), and `runTableAction(action, selection, noun, undoWindowMs)` runs it on the whole target (`{ ids }` from a
row menu, `bulkSelection` from the bar), toasts the result, and toasts "Could not {label, lower-cased} {noun}"
when `run` throws. A multi-row success
clears the selection. A list page's config (`ENTITY_LISTS`, `modules/entity-list/lists.ts`) is keyed by
kind alone, one page per kind.

The archive commands are `archiveTracks` and `unarchiveTracks` (`entities/track/archive.ts`), each
`({ projectId, selection, title?, router }) => Promise<TableActionResult>`; every surface (table action, track
page, palette) calls them and hands the result to `toastActionResult`. `router` is a `MutationRouter`
(`lib/mutation.ts`, what `applyMutation` needs): the request runs as a `defineMutation` invalidating `"route"`,
and the result's `undo` reuses it. The request is `requestTracksArchived` (`entities/track/api.ts`), which
answers only the tracks that changed (`{ ids, sessionCount }`); `undo` calls the opposite command with exactly
those ids, and a result where nothing changed ("No tracks to archive" / "No tracks to unarchive") has no `undo`.
`title` names the track only when exactly one changed. `ArchivedFlag` (`components/track/ArchivedFlag.tsx`) is
the one "Archived" `StatusChip` flag, in `ExplicitMark`'s colour.

The track table declares Archive (offered on a live row) and Unarchive (on an archived one) as `actions` through
`trackTableActions(projectId, rows, router)` (`entities/track/table.tsx`), which `useParts` memoises with
`useRouter()`; a one-id run passes that row's title. Its archived scope is `EntityTableScope["track"].archived`,
resolved by `archivedScopeOf` (`entities/track/api.ts`) for both `pageQueryOf` and the board's `fetchPage`: the
scope's value, else `"include"` when the table is scoped to a collection (archived tracks keep their place there,
flagged; the collection page's first-page fetch sends the same), else absent, which the route reads as live only.

The track and session tables end their data columns with "Last save" (`lastSaveAt`) and "Saves" (`saveCount`),
both server sort keys, so the column id is the key sent. They come from two factories in
`components/tables/columns.tsx`: `relativeDateColumn` (`format.relative` through `<Formatted>`, the absolute
`format.dateTime` as the `<time>` title, "—" when null) and `countColumn` (right-aligned tabular figures, 0 when
the row has none). `textColumn`'s optional `display(row, format)` writes a raw figure (a key from its
`keyTonic`/`keyScale`, a tempo, a loudness) in the viewer's formats while `value` stays what the column sorts and
copies. The
track title cell carries `ArchivedFlag` when `archivedAt` is set, and the session page's byline when `archived` is.
`relativeDateColumn`'s cell reads `tables.dateColumns` (`useSetting`) and renders `dateTimeColumn`'s absolute
form, same formatter, when it is `"absolute"`; a column already built with `dateTimeColumn` is unaffected. Sorting
stays on the underlying value either way.
`titleColumn`'s `TitleCell` reads `tables.thumbnails` (`useSetting`) and drops the `TrackCell` image wrapper
when it is off, even where the column config passes an `image`; the link and title are unchanged.

## Field kinds (`src/fields/`)

One module per `FieldKindName` (`text | number | date | select | status | checkbox | priority | list |
suggest | url`, the `EditableCellConfig["type"]` strings) says how a cell's value is parsed, formatted and entered,
in `src/fields/<kind>.tsx`. `src/fields/index.ts` collects them into `FIELD_KINDS`, typed
`satisfies Record<FieldKindName, FieldKind>`, so a `FieldKindName` with no module fails the typecheck, plus
`fieldKind(name)`, which is total over `FieldKindName` and still throws on any other string, the guard for
the `Partial`-shaped lookup behind it. **A kind is one file and one registry line** (an import and a record
entry); nothing else names it. Each kind ends `} satisfies FieldKind;` and carries no `: FieldKind`
annotation, so its literals (`entry`) survive. **The registry is client-only and carries no `"use client"`
directive.** A kind's `Editor` and `DraftInput` are built by factories called at module scope, which a
`"use client"` boundary would forbid, so `src/fields/index.ts` must only ever be imported from a client
component; every consumer (the cell editor, the draft row, paste, peek and card field lists) already is.
`types.ts`, `scalar.ts` and `custom-field.ts` hold no components and are safe anywhere. A module a server
component reads from must not import the registry either: that is why the custom field columns live in
`tables/custom-field-columns.tsx` rather than `tables/columns.tsx` (whose `TABLE_THUMB_WIDTH` a server component
imports), and why the activity feed words a custom value in the client `CustomFieldChange`.

The contract is `FieldKind` in `src/fields/types.ts`:

- `parse(raw, config)` is strict: it returns `{ ok: true, value }` or `{ ok: false, error }`, and a raw string
  that is not valid for the kind is the error, never coerced and never kept as text. Blank is `null`, or the
  error "Required" when `config.required`. `format(value, config)` is the text a value shows and edits as;
  `null` formats to `""`.
- `entry` says how a cell is entered: `editor` mounts the kind's `Editor`, `self` means the cell owns its own
  popup, `toggle` means a commit flips the value. `tables/cell-interaction.ts` reads it to decide what a
  gesture on a grid cell does.
- `Editor` takes `{ value, config, seed?, onCommit, onCancel }`. It starts from `seed` (replacing the value)
  or `format(value)`, commits only a value `parse` accepts, shows a parse error inline, and cancels on Escape
  and blur. `DraftInput` is the draft row's input, `{ raw, config, onChange, invalid, id, onBlur?, ref? }`;
  it edits the raw string, so its parse happens when the row is saved. `onBlur` and `ref` are optional
  because a table's draft row and `use-cell-grid.tsx` render the same `DraftInput`s outside a form and need
  not pass them; `EntityForm`'s `FieldKindRow` passes RHF's `controllerField.onBlur`/`.ref` so `mode:
"onTouched"` sees a field-kind row touched and a failed submit's `shouldFocusError` can focus it. Each
  kind puts both on its focusable control — for a popover-trigger kind (`select`, `priority`, `status`)
  that is the trigger, so a ref lands on an element with `.focus()`; `status`'s trigger is `StatusCell`'s
  `div`, which Base UI's `DropdownMenuTrigger` makes focusable and hands the ref and `onBlur` to.
- `seedable: false` says a typed character means nothing on this kind, so the grid leaves the key to the
  page's hotkeys instead of opening an editor with it. `date` sets it, because a native date input cannot
  hold a lone digit; Enter and a second click still open the editor. It defaults to true and is only
  meaningful alongside `entry: "editor"`.
- `Display`, `optimisticPatch` and `saveAs` (the row field a save writes when it is not the column id) are
  optional; `paste: false` makes a pasted rectangle pass over the column.

**A column has two presentations, and which one a cell shows depends on the reader's role.**
`DataTable` passes `editableCells` through only when `canEdit` (`editableCells = canEdit ?
editableCellsProp : undefined`), so for a viewer no cell has a field kind and every cell renders the
column's own `cell` renderer through `FlexRender`. For an editor, an editable cell of an `entry: "editor"`
kind still shows the column's renderer and swaps to the kind's `Editor` while editing. A `self` or `toggle`
kind renders through `renderOwnControl` instead, in place of the column's renderer: `status` (`self`) as its
`DraftInput`, `checkbox` (`toggle`) as its `Display`. So a column's `cell` renderer that an editor never sees
is not dead: it is the viewer's presentation of that column.

`text` and `number` are entered as one line of text, through `inputEditor` and `inputDraft` in
`src/fields/input.tsx`, with `parseTrimmed` and `formatScalar` in `src/fields/scalar.ts` for the shared
trim, blank and formatting rules. `number` uses a text input with `inputMode="decimal"` rather than
`type="number"`, because the browser reads text it cannot parse as an empty value and that would clear the
cell instead of reaching `parse`; its parse rejects anything `Number()` makes non-finite, so `"1,5"` and
`"12abc"` are errors with "Must be a number".

`status` and `priority` are **vocabulary kinds**: a value is an id into a project vocabulary the field config
carries (`config.statuses`, `config.priorityLevels`, the scale bottom level first, from `GET
/projects/:id/priorities`), a save writes `saveAs` (`statusId`, `priorityId`), and `optimisticPatch` sets both
the id and the object the row draws (`status`, `priority`). `priority` is entered through its `Editor` (a
`Select` whose options are the levels as `PriorityBadge`s) and can be pasted into: `parse` takes a level's exact
name, else its name ignoring case (the first up the scale), else its id, so a name is never read as another
level's id; blank parses to the scale's `isDefault` level, or `null` (the server's default) when there is no
scale. `format` names an id, and an id the scale no longer has formats as itself, so the cell still shows the
level object its row carries. The draft input's raw text is the level's name, the same text a paste carries; a
group header seeds the level id. `draftFieldsFrom` carries `statuses` and `priorityLevels` into a draft field.

`select`'s options are `SelectOption`s (`{ value, label, colour? }`): a value is an option's `value` (a custom
field's option id), read as its `label` (its colour's `StatusChip` when it has one); `parse` takes a label
exactly, else ignoring case, else a value, and a value no option has any more formats as itself and displays in
faint ink. `url` is a text input (`type="url"`) whose `parse` wants an absolute http or https link (`isWebLink`),
shown by `UrlDisplay` as a link opening in a new tab; a stored value that is not a web link reads as plain text. `describeValue(config, value)` in `src/fields/index.ts` words a
value for text that names it (an activity line, a palette row): a box as Yes or No, anything else as its kind
formats it. `src/fields/custom-field.ts` is plain data, safe anywhere: the `cf_<id>` key helpers,
`kindForField(field)` (each custom field type is the kind of the same name, a select's options from the field,
`label` the field's name), `fieldWriteBody`, `withCustomFieldValue`, `customFieldWrites` and `bagCustomFields`.

`list` and `suggest` are text inputs too. `list` (a track's artists) parses comma-separated text to a
`string[]`: entries are trimmed, blanks dropped, duplicates kept, blank is `[]` (or "Required"), and `format`
joins with `", "`. `suggest` (a session's DAW) is `text` with `{ suggest: true }` passed to the input
factories, which render `config.suggestions` as a `<datalist>` wired to the input's `list` attribute (a
`useId` id per input); free text is always valid, and with no suggestions it is plain `text`. An input with a
`list` has the `combobox` role rather than `textbox`.

## Data loading pattern

- **Entity pages** (`*/page.tsx`): `Promise.all` of critical data (`cachedProject`, entity, images, optional parent)
  → each result unwrapped with `loaded()` (`lib/loaded.ts`), which returns the payload, calls `notFound()` for a
  404 or 403 (`isNotFound`, `@workspace/api/lib/action-result`), and otherwise throws the `ActionError`'s message
  to the segment's `error.tsx`, which offers "Try again"; an optional parent (the track page's `collection`) is
  only unwrapped when the id that would have fetched it was given. Then un-awaited promises (statuses, paginated
  tables, summaries) either awaited in `<Suspense>`-wrapped async subcomponents or handed to client components
  that `use()` them. The project page starts `getProjectToday` (`GET /api/projects/{id}/today`) once and hands
  the one promise to `TodayReadout` (a client component that `use()`s it under its own `Suspense`, beside an
  always-mounted `WeekStrip`), `NewSection` and `QuietSection` (async RSCs, each in `Suspense fallback={null}`);
  `RecentActivitySection` reads its own eight rows and `JobsSection` reads the jobs stream.
  `CommentSection`, `ActivityFeed`, `SharingRail`, `PluginInventory` are async RSCs behind `Suspense`.
  Page anatomy: DESIGN.md Layout, Entity page anatomy (`CANVAS` grid → `Masthead className={MASTHEAD_AREA}` + `BODY` + `RightSideBlur`).
  Every section is a direct child of `BODY` (its gap is the space above each head; no margin wrappers) and sits
  in an `EmptySection` (`@workspace/ui` `layout/empty-section`) whose `empty` is derived from the data the page
  already holds: `isBlankStoredDocument` for notes/description, `!entity.image`, `attachments.length`, the
  table page's `rowCount` or `totalStatus.trackCount`, `saveCount`. `BODY`'s children sit inside one
  `SectionFold`, laid out by `PageSections` from the shell policy's list for the page (`projectHomeSections`,
  `entityPageSections.collection|track|session`, read through `cachedPolicies()`): the page hands every section by
  id, the list picks the order and which show. By default `<AddLine label="Add to this track" />`
  (…project/collection/session, the `add` entry) goes after `CommentSection` and before `ActivityFeed`; the line
  gathers the empty sections in document order wherever they stand. An empty section with an add renders nothing in place and joins
  the line: `add` is the noun the line offers (`"Session"`, shown as `+ Session`) and reveals the content in
  place with focus inside; `addControl` is a caller-supplied `SectionAdd`/`SectionAction` (dialog-driven adds:
  links, relations, `LinkNoteAction collapsed`). Pass `add`/`addControl` only when `canEdit`; a section with
  neither renders nothing unless it has an `emptyLabel` (session SET, HISTORY). `SPLIT` hides a column holding
  only a folded section's anchor, and the whole row when both fold. Sections whose count arrives in a promise
  (project collections, track sessions) render the `EmptySection` inside the async subcomponent, with a head +
  `TableSkeleton` fallback; they join the line in page order when they resolve. Every async component
  that can resolve after the page wraps what it renders in `Arrive`
  (`@workspace/ui/components/layout/arrive`), so content that arrives after the page fades in, over the
  place its skeleton held or into the gap a null fallback left: the sessions and collections sections, the
  collection page's tracks table, the list pages' table and board sections, `CommentSection`'s list,
  `ActivityFeed`, `SharingRail`, `TrackLyrics`, and the project page's byline counts, plugin inventory and
  work heatmap.
  `ActivityFeed` renders a
  `CollapsibleSection` collapsed by default. On the track page `CommentSection` takes a `hint` line
  distinguishing track comments from version comments; `AudioCommentPanel`'s pill text is
  `versionCommentsLabel(count, version)` (`track-audio/audio-ui.ts`, "3 comments on v2"), which is also its
  accessible name. The WORK heatmap (`getProjectHeatmap`) and the profile
  ACTIVITY grid (`getMyHeatmap`) render only when `hasSaves(yearHeatmapQuery(timeZone))`, the zone
  `cachedFormatters()` reads.
- **List pages**: `await cachedProject`, start the paginated page promise
  (`getTracksPageForProject` etc. → `/…/paginated` → `{rows,rowCount,facets,groups}`), `PageHead` with a
  Suspense-wrapped lede, then a Suspense-wrapped section rendering the table (`TableSkeleton` fallback). The
  sessions, tracks and collections list pages are `modules/entity-list` (`EntityList({ kind, projectId, query, scope })`), driven by
  `ENTITY_LISTS` in `modules/entity-list/lists.ts`: a kind's config (`entities/<kind>/list.ts`) supplies the
  page loader, the lede's opening words and the table's lookups (`loadScope`), and its entity module supplies
  the nouns, the list and new routes and `hasStatus` (statuses load only for a kind that has one). A kind
  with a status also gets the `ViewSwitcher` beside the "New" button and, when `query.view === "board"`, an
  `EntityBoard` (given the whole `query` as its `filters`) in place of the table; a kind without one ignores
  the param and renders its table.
  `scope` is `"live"` by default or `"archived"`. A kind is archivable when its config sets `archived:
{ route, count }` (only `trackList` does): `route` is its archived list page, and `count(projectId)` a
  one-row page with `archived: "only"` that resolves to its `rowCount` (0 on an action error). The archived
  scope passes `"only"` as `loadPage`'s third argument (kinds without the axis ignore it) and as the table's
  `scope.archived`, so later pages keep it; it renders the list view only, with no switcher or "New" button,
  crumbs ending at the kind's list then "Archived" (`archived.route`), and the empty state in place of the
  table when `archived.count` resolves to 0 (`body.ts`'s `listBody`; a filter matching nothing keeps the table).
  The live page of an archivable kind streams the same count into a quiet "{N} archived" link to `archived.route`
  at the start of the head's action row (`ArchivedLink`), shown only when N > 0.
  `modules/entity-list/copy.ts`'s `listCopy` builds the title, crumb, button and lede strings, and
  `archivedListCopy` the archived page's title, crumb, lede and empty text. The project page does
  the same for its collections, with `EntityBoard kind="collection"` for the board. A page that owns
  its own scroll container — every list page, `*/new.tsx`, the home list, settings, plugins, history and
  the profile — is a `ScrollRoot` (`@workspace/ui/components/layout/scroll-root`) taking `PAGE`/`PAGE_WIDE`
  as its `className`, rather than a `div` with `SCROLL`: the component carries the ref that tells the
  content inside what it scrolls in.
- **New pages** (`*/new.tsx`): `PageHead` + client form; statuses passed as an un-awaited promise. The project
  read (and any parent read a page needs for its lede) unwraps with `loaded()`; a sibling read whose absence is
  just a narrower page (an optional parent when no id for it was given) keeps its own `isActionError`/`notFound()`
  branch.
- **Settings panes** (`components/settings-hub/panes/`, one `<Name>Pane.tsx` each; how the hub lists and gates
  them is Settings → The hub): each `Content` is an async server component that loads its own data from
  `{ project, searchParams }`, behind the hub's `Suspense`. The project panes, in order 10 to 60 — Statuses,
  Labels, Relation types (23), Priorities (25), Fields (27), Images, Assets, Members (`minRole: "viewer"`) and Danger zone (`minRole: "owner"`) — render nothing without a project, which the
  Project section always hands them. Fields loads the track and the collection fields with two `getCustomFields`
  calls in one `Promise.all`, a failed read showing as an empty list. The table query goes through
  `parseTableQuery` and `?page=` through `lib/table-params.ts`'s `parsePageParam` (a whole number ≥ 1, anything
  else page 1); Images, Users and Machines (Instance) read `page`. `danger` holds `DeleteProjectButton` with a one-line explanation.
  `assets` reads the project's files
  (`getAssetsForProject(projectId, { page: 1, q, sort })`, one page of `{rows,rowCount,page,pageSize}`) and its
  storage counter together (`Promise.all`) and heads the pane with `SettingsStorage` (`components/settings/`), a
  `SectionHead` reading used bytes — and, only where the instance caps a project, used of cap over a `Meter`. A
  failed storage read simply omits the readout rather than failing the pane. `SettingsStorage` also reads the part of
  the used bytes the project's repositories take (`repositoryBytes`) under it as "Repositories 1.4 GB", left out at
  zero. Above the uploader `ProjectRepos` (`components/settings/`, in a `Suspense` with no fallback) lists the
  project's dit repos (`getProjectRepos`) as `Rows`, each a `Row as={AppLink}` to its repo page with the `lastPushLine`
  and the repo's `storageLine` under its name, and renders nothing while the project has none. Under the uploader, editors and above
  get `DuplicateAudioAudit` (`components/settings/`): a "Find duplicates" button that reads
  `getDuplicateAudio` (`lib/asset-queries.ts`) into an `AlertDialog` listing each bounce's kept, removable and
  skipped files (with the skip reason) and sizes. Its "Remove N files" sends exactly the listed `remove` ids
  through `removeDuplicateAudio` (`lib/asset-mutations.ts`, `POST …/duplicates/remove`) in batches of 500, and the
  toast sums the server's `deleted` counts. A failed audit shows the error with a retry and no destructive
  button. A failed assets read renders
  `AssetsTable` with zero rows. `AssetsTable` loads its pages through its own loaded window and counts them in
  its `DataTable.Paging` footer (`serverPage={{ rowCount, load }}`, a `useTableUrlState` source that navigates,
  `hotkeys="page"`) rather than `PageLinks` — a second footer under the table's own would be
  redundant; `format`, `attachedTo` and `uploadedBy` are `enableSorting: false` since the server does not know
  those keys. `images` reads `getImagesForProject(projectId, page)` the same way and renders `PageLinks`
  (`components/tables/PageLinks.tsx`) beneath the grid, since the grid itself has no footer; a failed read
  renders the grid empty with no pager. An upload in the Assets pane follows its job through `JobsProvider`,
  which watches the project a `/settings/project/:id` URL names as it does a `/project/:id` page's, with the
  caller's role from the `JobsRole` the section mounts, so an editor keeps Cancel, Retry and Clear.
  The instance panes — Users, Storage and About, in order 20 to 40 after the Access group's 10 — sit behind
  the Instance section's own admin gate, which `notFound()`s the whole section before any `Content` runs.
  Users pagination (`AdminUsersTable`) is server-driven via `?page=` on `/settings/instance/users`, not
  client-side fetching. `components/admin/admin-users-logic.ts` holds the two bits of pure logic the
  table needs tested without a DOM: `isOnlyEnabledAdmin` (client-side courtesy that disables demote/disable
  on the sole enabled admin — page-scoped, so it can't see admins pagination has hidden; the server's own
  409 on `PATCH /admin/users/:id` is the real guard) and `resetLinkDialogReducer` (the reset-link dialog's
  state holds at most one just-minted link, cleared on close, so it is shown once by construction).
  `components/admin/update-availability.ts` turns `{updateCheck, version, latestTag}` into what the About
  pane's update line shows; the tag itself is fetched client-side from GitHub's releases API in
  `AdminAboutSection` (not from the server, so a firewalled instance still shows its own version).
- **Request-scoped caches** in `lib/server-data.ts` (`server-only`, React `cache()`): `cachedMyProjects`,
  `cachedMe`, `cachedInstance` (`GET /api/instance`; the signed-out settings read and the sign-in card share
  it), `cachedProject`, `cachedTrack`,
  `cachedCollection`, `cachedSession`, `cachedRepo`, `cachedCustomFields`, `cached{Collection,Track,Session}Summaries`, `cachedMyNotes`, `cachedNote`,
  `cachedIsInstanceAdmin` (derived from `cachedMe()`'s own `instanceRole`, `false` on a failed `/me` — one
  `/me` read per request, shared by the settings hub's Instance gate and the palette's settings results;
  `cachedShellData()` reads the session, `/me/projects` and the project cookie, never `/me`; the cache
  here is request-scoped, but `/me`'s role comes off the session, so this
  answer is as old as the server's cookie cache: a promotion can take up to five minutes to show the Instance
  section, while a demotion revokes the session instead, so it ends as a sign-out rather than a stale shell —
  no data rides on it either way, since `/api/admin/*` re-reads the row every request),
  `cachedShellData()` → `{ user, projects, currentProject }` (feeds `AppSidebar`, `TopStrip`, palette recents).
  Server actions cannot be `cache()`d themselves; anything read by several components on one page goes here.

## API access and auth

- **Server actions** (`src/actions/*.ts`, one `"use server"` file per resource: activity, admin, assets,
  collections, comments, cookie, custom-fields, images, instance, labels, machines, me, members, notes, patch-field, player-metadata,
  priorities (`getPriorityLevels(projectId)`, the scale a list page, the entity pages' tables, the track rail, the
  palette and the activity feeds read; `createPriorityLevel`/`updatePriorityLevel`/`reorderPriorityLevels`/
  `deletePriorityLevel`, each wrapped in `written()`, back the Priorities pane), projects, relation-types, repos, save-description, saved-views, sessions, sharelinks, statuses,
  storage, track-audios, tracks). `instance.ts` `getInstance` wraps the public `GET /api/instance` (`{registration, hasUsers, emailEnabled, version,
updateCheck}`) the sign-in card and the Instance section's About pane both read. `admin.ts` is every `/api/admin/*`
  call (whether the caller administers the instance at all is `lib/server-data.ts`'s `cachedIsInstanceAdmin`,
  off `/me`, not a call in here). Convention: `serverApi.<METHOD>(path, { params, body })`
  (`lib/server-api.ts` = `createServerApiClient(getCookie)` from `@workspace/api/lib/authed-client`; the raw
  `Cookie` header comes from `lib/request-cookie.ts`), wrapped in `toActionResult`/`toActionOutcome`; return
  `Data | ActionError`; callers narrow with `isActionError`, which is the client's only narrowing idiom — the
  bare `"error" in result` check is gone and nothing re-wraps an error into a fresh `{ error }` literal. Both
  `to*` helpers are async — a result inspected before returning must be awaited. Every export of a
  `"use server"` file is an RPC endpoint the browser can call with whatever arguments it likes, so a runtime
  guard in one is never dead code just because the compiler can prove every call site in the repo passes the
  right type: the compiler guards the call sites it can see, not the boundary. Deleting such a guard on
  type-safety grounds turns a clean `{ error }` into a thrown `TypeError` for a request that was always
  possible. `ActionError` carries the
  failing response's `status`, its `code` and its `details` alongside `error`, and `isNotFound` reads a 404 or a
  403 off it (`packages/api/src/action-result.ts`). Nothing on the server is cached: each `serverApi` read
  awaits `headers()` (`lib/request-cookie.ts`) and
  Next's fetch cache key includes `Cookie`, so tag invalidation has nothing to act on and "re-render this route"
  (`router.refresh()`, or `refresh()` from `next/cache` inside a Server Action) is the only primitive. A Server
  Action called from a bare async handler is still dispatched inside a transition (`callServer` wraps it). **Path params are strings.** `patch-field.ts`
  exports `patchField`/`patchEntity` (`PatchableEntity = EntityKind`), routing each kind's PATCH through
  `ENTITY_API[entityType].patch`; `save-description.ts` `saveRichText`; `cookie.ts` only sets `currentProject`; `me.ts` `getMe`/`getMyProjects`/`getMyHeatmap`;
  `notes.ts` `getMyNotes`/`getNote`/`deleteNote`/`linkNote`/`unlinkNote`; `sharelinks.ts` share-link CRUD,
  convert, options and share-comment CRUD (404 → "invalid", 410 → "expired"); `images.ts` `setImageOnParent(imageId,
kind, parentId)` PUTs `/images/parent/{kind}/{parentId}` — no `projectId` argument, since the server resolves the
  parent's project itself.
- **Browser calls** (`"use client"`): `lib/browser-api.ts` `browserApi = createBrowserApiClient()` (`baseUrl: ""`,
  `credentials: "include"` — same-origin through `proxy.ts`'s forward, **cookie-authenticated; there is no Bearer token in
  the client**, Bearer is for non-browser clients only). `lib/client-api.ts` — `clientGet*` reads that skip a server-action round
  trip (track sessions/attachments/audios/peaks, collection primary audios/track summaries, my projects, active
  jobs, project/my heatmap, project saves). `lib/notes-client.ts`
  (`createNoteClient`, `saveNoteClient`, `getNoteTextClient`) returns openapi-fetch's raw `{data,error,response}`
  so the autosave can read a 409. Uploads: `components/uploads/upload-client.ts` `uploadAsset`/`uploadImage`
  over `uploadMultipart` from `@workspace/api/lib/authed-client` (XHR, real `onProgress`); they bypass server
  actions because of the 1 MB body cap. The same file's `uploadLimit()` reads the enforced byte cap
  (`GET /api/uploads/limits`), and `tooBigMaximum(error)` reads the cap back out of a `too_big` rejection's
  `details.issues` (the API answers the same 400 whether the body's declared length or the validator caught it).
  `lib/asset-mutations.ts`'s `bulkDeleteAssets(projectId, ids)` is a `Mutation` over `DELETE /api/assets/bulk`
  (one request for the whole selection, answering `{ deleted }`; the server skips an id in another project or
  naming no file); `AssetsTable`'s bulk bar and its row menu both call it, since files have one delete path.
  `removeDuplicateAudio(projectId, ids)` is the `Mutation` behind the settings duplicate-audio audit.
- **Mutation contract**: each transport declares who re-renders after a write, rather than the caller
  remembering. A server action's write wraps its result in `lib/write-action.ts`'s `written()`, which calls
  `refresh()` from `next/cache` on success; Next re-renders the current route inside that same action response,
  so a caller has no reason to call `router.refresh()` after one (`refresh()` throws outside a Server Action,
  so `written()` is
  `server-only` and never sits in a function called during render). Every write in `actions/` goes through it:
  `actions/write-actions.test.ts` reads the sources as text and fails on an exported function that makes a
  `serverApi` write without `written(`, unless its name is in that file's `UNREFRESHED` record with the reason.
  Six entries live there: four writes whose caller navigates away (`createProject`, `deleteProject`,
  `deleteNote`, `acceptInvite`), because re-rendering a route that is about to be left, or that no longer
  exists, is wrong; `leaveProject`, which redirects home itself; and `patchEntity`, explained below. The test
  also fails on an entry naming no function, so the list cannot go stale. `patch-field.ts` is the one
  place the wrap sits on the wrapper rather than the write: `patchField` refreshes, the `patchEntity` it calls
  does not, because `save-description.ts` autosaves rich text on a debounce while the user is still typing.
  A browser mutation becomes a `Mutation<T>`
  (`lib/mutation.ts`'s `defineMutation`, branded so it cannot be awaited as its result), naming which
  `InvalidationKey`s it invalidates (`"route"`, or a key naming a list held in client state); only
  `applyMutation` — reached through `hooks/use-mutate.ts`'s `useMutate()` — may run one, and it applies the
  invalidation only on success: `"route"` calls `router.refresh()`, any other key notifies whatever
  subscribed to it through `onInvalidated`. Tag-based invalidation (`revalidatePath`, `cacheComponents`) is
  deliberately unused: every read is per-user and cookie-authenticated, so nothing on the server is cached for
  a tag to act on.
- **Session**: `lib/session-state.ts` `SessionState = member | guest | signed-out | unavailable`;
  `resolveSessionState`, `isSignedOut` (true for guest too), `sessionUser` (member or guest). `lib/session.ts`
  `getCachedSession` reads the signed `session_data` cookie in-process (`lib/auth-server.ts`
  `readCachedSessionCookie`, needs `BETTER_AUTH_SECRET`) and falls back to `authServerClient.getSession()` only
  when it is absent; network failure → `unavailable`, never signed-out. The cookie's name follows the request's
  scheme, `lib/request-origin.ts`'s `requestProtocol` (the first `X-Forwarded-Proto` entry; absent → `http`):
  `__Secure-better-auth.session_data` over https, `better-auth.session_data` over http, which is what the API
  writes when its `BETTER_AUTH_URL` is the public origin the browser uses. Behind Caddy or the Tailscale node
  (both terminate TLS, set the header to `https` and discard the caller's own) it is the prefixed name; under
  `next dev`, where Next fills the header from its own plain-http socket, the unprefixed one. A mismatch finds no
  cookie and costs one API read, never a wrong answer; `lib/auth-server.test.ts` checks the name per scheme.
  `authServerClient` forwards only
  `better-auth.*`/`__Secure-better-auth.*` cookies and carries the `anonymousClient` plugin (guest sessions for
  share/invite). No client session hook: session data is read server-side and passed as props; the only per-user
  surface is `/profile` (`authClient.updateUser` etc.). `lib/sign-out.ts` `signOut()` = `authClient.signOut()` +
  full reload. `currentProject` cookie set by `ProjectCookieUpdater` → `setProjectCookie`.
- **Roles**: `lib/roles.ts` `roleSatisfies(role, min)` (viewer<editor<admin<owner); `hooks/use-project-role.tsx`
  `ProjectProvider`, mounted by the project layout with `project: Pick<Project, "id" | "name" | "role">`,
  backs both `useProject()` → `{ id, name, role, can(min) }`, which throws outside a project route, and
  `useProjectRole()` → `{ role, can(min) }` or `null` outside one. Gating is cosmetic (server is
  authoritative): viewers get no editable cells, draft rows, selection, bulk bar, delete, "+" chips or inline
  editors. The readers of `useProject()` are the ones that always mean the project the URL is in: the two
  uploaders (`ImageUploader`, `FileUploader`), `RelationSelector`, `TrackRelationsSection` and the four
  pickers in `product-linking/pickers.tsx`. A component between such a reader and a page holds no
  `projectId` prop of its own: `AttachmentList`, `TrackAudioSection`, `TrackAudioDialog`, `LinkToDialog` and
  `TrackTags` each lost one that existed only to be passed on. Two limits: server components cannot read
  context, so a server-rendered page still takes the project id as a prop; and a component that may mean a
  different project than the one the URL is in (the move-to-project dialog, the note picker, the player's
  now-playing) keeps an explicit prop rather than reading the context. Components in the app shell (sidebar, dock, palette, hotkeys) sit above the project
  layout and read `useCurrentRoute()` instead.
- **Entity mutations**: every browser write for an entity kind — table cell edits, page-control patches,
  create/remove, bulk patch/remove, bulk labels/move, labels, moves, track relations, collection links,
  saved views — is one
  `Mutation<T>`-returning export in `entities/mutations.ts`, the one file under `entities/` allowed to import
  `browserApi`. It calls `ENTITY_API[kind]` (or, for the calls a `TableEntityApi`/`EntityApi` annotation can't
  carry — `linkTracks`, `addRelation`/`removeRelation`, `createSavedView`/`deleteSavedView` — the standalone
  export beside the per-kind object) and is only ever run through `useMutate()`. A table cell edit
  (`patchEntityField`) is optimistic in the table and invalidates nothing, except a `statusId` edit on a kind
  whose entity module sets `hasStatus`, which feeds a server-rendered rollup an optimistic row can't reach. A
  page control (`patchEntityFields`) has no optimistic row on its page, so it always invalidates `"route"`.
  `collectionTracksChanged()` calls no API at all — it lets a server-action caller, whose write already
  refreshed the route through `written()`, also notify the collection's client-held track list, which a server
  action cannot reach on its own.
- **Refreshes that remain a caller's job**: a `router.refresh()` outside `written()` and `applyMutation`'s
  `"route"` key survives only where neither covers it — a session change made through `authClient` (nothing
  of ours re-renders it), a job-stream event, a raw browser write outside the action/mutation layers (e.g. a
  direct `browserApi` call), or a refresh of a client-held list that no route re-render reaches.
- **Reads shared across both transports**: `lib/shared-reads.ts` holds the handful of reads a server-rendered
  page and an interactive component genuinely both need — `myProjects`, `myHeatmap`, `projectHeatmap`,
  `myMachines` (the Devices section's first render and its poll). Each
  takes an `ApiClient` as its first argument instead of importing one, so the module carries neither
  `"use server"` nor `"use client"` and neither `server-only` nor anything that transitively pulls it in;
  `actions/me.ts`/`actions/projects.ts` bind it over `serverApi`, `lib/client-api.ts` binds it over
  `browserApi`. `HeatmapFilters` lives here too (client-api.ts re-exports the type) since `projectHeatmap`
  needs it but a `"use server"` file cannot import from a `"use client"` one. A read with a caller on only one
  transport stays a plain wrapper in that transport's own file — this module is for the exceptions, not a
  general resource layer over every read.

## Settings (`src/lib/settings/`)

The server resolves every setting (`@workspace/settings` declares them; `docs/agents/packages.md`); the client
reads the result and never walks the cascade itself. The only registry logic it runs is the defaults and
`documentAttributes`.

- **The read** — `server.ts` (`server-only`): `cachedEffectiveSettings(projectId?)` → `{ values, version }`,
  React-`cache()`d per request and per project (the no-argument call is one entry however it is spelled). Signed
  in: `GET /api/settings/effective?project=`. Signed out or a guest: the `settings` of `GET /api/instance`
  (`cachedInstance`, shared with the sign-in card) and no authenticated read, so the sign-in and share pages make
  no failing request. A read that fails logs a console warning and returns the registry defaults
  (`DEFAULT_EFFECTIVE_SETTINGS`), never an error page. `effective.ts` (no directive, both sides) holds
  `EffectiveSettings`, `DEFAULT_SETTINGS` and `effectiveSettings(values, version)`, which fills the keys the server
  did not send (admin-only keys, non-public keys signed out) from their defaults. RSC code reads settings through
  `cachedEffectiveSettings` and sees a write on the next navigation. `cachedSettingsHub(projectId?)` (same file) is
  the hub's read, `GET /api/settings?project=`, React-cached per request and project, with no fallback: it returns
  the `ActionError` (a project the caller is not in is a 404) for the page to `loaded()`.
- **The provider** — `provider.tsx` (`"use client"`): `SettingsProvider { initial, projectId?, userId? }`. One
  root provider mounts in `app/layout.tsx` for every page (signed in or out, `userId` the signed-in member's id
  or `null`), never in `(app)/layout.tsx`; the project layout nests one with `projectId`, whose values
  replace the outer ones wholesale (the server resolved them with the project layer, from the URL's id, never the
  lagging `currentProject` cookie). A later `initial` with a new `version` (a route refresh) replaces what the
  provider holds, keeping writes still in flight on top. Each provider is a `SettingsStore` (`store.ts`, no
  React): the server's values, then values writes have confirmed, then values writes in flight predict. Back and
  Forward remount a project layout from the router cache with the read it had before, so the shared queue
  remembers each read, by project and `version` (a version digests the values alone, so two projects can share
  one), against a count of landed changes (`hold`/`outdated`), and a store that mounts with a read a change has
  outdated since reads its values again. A change made outside the queue (an import, a lock) goes through the
  store's `refresh`, which counts it with `changed()`.
- **The hooks** — `useSetting(key)` → `SettingsValues[K]`, typed per key and re-rendering only when that key
  changes (`useSyncExternalStore` over the store); `useSettings()` → every value; `useSettingsDerived(server,
derive)` → `derive(values)` once the store has changed since mount, else the `server` value the first render
  hands down, so a component built from settings matches the server's own render until a write moves it;
  `useSettingsWrite()` → `{ write(scope, id, patch), pending }`, `id` typed per scope (`user`: the caller's own
  id, `project`: a number, `instance`: `"instance"`), `patch`
  `{[key]: value | null}`; `write` settles with the
  request's `WrittenSettings` (the hub rows of every key the batch carried, the same object for every write in
  it). `useUserSettingsWrite()` → a `(patch) => Promise<WrittenSettings>` that writes at the signed-in member's
  own scope directly, for a caller with no reason to spell out `scope`/`id` itself (a theme toggle, a sidebar
  fold); signed out it rejects the same way a write outside any provider does. `useSettingsRefresh()` → a
  function that re-reads the nearest store and every store above it (`SettingsStore.refresh`), for a change the
  write queue never sees: a lock set or lifted. Signed out (the sign-in and share pages) the reads return the
  instance's public values over the registry defaults, and `write` rejects with a 401 `SettingsWriteError`, as
  it does outside any provider; `useSettingsRefresh()` reads nothing.
- **The landing rule** — `lib/landing.ts`'s pure `landingHref({ landing, defaultProject, cookieProjectId,
projects })`, read by `(app)/page.tsx` from the `navigation.landing`/`navigation.defaultProject` settings
  (`packages/settings/src/groups/navigation.ts`). `last-project` opens the `currentProject` cookie's project,
  falling back to the one-project shortcut, then the list; `project` opens `defaultProject` or the list;
  `projects` and `notebook` always go to their own route. A cookie or a chosen project that no longer names
  one of the caller's own projects is treated as absent rather than cleared — a Server Component cannot write
  cookies, and the list is always a safe landing.
- **Refused writes outside the hub** — `refusal.ts`'s `toastRefusedWrite(failure)`: the store has already put
  the old value back, so this only tells the viewer why (a theme toggle, a sidebar fold, a strip write that
  fails); the hub shows its own refusal inline instead.
- **Settings becoming policies** — `lib/policies/from-settings.ts` is the one place a set of effective settings
  becomes a `Policies` and a format-preferences pair: the server builds them from its own read (`cachedPolicies()`,
  `viewerFormat()`, each taking the project's id on a project's route so the project layer applies) and the client
  rebuilds them from the settings store as it changes, both through this
  module, so the two are never allowed to diverge. `PoliciesProvider` (`lib/policies/provider.tsx`) hands down
  the server's `Policies` and, once the settings change, `useSettingsDerived`'s rebuild; `SettingsFormatProvider`
  (`components/format/`) does the same for `viewerFormat()`'s prefs (the zone stays the server's). Both are mounted
  twice: in the root and `(app)` layouts from the viewer's own read, and again in the project layout inside its
  nested `SettingsProvider`, where `useSettingsDerived` follows the project's store. The root
  layout's `SettingsToaster` and `SettingsHapticsProvider` (`components/feedback/SettingsFeedback.tsx`) read the
  `feedback.*` toast and haptics settings themselves, since they sit above the signed-in shell's
  `PoliciesProvider`. `AppSidebarProvider` (`components/sidebar/AppSidebarProvider.tsx`) sets
  `--sidebar-width` from the shell policy, following it as it changes; `SidebarSections` writes a fold to
  `layout.sidebarSections` and `use-selected-strips` writes `visuals.strips`, both through
  `useUserSettingsWrite()`.
- **The write rule** — `write-queue.ts`'s `SettingsWriteQueue`, one per root provider and shared by the nested
  one. A write applies at once and goes out after 300 ms without another write to the same scope and id
  (`SETTINGS_WRITE_DELAY_MS`, the player's slider debounce), every key written in the window in one `PATCH
/api/settings/:scope/:id`, the last value per key winning; a target's requests go one at a time. It PATCHes
  through `browserApi` and never calls `written()`, a server action or `router.refresh()`, so it is not in
  `write-actions.test.ts`'s sweep. A value is predicted only when the write lands at the key's highest scope
  (`scopes[0]`) and is not `null`; anything else waits for the server. On success a store whose context the
  server answered for (no project for `user`/`instance`, its own for `project`; `isAnsweredFor` in `store.ts`, which
  the hub shares) takes each row's `effective`; a
  project store hearing a `user` or `instance` write re-reads `GET /settings/effective?project=`. On a refusal
  the values from before the write return and `write` rejects with `SettingsWriteError` (`status`, `code`,
  `details`, `keys`; `code: "setting_locked"` names the lock) for the caller to show.
- **The document attributes and style properties** — the root layout spreads `documentAttributes(values)` onto
  `<html>` and `documentProperties(values)` onto its inline `style`, so a setting with a `document` entry (an
  `attribute` or a `property` form) paints with the first byte, signed in or out, at its value outside any project
  (the root layout reads no project, so a project value of such a setting shows only after hydration). After
  hydration the innermost mounted store owns both: `SettingsStore.paint()` (`paintDocumentAttributes` in
  `store.ts`) repaints them on every change (a write, its rollback, a new read), a nested project store paints its
  own on mount and hands the outer store's back on unmount. `editor.syllableCounts` / `editor.rhymeLetters` paint
  `data-lyrics-syllables="off"` / `data-lyrics-rhymes="off"` (nothing when shown), which
  `packages/ui/src/styles/doc.css` reads to blank the lyrics gutter's count and rhyme-letter columns
  without collapsing their width. `appearance.accentFallback` (hex, or `""` for none) is the one property-form
  entry: the inline `--art-fallback` custom property on `<html>`, left off at `""`, painted the same as every
  attribute.
- **The editor's own settings** — `NoteEditor.tsx` reads `editor.newNoteMode` for the variant a new note (no
  draft yet) starts in. `LyricsProvider.tsx` (`components/editing/`) reads `editor.rhymePrefix` /
  `editor.synonymPrefix` and `editor.rhymeSuggestions` / `editor.synonymSuggestions`, and hands the lyrics
  editor's context a `null` prefix (`LyricsPrefixes` in `@workspace/ui`'s `lyrics/context.ts`) for whichever
  suggestion type is off, so its menu never opens.
- **The theme** — `appearance.theme` (`light` | `dark` | `system`) is `data-theme` on `<html>`; the scheme it
  resolves to is the `light` or `dark` class there, which Tailwind's `dark:` variant reads. The root layout
  renders an explicit theme's class itself (`explicitTheme`, `lib/theme/script.ts`) and always renders
  `THEME_SCRIPT` from the same module in `<head>`: a constant inline script that, for `data-theme="system"`, adds
  the `light` or `dark` class kept in `localStorage` under `THEME_STORAGE_KEY` when the page rendered signed out
  (`SIGNED_OUT_ATTRIBUTE`, `data-signed-out` on `<html>`; a read that throws counts as nothing kept), else the one
  `matchMedia("(prefers-color-scheme: dark)")` asks for, before the first paint.
  Being a constant, it has a constant hash, which `next.config.ts` puts in the CSP's `script-src`. The kept
  theme is what lets the precached `/offline` page follow the member: `public/sw.js` fetches it with
  `credentials: "omit"`, so the root layout renders it signed out, from the instance's public theme (`system`
  unless an admin set one, which then shows offline for everyone), and the script resolves that from the theme
  the member last chose rather than the OS. Every signed-out page whose theme is `system` follows the kept
  theme this way, the sign-in page and reset links included, and the provider (below) agrees with the script
  so hydration does not swap the class. After that,
  `components/theme/AppThemeProvider.tsx` (inside the root `SettingsProvider`) owns the class: the theme is
  `useSetting("appearance.theme")`, or signed out (no `userId`) a page-lifetime override set by `setTheme`; a
  signed-in theme is kept with `storeTheme` (`lib/theme/script.ts`, storage failures swallowed) whenever it
  changes, and a signed-out page never writes the key, so the offline page cannot overwrite it. Signed out, a
  `system` theme resolves to `storedTheme()` (the kept `light`/`dark`, read through `useSyncExternalStore` with a
  `null` server snapshot and the window `storage` event) before the OS scheme; a signed-in `system` follows the
  OS and ignores the key. The
  OS scheme is `useSyncExternalStore` over `matchMedia` with a `null` server snapshot, so `resolvedTheme` is
  `undefined` for `system` through SSR and hydration and the script's class stands. A layout effect with no
  dependency list puts the resolved class back after every commit, because a route refresh that changes the root
  layout's `className` string rewrites the whole class list first in the same commit (React's mutation phase runs
  before its layout effects); a switch it makes holds transitions off while it lands. `useTheme()` →
  `{ theme, resolvedTheme, setTheme }`; signed in `setTheme` writes `appearance.theme` through
  `useUserSettingsWrite()` and toasts a refusal with `toastRefusedWrite`, the store's rollback flowing back through
  the effect. `bindThemeHotkey` (signed out) binds `d` with ui's `useThemeHotkey`. `SettingsToaster` passes
  `resolvedTheme` to the `Toaster`. `useSettingsUserId()` (`provider.tsx`) is the member's id or `null`.

### Brand (`src/lib/brand.ts`, `src/lib/brand-context.tsx`, `src/lib/brand-defaults.ts`)

How the instance presents itself — its name, its uploaded logo and icon, and its colours — everywhere the
client shows something other than the app itself: the title, the manifest, the sign-in and one-off page
shells, the share footer and unfurl poster, the OAuth consent copy. It rides `GET /api/instance`'s `brand`,
the same public, signed-out-safe read `cachedInstance` already makes — there is no second fetch path.

- **The read** — `brand.ts` (`server-only`): `cachedBrand()`, React-`cache()`d per request, is `cachedInstance()`
  → `.brand`, or `DEFAULT_BRAND` (the registry defaults, `packages/settings`'s `instance-branding` group; import
  them, never spell the product's name out again) when the read throws or is an `ActionError` — the same
  `attempt` shape `lib/settings/server.ts` uses. `brand-defaults.ts` (no directive) holds the `Brand` type
  (`Instance["brand"]`) and `DEFAULT_BRAND` so both the server and client halves, and their tests, share one
  definition instead of two.
- **The provider** — `brand-context.tsx` (`"use client"`): `BrandProvider { brand, children }` and `useBrand()`,
  a plain context defaulting to `DEFAULT_BRAND` outside any provider. The root layout is the one provider,
  seeded from `generateMetadata`'s/`RootLayout`'s own `cachedBrand()` read, wrapping both the signed-in and
  signed-out branches so every page and every `error.tsx` reads the same value. A server component that needs
  the brand (a shell, `SignInPrompt`) calls `cachedBrand()` directly instead of rendering a client wrapper.
- **Marks** — `BrandMark` (`components/brand/BrandMark.tsx`, `"use client"`) renders the uploaded logo
  (`imageUrl(brand.logoImagePath, 64)`) or, with none set, the generated `Logo`; `CenteredPageShell` and
  `ShareFooter` use it. The manifest's icon routes (`icon.tsx`, `apple-icon.tsx`) go through `logo-image.tsx`'s
  `logoImage(side, scale, markPath?)`, which fetches `markPath`'s bytes from the API's static route
  (`?w=` at the nearest served width) as a `data:` URL for Satori to draw, falling back to the generated
  drawing on any fetch failure or when no path is given; the icon prefers `iconImagePath` over
  `logoImagePath`. `manifest.ts` itself is async and takes `name`/`short_name` and both colours from the
  brand.
- **An unreachable instance** (the API down, signed out) renders as `DEFAULT_BRAND` — the product's own
  name — rather than a cached last-known brand: there is no brand cache in Next.

### The hub (`/settings`, `components/settings-hub/`)

- **Routes** — plain file routes under `app/(app)/settings/` (not the `/project` sub-router), all behind the
  proxy's session gate. `page.tsx` redirects to `/settings/personal`. `personal/[[...group]]`, `instance/[[...group]]`
  (`notFound()` for anyone `cachedIsInstanceAdmin()` says is not an admin, before anything else; `page.test.ts`
  beside it) and `project/[[...rest]]` (`<id>[/<group-or-pane>]`; bare `/settings/project` redirects to the current
  project's, from `cachedShellData().currentProject`, else to `/settings/personal?notice=no-project`, which the
  Personal page shows as a note) each hand one optional segment to `HubPage` (`entrySegment`: a deeper path is a
  404); `devices/page.tsx` takes none. `loading.tsx` is the skeleton (nav and rows) while a section loads. URLs come
  from `lib/settings/href.ts`'s `settingsHref({ section, projectId?, group?, key? })`; a row anchors as `#<key>`, and a machine's row on the Devices page as `#machine-<id>` (`machineHref(id)` builds it).
  Every entry point opens `SETTINGS_HREF` (`/settings/personal`) from any signed-in page: the sidebar's Settings
  item, the account menu and the phone account sheet (Profile · Settings), `g ,` and the palette's "Go to
  settings"; the palette also offers every setting as a result (Components → Command palette). The old URLs
  redirect: `/project/:id/settings[/<pane>]` (the `[...route]` page) to the Project section, `/admin[/<tab>]`
  (`app/(app)/admin/[[...tab]]`) to the Instance section, `registration` to its `instance-access` group.
- **The page** — `HubPage` (server) reads the session, `cachedShellData()` and `cachedIsInstanceAdmin()`, then the
  page's project (the URL's in the Project section, through `loaded()`, so a non-member 404s; the current project
  elsewhere, dropped if it cannot be read), then one `cachedSettingsHub(project)`. Every row on the page, and the
  search, render from that one read, so the Personal rows show what applies inside the current project (its
  member defaults and its locks), and a personal Reset there falls back to the project's value. A group or pane the
  section does not have for this caller is a 404; a section with no groups opens on its first pane. The Project
  section mounts `ProjectProvider` and a nested `SettingsProvider` for its own id, as the project layout does. The
  frame is `TopStrip back` over a `ScrollRoot` `PAGE`. Under a section's head, `RestartNotice` (client) takes the
  section's restart-required keys and, while any row's `running` differs from its `effective`
  (`row-view.ts`'s `waitsOnRestart`, compared as JSON), shows one quiet `role="status"` notice naming them; it
  renders nothing otherwise, so it takes no gap in the page's rhythm, and it goes when every value matches again.
- **The shape** — `layout.ts`'s `hubLayout({ visible, isAdmin, project, panes })` (pure; the server calls it) turns
  the registry into sections, each a spec with its label, heading, the scope its rows write (`personal` → `user`,
  `project` → `project`, `instance` → `instance`; Devices writes none yet) and whether it is shown: Personal and
  Devices always, Project with a project, Instance for admins. A section's entries are its declared groups
  (`GROUPS` of that section; a key is a row there when the caller receives it and it takes a value at the section's
  scope), the generated **Member defaults** group (`member-defaults.ts`'s `memberDefaultsGroup`, Project and
  Instance only: every Personal setting that takes a value at that scope, order 1000) and its panes, sorted by
  `order`, ids unique per section. Instance also lists the four Project groups (`project-defaults`, `-sharing`,
  `-conventions`, `-audio`) as its own groups at `instance` scope, ordered after Member defaults (`1000 + order`),
  without the per-project `trackStatusId`, `collectionStatusId` and `labelIds` keys (`PER_PROJECT_KEYS`; their
  controls read a project the Instance section has none of). A group with no rows is left out; a section with nothing shows "Nothing to set
  here yet". It also returns the search index: every row of every section the caller can open. A declared group's
  `advanced` flag carries through: `SettingGroupView` folds such a group under a `CollapsibleSection` head with its
  row count, open from the start only when the URL names the group (`opened`, from `HubPage`'s named entry, so a
  search result's group link lands on its rows), with the section's group action (below) in the head, so it shows
  while the group is folded. `GroupHead` and `GroupDescription` (`GroupHead.tsx`) are the head and the "what it is
  for" line every group and hub block uses.
- **Rows** — `HubRowsProvider` (`hub-rows.tsx`) holds the page's hub rows in a `HubRowsStore`, subscribed per key
  (`useHubRow`), and takes `write` and `refresh` once for every row. The rows change only by the server's own
  answers, and not only to the hub's own writes: `HubRowsStore.attach` observes the shared `SettingsWriteQueue`
  (as `SettingsStore` does), so every write or lock that lands anywhere — the hub's own included — reaches
  `landed`, which takes the rows when the server resolved them with the page's project (`isAnsweredFor`), or
  falls back to a fresh `GET /api/settings?project=` when it did not (falling back on the answer if that read
  fails in turn); a landing already dedupes by the answer object's identity, so the hub's own write is still
  processed once, not twice, whether `row-state.ts` or the queue observer lands it first.
  `HubRowsStore.attach` (called from the provider's mount effect with `useSettingsQueue()`, whose cleanup is
  its returned unobserve) also re-reads the page's rows when its seed is one the write queue's
  `holdRead`/`outdatedRead` (keyed on the seed object's identity, since the hub read carries no version) says a
  write has landed since: a page the router cache restores on Back or Forward with a stale payload.
  `useHub()` also carries the page's own `projectId` (`null` off a project page), which a `custom` control reads
  for anything scoped to the current project (`table-default-views`, below). `SettingRow` renders one setting at the scope it writes (an optional `note` slot under its facts, which `SettingGroupView`'s `notes` fills by key: the Instance section's `SECTION_EXTRAS` puts `SavePruneNote`, the retention job's last-run line from `savePruneLine`, under `instance-jobs.saveContentRetentionDays`); `row-view.ts`'s `rowView`
  reads what it shows off the hub row: at the key's highest scope the effective value and source as the server
  sent them, at a lower one (a member default) what that scope holds, else the first value held below it, else
  the registry default (the one place the client walks `values`; the server seeds `env` only for instance-only
  keys, which take the first branch). Modified is "this scope holds a value"; Reset (`view.resettable`) is
  modified and writable, and on a row locked at its own scope also needs `lockable[scope]`, since clearing lifts
  the lock; a lock is shown where
  `lockedBy` sits below the row's scope; `writable[scope]` decides whether the control is live, and the lock toggle
  (`LockToggle`, `PUT /api/settings/:scope/:id/locks` through `api.ts`'s `lockSettings`, then
  `useSettingsRefresh()`) shows where the key is lockable, the scope can lock, a scope sits above it, and the
  caller may write there and lock there (`lockable[scope]`, the server's `mayLock`; the client never derives the
  role rule). The group-level "Reset all" (`ResetGroupButton`) only sits on user and instance groups, where no
  row is locked at a scope the caller cannot lock at, so it needs no such filter. `row-state.ts`'s `useSettingRow` is the row's state: a change shows at once and goes through the
  write queue (so text and sliders save once they pause); a value the schema refuses (`validation.ts`'s
  `checkValue`, with the hub's wording for zod's stock refusals) stays on screen with the reason and is never sent,
  and goes back to the saved value when focus leaves the row; the server's refusal puts the saved value back and
  shows its message (a 409 re-reads the rows, to show the lock); only the latest change speaks for the row.
  "Saved" shows for `SAVED_FOR_MS`. A restart-required row's facts say "Applied" while the server runs with its
  value and "Restart to apply" once it differs (`RowView.restart`, from the hub row's `running`), or "Applies after
  restart" when the read carries no running value. `useHubKeysWhere(keys, test)` subscribes to several rows at once
  and re-renders only when the list of keys passing `test` changes; the notice and the reset use it.
- **Controls** — `controls/index.ts`'s `SETTING_CONTROLS`, one component per control kind (colour, custom, duration,
  list, multiselect, number, select, slider, text, toggle), each typed `SettingControlProps<V, C>` (`{ definition,
value, onChange, disabled, id }`; the row labels the control by `id`, `labelIdOf`/`describedByOf` in
  `controls/types.ts`); `SettingControl` renders a definition's. A control hands every change up and never saves or
  debounces itself. `select` with three options or fewer is a `SegmentedPill`, more a `Select`; number and duration
  share `NumericInput` (`fields/number`'s parse; half-typed text never reaches the setting). For a key whose schema
  takes `null` (`emptyMeaning`), the field shows null as empty with the control's `placeholder` ("No cap",
  "Forever") and clearing it hands on `null`, which the write turns into a cleared row. `custom` looks its
  definition's `component` up in `controls/custom/index.ts`'s `CUSTOM_CONTROLS` (one line per control,
  alphabetical); an unregistered one shows the value read only and logs a console error outside production.
  `controls/index.test.ts` checks every kind and every declared setting's control resolves. `image`
  (`ImageControl`) is an instance image by id, read through `GET /api/images/:id` for its thumbnail, uploaded
  through `uploadInstanceImage` (`POST /api/images/instance`, `components/uploads/upload-client.ts`), with Replace,
  Remove (clears the setting and leaves the image stored) and a notice when the id's image has been deleted (a
  404), since every reader falls back to the default for it. `ordered-list`
  reorders and shows or hides the app's own ids (`definition.control.options`), spreading each stored row so
  extra fields such as a sidebar section's `collapsed` survive a move or a toggle; an id the stored list leaves out
  is appended shown with `definition.default`'s row for it (`completeArrangedList`), the same rule `shellFrom`
  applies to every arranged list before a policy reads it; `delete-confirms` is one
  switch per kind of delete, on unless the stored partial record turns it off; `palette-aliases` edits a
  `Record<alias, command>`, validating an entry through the setting's own `z.record` (`keyType`/`valueType`)
  rather than a hard-coded command list, and offers a select when `valueType` is an enum: `palette.aliases`'
  value is `z.enum(PALETTE_PREFIX_COMMANDS)` (`@workspace/settings/groups/palette`), and `PrefixCommand.id` in
  `action-context.ts` is typed against it, with a test that the two sets are equal. A stored alias for an id the
  enum lacks fails the schema, so that row reads as absent. `key-capture` (`KeyCapture`) is the presentational
  capture control the keybindings control is built from: a focusable button that listens on its own `onKeyDown`,
  consumes every key with `preventDefault` and `stopPropagation` (so the window keymap runs nothing) except Tab,
  and hands `onCapture` one `canonicalCombo`. A bare `Escape` always cancels and is never captured; a bare letter
  `a`-`z` waits `chordWindowMs` (default `CHORD_WINDOW_MS`) for a second press to make `"<first> <second>"`, and
  the window running out captures the letter alone; anything else captures at once; a bare modifier, Caps Lock or
  dead key is ignored. Blur drops a pending letter and calls `onCancel`. It shows the pending letter as
  `ComboCaps` and announces it in an `aria-live="polite"` region; it never validates conflicts. `keybinding-map`
  (`KeybindingMapControl`) edits `keybindings.client`, choosing the commands by `definition.key`
  (`keybinding-commands.ts`'s `keyCommandsFor`): `keybindings.client` lists `COMMANDS` minus
  `LINKED_CLIENT_COMMANDS`, keyless ones included, under the command's `group` in `groupByHeading`'s order (the
  overlay's: global-scope groups first, then first-seen). A row is the label, the
  effective keys as `ComboCaps`, "Default: …" muted once overridden, and Change (an inline autofocused
  `KeyCapture`), Remove (writes `[]`) and Reset (only when overridden). A capture replaces the command's keys with
  the one combo: `checkBinding` runs first and a refusal shows as `refusalText` in a `role="alert"` under the row,
  writes nothing and leaves the capture open until another key or a cancel; Remove on a reserved command is
  refused the same way. Writes go up through `onChange` as the whole record, and `withKeys`/`withoutOverride`
  drop an entry that equals the command's defaults as a set. Ids in the record that name no command are listed
  last as "Unknown commands" with their caps and a Remove; clashes already in the stored value (`conflicts`) show
  as `role="status"` notes on the affected rows and block nothing. "Reset all to defaults" (only while the record
  is non-empty) writes `{}` after a `ConfirmDeleteDialog`. `disabled` renders the map with no actions. `lab-speed-range` and
  `lab-pitch-range` (one `lab-range-control.tsx`) are a two-thumb `Slider` inside `SPEED_*`/`PITCH_*`, the
  rack default (`RACK_DEFAULT`, `{ rack: true }`, from `@workspace/settings/groups/lab`) shown as the whole
  range with a Reset that writes it back. `lab-compressor`, `lab-reverb` and `lab-eq` edit a rack
  part's default from the Lab's own pieces (`RackSliderRow`, `RackComp`'s `ROWS`, `RackReverb`'s `PRESETS`,
  `EqCurveOverlay`, `RackBand`), the rack default shown as `DEFAULT_LAB.rack.<part>` marked "Rack default" and Reset writing
  it back; the first edit writes the whole part. `from-settings.ts` maps the rack default to the Lab's own
  bounds and rack parts, so the policies never see it. They use a bare `TogglePill` for `on`, not `RackModule`, whose rows unmount while
  the part is off. `table-columns`, `table-sort` and `table-grouping` (`tables.<kind>Columns/Sort/Grouping`)
  each derive `kind` from `definition.key` (`table-kind.ts`'s `tableKindOf`) and call
  `entityTable(kind).useParts(emptyTableCtx(kind, useHub().projectId))` — an empty context (no rows, no custom
  fields even inside a project, so the pickers offer built-in columns only) — for `parts.columns` and
  `parts.groupByOptions`. `table-columns` is one switch per hideable column (`enableHiding !== false`),
  ungrouped first then each `meta.group`'s, writing the full `Record<id, boolean>` (a missing id is visible, as
  `DataTable`'s own `initiallyHiddenColumns` reads it); `table-sort` and `table-grouping` are a "pick one column
  or None" menu mirroring the toolbar's own (`GroupByMenu`), `table-sort` writing a single `` `${id}.${asc|desc}` ``
  pair (the setting takes no multi-sort) with a direction toggle beside it. `table-default-views`
  (`tables.defaultSavedView`) shows each kind's current default by name, fetched with `actions/saved-views.ts`'s
  `getSavedViews(projectId, kind)`, with a Clear per kind through `clearDefaultSavedView`; off a project page it
  shows "Open a project's settings to see its defaults." instead, no picker. `project-status` is a single
  select of the project's statuses, fetched once with `actions/statuses.ts`'s `getStatuses(projectId)`, with a
  notice when the stored id's status has been deleted. `project-labels` is a multi-select of the project's
  labels, fetched once with `actions/labels.ts`'s `getLabels(projectId)`; an id the project no longer has is
  listed on its own with a way to remove it, rather than dropped from the value. Both read the project id off
  `useProject()`.
- **Panes** — `panes/index.ts`'s `HUB_PANES`, one line per pane, alphabetical, nothing else in the file; a pane is
  `{ id, section, label, order, minRole?, Content }` (`panes/types.ts`; `minRole` counts in the Project section).
  A pane is a page of its own in its section (`/settings/<section>/<id>`, the id after the project's), listed in the
  nav with the groups; Devices, whose URL has no segment, stacks its panes on its one page. `Content` is a server
  component taking `{ project, searchParams }`. The Project section's panes are Statuses, Labels, Priorities (25),
  Fields (27), Images, Assets, Members (orders 10 to 50, any member) and Danger
  zone (60, the owner); the Project section's groups (`packages.md`, Groups, Project groups) order from 70, after
  every pane, so the section still opens on Statuses. Fields is two `ColourList`s, Tracks and
  Collections, of `CustomFieldItem` rows (`components/settings/SettingsFields.tsx`): up/down buttons and a
  `@dnd-kit/sortable` drag handle reorder a kind's fields, each move sending every id of that kind once through
  `PUT .../fields/order`; `CustomFieldForm` adds or renames a field and, for `select`, opens `FieldOptionsEditor`
  (a select's options, up/down only, no drag); a field's type is fixed after creation, so an edit shows it as text
  with why. `DeleteFieldDialog` names how many values a field's delete would lose, or asks plainly at zero.
  The Instance section's are Users, Machines and Storage and About (20, 25, 30 and 40, after its Access group); the
  Devices section's one pane is Machines (100). Orders leave gaps so a pane slots in between two without
  renumbering; `panes/index.test.ts` checks the order each role sees. What each loads is Data loading pattern →
  Settings panes.
- **Devices → Machines** (`panes/DevicesPane.tsx`, pane `devices`, URL `/settings/devices`) — the caller's machines.
  The pane reads `getMyMachines()` (`GET /api/machines`, via `lib/shared-reads.ts`'s `myMachines`) for the first
  render and hands it to `devices/MachinesSection`, which keeps it current with `devices/machine-poll.ts`'s
  `createMachinePoll` (a generic list poll: every 30 s while the page is visible, at once on show, and on
  `onInvalidated("machines")`, never two reads at a time; `useMachinePoll` in the section wires it to
  `clientGetMyMachines`). A list that could not be read says so and reads again at the next poll. Under a
  `Machines` head with the count: the user's "Not a bounce" files, once and first, as a `RejectionList` (the files
  are the user's and shared by every machine; each entry is the file name, else its fingerprint, with a Remove named
  "Remove <file> from Not a bounce"), then one `MachineRow` per machine as a hairline `Row` (`<li
id="machine-<id>">`, `lib/settings/href.ts`'s `machineAnchor`): the name, a facts line in `LABEL` caps (platform,
  `dit <version>`, `online` in full ink, else "Last seen <relative>"), "Open: <set>" when a set is open on it, its
  "Never here" folders as a `RejectionList`, and the repos it has pushed ("Pushed") as links to their pages
  (`hrefFromParsedRoute` with the repo's own project). Remove is a ghost button named "Remove <machine>" behind a
  `useDeleteGate("machine", …)` confirm ("Remove Studio Mac?" / "It's signed out of dit; its saves and commits
  stay."); removing a rejection asks nothing. Both go through `lib/machine-mutations.ts`
  (`removeMachine`, `forgetRejection`: `DELETE /api/machines/:id` and `/api/machines/rejections/:id`, each
  invalidating `"machines"`) and `devices/use-machine-mutation.ts`, which toasts the outcome. A user with no
  machine sees "No machines yet. Install dit on the Mac you make music on." and the download link
  (`DIT_PAGE_URL`, the site's `/dit/` page; `DeepLinkFallbackDialog` links to `DESKTOP_APP_DOWNLOAD_URL`).
- **Instance → Machines** (`panes/MachinesPane.tsx`, order 25, `/settings/instance/machines`) — every account's
  machines for the instance admin, read-only: `getAdminMachines(page, 20)` (`GET /api/admin/machines`) into
  `components/admin/AdminMachinesTable` (Owner, Machine, Platform, Version, Last seen; `PageLinks` over `total`).
- **Search and nav** — `HubShell` puts `HubSearchField` and `HubNav` in a sticky column beside the page (stacked
  above it on a phone, where the nav is `SettingsTabNav`: the sections, then the current section's entries when it
  has a pane). While the box holds a query, `HubSearchResults` stands in for the page (kept alive under
  `<Activity>`): `search.ts`'s `searchSettings` matches every word against a setting's label, description and
  keywords, and the matches render as live rows under their group and section, or "No settings match" with a
  way to clear it. On arrival the shell scrolls to the `#<key>` row (marking it for a moment) or the group the URL
  names; a `#machine-<id>` hash names a machine's row on the Devices page (`data-machine-row`), which it also
  focuses (the row is `tabIndex={-1}`), so a keyboard or screen reader user lands on the machine.
- **Settings file, group reset and recent changes** — `SectionPage` takes what a section adds to its registry
  groups from `SECTION_EXTRAS` (`HubPage.tsx`): an action beside each group's label and what ends the page. Personal
  ends with `export/PersonalFooter`: `ExportButton` downloads `GET /api/settings/user/:id/export` (the user's own
  rows, not effective values) as `projammr-settings-<YYYY-MM-DD>.json` through `lib/download.ts`; `ImportFlow` reads
  the chosen file, asks `POST …/import?dryRun=true`, and `ImportPreview` shows the answer against the page's rows
  (changes as `from → to`, keys already the same, skipped keys with their reason), then Import posts the real import
  and awaits `store.reread()` and `refresh()` before the toast. Every failure stays in the dialog: not JSON, a 400
  (not an export, or a `version` it does not read), a dry run or an import that failed (a server refusal changed
  nothing; no answer at all may have landed, so the rows are read again), and an import that applied a different set
  than the preview (a lock between the two) lists the difference. `ResetGroupButton` sits on each Personal group's
  head, and on each advanced Instance group's (`HubPage`'s `SECTION_EXTRAS[…].groupAction`), while the group holds
  a value at the scope its rows write: after a confirm that says what each value goes back to at that scope, one
  write of `null` for every key in the group (a locked key's inert row goes too; the server lets a clearing write
  through any lock), then `store.landed`. Instance, and Project for its owner and admins, end with `audit/RecentChanges`: folded until opened,
  then `GET /api/settings/audit` a page of 20 at a time (`before` the last id shown), each change as actor · setting ·
  `from → to` or "locked"/"unlocked" · relative time in the `Chronology` rows `ActivityList` also uses. Values read
  through `format.ts`'s `formatSettingValue` (by control kind; a key the registry no longer knows prints raw) and
  `ValueChange`, cut to 40 characters or "<n> items" with the whole in the title.

## Components (`src/components/`)

Feature folders: `activity`, `art` (ArtProvider — `"use client"`, the page's `ArrivalRoot`
(`@workspace/ui/components/motion/arrival`) and, since it is the element the page scrolls in, the
`CanvasRootProvider` its children read and the `CanvasScrollProvider` that publishes its offset;
takes an optional `playing: PlaybackOwner` and renders
`PlayingLight` (also the room's breath: live loudness → the art tone layer's inline `opacity` and the deep
wash lobe's opacity while the page's own record plays), ArtSwatch, MastheadArt, PageWash, `playing-light.ts` pure `belongsTo`/`playbackState`),
`attachments`, `auth`,
`collection`, `command-palette`, `commands` (the command registry; see Command palette and Hotkeys below),
`comments`, `copy-text` (`CopyTextProvider`/`useCopyText`), `dock`, `editing`,
`forms`, `home` (HomeProjectList, the "/" project
list), `hotkeys` (`ShortcutsOverlay`, `combo-format.ts`; the registry itself lives in `commands/`), `layout` (Breadcrumbs,
RightSideBlur, `shell.ts`), `loudness`, `masthead`, `motion` (`ArtMorph.tsx` view transitions —
`MastheadArtMorph` is a stable `masthead-art` frame that a running-order step cross-fades on,
`MastheadMorph`/`RailMorph` hold the header and rail above the art; `TrackRunningOrder` links add
`morph-keys.ts`'s `STEP_NEXT`/`STEP_PREV` transition types. `canvas-scroll.tsx`'s
`CanvasScrollProvider` runs `useScroll` on the enclosing `CanvasRootProvider`'s element and publishes `scrollY` through
`useCanvasScroll()`; `masthead-scroll.ts` holds the recession tables `MASTHEAD_SCROLL` /
`MASTHEAD_SCROLL_PHONE` (per part: `end` in px plus the `opacity`, `scale` and `y` pairs it travels),
the pure `scrolled(offset, end, pair)` and `mastheadScroll(phone)` behind them, and
`useMastheadScroll(part)`, the `style` the art, scrim, crumbs and head bind — `undefined` until the
arrival has settled, so the entrance and the scroll never write the same property at once),
`music-player`, `navigation` (`AppLink`, the one link component the client uses — wraps `next/link`,
forwarding every prop untouched, and marks itself `data-pending` via `useLinkStatus` so `link-pending`
(`packages/ui/src/styles/globals.css`) can fade and pulse its content while a navigation it started is
still in flight), `notebook`,
`product-linking`, `project`, `pwa` (`ServiceWorkerRegistration` registers `/sw.js` in production only with
`{ scope: "/", updateViaCache: "none" }`; `OfflineBanner` reads `useOffline` — both render in the **root**
layout so signed-out and share pages get them too), `session`, `settings`, `settings-hub` (the `/settings` hub; see
Settings → The hub), `share` (public page), `sharing` (owner
UI), `sidebar`, `spectrum`, `status`, `tables`, `theme` (`AppThemeProvider`, `useTheme`; see Settings → The
theme), `track`, `track-audio`, `uploads`, `work-heatmap`; one loose file,
`CopyButton.tsx` (copy icon button with 1.5 s check state, over `useCopied`).

**Copy with a manual fallback** (`copy-text/`, `lib/copy-text.ts`): `lib/copy-text.ts` `copyText(value):
Promise<boolean>` tries `navigator.clipboard.writeText`, then a hidden-textarea `document.execCommand("copy")`
— the case that matters is a plain `http://` origin (a LAN address), where `navigator.clipboard` is undefined or
rejects because the page has no secure context. `CopyTextProvider` (mounted once in `(app)/layout.tsx`) wraps
that in a `copy(value, { success? })` shared through context; `useCopyText()` reads it. When both copy paths
fail, the provider opens a dialog with the value pre-selected in a read-only input instead of an error toast, so
the user can select and copy it by hand. Every link copy goes through this — `CopyButton`, the row menu's
`onCopyLink`, `SettingsMembers`'s `copyInviteLink` — except the spreadsheet TSV copy (`use-cell-clipboard.ts`)
and the note-text copy (`notebook/copy-note-text.ts`), which have their own gesture constraints and stay on
`navigator.clipboard` directly.

**Page frame.** `layout/shell.ts` exports `CANVAS` (the scroll container: named-area grid `head/rail` over
`body/rail`, `stack:` collapses to `head`→`rail`→`body`; `overscroll-y-contain pb-(--dock)`), `MASTHEAD_AREA`,
`BODY`, `SPLIT` (notes beside artwork). `COLUMN`, `PAGE`, `PAGE_WIDE`, `EYEBROW`, `SIDEBAR_EYEBROW`,
`SECTION_TITLE`, `CAPPED_CHILDREN`, `SCROLL`, `REVEAL_ON_HOVER` live in `@workspace/ui/lib/shell`. `Masthead`
(accepts `className`; renders `children` after `byline` inside the one element `useMastheadScroll("head")`
binds, so a row placed there recedes with the byline and needs no scroll or arrival wiring of its own — the
collection page's hero `PlayAffordance` sits there), `RightSideBlur` (`RailColumn` > `Rail`; `more={<>…</>}` holds the tail `RailMore` folds
on phones; `RailBlock`s are direct children), `packages/ui/src/components/layout/rail.tsx` (`RailIdentity`,
`RailBlock`, `RailLabel`; the `rail-seam:` variant divides consecutive blocks, so a fragment around a pair of
blocks is transparent to it),
`MetadataItem` (`pending` = quiet italic), `Breadcrumbs` (renders a `Crumb[]` — `{label, href}` a caller already
built, never derived from the pathname; takes its left edge from its container — `PageHead`'s column, or the
`COLUMN` `Masthead` wraps it in — so it lines up with the `h1`), `masthead/NowPlayingFlag` (client leaf in the
byline; `StatusChip flag colour="var(--art)"` reading `Playing`/`Paused` for a track page's own audio, or
`Playing · <track>` linking into the collection for a collection page; renders nothing when the player holds
something else).

**Editing** (`editing/`): `Description` (BlockNote via `next/dynamic` ssr:false, document in a ref, 1.5 s
debounced `saveRichText`, unmount flush; `variant="lyrics"` reads `LyricsContext`), `InlineTitleEditor` (masthead
h1) and `InlinePropertyEditor` (rail scalar fields, optional copy/hint; a member below editor, or a render outside a
project route, gets the value as plain text with a read-only `CheckboxDisplay` for a checkbox) on `hooks/use-inline-edit.ts` +
`InlineEditActions` (✓/✕ pair). `LyricsProvider` supplies `browserLyricsDictionary` (`lib/lyrics-dictionary.ts`:
batched `POST /api/lyrics/analyze` with module-level caches, memoised rhymes/synonyms with abort) and the caller's
`editor.rhymePrefix`/`editor.synonymPrefix` through `useSetting`, so it mounts under a `SettingsProvider` and takes
no props (never import the `"use client"` context module from a server component).

**Status** (`status/`): `StatusDisplay` (title/icon-title/chip variants), `StatusDropdown` (`useOptimistic`,
detail pages), `StatusCell` (table cell, plain `onSave`), `components/StatusMenu.tsx` (shared pipeline-ordered
list, `StatusNote` portalled hover panel, `useHoveredStatus`). Chip
shapes: `packages/ui` `status-chip.tsx` (`StatusPill`/`StatusChip`). `tables/Priority.tsx`: `PriorityBadge`
(a `PriorityLevel`, `{ id, name, colour, rank }`, as a tinted flag `StatusChip` in the level's own colour; every
level alike, the default included) and `priorityFilterColumn(levels)` (the priority filter every table kind
offers: `multiple` and `listed`, so several levels sit in one `priority=3,7` param). The track table's own `relation` filter column (`entities/track/table.tsx`) is built the same way
from its `relationTypes` prop (the project's own list, `getRelationTypes`): "Has any relation" plus one option
per type. `StatusDropdown`'s `targetKind`
is `StatusKind` (`entities/index.ts`), the `EntityKind`s whose module declares `hasStatus: true` (track and
collection); it writes through `patchField(targetKind, targetId, "statusId", picked.id)`, the same generic
`PATCH /api/{kind}/{id}` route any other field uses, not a per-kind PUT route.

**Comments** (`comments/`): `CommentSection` (RSC) → `CommentList` + `CommentCompose` on `compose-ui.tsx`
primitives (`Compose`, `ComposeField`, `ComposeInput`, `ComposeFoot`, `ComposeHint`, `Stamp`). Reads/writes go
through `comment-backend.tsx`'s `CommentBackend` (`useCommentBackend`/`CommentBackendProvider`) so the same
components serve project pages (default) and share pages (`shareCommentBackend`, token-scoped). `viewerId` only
gates replying (`canReply`: `null` = read-only). Edit/Delete and Resolve are the server's answer, carried on every
comment and reply as `viewerCan: { amend, resolve }`: `canAmend(backend, comment)` returns `amend`, and
`canResolve(backend, comment)` returns `resolve` when the backend also defines its optional `resolve`/`reopen`
(the project backend does, the share backend does not, so share pages show the state and never the control).
`CommentList`'s `CommentItem` is the one render path for a comment row on every surface (project pages, the audio
panel, the share page). A root row with `canResolve` gets a `Resolve`/`Reopen` button (the verb carries the state, so no `aria-pressed`) in
`COMMENT_ACTIONS`; a failed toggle is a `toast.error` and leaves the row as it was. Delete goes through the
`comment` delete gate: "Delete this comment?" (or "…reply?"), saying the replies go with a root that has them; on
the share page, with no policies provider, it always asks. `AudioCommentSection` starts a new comment pinned to the
playhead when the shell policy's `audioCommentPinned` holds and its audio is the one loaded. A resolved thread's author
names go to `text-ink-soft` (replies take it from a `parentResolved` prop) and the root row gains a `<span>` chip
on `compose-ui.tsx`'s `STAMP_SHAPE`, `Resolved · <resolver or "Unknown"> · <relative time>`. `ActivityFeed` (RSC)
owns the read (`getProjectActivity` with `limit` default 15, folding to `null` on error or no rows) and the
`CollapsibleSection` around the list. The rows are `ActivityList.tsx`, which the project page's
`RecentActivitySection` renders too: create/update/delete/comment/resolve/reopen rows with before→after diffs,
hiding `notes`/`description`/timestamps, through the pure row-text helpers `headline`/`detail`. `ActivityList`'s
`ACTION_VERB` is an exhaustive `Record` over the generated action enum, so a new server action fails the client
typecheck until it has a verb. A `statusId` or `priorityId` change prints the status or level name from the
`vocabularies` prop (`ActivityVocabularies`), which both callers read through `activity-vocabularies.ts`
`loadActivityVocabularies(projectId)` in parallel with the activity; an id the vocabulary no longer has prints as
the id. Its rows are `Chronology.tsx`'s `Chronology`/`ChronologyEntry` (the hairline list, one event a line, a
relative `<time>` at the right with the full date in its title), which the settings hub's "Recent changes" shares.

**Tables** — TanStack Table **v9** (`useTable({features…}, s => s)`, `createColumnHelper`, `<table.FlexRender/>`,
`cellSelectionFeature`); config in `packages/ui/src/lib/table-config.ts`, bound once in
`tables/data-table-hook.ts` (`createTableHook`: `useAppTable`, `useTableContext`, `createAppColumnHelper`; the one
registered cell component is `PeekHandle`). `table-hook-contexts.ts` holds the table, cell and header contexts
(`useCellContext`, `useHeaderContext`) that a module the factory imports reads without importing the factory back.

The table is a compound. `tables/DataTable.tsx` (`DataTable<TData, TChild>`, client) is the root: it takes the data,
the columns and the config props, and renders its `children`, the parts, which are its static properties
(`DataTable.Toolbar`, `.SavedViews`, `.Cards`, `.Grid`, `.Paging`, `.Selection`, `.Peek`, `.Move`). A caller
composes the parts it wants, in the order it wants them: `EntityTable` renders all eight (`EntityTableLayout`),
`AssetsTable` renders `Toolbar`, `Grid`, `Paging` and `Selection` only. `DataTableProps` is defined in full in
`generic-table-types.ts`, `urlState`, `hotkeys`, `peek.inUrl` and `children` included, and re-exported from
`DataTable.tsx`. The root owns the table (`useAppTable`, with the disclosure and selection columns from
`leading-columns.tsx` prepended), the loaded window (below), the state the parts share and the one delete dialog,
and it withholds every write affordance from a viewer.

`useTableContext()` (`data-table-hook.ts`, provided by `table.AppTable`) is the TanStack table itself; everything
else the root derives reaches its parts through two contexts in `data-table-context.tsx`, both set by one
`DataTableProvider config state`:

- **`DataTableConfigContext`** (`DataTableConfigValue`, read with `useDataTableConfig()`): what holds still while
  the table is used. The held table, `data` (the loaded window's rows), `urlState`, `ownsUrl`, `serverDriven`,
  `totalRows`,
  `topLevelRows`, `sections`, the column and feature config from props, the bulk and cell-save handlers,
  `cellGrid`, `gridRef`, `gridHandlers`, and every setter of hot state (`setPeekId`, `setRenaming`,
  `requestDelete` (the delete gate's stable `request`), `setMoveTarget`, `setSelectMode`, `setSelectAllMatching`,
  `clearSelection`,
  `exitSelectMode`). A setter lives here because it never changes, so a part that only writes hot state does not
  re-render on it. `scrollToIndex` is a `RefObject<((index: number) => void) | null>`, created once with `useRef`
  in the root: `GridSections` assigns `.current` in an effect once its virtualiser exists and clears it on
  unmount, so a caller that walks past the loaded window (the row cursor, peek, the cell grid) can scroll to a
  row index — a row's position in `pageRows`, the same order `topLevelRows` and the loaded window use — without
  reaching for the virtualiser itself; `GridSections` maps it to its own flattened item index internally (a
  group's header is one of that list's slots too).
- **`DataTableStateContext`** (`DataTableStateValue`, read with `useDataTableState()`): what changes as the table
  is used. `cursorRowId`, `peekId`, `expanded`, `selectedIds`, `selectAllMatching`, `canSelectAllMatching`,
  `bulkSelection`, `renaming`, `draft`, `selectMode`, `moveTarget`, and the loaded window's
  `loaded: { count, hasMore, state }` with its `loadMore`, `ensureLoaded` and `retryLoad` (stable, beside the
  state they change). The context's `ensureLoaded` is not `use-loaded-window.ts`'s own: `DataTable.tsx` wraps
  it into a row-model-indexed version (an index into `table.getRowModel().rows`, the shape the row cursor,
  peek and paste all reason in) before putting it on the context — see "The loaded window" below.

`useDataTable()` returns both merged (`DataTableContextValue`) for a part that reads both; it re-renders on
either. Each hook throws outside a provider. The root builds each half with one `useMemo` over its members (the
deps list is the lint-checked member list), so every member must itself be stable: `useDraft`, `useCellGrid`,
`useRowCursor`'s `gridHandlers`, `useTableViewState`'s `view` and `useLoadedWindow`'s `loaded` all return
memoised values, and the window's loaders keep their identity for the table's life. The table is
`useHeldTable` (`data-table-hook.ts`): `useAppTable` returns a fresh object every render because its options are
rebuilt, so the root holds one until `table.state`, `columns` or `data` changes. The root's selector
(`selectRootTableState`, typed `DataTableInstance<TData>`) leaves `rowSelection` out of `table.state`, since
selection is the root's own React state, so a tick does not change the held table.

**Where rows and scrolling come from.** A table's first page reaches it as RSC props: the server component
(`modules/entity-list/index.tsx` `EntityListTable`, or an entity page's `get<Kind>sPageForProject` promise) awaits
a `"use server"` action and always requests page 1 — `TableSearchParams` carries no `page` — and hands it to
`EntityTable`, which seeds the root's loaded window (below); every further page comes through `serverPage.load`,
which runs in the browser (`lib/browser-api.ts` `browserApi`), and a mutation's `router.refresh()` hands the root
new props, which refetch the window. `entity-table-props.ts`'s `assembleEntityTableProps` builds `load` for both
page and embedded tables inside the same `useMemo` chain that assembles the rest of the props, from the kind's
`ENTITY_API[kind].page` (`entities/api.ts`) and its definition's `pageQuery` (each kind's own `pageQueryOf`,
`entities/<kind>/api.ts`; a scoped table's own id wins over the view's own filter of the same kind, e.g. a
track table's `scope.collectionId` over `view.collection`), throwing on an `ActionError` so the root's retry line
shows. `AssetsTable.tsx` builds its own `load` the same way, over `lib/asset-queries.ts`'s `getAssetsPage` (the
browser twin of `actions/assets.ts`'s `getAssetsForProject`). An embedded table (tracks on a collection page,
sessions on a track page) passes `rowCount` with no URL source, so its view reaches the server only through
`load`, exactly as a page table's does. The document never scrolls: `<body>` is `flex h-dvh`, list pages scroll inside
`ScrollRoot` and entity pages inside `ArtProvider`'s canvas, both published by `useCanvasRoot()`
(`@workspace/ui/components/layout/scroll-root`), and scroll restoration is the app's own `useScrollRestoration`.
The grid is a real `<table table-fixed>` with sticky `th`, a sticky pinned `td` and `colSpan` group headers, and
every DOM reach in the grid (`cellSelector`, `focusCellElement`, the cursor's `scrollIntoView`) is a
`querySelector` inside `gridRef`, so a row that is not mounted silently no-ops.

**The state source decides who owns the URL.** A root given `urlState` (built with `DataTable.tsx`'s
`usePageTableState(serverPage)`, which makes the source navigate exactly when the root is server-driven, so a
caller never derives `navigate` itself) owns the page URL: its view state travels there (`ownsUrl`), and with a
`serverPage` the server filters and sorts its rows (`serverDriven`: the manual filtering and sorting flags). A
root given none keeps the same state in React (`use-table-local-state.ts` `useTableLocalState`), so the parts
read one shape either way, and filters and sorts the rows it has loaded itself. `useTableUrlState` debounces a
search-box write to the URL (`SEARCH_DEBOUNCE_MS`, 300ms in server-owned mode, where that write is what
navigates and refetches; 150ms otherwise); `useTableLocalState` has no URL to debounce, so it debounces the
search term its own `viewParams` reports on the same `SEARCH_DEBOUNCE_MS` instead — the input still reads the
live value, only the view `serverPage.load` sees lags behind it, or an embedded table would fire one `load` per
keystroke.
`serverPage` carries a `load: (page, view) => Promise<PageResult<TData>>` (`generic-table-types.ts`
`PageResult<TData> = { rows; rowCount; pageSize }`), which the loaded window calls to append and refetch
pages; the client never hard-codes a page size, it reads `pageSize` back from the envelope `load` resolves.
`hotkeys="page"` pushes the `commands/tables.ts` `TABLE_SCOPE` from mount, for the table that is the page; `"focus"`
(the default) pushes it only while the pointer or focus is in the grid — every table pushes the same scope, and
the innermost push (the one pointed at or focused last) is the one its commands see. `peek.inUrl` mirrors the open row into the
`peek` query param (`use-peek-row.ts` `usePeekRow`). A page's own table passes all three (`EntityTable`'s
`PageEntityTable`, `AssetsTable`); a table sharing the page with another (`EmbeddedEntityTable`) passes none. The
toolbar offers filter menus, grouping and saved views only under `ownsUrl`, and `SavedViews` renders nothing
without it, a view being a URL query.

**The loaded window.** `use-loaded-window.ts` `useLoadedWindow`, called once by the root, holds the rows the
table has loaded; they are `data` to every part. The `data` prop seeds page 1. With no `serverPage` the window
is the prop and never grows: `hasMore` is false and the grid renders every row, there being no client-side
paging. With a `serverPage`:

- `loadMore()` fetches page `pages + 1` through `serverPage.load(page, urlState.viewParams())` and merges it by
  id: a loaded id keeps its position and takes the new row's fields, a new id is appended. A call while a page
  loads returns that page's promise. A failed page sets `loaded.state` to `"error"`, after which `loadMore`
  does nothing until `retryLoad()` fetches the page again.
- `ensureLoaded(index)` loads until row `index` of `data` — the window, not the row model — exists (`true`), or
  resolves `false` once nothing more exists, a page fails or the view changes. `DataTable.tsx` wraps this into
  the row-model-indexed `ensureLoaded` the context exposes (below), since a locally filtered table's row model
  can be shorter than the window: the wrapper loops this one, passing it the window's own current length each
  time, until the target index exists in `table.getRowModel().rows` or the window truly has no more to give it.
- A new `data` prop under the same view is the server's data changing (a mutation's `router.refresh()`): every
  loaded page is refetched in parallel and replaces the window. When the window holds only page 1 and the prop
  is page 1 of the window's view, the prop replaces it with no fetch; that is always so for a URL table, whose
  props the server renders for the URL's view, and for an embedded table only on the view it mounted with. A
  failed refetch keeps the window and toasts "Couldn't refresh the table". A `rowCount` fallen below the window
  leaves `hasMore` false and the window what the refetch returned.
- A view change resets the window to the `data` prop as page 1 and drops anything in flight; an embedded table
  then refetches page 1 for its new view. The view's key is `JSON.stringify(viewParams())` (search, sort,
  filters, grouping), so a layout change (visibility, order, sizes) keeps the window. A URL table's new props
  arrive once its navigation lands and replace page 1 as above.
- A window holding another view's rows is `pending` and is never paged: a URL table while its view differs from
  the view its `data` prop was rendered for, and an embedded table from its view change until the page-1 refetch
  succeeds, staying unpaged if that refetch fails. A view change also clears the in-flight append, so the next
  `loadMore` starts afresh.
- A URL table's prop's view is `locationViewParams()` read in a layout effect after the commit that delivered it
  (or mounted the table), never during render: Next writes a navigation's URL in an insertion effect, so a render
  still sees the previous URL. The next render records it (`located`). A view the first render adopts from the
  URL, a search typed and cleared within its debounce, or a return to the view of rows that landed after the view
  moved on (a late navigation, browser back) therefore pages at once, with no navigation needed.
- An append in flight when a refetch starts does not land: it runs again on the refetched window once the
  refetch settles. Each refetch and view change bumps the window's generation, and a response requested under
  an older one is dropped.
- `hasMore` is false on a `pending` window, and otherwise page arithmetic, `pages × pageSize < rowCount`, so rows that shift between pages cannot keep it
  true with every page fetched. `pageSize` is the one the last `load` returned, and the `data` prop's length
  before any.
- While a grouping is active (`grouped`, passed by the root) `hasMore` is false and `loadMore`/`ensureLoaded`
  load nothing: a grouped response is each group's preview, and the server answers every page with the same one.
  The row cursor, peek, the cell grid and paste all stop at the window's end there.
- `loadMore`, `ensureLoaded` and `retryLoad` settle once what they loaded has committed, so a caller can scroll
  to the row as soon as they resolve.

The optimistic cell writes (`setData`) edit the window's rows, and the root prunes the selection to the window's
ids whenever its rows change. `totalRows` is the window's `rowCount` for a table with a `serverPage`, else the
table's own filtered count of top-level rows. The header checkbox ("Select all loaded rows") ticks every loaded
row, and "select all N" is offered once they are all ticked and the server matches more.

The parts, each in `tables/parts/`:

- `Toolbar.tsx`: a desktop row of search, filter, group, saved-view and column menus and a phone row of search and a
  "Filter" button; both are always rendered and CSS shows one. Its `children` sit between group-by and the column
  menu. `cards/FilterSheet.tsx` is the sheet the button opens, loaded with `next/dynamic` (`ssr: false`) behind the
  `filterSheetLoaded` latch.
- `SavedViews.tsx`: the saved-views picker, placed inside `Toolbar`.
- `Cards.tsx`: the rows as the phone's stacked list (`cards/`). The root decides when it replaces the grid
  (`showCards`: a phone with `cards` and `peek` configured) and owns select mode.
- `Grid.tsx`: the keyboard, paste and pointer wrapper around the header, the pinned column and the body
  (`GridSections.tsx`, one `GridRow.tsx` per row), then the draft toggle and the empty state. The wrapper and table
  are withheld on the card tier. `GridRow` is `memo`ed and reads only the config half; `GridSections` reads each
  half separately (`useDataTableConfig()`/`useDataTableState()`) and hands each row `isCursor`, `isPeeked`,
  `settling`, `selected` (`row.getIsSelected()`) and `selectedIds` (the selection while the row is ticked, else a
  shared empty list, since a ticked row's actions act on the whole selection). A cursor move, a peek or a tick
  re-renders only the rows whose props change; anything drawn through the table (columns, sizes, order, the cell
  grid's selection, editing) changes the config half and re-renders every row. `PeekHandle` reads `peekId` from
  the state half itself. `Grid.tsx`'s `role="grid"` table carries `aria-rowcount` (the flattened item count plus
  the header row: a group's header counts as one of its own) and its header `tr` `aria-rowindex={1}`; `GridRow`
  carries `aria-rowindex`/`data-index` off the flattened index `GridSections` hands it as a prop, and
  `aria-colindex` per cell, the pinned actions cell taking the next one. `tables.rowClick` (config half:
  `rowClick`, `openRow`) decides what a peekable top-level row's click does: `peek` (default) `setPeekId`s it as
  today, `open` calls `openRow(row.original)` — `router.push(peek.href(row.original))`, the same href
  `use-row-cursor.ts`'s `open` move (Enter) already takes. Read once in `DataTable.tsx`, not per row; a table with
  no `peek` is unaffected either way.

  **`GridSections` is virtualised** (`@tanstack/react-virtual`): it flattens
  grouped mode's sections (a header, then its own rows, each one item) or the ungrouped page's rows into one list
  and indexes it with `useVirtualizer`, scrolling the element `useCanvasRoot()` publishes (never `window`). The
  grid is a real `table-fixed` table with sticky cells and `colSpan` group headers, so TanStack's usual absolute
  row positioning is out: the window's items render as ordinary `<tr>`s in document flow, with one `aria-hidden`
  spacer `<tr>` above and below holding the skipped items' combined height (rendered only when that height is
  non-zero). `estimateSize` is a flat guess; each row and header carries the virtualiser's own `measureElement` as
  its `ref` (stable, so it costs a row no re-render) to correct it. `scrollMargin` is measured from `gridRef` and
  the scroll root once both exist, to place the tbody's own offset (the toolbar and the sticky header above it)
  in the virtualiser's coordinate system. `useCanvasRoot()` returning `undefined` (a test, or a page that embeds
  the table with no scroll root) renders every row unwindowed instead, with no sentinel and no loading strip.

  A section's seeded draft row (`SeededDraftRow`) is not one of the flattened items — closed, an
  `AnimatePresence` with nothing to show costs nothing, so it renders beside its header outside the window rather
  than costing every row after it a measured slot it only occasionally needs. The ungrouped toggle's draft row
  (`DraftTableRow`) is pinned outside the window entirely, the last thing in `LayoutGroup`, so it is never
  virtualised away while focused.

  Past the bottom spacer, ungrouped only, a sentinel effect calls `loadMore()` once the last virtual item's index
  is within `OVERSCAN` (10) of the flattened list's end, `loaded.hasMore` and `loaded.state === "idle"`; grouped
  mode never calls it, a grouped response being a per-group preview rather than a page. While `loaded.state` is
  `"loading"`, five `aria-hidden` skeleton rows follow; on `"error"`, one row reads "Couldn't load more rows"
  with a Retry button calling `retryLoad()`.

  A ref (`canvasRoot`, an ancestor's) is attached during the same commit's layout phase as `GridSections`'s own
  layout effects, so the very first render can still find no scroll element; a `useEffect` that fires once on
  mount forces exactly one extra render once every ref in the tree is guaranteed attached, for the virtualiser to
  see it on. A test needs its own fixed sizes: happy-dom does no layout, so a scroll element with a stubbed
  `offsetHeight`/`clientHeight` (`CanvasRootProvider` from `@workspace/ui/components/layout/scroll-root`) and
  rows with a stubbed `HTMLTableRowElement.prototype.offsetHeight` stand in for it — see the `"GridSections
virtualised"` describe block in `GridSections.test.tsx`. A `serverPage.load`'s actual call lands one render
  after the `loading` state does (`loadMore`/`retryLoad` only call it past their first `await`), so a test needs
  its own `await act(async () => {})` after triggering one, not just after the render that starts it.

- `Paging.tsx`: the row count line under the rows, `totalRows`, with the number of groups while grouped.
- `Selection.tsx`: the bulk actions bar over the root's selection state.
- `Peek.tsx`: the peek panel; nothing without a `peek` config.
- `Move.tsx`: the move-to-project dialog for the row a row action chose.
- `Draft.tsx`: not a part but the draft row's pieces: `useDraft()` (called once by the root; the toggle, the draft
  rows and the section headers share the `draft` slices), `Draft`, `DraftTableRow`, `SeededDraftRow`, `sectionSeed`.
  A `NewRowConfig`'s `defaults` (raw drafts by column id) are what a draft row starts with, shown and editable and
  sent unless cleared; a group seed still wins for its field and locks it. The track and collection tables fill
  `defaults` from the project's `project-defaults.*` settings (a status the project no longer has is left blank,
  through `defaultStatusRaw`), and `TrackForm`/`CollectionForm` start a new entity from the same settings.

`PeekPanel` (`Peek`), `MoveToProjectDialog` (`Move`) and `FilterSheet` (`Toolbar`) are lazy: `next/dynamic` fetches
each on first render, so `Peek` withholds the render until a row opens and `Move` until a row asks to move.

The hooks the root and the parts call, each in `tables/`: `use-table-view.ts` (`useTableView` for leading
disclosure/selection columns, URL vs local state ownership, `columnVisibility` default merging, grouping metadata,
`peek`/`openRow` wiring, phone card tier and row expansion; `useExpandedAnnounce` for lazy `subRows.onExpand`
announcements; `useTableSections` for `topLevelRows`, `sectionize` and `drillInFor`), `use-table-selection.ts`
`useTableSelection` (ticked rows, render-phase pruning when rows leave the window, `allLoadedSelected`,
`canSelectAllMatching`, `bulkSelection`, `clearSelection`, phone `selectMode` and viewer-gated bulk-bar handlers),
`use-table-editing.ts` `useTableEditing` (`patchBySavedField`, optimistic cell patching with rollback, `handleCellSave`
and `canSave`), `use-table-delete.ts` `useTableDelete` (single-row vs bulk delete dispatch behind `useDeleteGate`,
`pendingDelete`, `requestDelete` and `requestRowDelete`), `use-cell-grid.tsx` `useCellGrid` (cell state machine,
editing, selection, clipboard through `use-cell-clipboard.ts`), `use-row-cursor.ts` `useRowCursor` (the `j`/`k`
cursor and the grid's handlers), `use-peek-row.ts` `usePeekRow`, `use-table-url-state.ts` `useTableUrlState` and
`use-table-local-state.ts` `useTableLocalState` (the two view-state sources), `use-row-actions.tsx` `useRowActions`
(the row menu's handlers; stateless, so `GridRow` and `Cards` each call it) and `use-saved-views.ts`
`useSavedViews` (the saved-views config `EntityTable` passes as `savedViews`).

The capabilities, by what carries them: the loaded window's rows in state, for optimistic cell patches with
rollback; `editableCells` (a field kind per column id, from the `src/fields/`
registry: an `editor` kind's cell is `EditableCell` hosting the kind's `Editor`; a `self` kind draws its own
control, its `DraftInput`, saving to `saveAs ?? column id`; a `toggle` kind draws its `Display` and the grid
writes the flip; an optimistic patch spreads the kind's `optimisticPatch` for the `saveAs` field) (paste goes through `paste-cells.ts` `planPaste`); `newRow` draft (`DraftRow.tsx`, `new-row.ts`, `draftFieldsFrom()`; hidden until the `+ Add <entityLabel>` toggle under the grid, or open from mount when `useSectionRevealed()` says the enclosing `EmptySection` was just opened; first field autofocused, Escape closes) + `subRowNewRow`; server-driven
mode when `serverPage` and a URL source are both given; `filterColumns` + `facets`; grouping (`group-sections.ts`
`sectionize`/`sectionDrillIn` — feed top-level rows only); typed `subRows: { getRows, cells: Record<parentColumnId,
(child) => ReactNode>, onExpand? }` (`getRowId` namespaces children as `"5.12"`, so `Number(row.id)` is the entity
id for top-level rows only); `enableSelection` + `BulkActionsBar` (status, add-to-collection, labels — Add
label…/Remove label…, each a sub-menu of every project label — priority, move, delete; on a phone the Labels
sub-menus reuse `RowActionSheet.tsx`'s exported `sheetPrimitives` to become an inline disclosure instead of a
flyout); cell grid keyboard nav + TSV copy/paste
(`use-cell-clipboard.ts`, `tsv.ts`; paste is strict: `planPaste` runs each pasted cell through its column kind's
`parse`, passes over a column with no registered kind or `paste: false`, and leaves a cell the kind
rejects unchanged. A rejected cell is counted in one "n cell(s) skipped: not valid for their column" toast;
a cell landing on a navigable column with no editable config at all — the identity column, which is in the
rectangle so it can be copied — is counted separately into "n cell(s) skipped: column is not editable",
because the reason is the column rather than the text. `PlannedSave.field` is `kind.saveAs ?? columnId`, so
paste writes the same row field the cell editor does) on the wrapper `div` around the `role="grid"` table, which also tracks pointer/focus for hotkey
scoping; row cursor `j`/`k`/`Enter`/`o`/`x`/`r`/`e`/`a`/`s`/`!`/`f`/`Escape` in the `TABLE_SCOPE` command scope (`use-row-cursor.ts`
`useCommandScope`, `row-cursor.ts` `nextCursor`,
`data-cursor` ring; `j` at the last loaded row loads the next page and moves onto it, scrolling the grid there
through the context's `scrollToIndex` ref first — wrapping happens only once every row is loaded, and `k` at
the first row only wraps then too). `j`/`k` are countable (`5j`): a count above one never wraps, it clamps at
the ends, and past the last loaded row it loads pages up to the target and lands on it, or on the last row when
the rows run out first. `Home`/`End` put the cursor on the first row and the last _loaded_ row, never loading;
`mod+a` selects every row (`table.toggleAllRowsSelected(true)`) when the table allows selection, and yields to
the grid's own `mod+a` while a cell holds focus, the grid's scope being pushed after the table's. `r`, `e` and `a` act on the cursor row through the row menu's own
handlers: `DataTable` calls `useRowActions` for the cursor row and hands `useRowCursor` the result as
`rowActionsFor`, so `r` runs `onRename` (single-row targets only), `e` runs the declared `archive` action through
`runTableAction` (toast and Undo; `repeatable`, so `e j .` archives the next row), and each is absent where the
menu does not offer it. `a` asks the row's `⋯` menu to open with "Add to collection" open: the root holds
`menuRequest` (`{ rowId, submenu }`, state half) and `setMenuRequest` (config half), `GridSections` hands only the
matching row `menuRequest`, and `RowActionsBar` holds its menu's open state so a new request opens it and closing
it (`onMenuClose`) clears the request; it is absent where the row has no `⋯` menu or no collections exist.
`f` focuses the table's search: the desktop toolbar's `TableSearch` hands its input to the root through
`registerSearch`, held as state so the key is offered only once the toolbar has rendered. `s` and `!` open the
cursor row's `status` and `priority` cell as Enter on it would: `useCellGrid` exposes `openCell(rowKey, columnId)`,
which dispatches the `enter` event (an `editor` cell such as priority opens its editor, a `self` cell such as
status has its `data-cell-control` clicked open), and `DataTable` hands `useRowCursor` that through a ref (the grid
is built after the cursor) with `cellOpenable(columnId)`, so each key is absent with no cursor row, without an
editable cell config for the column, or with the column hidden; `peek` (`PeekPanel.tsx`, `use-peek-row.ts`, `lib/peek-param.ts`; `peek.titleField` names the
row field a rename saves — `title` or `name` — which the panel cannot know); `rowActions`
(`RowActions.tsx` exports `ActionItems` + structural `ActionPrimitives`; `row-action-target.ts`
`rowActionTargetIds` — acting on a selected row targets the selection). **Rename** is an `ActionItems` item
(`onRename`, single-row targets only, just above "Copy link"), so the right-click menu, the `⋯` overflow and the
phone action sheet all carry it. `buildRowActions` sets it only when the user can edit, `peek` is configured and
`onCellSave` exists; it opens the row in the panel and sets the root's `renaming` state (never the URL), which
the `<PeekPanel rename>` prop reads as `active`. The panel's `PeekTitleEditor` saves through `handleCellSave(row.id,
peek.titleField, title)` — the grid cell and the panel header read the same row — and `onEnd` clears `renaming`, which
`PeekPanel` also calls when the peeked row changes or the panel closes. `RowDeleteContext`/`useRequestRowDelete()`
(`row-delete.ts`) so any cell can open the shared confirm dialog; `moveToProject` (`MoveToProjectDialog` over
`move-targets.ts` `movableTargets` + the `moveEntity` mutation through `useMutate()`, then
`router.push(hrefInProject)`). `MoveTarget` (`data-table-context.tsx`) is a union — `{ row, id, name }` for a
row action's target or `{ selection, count }` for the bulk bar's, and for a row menu's Move chosen on a row
inside a multi-row selection (`use-row-actions.tsx`'s `onMove`, gated on `onBulkMove` being present rather
than `!many`). `Move.tsx` renders `MoveToProjectDialog` for either: a row target moves and navigates
(`router.push(hrefInProject)`) as before; a selection target calls `onBulkMove(selection, targetProjectId)`,
and on success clears the selection and the move target and, when the peeked row was among the moved ids
(or the selection is "all matching"), closes the peek — it never navigates, since the rows leave this
project's table and the caller's own invalidation already refreshes it. The dialog itself stays
context-free (`entityKind`, `entityLabel`, `target`, `currentProjectId`, `onBulkMove?`, `onMoved` are plain
props) and owns the move's success toast ("Moved N `<entityLabel>`s", or "Moved `<name>`" for a row), whose
description is `move-report.ts` `priorityFallbackNote(priorityFallbacks)` when the server reports levels that
fell back to the destination's default ("High became None on 3 rows."; `move` answers the report merged onto the
row, `bulkMove` beside `moved`), and its confirm copy: "Move N
`<entityLabel>`s to `<project>`?" plus a rule line keyed on `entityKind` (`SELECTION_RULES` in
`MoveToProjectDialog.tsx`) — worded per kind what stays behind and what moves with the rows. `savedViews`
(`use-saved-views.ts`'s `useSavedViews(projectId, kind, views, me)` returns `{ views, me, onSave, onDelete,
onShare }`; `me` is the caller's id from `cachedMe()` in `EntityListTable` (`""` when that read fails),
threaded through `EntityTableProps.me` → `EntityTable` → the hook; `onShare(viewId, shared)` runs
`entities/mutations.ts`'s `updateSavedView`, which PATCHes `{ shared }` — only the view's owner may set it,
enforced server-side; `SaveViewForm`, delete behind `ConfirmDeleteDialog`. A row that is not the caller's own
(`view.ownerId !== me`) carries an `IconUsers` mark with the owner's name as its accessible name ("Shared by
{name}"), not only a hover title. `saved-view-actions.ts`'s `savedViewActions(view, me, can)` is the one
place both `toolbar-menus.tsx`'s `SavedViewsMenu` (desktop) and `cards/FilterSheet.tsx`'s Views section
(phone) decide the row's trailing menu: mirroring the server's gate, Share/Unshare needs the view's own and
at least editor, Delete needs that or admin, and an empty `me` or a `null` role (outside a project route)
withholds every write affordance, admin delete included; `column-label.ts` `columnLabel(column)` for menus.
`SavedViewsConfig` also carries `defaultViewId` and `onSetDefault`/`onClearDefault(viewId)`, from `tables.
defaultSavedView` (`lib/default-saved-view.ts`'s `DefaultSavedViewMap`: `projectId` → `kind` → saved view id,
user-scoped since a per-project default at project scope would shadow every project's at once) through
`useSetting`/`useUserSettingsWrite`; a default whose view no longer exists is dropped client-side in a
`useEffect`, the one place that write happens. `SavedViewRowExtras`'s trailing menu (both `SavedViewsMenu` and
`FilterSheet`) always renders now, so every member can reach Set as default / Clear default regardless of the
row's own share/delete gate, and marks the current default with a filled `IconStarFilled` (`--art` ink). The
same map, read only, drives the settings hub's `table-default-views` control (below): per kind, the current
project's default by name with a Clear, since a default is set from the picker, not there.
Other files: `generic-table-types.ts` (`DataTableProps` and the config types its props are built from),
`leading-columns.tsx`, `toolbar-menus.tsx`.
URL state: `use-table-url-state.ts` over `lib/table-params.ts`
(`TABLE_PARAM` `q/sort/cols/order/w/group/view` — no `page`, since the table's loaded window only ever
grows, and a sort/filter/search/group change reloads it from the top; a stray `?page=n` from before is
ignored on adoption and purged whenever the URL is next projected. **The filter list is derived, never
listed**: `FILTER_PARAM_NAMES` is the union of the API package's generated `TRACK_FILTER_PARAMS`,
`COLLECTION_FILTER_PARAMS` and `SESSION_FILTER_PARAMS` (the server's list query schemas' own filter keys),
and `isFilterParam(key)` adds any custom field's `cf_<id>` key; adoption, the URL projection, `viewQuery()`,
`filterViewQuery` and `parseTableQuery` all go through it, so a filter the server declares (the Explicit
filter was the one a hand-kept list had missed) reaches the URL, a saved view and the server. Values are typed
from the generated query types (`TableFilters`: `status` a number, `priority` the comma-separated level-id list
the server reads, `explicit` and `inDit` (the sessions' "In dit" column, offered as "Yes"/"No") `"true"`/`"false"`, a `cf_<id>` filter a string); `FILTER_VALUE_PARSERS` drops a
raw value the server's schema would refuse (the type forces a parser for every filter whose value is not free
text), and a `cf_` value passes through, the server being the judge of its encoding. Each kind's `pageQueryOf`
spreads `declaredFilters(view, <KIND>_FILTER_PARAMS)` and, for tracks and collections, `customFieldFilters(view)`
(the one place `cf_` keys go past the generated types), and the page-1 actions forward the same.
`VIEW_QUERY_PARAMS` = what a saved view captures (plus the `cf_` filters, by field id) — `view` excluded;
`withFilters(href, filters)` for a link that opens a list already filtered. `useTableViewState`'s `viewQuery()`
serialises the same fields as a query string; its typed twin `viewParams(): TableSearchParams` is what a
server-paged root passes as `serverPage.load`'s `view`).
`useHydrated()` (`useSyncExternalStore`, server `false`) hides the desktop grid for one frame on phones.

**Default view.** `lib/default-view.ts`'s `hasViewParams(searchParams)` says whether a raw URL already
names a view: any of `VIEW_QUERY_PARAMS`, `view`, `archived`, or a `cf_` filter, present with a value. Only
`peek` is deliberately excluded — peeking a row is not naming a view. `EntityList`
(`modules/entity-list/index.tsx`) redirects a bare list URL (no view params at all) to `defaultViewTarget`'s
resolution — a default saved view's query if one is set and still resolves, else the kind's per-scope
settings (columns, sort, grouping, view mode) — narrowed by `defaultViewQuery` to always carry `view=`
(`BUILT_IN_VIEW_QUERY` = `view=list` when nothing overrides it), so a redirect target is never itself
redirected. All four route modules (`track-all`, `track-archived`, `collection-all`, `session-all`) pass
their raw `searchParams` through for this. The archived scope drops `archived` from the redirect (its scope
is the route, not a param); the live scope carries the tracks table's `archived` setting when set.
No client action is allowed to produce a bare URL either, so a later load of the same page is never
redirected out from under a chosen view: `useTableUrlState`'s `emptyQuery` option (only `PageEntityTable`
passes it, as `BUILT_IN_VIEW_QUERY`) makes an empty projected query string write `emptyQuery` instead of a
bare pathname — on the first render, this canonicalises the URL to match what's already rendered
(`history.replaceState`, no refetch); on a later change (Reset view, clearing every filter), it's a real
state change and goes through the normal push/replace path. `ViewSwitcher` always sets `view=` explicitly
rather than deleting it when switching to list. The toolbar's **Reset view** button (`parts/Toolbar.tsx`,
next to the saved-views menu, shown only when the table owns the URL) calls `urlState.applyViewQuery("")`.

**Custom fields in a table.** A project's fields of the table's kind (`cachedCustomFields(projectId, kind)` in
`lib/server-data.ts`, `EntityModule.customFieldKind` saying which kinds have them) reach `useParts` as
`EntityTableContext.customFields` and the bulk bar as `bulkFields`. Every part is keyed `cf_<id>` (the column
id, filter param, sort and grouping key, and the save name): `custom-field-columns.tsx`'s `customFieldColumns`
(one column per field, reading the row's `fields` bag, drawn by the kind's `Display` or `format`, `meta.group:
"Fields"` so `ColumnSettingsMenu` lists them under that heading and moves them among themselves) and
`custom-field-parts.ts` (`customFieldCells` — `kindForField` per field; `customFieldKeys` for
`initiallyHiddenColumns` and the draft ids; `customFieldFilterColumns` by type through `TABLE_TYPES`;
`customFieldGroupings` / `customFieldGroupKey` / `customFieldSeed` for select and checkbox groupings). A filter
is a `FilterColumnConfig` union: a choice (`options`, optionally `multiple` — sent comma-separated — with
`listed` to name every chosen option in `options` order on the trigger, and `counted: false` to hide counts), a `range` (`<from>..<to>`, either end open, `input` the kind that checks each
end) or `text` (contains). `filter-controls.tsx` owns the controls: `FILTER_CONTROLS` gives each its trigger
summary, its desktop `Menu` (`ChoiceFilterMenu`, or a popover around `RangeForm` / `TextForm`) and, for a typed
one, the `Form` the phone `FilterSheet` opens in place of an option list. Per type: number and date a range,
select a membership with facet counts, checkbox Yes / No / Not set (`true`/`false`/`unset`), url Set / Not set,
text contains. The cell save sends `fieldWriteBody(field, value)` (`{fields: {cf_<id>: value}}`, `null` clears),
`patchBySavedField` registers each custom column's patch of the `fields` bag (`withCustomFieldValue`, which drops
a cleared key), and the grid's toggle reads a checkbox's current value from the column rather than a row field
of its name. A draft row sends only the fields it shows (visible columns, plus a field a group header seeded),
the custom ones as the create body's `fields` bag (`customFieldWrites`). A saved view naming a deleted field
keeps its `cf_` param; the table has no column or filter for it and the listing ignores it.

Beyond the table, a custom field reaches: the bulk bar's **Set field…** (`SetFieldPopover`: pick a field, type a
value with its kind's `DraftInput`, one `onBulkPatch` of `{fields: {cf_<id>: value}}` for the whole selection);
the move dialog, which asks `clientPreviewMove` (`POST …/move/preview` or `…/bulk/move/preview`, through
`ENTITY_API[kind].movePreview` / `.bulkMovePreview`) as soon as a destination is picked and lists the fields
whose values the move drops (`DroppedFieldsNote`), holding Move until the answer is in; the rail's **Fields**
block (`components/editing/CustomFieldsBlock.tsx`, one `InlinePropertyEditor` per field in a paired grid after
ISRC/ISWC on the track page and after release date/UPC on the collection page; the editor takes every custom
field type — `checkbox` saves on change, `url` shows the link with its own edit button, `clearable` saves an
empty draft as `null`); the create forms (`customFieldSpecs` / `customFieldDefaults` append an optional
`field-kind` row per field to `TrackForm` and `CollectionForm`, and `bagCustomFields` moves the parsed values
into the create body's bag; the collection page's "New track" dialog passes none); the palette's `set <field>
<value>` (`command-palette/set-field.ts`: the page entity's title or one of its custom fields, a name in quotes
reaching a custom field that shares the title's name, the value parsed by the field's kind, a select's options
and a box's two states offered as rows); and the activity feed (`CustomFieldChange`, a client row because it
reads values through the field kinds, naming a `cf_<id>` change by its field from `loadActivityVocabularies`).

How the table's capabilities meet, for anyone cutting into it:

- **Shared slices.** A render-phase check prunes `rowSelection` to the ids the window still holds.
  `rowSelection` / `selectAllMatching` are written by the checkbox column, `clearSelection` (the bulk bar and row
  actions) and that prune. Every delete goes through one `useDeleteGate(deleteKind, runDelete)` (the root's
  `deleteKind`: the entity kind for `EntityTable`, `"file"` for `AssetsTable`, absent for `ReposTable`, whose rows are
  never deleted from it — a gate with no kind asks if a delete ever reached it), which opens the one
  `ConfirmDeleteDialog` or deletes at once when the feedback policy says that kind does not ask. The context's
  `requestDelete({ selection, label })` has three sources: a row action's delete (which targets the whole
  selection when the row is inside one), the bulk bar, and `useRequestRowDelete()` from a cell (`TableRowPlay`,
  `AssetRowActions`). `expanded` is written by the grid and
  the phone cards; `selectMode` by the phone filter sheet and the cards; `settleSection` from the group header.
- **Shared bodies.** `useRowActions`' `buildRowActions` is where selection, peek, move, bulk and copy meet, and
  both `GridRow` and `Cards` call it. `GridRow` mixes cells, selection and row actions; `GridSections` mixes rows,
  draft and grouping. `GridRow` and `cards/RowCard.tsx` are the memoised rows; a new member of either context
  half must be stable (memoised on its inputs) or it rebuilds the half, and with the config half every row.
- **A URL source means "this table owns the page URL".** It gates URL state (`ownsUrl`), `serverDriven`, and
  whether the toolbar offers filter menus, grouping and saved views; `hotkeys` and `peek.inUrl` are the caller's
  own choices beside it, and a page's own table sets all three. `useTableUrlState` and `peek-param.ts` read
  `window.location.search`, not `useSearchParams()`, and adopt it only once `useHydrated()` is true.
- **`peek` reaches furthest:** the id cell's handle (`PeekHandle`, a `cellComponents` entry in `cell-components.tsx` that `idColumn` wraps its span in), click-to-peek, the
  `Enter`/`o` hotkeys, and the phone cards, which need both `cards` and `peek`. Previous and next walk
  `peekableRows` (`Peek.tsx`, top-level rows of the current page); Prev is disabled at row 0. Next at the last
  loaded row awaits `ensureLoaded` for the next page (busy state on the button meanwhile) rather than clamping,
  and is disabled only once `loaded.hasMore` is false; a failed load leaves the panel on the current row.
  `ensureLoaded` measures `table.getRowModel().rows` as a whole, which can hold more than `peekableRows` while
  a parent is expanded, so `onNext` calls it with `pageRows.length` rather than `peekableRows.length`; the
  pending step it lands still resolves against `peekableRows`, the array it is read from.
  `lib/peek-param.ts`'s `stepPeek` takes a `hasMore` input and returns `"load"` for that past-the-window case,
  which `BoardView.tsx` never sees since its columns paginate independently (`hasMore: false` always there).
  The stepped-to row scrolls into the grid's window through the context's `scrollToIndex` ref, keyed by the
  row's index in `table.getRowModel().rows` — not its index in `peekableRows`. Grouping hides the pager;
  ungrouped draft rows never animate.
- **Tests.** Table suites render the real root through `tables/test-support.tsx`, which registers the
  `next/navigation` and `CopyTextProvider` stubs before it imports the table, so a suite reaches the
  table only through it. It exports `renderGrid` (the fixture table, optionally inside a `ProjectProvider`),
  `routerMock`, the fixtures and `TestDataTable`, the harness's own composition of every part in the standard order
  (its `persistStateInUrl` prop is on by default, built as `EntityTable`'s page variant is; `renderGrid`
  passes it off). The row cursor's keys run through a real `CommandRegistry` (`TABLE_COMMANDS`, a stub
  `ActionContext`) rather than a stand-in, and `pressHotkey(combo)` dispatches a real `window` keydown event
  (pointer-entering the last grid on the page first, so a page- or focus-scoped table under test claims
  `TABLE_SCOPE`). `AssetsTable.test.tsx`
  renders `AssetsTable` with `AssetRowActions` stubbed (it needs the music player); no test renders `EntityTable`.
  A phone-tier test must stub `matchMedia` (`stubGlobal`, as `player-engine.test.ts` does).
- **Bundle.** On a project's tracks page the table chunk is 287.3 KiB raw / 86.2 KiB gzip (`gzip -6` of the
  file); `EntityBoard` lands in the same chunk. `PeekPanel`, `MoveToProjectDialog` and `FilterSheet` are each
  their own chunk, so the table chunk holds none of them. `next build` prints no sizes under Turbopack: measure with
  `cd apps/client && bun run build && bunx next experimental-analyze -o`; the route's
  `.next/diagnostics/analyze/data/project/[projectId]/[...route]/analyze.data` is a length-prefixed JSON of which
  chunk each module lands in, and the chunk file's own size is the number to quote. `next/dynamic` fetches on first render, so only a render gate (the
  `filterSheetLoaded` latch) defers a chunk to first open.
- **TanStack v9 sharing.** `createTableHook` is the library's composable-tables pattern; its `AppTable` provider
  value changes identity each render, so `useTableContext()` consumers re-render with the root. `table.Subscribe`
  isolates a consumer only under a stable context value. Table `meta` cannot carry state (nothing subscribes to
  it). A factory that registers a component importing the factory's own hook is an HMR import cycle;
  `createTableHookContexts` gives hooks a cell component can import instead.

**Cell grid mechanics worth knowing.** `tables/cell-interaction.ts` `cellInteraction(state, event)` is a pure
reducer and the one owner of what a gesture on a cell does: it takes `press`/`doublePress`/`enter`/`type`/
`editEnd` and returns the next `CellState` — which cell, if any, holds the editor — plus one effect
(`openEditor`, `toggle`, `activateSelf`, `none`). Which branch it takes is the column's `EntryMode`:
`fieldKind(config.type).entry` for a column present in the role-gated `editableCells`, `"none"` for every
other column. `useCellGrid` dispatches events and applies effects; it decides nothing, and only `editEnd`
releases the editor. A cell opens its editor on the second click, never the first: `cellSelection` is
uncontrolled, so TanStack's mousedown handler (`cell.getSelectionStartHandler()`) moves the selection anchor
synchronously and `cell.getIsFocused()` is already true by the time the same gesture's `onClick` runs — the
grid records `wasFocused` in a ref at mousedown and hands that to the machine instead. A press inside an
element marked `data-cell-control` (the status pill in `StatusCell`, a `toggle` kind's box) belongs to the
cell's own control: it is what flips a `toggle` cell, and `activateSelf` opens a `self` cell's control by
clicking that element, which is the keyboard's only way in. A printable character typed on a focused `editor`
cell opens its editor with that character as the draft in place of the value (Escape restores the old one):
`use-cell-clipboard.ts` dispatches `type` for any key but a ⌘/Ctrl/Alt chord, an IME keystroke or one typed into
a text control (`isTypingTarget`), lets `isSeed` in the reducer decide what counts as a character, and calls
`preventDefault` only when the returned effect is `openEditor` — so a read-only cell leaves the key to the page's
hotkeys, and on an editable one the cell wins because the app's hotkey listener skips a defaulted event.
`useCellGrid` keeps the seed from `openEditor` in `editSeed`, hands it to that cell's `EditableCell` as `seed`,
and the kind's `Editor` reads it once on mount. Navigable columns default to the keys of the
`editableCells` _prop_, before role gating, so a viewer navigates and copies a grid whose every entry mode is
`"none"` and whose paste plans no saves. `draftFieldsFrom` silently
skips an id with no config in `editableCells` unless `extras` names it, in which case the extra takes that
id's place in the list. The identity column (`title`, `name`) is a link and nothing else: `TitleCell` wraps
the thumb and the title in one `AppLink`, the trailing slot (marks, play affordance) sits outside it, and the
column is not in `editableCells`, so its entry mode is `"none"`. A click on its padding selects the cell and
opens nothing; renaming is a row action. Because it is not editable, each entity table declares its draft
input through `draftFieldsFrom`'s `extras` and passes `navigableColumns` from `navigableColumnIds(columns,
editableCells, identityId)`, the editable columns plus the identity column in column order. A column's id is not always the field it saves (`status` saves
`statusId`). Phone cards pick their fields from `toPeekRow().fields` by `PeekField.id`. The whole table system,
board and peek panel included, ships as one chunk on every project page; only `FilterSheet` is split out.
`DataTable.interaction.test.tsx` renders the whole table through `test-support.tsx` under the DOM preload,
mocking `next/navigation` and `CopyTextProvider`. The three entity tables are
rendered from server components, so nothing function-valued can be passed to them as a prop.

**Cell grid over unmounted rows.** Cell selection and keyboard navigation (`table.moveCellSelection`,
`extendCellSelection`, `getFocusedCell`, `getSelectedCellRangesData`, `getCellSelectionBounds`) are
TanStack's own cell-selection feature (`packages/ui/src/lib/table-config.ts`'s `cellSelectionFeature`),
which resolves against the row model rather than the DOM and reads/writes its own atom rather than React
state — copy, and a rectangle spanning a row scrolled out of the virtualised window, read its value from
there, never from `textContent`, and `getFocusedCell()` already sees a `moveCellSelection`/`selectAllCells`
call made earlier in the same tick. The feature only ever moves that state, though: nothing puts DOM focus
or scroll position on the cell a keyboard move lands on, so `use-cell-clipboard.ts` does that itself after
every move that changes the focused cell (a plain arrow, the load-past-the-window move once it resolves,
⌘A) by revealing `table.getFocusedCell()` through `revealCell` (`use-cell-grid.tsx`'s `focusCellElement`:
scrolls the row into the window, waits a frame, focuses the cell). A row-changing shift+arrow (extend)
reveals the moving edge too, but scrolls only: `getFocusedCell()` reads the range's anchor, which extending
never moves, so there is no single cell to hand focus to — the target row comes from
`getCellSelectionBounds()`'s last range (`maxRowIndex` extending down, `minRowIndex` extending up). Outside
keyboard moves, the same DOM reach covers `focusCellElement` (ending an edit) and the `activateSelf` click
in `applyCellEffect`; every one goes through `scrollToIndex.current?.(rowIndex)` (a no-op unwindowed, null
on the card tier) before the `querySelector`, in a frame. An arrow-down at the last loaded row calls
`ensureLoaded` before letting the feature move, so a step past the window loads the next page instead of
clamping; every other direction, and any row short of the last loaded one, leaves the feature's own clamp to
stand. Paste anchors on `table.getFocusedCell()` and reads `table.getRowModel().rows` the same way; a
pasted block taller than what is loaded calls `ensureLoaded` for its bottom row first. `ensureLoaded`
resolving only guarantees the rows exist in state, not that the row model this render is holding carries
them yet, so both the arrow-down load and the paste load hold the pending work (a target row index; a
parsed paste grid and its start) in state and resolve it in an effect once the table's own row model — read
fresh in that effect, never off a `rows` array captured before the `await` — reaches it, mirroring
`use-row-cursor.ts`'s `pendingIndex`. `ensureLoaded` resolving false covers three outcomes the pending-paste
effect tells apart: a failed load (`loaded.state === "error"`, passed in as `loadFailed`) writes nothing, and
the grid's own retry line reports it; a view that changed under the load (the anchor row is no longer at the
paste's start index) writes nothing; a server with no more rows writes what exists and stops, since
`planPaste` skips a row past the end. `needsLoadFor` in `cell-interaction.ts` is the shared pure check
(`index >= loadedCount && hasMore`) both paths use.

**Cell affordance and ARIA.** `role="grid"` is on the `<table>` (a `role="grid"` `div` around a real table gave
assistive tech two structures); rows carry `role="row"`, head cells `columnheader` and every body cell
`gridcell`, all set from the client since `Table`, `TableRow` and `TableCell` spread props. A navigable cell
(`selectionCellProps`) also gets `aria-selected` from cell selection, `aria-readonly="true"` when
`entryOf(column)` is `"none"` and `data-editable` otherwise, and an editable one points `aria-describedby` at
the single visually hidden "Press Enter to edit" node the grid renders once per table. A cell outside the
navigable set (selection checkbox, disclosure, pinned actions) has the role and nothing else. A row's "peeked"
state is `aria-current`, never `aria-selected`. `aria-rowindex` / `aria-colindex` are absent while the DOM holds
every row. The editable affordance is `data-editable` styling (`EDITABLE_CELL` in `parts/GridRow.tsx`): on hover a
1px inset hairline in the `--border` token (an `outline`, so it composes with the selection's inset `--art`
`box-shadow`) and `cursor-text`; a `data-cell-control` inside it gets `cursor-pointer` instead. There is no
resting underline. A focused cell shows a `:focus-visible` outline in `--ring`, which suppresses the hover
hairline.

Entity tables: tracks, collections and sessions all render through `<EntityTable kind=… rows=… scope=… />`
(`tables/EntityTable.tsx`), which takes a kind rather than a definition because the pages that render it are server
components. Each kind's definition is `entities/<kind>/table.tsx` (`EntityTableDefinition<K>` from
`entities/table-types.ts`: `identityField`, `href`, `toPeekRow`, `pageQuery` (`entities/<kind>/api.ts`'s own
`pageQueryOf`), and a `useParts(ctx)` hook returning the kind's columns,
editors, filters, new-row config, group-by, sub-rows, cards, hidden columns and mutation options), registered in
`entities/tables.ts` (`ENTITY_TABLES`, a record total over `TableEntityKind`, so a kind with no definition is a type
error). `EntityTable` derives the nouns, routes, mutation handlers and saved views from the kind and hands
the `DataTable` root the assembled props (`assembleEntityTableProps`). The track definition adds session sub-rows with a cache
keyed on the identity of the page's rows, the bulk "add to collection" action, and a `saveField` override that saves
`trackNumber` through the collection (`updateTrackNumber`); its `scope` is `{ collectionId?, collections }`. `AssetsTable`
is the one hand-written entity table. The definitions build columns from
`tables/columns.tsx` (`idColumn`, `titleColumn`/`TitleCell`, `priorityColumn`, `labelsColumn`, `textColumn`,
`dateTimeColumn`, `timestampColumns`, `navigableColumnIds`, `ACTION_COLUMN_SIZE`, `TABLE_THUMB_WIDTH`; no loudness
factory — the track columns format LUFS with `@workspace/ui/lib/loudness` `formatLufs`) and take handlers from
`hooks/use-entity-mutations.ts` (`useEntityMutations(kind, projectId, { saveField? })` →
`onCellSave`, `onBulkPatch`, `onBulkDelete`, `onBulkSetLabels`, `onBulkMove`, `onRowDelete`; a cell editor
commits a value the field registry has already parsed, so nothing normalises between the editor and the
patch; each handler runs a declared mutation from `entities/mutations.ts` through `useMutate()`, so what
re-renders is the mutation's own `invalidates`; the bulk handlers return `{ ok, count }` (`onBulkMove` adds the
move's `priorityFallbacks`) and toast nothing, since the bar or dialog that called them owns the success and error
toasts). Create goes through `createEntity` (no fabricated rows). Track sub-rows are sessions; collection
sub-rows are tracks (`ListCollection["tracks"][number]` = `{id,title,image,priority}`, no artists). `TrackTags`/
`Tag` (`StatusChip flag` + link + remove, "+" opens `LinkToDialog`), `LabelsCell` (badges + popover picker,
`setEntityLabels`; an optional `listHref` makes each badge a link to that list filtered to its label — only the
tracks list reads `label`). `ReposTable` (`components/tables/`; `DataTable` used directly, not `EntityTable`, because a repo is not an `EntityKind`; embedded —
view state in React, no `urlState` or `serverPage` — composing `Grid` alone over `getTrackRepos`/`getCollectionRepos` rows; columns Name
(`titleColumn` linking to `/project/:pid/repo/:id`, pinned by `tables.pinnedIdentityColumn`), Sets, Branches (`branchCount`), Last
Push (relative time, hover date), Machine (the machine the repo was last pushed from: a `MachineLink` to its row in Settings → Devices when it is the viewer's own, plain text when it is another account's, "—" when the push named none; `RepositoriesSection` passes the signed-in user as `viewerId`); and Storage, the repo's set plus sample bytes (`storage.setBytes + sampleBytes`, shared savings are not part of it)).
`RepositoriesSection` (`components/repo/`) is the async section that wraps it under a `REPOSITORIES` head with the count and returns `null`
for no repo or a failed read, so a page without repos gains no heading, no skeleton (its `Suspense` has `fallback={null}`) and no add-line entry.
`AssetsTable` (settings Assets pane; composes the root with `Toolbar`, `Grid`, `Selection` and `Paging`, `enableSelection`,
server-paged, the row menu and the bulk bar both deleting through `bulkDeleteAssets`) with `AssetRowActions`
leading cell (play for audio, Download dialog, Details, queue, delete via `useRequestRowDelete`). Details opens
`AssetProvenancePopover` anchored to the menu button, on every pointer type, through `useMenuDetails` (it opens from
the menu's `onOpenChangeComplete`, as the attachment tile's does).
`AssetRowActions.test.tsx` renders it directly. `TableRowPlay`/`RowPlay` = the row's play control.
`tables.hoverPlay` picks the play control's class in both: `hover` (default) `rowPlay` (hidden until the row is
hovered or focused, `fine` pointers only), `always` `rowPlayAlways` (visible at rest); both classes are
`packages/ui/src/components/table.tsx` exports, so a table outside `tables/` (`project-home/RenderRow.tsx`,
`attachments/AppAttachment.tsx`) keeps plain `rowPlay` untouched by the setting.

`tables/EntityTable.tsx` (`EntityTable<K extends TableEntityKind>`, client) draws any kind's table from its
`EntityTableDefinition`. It takes `kind` — plus `rows`, `rowCount?`, `facets?`, `groups?`, `projectId`,
`statuses?`, `projectLabels?`, `priorityLevels?`, `savedViews?`, `me?`, `embedded?` and the kind's `scope` — rather
than a definition,
because its render sites are server components and a definition is hooks and callbacks, which do not cross that
boundary; it reads `entityTable(kind)` itself. It calls `useProjectRole()` for `ctx.canEdit`, the definition's
`useParts(ctx)` unconditionally (a mounted table's kind never changes), `useEntityMutations(kind, projectId,
parts.mutationOptions)` and `useSavedViews(projectId, kind, savedViews, me ?? "")`, and renders
`DataTable<EntityTableRow[K], EntityTableChild[K]>` with every part (`EntityTableLayout`): as the page's own
table (`PageEntityTable`: a `useTableUrlState` source that navigates when the server pages the rows, `hotkeys="page"`)
or, when `embedded`, with the state in React (`EmbeddedEntityTable`). Role gating is the root's: a viewer's
`editableCells` are passed through ungated, and `ctx.canEdit` is only there for a definition that needs to know.

`tables/entity-table-props.ts` `assembleEntityTableProps({definition, entity, parts, mutations, savedViews,
props, rowsPerLoad, pinnedIdentityColumn})` is the pure half, and holds everything a table derives from its
kind alone, so it is asserted on without a render: `entityLabel` is the module's `nouns.singular` and
`emptyText` `No <plural> yet`; `pinnedColumnId` is `identityField` when `pinnedIdentityColumn`
(`tables.pinnedIdentityColumn`) is on, else `undefined`, and `peek.titleField` is always `identityField`;
`peek`/`rowActions.copyHref` call `href` with the
scope, `moveToProject.hrefInProject` without it; `rowActions.label` is the module's `labelOf` and `onDelete`
`onRowDelete`; `bulkStatuses` is the statuses only when the module's `hasStatus`; `bulkLabels` is the
`projectLabels` prop, passed through for every kind but `AssetsTable`, which builds its own props (and reads
`tables.pinnedIdentityColumn` itself for its own `pinnedColumnId="name"`);
`bulkPriorityLevels` is the `priorityLevels` prop, which the bar's Priority menu lists (it hides with no scale);
`onBulkSetLabels`/`onBulkMove` are `mutations.onBulkSetLabels`/`.onBulkMove`; `serverPage` is set only when
`rowCount` is, its `load` calling `ENTITY_API[definition.kind].page(browserApi, projectId, {
...definition.pageQuery(view, scope), page, pageSize: rowsPerLoad })` and throwing on an `ActionError`.
`rowsPerLoad` (`tables.rowsPerLoad`) is `EntityTable`'s own state, captured once with `useState(useSetting(...))`
rather than read live: `useLoadedWindow`'s pages are offsets of the size they were fetched with, so a table
already mid-window that adopted a live increase would open a gap between pages instead of extending the
window; the new value takes effect from the table's next mount. `page.tsx`'s server-rendered page 1
(`modules/entity-list/index.tsx`, `config.loadPage`) reads the same setting server-side instead, so the two
render the same page size for a fresh visit. `peek.inUrl` is `!embedded` and
`savedViews` is dropped when embedded, a view being that
state under a name; `navigableColumns` defaults to `navigableColumnIds(columns, editableCells, identityField)`,
which a kind overrides through `EntityTableParts`. Everything else in `EntityTableParts` is forwarded as given,
`mutationOptions` excepted — it is the component's argument to `useEntityMutations`, not a `DataTable` prop.
`DataTable` keys its own memos on `peek`, `rowActions`, `moveToProject` and `navigableColumns`, so the
assembled set is memoised and the parts object is held still by `hooks/use-shallow-stable.ts`
`useShallowStable`, which returns the previous object while every member matches — a `useParts` that memoises
its columns and returns them in a fresh literal would otherwise change every derived identity per render.

**Board view** (`tables/board/`): `BoardView<TRow>({ statuses, fetchColumn, toCard, toPeekRow, href, onMoveCard,
entityLabel })` — one `BoardColumn` per status (sorted by `percentage`), each paging the entity's ordinary
paginated endpoint (`BOARD_PAGE_SIZE` 50, no board endpoint), dnd-kit `DndContext` (`lib/drag-sensors.ts`
`useDragSensors`: pointer distance 5 + touch delay 200), optimistic move with rollback, its own `PeekPanel`
(`usePeekRow(true)`). `BoardCard` (draggable, drag data carries source `statusId`; `BoardCardData`),
`BoardColumn` (`useDroppable`, "Load more"). A definition's `board` (`entities/table-types.ts`
`EntityBoardDefinition<K>`: `fetchPage(projectId, { page, pageSize, status, filters }, scope?)` over the kind's
`getXPageForProject`, and `toCard`) carries the per-kind wiring; it is not a hook and does not read the table's
parts. `EntityBoard kind projectId statuses filters? scope?` (`tables/EntityBoard.tsx`, client-only like
`EntityTable`) looks the definition up, throws if the kind has no `board`, and renders `BoardView` with the
definition's `toCard`, `toPeekRow` and `href` and `useEntityMutations(kind).onCellSave(id, "statusId", …)` for the
move. Every list page with a status (through `EntityList`), a collection page's track board and the project page's
collection board render `EntityBoard`. `ViewSwitcher` (List/Board `Tabs`) navigates by
writing/removing `?view=board`; the module page picks the surface server-side.

**Phone cards** (`tables/cards/`): `showCards = isPhone && cards && peek` swaps the grid for `RowCardList`
(`RowCardSection[]`; an ungrouped list is one label-less section; `selection`/`expansion` are optional capability
objects whose presence _is_ the mode; one shared `RowActionSheet`). `row-card-model.ts` `RowCardModel`
(`fields` ≤ 2 via `card-fields.ts` `cardFieldsFrom(peekRow, keyFields)`, `children` from `cards.childCard`,
`play`). `RowCard` (`TrackCell` thumb / checkbox in select mode / `CardPlayButton`, three-tier identity: title + flag,
full-width single-line `MetaText`, separate `ChipRow` of status + priority, `[content-visibility:auto]` with `76px`
intrinsic size, expand chevron, `⋯` or long-press via `hooks/use-long-press.ts` — 450 ms / 8 px / touch only, swallows
the trailing click). `RowActionSheet` renders `ActionItems` through `sheetPrimitives` (collapsibles instead of
submenus) and runs the chosen action from `SheetContent onClosed` so a follow-up dialog never fights the sheet's modal
layer. `FilterSheet` (`next/dynamic` ssr:false, opened from the phone toolbar's Filter button with
`activeFilterCount` badge) folds search filters, sort (`sortRowsFrom`), group-by, saved views and the select-mode
toggle into one sheet; `selectMode` lives in the `DataTable` root and resets when the viewport leaves the phone tier.
Card `keyFields` name `PeekField.id`s (the React key too; the first of two duplicate ids wins and dev builds
`console.error`). Each table exports a union of its ids beside its `toPeekRow` (`TrackPeekFieldId`,
`CollectionPeekFieldId`, `SessionPeekFieldId`) and types its field list and its `keyFields` with it, so an unknown
id does not compile: tracks `["collections","bpm"]`, collections `["releaseDate","tracks"]`, sessions
`["daw","track"]`. A collection's track count and a session's DAW are also the card subtitle, so the meta line
repeats them.

**`RowCardList` is virtualised**, an absolute-positioned layout (`useVirtualizer`) rather than
`GridSections`'s padded-spacer table rows — a list of divs has no row to pad instead. It flattens each
section's heading (only where it has a label — the ungrouped list's one section has none) and its own cards
into one list, indexes it with `useVirtualizer` off `useCanvasRoot()`'s element, and mounts only the window's
items, each `translateY`-positioned and carrying the virtualiser's `measureElement` as its `ref` (a card's
height varies with its meta line and whether it is expanded). `useCanvasRoot()` returning `undefined` (a test,
or a list with no scroll root) falls back to the original unwindowed markup, per-section `role="list"` and
all — the windowed path renders one `role="list"` spanning every item instead, headings included, so a
grouped virtualised list trades the per-section `aria-label` for the sentinel and the loading strip. The
sentinel, the five-skeleton loading strip and the "Couldn't load more rows" retry line follow the same rules
`GridSections` does (ungrouped only, `OVERSCAN` 10, `loaded.state`), the retry line's copy and button shared
through `parts/LoadMoreRetry.tsx`. `scrollToIndex` is the same context ref `GridSections` claims — the two
never mount together, so nothing contends for it — mapped through each card's own `rowIndex` (its position
among `table.getRowModel().rows`, set by `Cards.tsx`) rather than `GridSections`'s per-render `Map`. Tests
stub `HTMLDivElement.prototype.offsetHeight` the way `GridSections.test.tsx` stubs
`HTMLTableRowElement.prototype.offsetHeight` — see the `"Cards virtualised"` describe block in
`Cards.test.tsx`.

`tables/PageLinks.tsx`: `PageLinks({ page, pageSize, rowCount })`, `"use client"`. Server-paged list
footer ("Page N of M" + Prev/Next), rendering nothing at one page; builds `?page=` hrefs off
`usePathname()`/`useSearchParams()`, preserving other search params. Used by `AdminUsersTable`; needs a
`Suspense` boundary above it on a prerendered route (its callers here are dynamic).

**Forms** (`forms/`): RHF; `FormController` from `@workspace/ui/components/forms/form-controller`
(`title|input|select|blocknote`, `trailing`); layout in `forms/components/FormLayout.tsx`
(`FormLayout`, `FormRow pair`, `FormFoot` — `phone:flex-col-reverse`).
`forms/components/EntityForm.tsx`'s `useEntityForm({ fields, defaultValues, submit, created, createdHref })`
resolves every form through `forms/components/field-resolver.ts`'s `fieldKindResolver(fields)`, so `submit`
receives values already coerced to their kind's type rather than the raw strings react-hook-form holds. After a
create it does what the shell policy's `afterCreate` says: `open` pushes `createdHref(record)`; `stay` goes
`router.back()`; `add-another` resets the form to `defaultValues` and focuses its first field (in an effect,
since `reset` drops the refs `setFocus` needs); the last two toast an "Open" action linking to the record.
`EntityForm({ id, form, onSubmit, fields: FieldSpec[], submitLabel, busyLabel })` renders its own `<form
noValidate>` — the browser's own constraint validation on an `inputType="url"` (or similarly patterned)
input blocks the submit event before react-hook-form ever sees it, silently defeating a field-kind's or a
custom spec's own message, so native validation is off everywhere and the resolver is the only source of
errors. `FieldSpec` = `FormController` props | `{kind:"field-kind", field: FieldKindName, config?, label,
hint?, required?, statuses?: Promise<Status[]>}` (`field: "status"` is the pipeline picker) | `{kind:"pair",
fields}` | `{kind:"custom", key, render, validate?: (value: unknown) => Record<string,string>}`. A
`field-kind` row is the `Field`/`FieldLabel htmlFor`/`FieldDescription`/`FieldError` wrapper `FormController`
renders, with the kind's own `DraftInput` (never its `Editor`, which cancels on blur) in place of a
`FormController` type; the label's own id joins into the input's `aria-labelledby`, and the description's
and error's ids join into its `aria-describedby`. `FieldDraftProps` carries both as optional —
`"aria-labelledby"` and `"aria-describedby"`; `inputDraft` (`fields/input.tsx`, so
`text`/`number`/`date`/`list`/`suggest`) forwards `aria-describedby` to its `<Input>` (already named by the
label's `htmlFor`), and `fields/status.tsx`'s `StatusDraftInput` forwards both to `StatusCell`, whose trigger
`div` carries `id`/`invalid`/`aria-labelledby`/`aria-describedby` — the one kind whose trigger isn't
`htmlFor`-labelable. A row's `statuses` promise suspends only that row, under its own `Suspense` with a `Skeleton`
fallback, not the rest of the form. `fieldKindResolver` runs a `field-kind` spec's raw string, and a
`FormController type: "title"` field's, through `fieldKind(...).parse` — the same one `tables/new-row.ts`'s
`validateDraft` uses for a table's draft row, `required` folded into the config so a kind that already
rejects a blank does not double up on "Required" — and passes every other spec's raw value through
unparsed; the title always parses with the `text` kind. It calls `fieldKind(...).parse` directly rather than
sharing `validateDraft`'s loop, since a `field-kind` spec array also carries specs `validateDraft` never sees
(`pair`, `custom`, a non-title `field`). A `custom` spec's own `validate` runs against its raw form value and
nests its messages into `errors` by field path (react-hook-form's own `set` helper, since react-hook-form
ignores field-level `rules` once a resolver is set) — `ProjectForm`'s `links` field array is the one caller,
validating a blank name ("Name this link") and a bad URL ("Enter a valid URL, including https://") with
`z.url()` inside the validator itself. Forms take ids (`projectId`, optional `collectionId`/`trackId`),
never a fetched entity; submit → server action → toast → the shell policy's `afterCreate` (see `useEntityForm`). A
`field-kind` row gets one message per kind ("Required", "Must be a number", "Must be a date
(YYYY-MM-DD)"), the same text a table cell gives, and artists post `[]` for a blank field (not `[""]`,
`createTrack`'s own `split` never runs on an empty string). All four forms and `EntityForm` are
`"use client"`, and `DraftRow.tsx` already imports `@/fields` from a client boundary. `TrackForm
initialTitle` / `SessionForm initialName` are prefilled by the palette. `SessionForm`'s DAW field is a
`field: "suggest"` kind whose `config.suggestions` comes from `entities/session/daw-suggestions.ts`'s
`dawSuggestions(daws)` — the same list `entities/session/table.tsx`'s `editableCells.dawName` uses, so the
form and the table's inline cell never drift; it always submits `daw: "manual"` — a manually created session
is never attributed to a DAW module. `lib/daw.ts` holds the client's DAW helpers:
`DawIdentity` (with `DawCapability` imported from `@workspace/api/lib/enums`, which typegen mirrors from the
server's `DAW_CAPABILITIES`), `dawCanReport`,
`structureEmptyLabel`, and `isDawId` (validates a raw `daw` query/URL value against the server's module-id
pattern before it reaches a request).

**Product linking** (`product-linking/`): `EntityPicker<T>({ load, matches, renderRow, onPick, exclude })` is the
one searchable list (loads once, marks linked ids; `onPick` owns any refresh); `pickers.tsx` `TrackPicker`,
`CollectionPicker`, `SessionPicker`, `TrackPickerForSession` (+ `trackMatches`, `TrackRow`, `NoteRow`);
`RelationSelector` (reads the project's own relation types with `getRelationTypes`, a `Select` over them above
a picker; exports `relationVerb`/`inverseRelationVerb`/labels — a type outside the seeded eight reads "has
`<name>`").
`LinkToDialog` — tabbed, uncontrolled, stays open after a pick: `targetKind="track"` (collection|session|relation
tabs, `defaultTab`, `linkedCollectionIds`) or `"session"` (`currentTrackId`). `LinkPickerDialog<T>({ title,
description, scope?, load, matches, renderRow, link, linkedLabel })` — the generic close-on-pick "pick a record and
link it" shell behind `track/LinkNoteAction` and `notebook/LinkNoteDialog`. `track/AddTrackMenu` (collection "+")
= New track (`TrackForm` dialog) | Existing track (`TrackPicker`).

**Uploads and attachments** (`uploads/`, `attachments/`): `FileUploader` (→ `uploadAsset` → `attachAssetTo` for
every kind including project when `attachTo` + `parentId` are given, or the caller's own `onUploaded`, which may hand
back a job id to follow; with neither, one `router.refresh()`, which is Settings → Files: project files attach to
nothing. A failed attach marks the row as an error like a failed upload. The in-flight row is a tile of the
attachment shape, built from `AppAttachment`'s exported `TILE`/`TILE_KIND`/`TILE_NAME`) and `ImageUploader` (→
`uploadImage` → `setImageOnParent`; coarse pointers get a "Change" pill) both keep their row past the byte transfer
when there is a job to follow (`onUploaded`'s return, or `POST /images/upload`'s `variantsJobId`): `useTrackedJob`
(`use-tracked-job.ts`) subscribes to it with `JobsProvider`'s `useJob`, falling back to one direct `clientGetJob`
read (`shouldFetchTrackedJob`) once `useJobsLoaded()` says the map has done its first real read and still does not
carry the id — a job the server reused already done, or one whose whole queued-to-done life fell between two
fallback polls, otherwise never appears on the map at all. An optional second `resetKey` argument restarts that
tracking without a new job id, for a caller (`DownloadAssetDialog`) whose own repeat request can hand back the very
same id as before. `upload-row.ts` (`uploadRowPhase`, `uploadRowText`) derives the row's phase (`uploading` →
`following` → `done`/`failed`) and caption from the same `describeJobRow` the tray reads — a failed job's row shows
its error and does not auto-close, and `uploadRowShouldClose` removes a row from `FileUploader`'s list once a job it
followed settles and lingers out (its linger already gave the row its few seconds of visible completion). With
nothing to follow, the result is silent as before: the done row (or slot) stays as its own confirmation.
`DownloadAssetDialog` reads a queued conversion (`POST /assets/{id}/convert`) the same way — `useTrackedJob` +
`convert-outcome.ts`'s `convertOutcome`, no polling of its own — and fetches the output once the job's row reads
`done`; `shouldSettleConvertRequest` fires that (or a failure toast) once per request, keyed on a local requestId
rather than the `Job` object, so neither an unrelated jobs-map update nor a later request reusing the same job id
can repeat it (downloads are fetch → blob, never `<a href>`). `AttachmentList` takes an entity read's
`AttachedAsset[]` and lays one `AppAttachment` tile per asset in a container-query grid whose rows meet on each
tile's bottom hairline. The tile is a kind slot (image thumbnail, music or file glyph), the wrapped name,
`ProvenanceGlyph` beside `provenanceLine` in `LABEL` caps, the `FingerprintMark` in faint ink when the file has
one, and the size; play and the menu are `IconButton`s behind `rowPlay`. The menu is download, Details, "play/queue and "Add as track audio" via `linkTrackAudios` (the only toast left here,
since the result lands in the masthead, not the attachments list), then delete, through the `attachment` delete
gate's `ConfirmDeleteDialog` ("Delete {name}?", the file coming off everything it is attached to and any track
version made from it going too), silent once confirmed, which disables the menu while it runs. Details opens a controlled `AssetProvenancePopover` anchored around the menu button through
`useMenuDetails` (`AssetProvenance.tsx`), which opens it from the menu's `onOpenChangeComplete(false)`, once the
menu has closed and returned focus to its trigger, so the popover takes focus last. The tile owns the glance note: pointer enter or focus within anchors `AssetProvenanceNote` to the
tile, pointer leave or focus leaving clears it, and it stays closed while the menu, the popover or a dialog is
open, while deleting, and after the menu opens or Escape is pressed, until the pointer or focus next leaves the
tile (`FloatingNote` never shows on a coarse pointer, where Details is the path).
`uploads/drop-prompt.ts` `DROP_PROMPT`/`dropPromptFor(attachTo)`: the drop zone's first line by parent kind (`track`,
`session`, `collection` get a worded prompt; `project` and no `attachTo` keep "Drop files here"). Drop handling:
`@workspace/ui` `hooks/use-file-drop` + `components/drop-zone`; accept lists from `@workspace/api/lib/upload`
(`IMAGE_ACCEPT`, `AUDIO_ACCEPT`, `isAudioFileName`). The size hint under `FileUploader` and `ImageUploader` prints
the limit the server serves: `uploads/use-upload-limit.ts`'s `useUploadLimit()` reads `uploadLimit()` once on mount
and holds null (no hint) until it answers or when it cannot.

**Command palette** (`command-palette/`): `command-palette-context.tsx` `CommandPaletteProvider`/
`useCommandPalette()` → `{ open, setOpen, openWith, initialQuery }` (`openWith(query)` opens the palette with
`query` typed, so it lands in that prefix command's mode; `CommandPalette` copies `initialQuery` into its query
on each closed→open transition, and `setOpen` resets it to empty; opened by the sidebar trigger, the Search tab and the
`command-palette` (`mod+k`) and `search` (`/`) commands in `commands/palette.ts`). `CommandPaletteMount` is the
only mount point (`next/dynamic` ssr:false —
Next 16 requires that in a client component; a new `CommandPalette` prop flows through it) and also
publishes `recents` into the command registry's context through `commands/provider.tsx`'s
`usePublishCommandContext` (withdrawn on unmount), so `ActionContext.canEdit`/`routeTrack` come from the same
data the palette renders with. `CommandPaletteRecents`
(async RSC) passes the cookie project's `recents` (whole track and session lists; `CommandPaletteMount` slices them
into `PaletteRecents` with the sidebar's `recentTracks`/`recentSessions` under `useShellPolicy()`), plus `projectId`,
`canEdit` (editor+, from `cachedProject`'s role — the palette mounts above `ProjectProvider`, so `useProjectRole()` is
`null` there) and `allTracks` (`{ id, title, archived }` for every track). The palette uses `canEdit` and `allTracks`
only when the URL's project is the cookie's; `routeTrackFrom(route, allTracks)` gives `ActionContext.routeTrack`, a
track missing from the summaries (just created) counting as live. It also passes `settings`: `settings-results.ts`'s
`settingResults({ isAdmin, project })`, every setting the caller can open in the hub (the hub's own `hubLayout` for
`settingsReceivedBy(isAdmin)`, `cachedIsInstanceAdmin()` and the current project, as the hub resolves its pages
outside the Project section), each once, at its own group's row (`settingsHref({ …, key })`). `CommandPalette({
recents, settings })` guards with `should-render-palette.ts` `shouldRenderPalette(projectId, route)`: every
signed-in page but a URL inside a project that no route resolves; whatever needs a project gates on
`isInProject` and is absent, not disabled, off one. Its project is the route's, or on a hub Project page the one
`settingsProjectId` reads from the URL (search, `filter` and the project actions work there as they did on the
old project settings; recents show only when the cookie names that project). A query matches settings as the hub's search does
(`matchSettingResults`), listed first under Results as "Setting · <label>" over its group's label, and choosing
one navigates to its href without a project. Query order: pending collection op →
`collection-op.ts` `matchCollectionOpPrefix` (`add `/`move `; move only when the route has a `collectionId`;
`planCollectionOp` → remove/add steps) → `prefix-match.ts` `matchPrefixCommand(commands, query, aliases)` (every
command's own prefix first, then the shell policy's `paletteAliases`, extra words mapped to a command id, each
opening its command once typed in full and followed by a space) → plain search (`use-search.ts`
`useSearch(projectId, q, {types, limit, enabled})` → `GET /api/projects/{id}/search`, 150 ms debounce, abort on
change); a result with `archived` (the server ranks those last) shows `ArchivedFlag` after its title.
`action-context.ts`: `matchActions(commands, query)` matches on `` `${group} ${label}` `` so "go to project" and
"new track" find their commands under their groups (used on the registry's own `Command`s, grouped by
`commands/types.ts`'s `CommandGroup` — Playback, Queue, General, Go to, New, Help, Table, Notebook, Lab, Track — the same headings
the shortcuts overlay lists under); `resultHref`, `PREFIX_COMMANDS` (`play`/`queue`/`playnext`, `go`, `note`,
`theme`, `volume`, `speed`, `pitch`, `seek`, `set` (a field on the page entity or one of its project's custom
fields), `new track `, `new session `, `filter` (in a project), `status`/`priority`/`label`/`unlabel` on track
pages; `priority` lists the current project's levels (`getPriorityLevels`) whose name holds the remainder, in
the scale's order with an exact name first, and writes `priorityId` through `patchField`; `mode: "async"` commands
get an `AbortSignal`), `matchPrefixCommandCandidates`. `use-prefix-command.ts`
`usePrefixCommandResults` (debounced, abortable). An empty query shows the shell policy's `paletteEmptyGroups` in
its order — `actions` (grouped by `group`), `recent-tracks`, `recent-sessions` by default — through
`empty-groups.ts`'s `emptyQueryGroups(order, sizes)`, which drops a group with nothing in it.
`CommandDialog` is full-screen below 768px. Every action row shows its bound combo, read live off
`useCommands()` (`commands/provider.tsx`) and formatted with `hotkeys/combo-format.ts` `comboLabel` — never
a literal on the command, so the two can't drift. Prefix commands are kept even once the palette narrows to one:
picking a surfaced prefix candidate (`matchPrefixCommandCandidates`) fills the input with the full prefix rather
than running anything, so the user can keep typing the argument.

**Hotkeys** (`commands/`): the registry a key, the palette and the shortcuts overlay all read. `types.ts` is the
contract — `Command` (id, label, `group`, optional `keys`/`scope`, `when`, `run`, an optional `palette` entry with
its icon, `countable`, `allowInInput`) and `ListedCommand` (a command with its live `keys` and `available`).
`define.ts`'s `defineScope<Surface>(name)` names a scope and the shape of what a push of it attaches (`GLOBAL`,
the scope with no surface; `DIALOG_SCOPE`, pushed modal by an open dialog); `defineCommands(scope, specs, { alsoIn }?)`
stamps a list of `CommandSpec`s with that scope's name (and `alsoIn`'s scope names) and validates at load — throws on a duplicate id or a key
`parseCombo` cannot read, so a typo never reaches the keymap. `group` (`CommandGroup`: Playback, Queue, General,
Go to, New, Help, Table, Notebook, Lab, Track) is the heading a command sits under in the palette, the shortcuts
overlay and the web guide's keyboard shortcuts. One file per area declares its commands with these:

- `navigation.ts` (`NAVIGATION_COMMANDS`) — the `g`/`n` chords, including `g a` archived tracks, `g l` samples and
  `g u` plugins, and the palette's "Go to"/"New" destinations.
- `palette.ts` (`PALETTE_COMMANDS`) — `command-palette` `mod+k`, `search` `/`, and `keyboard-shortcuts` `?`, off on
  a coarse pointer, there being no keyboard to list; `SHORTCUTS_SCOPE`'s `close-keyboard-shortcuts`, also `?`.
- `player.ts` (`PLAYER_COMMANDS`) — transport and queue for whatever is loaded. `space`, which with nothing loaded
  on a track page plays the route's track through `playRouteTrack` (`tracks.ts`) and elsewhere does nothing; the
  arrows ± a small step and `shift`+arrow a large one; `]`/`[`; `m` mute (`shift+m` does not mute); `-`/`=` volume
  and `<`/`>` speed, 5% a press (`KEY_STEP`; the sliders' hundredths are too fine for a key), leaving the clamp to
  the store; `p` opens the now-playing sheet on the player pane or closes it; `shift+s` shuffle, `shift+r` repeat;
  `seek-to-0`…`seek-to-9` on `0`-`9`, generated from a table, each `yieldsToCount` so a digit builds a count
  instead of seeking where a countable command answers, and `palette.hidden`. Volume, speed, `p` and the seek ten
  are `when` a track is loaded.
- `settings.ts` (`SETTINGS_COMMANDS`) — `toggle-theme`, `d`.
- `tables.ts` (`TABLE_COMMANDS`, `TABLE_SCOPE`) — the row cursor's keys; see the row cursor, above. `archive-row`
  (`e`) is the one `repeatable` command.
- `views.ts` (`VIEW_COMMANDS`, `VIEW_SCOPE`) — `toggle-board-view` on `b`, "Board or list", in group "Table".
  `ViewSwitcher` pushes the scope while mounted, so the key works only on a page that has a board, and its
  `toggle()` is the same `?view=` router push as clicking the other tab.
- `grid.ts` (`GRID_COMMANDS`, `GRID_SCOPE`, group "Table") — the cell selection's moves on the arrows, its
  extensions on `shift`+arrow, `mod+a` select all, `mod+c` copy and `Enter` to edit. The cell grid pushes it
  `onTop` while DOM focus is inside the grid and no cell editor is open, so it outranks the table's `Enter` and the
  player's seek arrows for as long as a cell holds focus.
- `tracks.ts` (`TRACK_COMMANDS`) — `play-this-track` and `archive-track`/`unarchive-track`, global and `when` on a
  track page's own track; `archive-track` is on `e`, `unarchive-track` keyless. `playRouteTrack(ctx)` is the body
  `play-this-track` and `play-pause`'s nothing-loaded fallback share; `routeTrackFrom` looks the route's track up in
  the project's summaries, a track missing from them (just created) counting as live.
- `entity.ts` (`ENTITY_COMMANDS`, `ENTITY_SCOPE`, group "Track") — `previous-track`/`next-track` on `{`/`}`, router
  pushes of the running order's hrefs, `when` a neighbour exists; `s`/`!`/`t` (`set-status`, `set-priority`,
  `set-labels`) call `palette.openWith("status " | "priority " | "label ")`, present for an editor on a track page.
  The scope's surface is `{ previousHref, nextHref, handler(name) }`, where `handler` returns what a control
  registered under an `EntityKeyName` (`rename`, `comment`, `upload`, `delete`, on `r c a mod+Backspace`); each
  command is present only while its control has a handler registered, and `run` calls it. `InlineTitleEditor`
  registers `rename` (the viewer can edit and is not already editing), `AudioCommentPanel` registers `comment`
  while an audio version is selected (opens its comments popover with the audio's composer focused through the
  popup's `initialFocus`, or focuses the composer when the popover is already open), `TrackAudioSection` registers
  `upload` (opens the manage dialog) and `TrackRailActions` registers `delete` (`deletion.request()`, so the delete
  gate's confirm applies). `commands/entity-surface.tsx`'s `EntitySurfaceProvider` is the one push, rendered by
  `modules/track/page.tsx` around the page with the hrefs the server page computed from `runningOrder` (null at the
  ends and when the track sits in no collection), pushed while the page is mounted, track pages only.
  `useEntityKey(name, fn, enabled = true)` registers a control's handler while it is mounted and enabled, and does
  nothing where no provider is mounted, as on `/share`.
- `lab.ts` (`LAB_COMMANDS`, group "Lab") — `toggle-lab` `l`; `toggle-mono`/`toggle-dim` on the chords `h m`/`h d`
  rather than `shift+m`/`shift+d`, which sit a stretch of the hand away from the `m`/`d` they would be beside (the
  grammar does produce `shift`+letter, as `shift+s` and `shift+r` show; the reason is reach, and `h` for "Hear it
  as"); `open-lab`; and `TRACK_AUDIO_SCOPE`'s `swap-compare`, `v`, while the compare state is ready.
- `peek.ts` (`PEEK_COMMANDS`, `PEEK_SCOPE`, group "Table") — `peek-previous`/`peek-next` on the bare arrows and
  `k`/`j`; `PeekPanel` pushes it while it shows a row. Pushed innermost, it outranks `PLAYER_COMMANDS`' global seek
  arrows on the same keys for as long as the panel is open.
- `queue.ts` (`QUEUE_COMMANDS`, group "Queue") — global `show-queue` `q` opens the now-playing sheet on its queue
  view, or closes it when the sheet already shows that view; `QUEUE_SCOPE`: `j`/`k` move a cursor through the
  upcoming entries and clamp at the ends, `x` removes the cursor's entry and `Enter` jumps to it, each hidden by
  `when` while its surface action is `null`. `QueueList` owns the cursor as an index into `upcoming`, clamped at
  read, rings the row with `data-cursor`, and pushes the scope while mounted; on `/share` there is no provider and
  the push is a no-op.
- `comments.ts` (`COMMENTS_COMMANDS`, `COMPOSE_SCOPE`) — `send-comment` on `mod+Enter`, `allowInInput` so it fires
  from the composer's own textarea; `CommentCompose` and a `CommentList` reply box each push it while focus is
  anywhere inside their compose box, tracked with `onFocus`/`onBlur` and a `relatedTarget` containment check rather
  than a scope tied to open state.
- `history.ts` (`HISTORY_COMMANDS`, group "General") — `undo` `u`, `when: hasUndo()`, runs `undoLast()`;
  `repeat-last-command` `.`, running `ctx.repeatLast()`. Neither is `repeatable`, so neither is ever the command
  `.` repeats.
- `notebook.ts` (`NOTEBOOK_COMMANDS`, group "Notebook") — two scopes. `NOTEBOOK_SCOPE`, pushed by `NoteList` while
  mounted: `j`/`k` open the next/previous note in the list's visible order (pinned first, after the filter, clamped
  at the ends, `j` opening the first and `k` the last when no note is open) and `f` focuses the filter input.
  `NOTE_SCOPE`, pushed by `NoteEditor` only on `surface === "notebook"` so it never shadows a track page's keys:
  `y` copies the note's text and `t` opens the link dialog, absent while the note's rights or saved state do not
  allow it, as the `⋯` menu's own items are.
- `dialogs.ts` and `command-bar.ts` — `confirm-dialog` and `command-prompt`; both are described below.
- `index.ts`'s `COMMANDS` concatenates every area's list and calls `assertUniqueIds` again across all of them.

`commands/shortcuts-doc.test.ts` keeps the web guide honest: `apps/web` cannot import the registry, so
`apps/web/src/content/docs/docs/guide/search-and-shortcuts.mdx`'s "Keyboard shortcuts" is kept by hand, one `###`
section per `group` in the overlay's order (global groups first, then the scoped ones), and the test reads it from
the repo root. It fails, naming the command id and group, when a keyed command's key is not in its group's section
or a section lists a key none of the group's commands has. It compares keys, not labels: each `<kbd>` is read back
into the keymap grammar (`Ctrl`/`⌘` are `mod`, consecutive keys a chord, a leading modifier such as `Shift with ← / →`
holds for the alternatives after it, `0`–`9` a range, the Mac spelling in `( )` is skipped). Adding, moving or
re-keying a command means editing that table in the same change.

`provider.tsx` is the engine. `CommandRegistry` (exported for a test to render standalone, `tables/test-support.tsx`
among them) builds one `Keymap` (`@workspace/ui/lib/keymap` `createKeymap`) from a `commands` list and owns the
single `window` keydown listener; a scoped command is unavailable — not dispatched, greyed in the overlay, absent
from the palette — while its scope has no push. `useCommandScope(scope, surface, active, { modal, onTop })` pushes
`scope` while `active`, attaching `surface` for the scope's commands to read as `ctx.surface`; a surface pushes
when it has the user's attention (a table under the pointer or focus, a dialog on screen), and the innermost push
of a scope is the one its commands see. `run(command, count)`, which a key and the palette both go through,
records `{ id, count }` when the command is `repeatable`; `ctx.repeatLast()` re-runs that record through the same
path when the command is available now, and does nothing otherwise. The registry's `subscribe` also follows
`subscribeUndo`, so `u`'s availability stays current in the palette and overlay. `onTop` keeps a push innermost even when another scope pushes above it —
only `ShortcutsOverlay` uses it, so its own `SHORTCUTS_SCOPE` stays on top of a dialog's `DIALOG_SCOPE` and `?`
closes the overlay rather than reaching whatever opened under it. `useModalScope(open, surface)` wraps it for
`DIALOG_SCOPE`. `CommandProvider` renders `CommandRegistry` with `COMMANDS` and the app's `ActionContext` — the
route, player, theme, policies, the shortcuts overlay's own open state (`useShortcutsOverlay()` → `{ open, setOpen }`,
so `ShortcutsOverlay`'s `?` and the palette's `keyboard-shortcuts` command share one piece of state instead of a
second key listener) and the palette recents `usePublishCommandContext` publishes (`canEdit`, `routeTrack`, both
`false`/`null` until published). It passes the effective `keybindings.client` setting through
`clientKeyOverrides` (`key-overrides.ts`) as the registry's `overrides`: an empty override for a reserved command
(`?`, `mod+k`) is dropped, and `close-keyboard-shortcuts` takes the keys of `keyboard-shortcuts` whatever is stored
for it. Hooks: `useCommand(id)`/`useCommands()` (every command, live keys and
availability), `useRunCommand()` (runs a command by id with the current context, as its key would),
`useKeymapState()` (the keymap's scope stack, pending chord, count and candidates), `useActionContext()`,
`useModalScope`, `useCommandScope`, `useShortcutsOverlay`, `usePublishCommandContext`.

`dialogs.ts`'s `DIALOG_COMMANDS` is one command in `DIALOG_SCOPE`: `confirm-dialog`, `mod+Enter`,
`allowInInput` (so it fires while a dialog's field has focus), available while `ctx.surface.confirm` is set,
running it. `packages/ui` cannot import this registry, so the push comes from the other side: its own
`lib/modal-scope.tsx` (`ModalScopeProvider`, `useModalScope(open, surface)`) is the seam, doing nothing where
no provider renders (signed-out pages, `apps/web`). `CommandProvider` fills it — a
`ModalScopeBridge` inside `CommandRegistry` renders `ModalScopeProvider` with a pusher that calls the same
`core.pushScope(DIALOG_SCOPE.name, ..., { modal: true })` `useCommandScope`/`useModalScope` above call, so a
ui dialog and a client push land on one stack, the innermost win rule (nested dialogs) included. `dialog.tsx`'s
`DialogContent`, `alert-dialog.tsx`'s `AlertDialogContent` and `sheet.tsx`'s `SheetContent` call the ui
`useModalScope` themselves while open (`useOverlayPresence`'s `open`, the value `AnimatePresence` itself mounts
and unmounts on), so every modal sheet (`NowPlaying`, `RowActionSheet`, `FilterSheet`, `BottomSheet`) silences
the page's keys as a dialog does. The push is a layout effect, so it lands before a passive-effect push the
overlay's content makes (`QueueList`'s `QUEUE_SCOPE` inside `NowPlaying`) and that scope stays above it and
answers. `NowPlaying` pushes `NOW_PLAYING_SCOPE` (`define.ts`, no surface) the same way, from `NowPlayingScope`
inside `SheetContent` and only while the sheet is open, so it stands above the sheet's modal push; the
commands that declare `alsoIn: [NOW_PLAYING_SCOPE]` (`PLAYER_COMMANDS`, both blocks of `LAB_COMMANDS`, and
`QUEUE_COMMANDS`' `show-queue`) answer inside the sheet, while the page's keys stay silent. `swap-compare` (`v`)
is declared in `TRACK_AUDIO_SCOPE` and answers inside the sheet only while a track page's Audio section is
comparing, since its surface is still that page's push. `Command.alsoIn`
and `defineCommands(scope, specs, { alsoIn })` only widen where the keys answer; a command's surface and
`available()` stay those of its own `scope`. `PeekPanel` passes `SheetContent` `modalScope={false}`: the
table's `j`/`k` keep moving the peeked row beside it. `DialogContent`'s
confirm is `requestSubmit()` on the `<form>` inside its popup, if there is one, nothing otherwise;
`AlertDialogContent` takes an explicit `confirm` prop instead, since an alert dialog is never a form —
`confirm-delete-dialog.tsx`'s `ConfirmDeleteDialog` passes its own confirm button's action, `undefined` while
`pending` or the typed `confirmText` does not yet match, so `mod+Enter` respects the same disabled state the
button shows. `command.tsx`'s `CommandDialog` (the palette) passes `DialogContent` `modalScope={false}`: it
toggles itself with the global `command-palette` command's `mod+k`, and silencing the global scope beneath a
push would take that key with it.

**Command bar** (`command-bar/ClientCommandBar.tsx`): the desktop key strip over the registry, mounted by
`(app)/layout.tsx` inside `<main>` as a row of its own, after the page's wrapper for `position: "bottom"` and
before it for `"top"` (the layout reads the position off the server's policies), so it spans the inset column
only and the page shrinks by its height: nothing is fixed, and no `--dock` padding is involved. It renders the ui
`CommandBar` (`packages/ui/src/components/command-bar/command-bar.tsx`) with `position`/`mode` from the shell
policy's `commandBar` (`{ enabled, position, mode }`), and nothing when `enabled` is false or below the `md`
breakpoint (`useIsMobile()`; phones keep the dock and the palette). At rest it lists the keyed commands a press
would run now (`useKeymapState().candidates`, which already leave out unavailable commands and what a modal
scope silences), each with its live keys from `useCommands()`, innermost pushed scope first and the global scope
last; it is clipped, not capped, and the trailing `? Keys` hint, a button, opens the shortcuts overlay
(`useShortcutsOverlay()`), so the `keyboard-shortcuts` command is not also a row. While a chord is pending the
bar shows the typed keys and the commands that continue it; while a count is typed, the count. `mode: "pending"`
shows the bar only then (no modifier tracking: the keymap has no held-modifier state). Only the bar that
renders (the inner `MountedCommandBar`) pushes the `command-bar` scope (`commands/command-bar.ts`), whose one
command, `command-prompt` on `:` (General), calls `surface.openPrompt()`; with the bar off, on the other edge or
on a phone nothing pushes it and `:` does nothing. The bar's `prompt` is that line: while it is open the bar
pushes `command-prompt` as a modal scope (never `onTop`), so keys type into the input instead of firing, and
Escape or a choice closes it. `command-bar/use-bar-prompt.ts` reads the line with the palette's prefix engine
(`matchPrefixCommand` with the policy's `paletteAliases`, then `prefixCandidates` in
`command-palette/use-prefix-command.ts`, which the palette shares for the availability filter): a complete
prefix offers that command's rows (`usePrefixCommandResults`) and choosing one runs `command.run(row, ctx)`; a
partial one offers the available commands, and choosing one completes the line and keeps the prompt open.

`ShortcutsOverlay` (`hotkeys/ShortcutsOverlay.tsx`) lists every command with keys, grouped — global first, then
each scope a surface pushes, in first-seen order — greying one whose `available` is false rather than dropping it,
so a page shows what the keyboard could do here even where it currently can't. Each group is a `section`
labelled by its `h3` and holds a `ul` of rows (`ShortcutSection`, `ShortcutRow`); keys are `ComboCaps`
(`hotkeys/combo-caps.tsx`, the one drawing of a combo's caps, shared with the settings hub's `KeyCapture`), read to a
screen reader with "plus" between held keys and "then" between chord steps, and a greyed row carries
`data-available="false"` and an sr-only "(not available on this page)". The list scrolls in its own focusable
region under the dialog's fixed header. A modal `onTop` push of its own
`SHORTCUTS_SCOPE` keeps `?` bound to closing it over whatever else is open. It is off on a coarse pointer, there
being no keyboard shortcuts to show. `combo-format.ts`'s `comboKeys` is the same combo-splitting the palette's
`comboLabel` reuses for its single-line hint.

`tables/test-support.tsx` wraps a rendered table in `CommandRegistry` (`TABLE_COMMANDS`, a stub `ActionContext`)
so the row cursor's keys run through the real registry rather than a stand-in, and its `pressHotkey(combo)`
dispatches a real `window` `keydown` `KeyboardEvent` (one press; `mod+`/`shift+` prefixes set the modifiers)
rather than calling a handler directly, pointer-entering the
last grid on the page first so a page-scoped and a focus-scoped table under test both claim `TABLE_SCOPE`.

`sidebar.ts`'s `SIDEBAR_COMMANDS` is one global command, `toggle-sidebar` on `mod+b`, running
`ctx.toggleSidebar()`; `CommandProvider` fills it from `useSidebar().toggleSidebar`
(`@workspace/ui/components/sidebar`), which no longer owns its own `window` keydown listener for the key. It is
not `allowInInput`, so `mod+b` inside a text field is left to the field (bold in an editor).

`grid.ts` (`GRID_COMMANDS`, `GRID_SCOPE`, group "Table"): the cell grid's arrows, `shift`+arrows, `mod+a`, `mod+c`
and `Enter` ("Edit cell", `when: surface.enter !== null`, so a read-only cell leaves `Enter` to the table's "Open
row"). `useCellClipboard` builds the surface; `useCellGrid` pushes the scope while `focusInGrid` (from
`useRowCursor`) and no editor is open. It is a plain push and wins by being innermost: `useCommandScope`
re-pushes only when `active` flips, the table's focus/pointer push is active whenever the grid's is, and
`DataTable` calls `useCellGrid` after `useRowCursor` so the grid's push lands second when both flip in one commit;
an editor closing re-pushes the grid on top. Only the shortcuts overlay uses `onTop`. Type-to-edit stays in the
grid element's `onKeyDown`. A cell carries `role="gridcell"`; `isActivationTarget(target, combo)` does not let a
gridcell claim `Enter`, so `Enter` reaches the keymap, while space on a cell stays inert as on any other role.

**Sidebar** (`sidebar/`, desktop only — `ResponsiveSidebar` = `Sidebar collapsible="offcanvas" mobile="hidden"`):
`AppSidebar` (RSC) streams two `cachedShellData()` readers — `AppSidebarHeader` (project switcher, then with a
current project `SidebarSearchTrigger` and View project, then Settings on every page, to `SETTINGS_HREF`) and
`AppSidebarGroup({ project? })` — plus a footer with `SidebarAccount` (avatar dropdown: Profile, Settings,
`SignOutDropdownMenuItem`) and a hide trigger; footer clears the
anchored player card (`--player-card`). `AppSidebarGroup` (RSC) hands
`SidebarSections({ sections })` (client) each section it has, with whole, unsliced lists; the client lists in
`SidebarRecents.tsx` (`SidebarCollections`, `SidebarRecentTracks`/`Sessions`/`Notes`) apply the shell policy via
`useShellPolicy()`, so a setting change re-slices and re-orders without a server render — Collections (`SidebarCollectionItem`, lazy
`clientGetCollectionTrackSummaries`, ordered by `sidebar-lists.ts`'s `orderCollections(collections,
sidebarCollectionOrder)`: `release` (newest release first, then undated by title — `collectionSorter`), `title`,
`edited`), Tracks (`RecentlyEdited` with `ArtSwatch`), Notebook (the newest notes, rendered even without a project),
Sessions — as `{ label, hrefNew?, newLabel?, hrefAll?, children }` by id. `SidebarSections` shows them in the policy's
`sidebarSections` order, leaves out those it hides and those the page did not hand over, and starts each collapsed as
the policy says; a fold the viewer makes is held there for the session. `sidebar-lists.ts`'s `recentTracks`/
`recentSessions`/`recentNotes(items, policy)` take the policy's `recentItems`, dropping archived tracks and sessions
of archived tracks first while `recentsSkipArchived`, so the lists stay full; the palette's recents reuse them.
`RecentlyEdited` is a component over
`{ id, label, href, swatch? }[]`. `RecentlyEdited` renders its own "Recently edited" caption and nothing at all when empty.
`CollapsibleGroup({ label, hrefNew?, newLabel?, hrefAll?, collapsed, onCollapsedChange })` is controlled: it shows
`collapsed` and reports a toggle, the state held by its owner (`newLabel` names what the "+"
creates — "New track" — since `label` names the group; it doubles as the link's `aria-label` and its Tooltip,
and the chevron trigger's own `aria-label` toggles "Collapse {label}"/"Expand {label}" with open state). `SidebarReveal`
(reopen trigger, lives in the player card). `AppSidebarHeader` wraps the project switcher in
`LeaveProjectScope` (`LeaveProjectDropdownMenuItem.tsx`), which holds the `LeaveProjectDialog` beside the menu so it
outlives the menu's content; `LeaveProjectDropdownMenuItem` (every build, only while a project is current) opens it.

**Phone chrome** (`dock/`, `md:hidden`): `Dock` (in `(app)/layout.tsx`, `currentProjectId` from the cookie →
`CurrentProjectProvider`/`useCurrentProjectId()`) is the fixed bottom container: `MiniPlayer` above `TabBar`,
safe-area padded; `TabBar`'s `<nav>` carries `data-slot="tabbar"`, which `globals.css` reads with a
`:has()` selector so the tab bar reserves its share of `--dock` from first paint; `Dock.tsx` still sets
`body[data-miniplayer]` (track loaded) as an effect, since that state is client-only. Renders nothing when
neither row has anything to show. `tabs.ts`: `TabContext = { projectId: number
| null, route: ParsedRoute | null, pathname }`; `Tab` = `{ kind: "link", href(ctx), longPressHref?(ctx), isActive }`
| `{ kind: "palette" }`; `TABS` = Collections · Tracks · Notes (long-press → new note) · Sessions · Search, each `id` a
`DockTabId`; `TabBar` shows `dockTabs(useShellPolicy().dockTabs)` — the listed tabs in the listed order, each once,
however few. A link tab whose `href` is null is skipped; no tab lights on the project root or in the settings hub.
`hooks/use-tab-context.ts` widens `hooks/use-current-route.ts` (`{ projectId, route } | null`, `/project/:id` only) to
`/notes` using the cookie project, and to `/settings` using the project its Project section names, else the cookie's. `TopStrip` (async RSC, `min-h-11` + top safe area, mounted by the project layout, notes layout, `/`, and
with `back` on `/profile` and `/project/new`; always inside `Suspense`): `ProjectSwitcherSheet` or a back link,
plus `JobsTraySheet` and `AccountSheet` (Profile, Settings → `SETTINGS_HREF`, theme, Sign out). `BottomSheet({ title, trigger, open?,
onOpenChange? })` + `SHEET_ROW` (48 px
rows) back both sheets and `RowActionSheet`.

**Jobs** (`jobs/`): `JobsProvider` (in `(app)/layout.tsx`; project from `useCurrentRoute`, or on a hub Project URL
`settingsProjectId`, reads nothing outside those; `JobsRole`, mounted by the project layout and by `HubPage`'s
Project section, gives it the caller's role for `canManage`) holds one `Map<number, Job>` fed by `jobs-stream.ts`'s `createJobsStream` — a framework-free
controller opening `EventSource("/api/projects/{id}/jobs/events")` while the tab is on screen, applying its
`snapshot`/`job` events (`applyEvent` in `jobs-poll.ts`), falling back to a timed poll of the collapsed read
`clientGetProjectJobs(id, recentMs)` on a stream error (`fallbackDelay`: 2 s while active, 60 s idle, paused
hidden, stream retried every 30 s), and pruning a `done`/`cancelled` row `LINGER_MS` (4 s) after `finishedAt`
(`lingerUntil`/`pruneLingering`). Every side effect (transport, fetch, timers, clock) is injected, so the
controller is unit-tested with a `FakeEventSource` and a hand-driven fake clock, no DOM. `useJobs()` →
`{ jobsById, loaded, canManage, cancel, retry, clearFailed, subscribe, setRole }` or `null` outside the shell;
`useProjectJobs()` reads it in tray order (`orderJobs`: running, then queued by position, then lingering, then
failed); `useJob(id)` reads one row live, for `PROJ-802`'s uploaders; `useJobsLoaded()` (`loaded` — whether the
project's map has done its first real read, stream or fallback) is `use-tracked-job.ts`'s signal that the map has
had its chance and a job still missing from it is worth a direct read instead. Clearing failed jobs is a delete the
server sends no event for, so the provider drops those rows from the map itself (`stream.remove`) rather than
waiting on one.
`subscribe(observe)` hands an observer the running and queued jobs after every update (and the latest read at
once, when one has landed); two hooks wrap it. `useJobsDrain(kinds, onDrain)` subscribes a `createDrainWatch`:
fires on the first read that finds none of `kinds` running or queued, then on present → absent, so it waits for
every job of those kinds. `useJobsFinish(kinds, onFinish)` subscribes a `createFinishWatch`: fires once per update
in which any job of `kinds` seen running or queued is no longer, whatever else is still in the queue, and never on
the first read. `JobsRole({ projectId, role })` (project layout) sets
`canManage` (editor+), because the provider sits above `ProjectProvider`. `JobsTray` (sidebar header,
beside `SidebarSearchTrigger`, `Popover`) and `JobsTraySheet` (`TopStrip`, `BottomSheet`) show `trayIndicator`:
spinner while running, a tick for the one second after a `done` row's `finishedAt` (no recurring clock — a
one-shot timer schedules exactly that boundary), `text-danger` warning while failed jobs exist, hidden
otherwise (kept while open). The row tree (`JobRow` → `RunningJobRow`/`JobRowLayout` over `Row`/`RowMain`/
`RowTitle`/`RowMeta` + `Meter`) is its own module, `JobRow.tsx`, which `JobsTray.tsx` and the project page's
`JobsSection` both render. A row's text is `describeJobRow` (`job-row.ts`, pure): the eyebrow is the
server's `label` plus ` · ${subjectLabel}` when present, the title is `steps[stepIndex].label` (falling back
to `label` before a run claims the row), "Step N of M" hidden for a one-step ladder, "Queued · #N" from
`queuePosition` (the place in the server's process-wide queue, so it has no project-scoped total), and elapsed/"Done"/"Cancelled" for the rest — the client keeps no kind-to-label map. Only a
running row ticks a local `useNow(1000)` (`hooks/use-now.ts`) for its elapsed time; every other row is static,
so a second passing re-renders one row, not the tray or the provider's tree. `Meter` shows the percent figure
(`showValue`) on running rows only. Cancel shows on queued and running rows when `canManage`
(`clientCancelJob`; a 409 means the job already finished, so the stream's own row is left to arrive); Retry
shows on failed rows — identical failures (same kind, subject, step and error) collapse into one row with a
"×N" count through `groupFailures` (`job-row.ts`), and its Retry retries every job in the group — and the Failed
heading carries Clear (`clientClearFailedJobs`, deletes every failed job
of the project, empties the list at once).

**Policies** (`lib/policies/`): every playback, Lab and drawing rule that used to be a literal is a field of one
of three policy objects whose defaults are those literals. `playback.ts` `PlaybackPolicy`/`DEFAULT_PLAYBACK`
(`defaultVolume`, `startMuted`, `repeat`, `shuffle`, `persistQueue`, `seekSmallSeconds`/`seekLargeSeconds` and
`seekStep(policy, large)`, `previousRestartsAfterSeconds`, `queueEnd: "stop"|"rewind"|"clear"`, `queueingStarts`,
`rowPlayContext: "collection"|"track"`, `versionToPlay: "primary"|"latest"`, `noAudioFallback:
"attachment"|"none"`, `analysisOnTouch`, `crossfadeSeconds`); `lab.ts` `LabPolicy`/`DEFAULT_LAB_POLICY`
(`timePitchMode`, `speedRange`/`pitchRange` inside `SPEED_MIN..MAX`/`PITCH_MIN..MAX` and `clampToRange`,
`rememberAuditions`, `keepEngaged`, `releaseDelayMs`, `normaliseTargetLufs` and `normaliseLabel`, `compressor`,
`reverb`, `eqPreset`, `bounceFormat` with `BOUNCE_EXTENSIONS`, `bounceNameTemplate` with `{title}`, `{version}`,
`{settings}`, `{details}`; `labSettingsFrom(policy)` is the Lab a fresh browser starts with); `visuals.ts`
`VisualsPolicy`/`DEFAULT_VISUALS` (`loudnessReferenceLufs`, `meterBallistics` — a multiplier on every meter's
attack and release through `meter-ballistics.ts` `scaledBallistics` — `waveformDetail`, the pixels a waveform bar
takes (`barCountFor(width, pitch)`), `waveformHeight` (the track page's `WaveSize`), `strips`, `lavaField`,
`artBreathes`). The meter's loudness reference and the Lab's normalise target are two fields with the same
default. `shell.ts` holds two more. `ShellPolicy`/`DEFAULT_SHELL` lays the shell out: `sidebarWidthRem`,
`recentItems`, `recentsSkipArchived`, `sidebarSections` (`{ id, shown, collapsed }` over `SIDEBAR_SECTIONS`),
`sidebarCollectionOrder: "release"|"title"|"edited"`, `dockTabs` (`DOCK_TABS` ids, in order), `paletteResultCap`,
`paletteAliases` (word → prefix command id), `paletteEmptyGroups` (`PALETTE_EMPTY_GROUPS`),
`projectHomeSections` and `entityPageSections.{collection,track,session}` (`PageSection<Id> = { id, shown }` lists
over `PROJECT_HOME_SECTIONS`, `COLLECTION_PAGE_SECTIONS`, `TRACK_PAGE_SECTIONS`, `SESSION_PAGE_SECTIONS`; collection and track pages carry
a `repositories` id (after `tracks` and `sessions`, labelled "Repositories") that a list stored before it gains at its end, rendered by
`components/layout/PageSections.tsx` through `shownSections(list)` — listed order, hidden ones out, each id once),
`inventoryDefaults` (`plugins: { origin, stock }`, `samples: { show, library, stock }`), `afterCreate: "open"|"stay"|
"add-another"`, `audioCommentPinned` and `commandBar` (`{ enabled, position: "bottom"|"top", mode: "always"|"pending" }`
over the `commands` group's `COMMAND_BAR_POSITIONS` and `COMMAND_BAR_MODES`; default off, desktop only). `FeedbackPolicy`/`DEFAULT_FEEDBACK` is how the app answers back: `haptics`,
`toastDurationMs` and `toastPosition` (sonner's own 4000 ms and bottom-right), `confirmDeletes` (a record over
`DELETE_KINDS`: `project`, `collection`, `track`, `session`, `note`, `status`, `label`, `file` (a Files-table row),
`attachment` (from an entity page's list), `audioVersion` (from a track's audio versions), `comment`, `savedView`,
`shareLink`, `member`, `relationType`, `priorityLevel`, `field`, `fieldOption`, `machine`, `account` — all `true`) and `undoWindowMs`. `confirmPolicy(kind, feedback)` is the one question every
delete asks (a kind the record does not name asks), put by `hooks/use-delete-gate.ts`'s `useDeleteGate(kind,
remove)` → `{ request(target), pending, dialog }`: `request` opens the caller's `ConfirmDeleteDialog` (spread
`dialog` onto it) or runs `remove` at once when the kind's confirm is off; `pending` keeps its target while the
dialog closes, so the copy does not change as it leaves. Every delete that confirms goes through it (the
`DataTable`, `TrackLifecycle`, `DeleteProjectButton`, `NoteEditor`, `ShareLinkRows`, the two saved-view pickers,
`ProfilePage`'s account delete, `LabelItem`, `StatusItem`, `AppAttachment`, `TrackAudioDialog`, `CommentList`).
`policies.ts` `Policies` (one field per policy) and `DEFAULT_POLICIES`, a plain module so a server layout
imports the value; `server.ts` `cachedPolicies(projectId?)` (server-only, React-cached per request and project,
`policiesFrom` over the viewer's effective settings, with the project's layer when given) is the value the `(app)`
and project layouts hand `PoliciesProvider` and what a server component laid out
by a policy reads for itself (the sidebar and the palette's recents read it with no project; the project home
and entity pages and the inventory pages and their compact sections pass their project's id); `provider.tsx` `PoliciesProvider({ policies })` carries the one
value, and `usePlaybackPolicy()`, `useLabPolicy()`, `useVisualsPolicy()`, `useShellPolicy()`,
`useFeedbackPolicy()` read one policy each — with no provider above (the share page, a test) the context's default
is `DEFAULT_POLICIES`. The root layout sits above the provider, so its `SettingsHapticsProvider` and
`SettingsToaster` read the `feedback.*` settings themselves. Readers: the seek steps in `Scrub`, `StripRow`,
`TrackWaveform` and `commands/player.ts`'s seek commands; `usePlayback`'s row context and `trackToPlayable`'s version pick and fallback
(the palette's two calls in `command-palette/action-context.ts` pass `ActionContext.playback`); the
speed and pitch sliders in `SpeedPitch` and `SpeedSlider`; the normalise pill's name (`LabAudition.labelFor`);
`LiveLoudnessScale` and `LoudnessStrip`'s reference line (`LoudnessScale`'s required `reference`, `@workspace/ui`'s
`loudnessRuler(reference)`); the meters' ballistics; `NowPlaying`'s lava field; `PlayingLight`'s breath; the
store for everything else below.

**Music player** (`music-player/`): `MusicPlayerProvider({ initial, perProjectTarget? })` builds the store once in a
lazy `useState` from `initial` (with `resolveProjectTarget` unless `perProjectTarget` is `false`, as on the share
page), binds Media Session, keeps the store's rules on the policies provider's (`store.setPolicy` from
`usePlaybackPolicy()`/`useLabPolicy()`) and calls `store.restoreQueue()` → `PlayerStoreContext` >
`NowPlayingProvider` > `NowPlayingHost` + children. `player-initial.ts` `PlayerInitial = { prefs, lab, policy:
{ playback, lab } }`, `playerInitial(policies)` and `DEFAULT_PLAYER_INITIAL` (plain data, built by the server
layout): `prefs` and `lab` are what a browser with nothing stored starts with; the browser's stored live state
(`music_player_prefs`, `music_player_lab`) overlays them field by field at construction, so the hub's defaults reach
a fresh browser and the player's own controls keep setting live state. `player-store.ts` `createPlayerStore({
createEngine?, runBounce?, bounceDeps?, fetchDiff?, initial?, resolveProjectTarget?, persist?, resolveQueue? })` (tests pass fakes;
`persist` is the `localStorage` stand-in, `null` on the server; a browser gets `lib/dsp/browser-engine.ts`
`createBrowserEngine`): `useSyncExternalStore` shape plus a separate rAF `subscribeProgress/getProgress` channel
(`getProgress()` is on the store, not in `actions`), `getServerSnapshot()` built per store from `initial`
(`snapshotFrom`) — the first client snapshot of a browser with nothing stored equals it, so hydration does not jump
— `setPolicy(policy)`, `restoreQueue()`, `bindMediaSession()` (metadata + `setPositionState` synced on timeline
changes). **The Lab's normalise target is the playing track's project's**, wherever the viewer is in the app: the
global player sits outside the project layout's settings provider, so the store asks `resolveProjectTarget`
(`project-target.ts` `createProjectTargetResolver(read)`, built by the provider over
`lib/settings/browser-read.ts` `readEffectiveSettings` — the read `SettingsProvider`'s browser transport also
makes — and `labFrom(values).normaliseTargetLufs`) for the `projectId` of each track it adopts, and again when the
metadata loader gives the playing track one (tracks built from a bare track id or attachment carry none until
then). The resolver keeps one promise per project for the session and forgets a failed read, so the next track from
that project asks again. `loudnessOf(track)` returns the answered project target, and `policy.lab.normaliseTargetLufs`
while the read is pending, after a failure, for a track with no project and on the share page (a guest cannot read
project settings); an answer that lands for the still-playing track and differs from what plays re-applies the Lab's
loudness, and `setPolicy`'s retarget never clobbers an answered project target. The target it plays at is published
as the snapshot's `lab.targetLufs` (kept current by `publish`), and the normalise pill's name, the palette row and
the bounce's file name all read it rather than the shell's policy. A project target edited while one of
its tracks plays reaches the player after a reload. **Rules from the playback policy**: `prev` restarts past `previousRestartsAfterSeconds`; the queue's end
runs `queueEnd` (`stop` pauses on the last track, `rewind` loads the first stopped via `player-queue.ts` `rewind`,
`clear` empties); queueing into an idle player plays only with `queueingStarts`; `requestAnalysis()` passes
`analysisOnTouch` to the engine. **Keeping the queue** (`persistQueue`): once `restoreQueue` has read the kept
queue, every queue change writes `music_player_queue` (`player-storage.ts` `queueToStored`: entries in play order
as `{ kind: "version", trackId, trackAudioId }` or `{ kind: "asset", ownerType, ownerId, assetId }`, and the
position) on the 300 ms debounce; `restoreQueue` reads it (`readStoredQueue` drops entries that do not parse),
resolves every entry afresh through `queue-restore.ts` `resolveStoredQueue` (a version through the track's
`clientGetTrackAudios` read and `play-track.ts` `audioToPlayable`, one read per track; any other file through
`clientGetAsset`, `GET /assets/:id`), drops what no longer resolves, holds the position on its entry or the next
one left (`keptPosition`), and loads it stopped — unless the listener started a queue meanwhile. Turning the policy
off forgets the kept queue. **Crossfade** (`crossfadeSeconds`, 0 by default): `publish` re-derives it
(`syncCrossfade`) — the engine is told the next source (`prepareNext`) only when a crossfade is set and only on a
change, and a timer is armed while playing on the crossfade point: the crossfade's length before the end at the
heard rate (the Lab's speed while live, the element's rate otherwise), never before halfway through the track.
`beginCrossfade` re-arms a timer that fired early, overlaps `min(crossfadeSeconds, what is left)`, and on success
advances the queue and `adoptTrack`s the incoming track without `engine.load`; an engine that refuses leaves the
track to end and cut (not retried for that play of the track; the next `adoptTrack` clears it). No crossfade on repeat-one, during a comparison, out of the last
track, or into the same file. `PlayerSnapshot`: `current`, `upcoming: QueueEntry[]`, `isPlaying`, `duration`, `loadError: { assetId,
message } | null` (the current asset's audio load failure, from the engine's `error(assetId, message)` event: the
element's `error` event, or a rejected `play()` while the element's own `error` is set — an autoplay refusal stays
silent; an event for a non-current asset is ignored, an empty message becomes "The audio failed to load"; cleared
by the source's metadata, by loading another asset, and by `retry`; `useLoadError()` is the read), `prefs`,
`volumeControllable`, `compare: { b, active: "a"|"b", matched, phase: "preparing"|"ready"|"unavailable", reason,
diff } | null` (`diff` is the pair's `TrackAudioDiff`, null until read or when the server has none),
`compareProgress` (0..1 in hundredths, a sibling of `compare` so progress re-renders only `useCompareProgress()`), `analyser` (null until a surface asks
for analysis, so a reader that mounted first re-renders when the node arrives), `routed` (whether playback
currently runs through Web Audio: the Lab is live or the elements' graph is built; `useRouted()` is the read), `lab:
LabState` (`settings: LabSettings`, `phase: "off"|"preparing"|"live"|"unavailable"`, `fraction` rounded to
hundredths, `reason`, `source: "original"|"copy"`, `pinned`; `useLab()` for the whole slice, `useLabSettings()` for
settings alone, steady while the Lab prepares). `PlayerActions`: `playNow(items, start?)`,
`playAt(item, position)`, `enqueue`, `playNext`, `next`, `prev`, `seek`, `jump`, `remove`, `move`, `clear`,
`play`, `pause`, `togglePlay`, `retry()` (a no-op without a `loadError`; otherwise drops `loadedSrc` so
`loadCurrent` reloads the same source, and plays it from the start), `toggleShuffle`, `cycleRepeat`, `setVolume`, `toggleMute`, the Lab's `setLabMode`,
`setSpeed`, `setPitch`, `setEqBand(i, patch)`, `setEqOn`, `setEqCurve(gains|null)` (engine only, not persisted),
`setComp`, `setReverb`, `setAudition`, `pinLab`, `resetLab`, `bounce()` (renders, encodes and downloads the
current source locally as a 24-bit FLAC, reporting through the snapshot's `bounce: BounceState | null` — kept as
a sibling of `lab` rather than nested in it, so a checkpoint's `publish()` leaves the `lab` object's reference
unchanged and only `useBounce()` re-renders), `uploadBounce()` (opt-in upload and attach of the last downloaded
bounce to the current project track),
`startCompare(b)`, `swapCompare`, `setCompareMatched`, `endCompare`, `requestAnalysis()`; `matchGains(lufsA,
lufsB)` for loudness-matched A/B. **Comparison** (on the Lab): `startCompare(b)` engages the Lab, calls
`engine.lab.compare.start(b's source)` and routes the matched gains, and reads the pair's diff once through the
store's `fetchDiff` (`clientGetTrackAudioDiff(a, b)`, injected for tests): `compareOffsetSeconds(diff)` (0 unless
`aligned`) goes to `compare.align`, and the same diff is the change strip's map. The comparison is `ready` once
the engine reports `compareState` `ready` and the diff has settled; `swapCompare` does nothing before that.
`setCompareMatched` re-routes with `matchGains`. `endCompare` keeps the audible side: on A it drops B; on B it
calls `compare.end("b")`, puts B in the queue's current slot (`player-queue.ts` `withCurrent`) and adopts it as
the loaded source without `engine.load` (`adoptTrack`, the bookkeeping `loadCurrent` runs for a new source), so
`TrackAudioSection`'s end handler selects B's version. A `compareState` `unavailable` keeps the comparison with
its `reason` but stops holding the Lab. Any `loadCurrent` ends a comparison on A. **On a coarse pointer**
(PROJ-838), `startCompare` reads `isCoarsePointer()` once and sets `CompareState.unmatched`, which the store
keeps for the comparison's life rather than re-reading the pointer mid-way; `compareEngine(state)` picks
`engine.compare` over `engine.lab.compare` for every call `startCompare`, `routeCompare`, `swapCompare` and
`endCompare` make, so an unmatched comparison never reaches the Lab. It skips `fetchDiff` and `compare.align`
entirely — there is no decode to align a structural offset against, so both sources start at the same transport
position — and settles to `ready` at once, since the elements have no download to report progress on. `matched`
starts `false` and stays there; there is no gain stage to ramp, so `AudioCompareControls` shows
`unmatchedCompareLine` in place of the "Match loudness" toggle, and `LabView` shows a line saying so instead of
its sections, since every one of them needs the Lab. `syncLab` treats `compare.unmatched` as an override on the
whole engagement rule below, not an input into it: while one runs, neither a pinned Lab nor a Lab-needing
setting may engage one, and a Lab already live (from before the comparison started) is released **at once**,
skipping the usual delay, rather than kept playing A under the elements' own B. `startCompare` triggers this by
calling `syncLab()` once `compare` already holds the new, unmatched state, before starting the plain comparison,
so a Lab that was live hands back to the element first. **Engagement** (`syncLab`, on
every Lab setting, pin and compare change): `lib/dsp/lab-settings.ts` `labWanted({ settings, pinned, comparing })`
is `comparing || pinned || settingsNeedLab(settings)`; `settingsNeedLab` is time and pitch the element cannot play (speed ≠ 1 in speed or
independent mode, pitch ≠ 0 in pitch or independent mode; linked mode never needs it), a rack block `on`, or any
audition off its default. Wanted engages at once; otherwise the store releases the Lab policy's `releaseDelayMs`
(2 s) after the last reason clears, a comparison ending included, and never once engaged under `keepEngaged`. `lib/dsp/hybrid-engine.ts` `createHybridEngine(events, { createPlain, createLab, destroy? })` is the
`AudioEngine`: the element engine is created at once and the Lab on first engagement; each engine gets its own
event object and only the live one's events are forwarded (the element's pause as it fades out and the Lab's as it
releases never reach the store). `engage` downloads and decodes while the element plays, then starts the Lab from
`plain.time`/`plain.playing` as they are **when the Lab is ready**, cross-fades `HANDOVER_RAMP_SECONDS` (12 ms;
`fadeOut` pauses the element after the ramp, or at once with no graph) and emits `analysis` so `routed`/`analyser`
republish; `release` seeks the element to `lab.time`, plays it if the Lab was playing, fades it in and stops the
Lab. `load` while live or preparing falls back to the element at once and re-engages if still wanted; a source the
Lab failed on is not retried until the next track or a release. `lab.set(settings, loudness)` (`LabLoudness = {
lufs, targetLufs }`, the version's stored loudness and the Lab policy's normalise target) gives the element
`elementRate` (the speed only in linked mode) and the Lab every setting. `crossfade(next, seconds)` runs on the
live engine: on the element it is `plain.crossfade` (a Lab still preparing the outgoing track starts again on the
incoming one); on the live Lab it needs the next track decoded — while the Lab plays with no comparison, the hybrid
has the Lab `loadNext` whatever `prepareNext` last named (dropped with `unloadNext` on a comparison, a release, a
track change or a new next; a track the Lab cannot hold stays unready and is not retried) — and then has the Lab
`crossfade`, loading the same file on the element so a later release carries on from it; not ready yet, it
refuses. `AudioEngine.lab: LabControls`
(`engage`, `release`, `set`, `setEqCurve`, `compare: CompareControls` — `start(source)`, `align(seconds)`,
`route(active, gains)`, `end(keep)`). `AudioEngine.compare: CompareControls` (same shape, top-level rather than
under `lab`) is the plain-element comparison `player-engine.ts`'s `createAudioEngine` builds beside the playback
element: `start` loads a second `<audio>`, seeks it to the playing element's `currentTime` once its own metadata
is in (a comparison can start mid-track) and plays it if the first is playing; `align` is a no-op, since there is
no decode to place an offset against; `route` and the listener's own mute pref together decide each element's
`muted` flag (`syncMuted`) — the audible side is never the muted one, and a swap is instant because both
elements are already decoding in lockstep; `end("b")` promotes the compared element onto the playing one (its
`src` and `currentTime`) rather than reloading; `end("a")` just drops it. `seek`, `restart`, `setRate` and `stop`
carry onto the compared element too, and `destroy` drops it. `hybrid-engine.ts` exposes it unchanged as
`compare: plain.compare`, so a comparison on this path never touches the Lab or `createLab`. The hybrid holds one comparison: `start` has the Lab `loadCompare` B
(creating the Lab if needed, so B downloads beside A while the Lab itself prepares) and reports `compareState`
`preparing` with the mean of both downloads until the Lab is live, then B's alone; `align`/`route` given before
B loads are replayed onto it; it reports `ready` once B is held and the Lab is live, and `unavailable` when either
load fails. `end("a")` unloads B; `end("b")` (ready and live only) has the Lab `promoteCompare` and loads B on the
element, so a later release hands back to B. A new track, a stop or a release drops the comparison.
`lib/dsp/audio-output.ts` `createAudioOutput()` (and `rampParam`, the click-free linear gain ramp both engines use) owns the one `AudioContext` (opened and seen `running` on first
`open()`, closed and forgotten otherwise) and one `AnalyserNode → destination` that both engines connect into, so
the lava field keeps the same node across a hand-over. `lib/dsp/lab-engine.ts` `createLabEngine(output, events,
{ fetch, coarse, requestCopy })`: a `"player"`-role node → `labGain` → the shared analyser; `load(source,
onProgress, signal)` streams the file with progress, caps it at `labSizeCap(coarse)` (80 MiB coarse, 300 MiB fine;
`Content-Length` first, then the running count), falls back to `requestCopy(assetId)` (`lib/dsp/lab-copy.ts`
`requestLabCopy`: `POST /assets/:id/convert` `.mp3` 320 kbps, then `clientGetJob` every `FALLBACK_POLL_MS` until
`convertOutcome` settles), `decodeAudioData`s it (a rejection is `LabUnavailable("This format cannot be decoded
here")`), transfers up to two channels to the processor and emits `duration` as an event once the processor answers
`duration`. `time` is synchronous: an anchor on `ctx.currentTime` advanced at `playbackSpeed(settings)` (1 in
pitch mode), re-anchored by each `position` frame whose `seq` matches the last `seek`. `set` sends only the
parameters that moved (`changedParams`; a reverb preset change resends the pre-delay, which the preset resets).
The Lab's comparison surface: `loadCompare(source, onProgress, signal)` (slot `"b"`, no `duration` event; each
slot's load settles on its own `duration`/`failed` answer), `alignCompare(seconds)` (`offset`), `routeCompare(active,
gains)` (`route`), `unloadCompare()` (unload `"b"`, route back to `"a"` at 1), `promoteCompare()` (`promote` with
a new seek `seq`, route `"a"` at 1, re-anchors `time` at A's position plus the offset and emits B's `duration`).
The Lab's crossfade surface: `loadNext(source, onProgress, signal)` (slot `"next"`, no `duration` event; a later
call waits for an earlier one to settle so their answers never cross, and a load aborted after the processor
answered holds nothing), `unloadNext()`, `crossfade(seconds)` (`crossfade` with a new seek `seq`; `time` restarts at
0, `duration` and `source` become the next track's, and `duration` is emitted in a microtask, after the store has
adopted the incoming track; false with nothing loaded).
`chainParams(settings, loudness)` maps settings to `Param`/`Block` values, clamped to each range's domain;
`normalise` offsets `GainNormaliseDb` to `loudness.targetLufs` from `loudness.lufs`. `player-engine.ts`
`createAudioEngine(events, output)`: one detached `Audio` element (plus the throwaway `probeVolumeControl()`
element; iOS pins `volume` → `volumeControllable: false`), `setRate` (re-asserted on `loadedmetadata`),
`fadeOut`/`fadeIn`, Web Audio graph built only on `requestAnalysis(onTouch)` (`source → fade → shared analyser`
per element), plus one `projammr-dsp` AudioWorklet node (role `"meter"`) tapped after each element's fade,
posting side `"a"`. Elements are `Voice`s (`el`, `level`, `route`, `unlisten`); every listener reports only while
its element is `primary`. `crossfade(next, seconds)` is the only thing that makes a second element: it refuses
before making anything where the playing element cannot be faded (iOS with nothing routed, or a plain comparison
running), else starts `next` silent on an idle element (a new one, routed at once if the graph exists), fades the
outgoing element to 0 and the incoming to 1 — on the routed `fade` gains, or by stepping `el.volume` (the
listener's volume times `level`) every 25 ms on the wall clock — and lets the outgoing one go (paused, emptied,
kept as the idle element) on its `ended` or 250 ms after the overlap. A pause, seek, restart, load, stop,
`fadeOut`, comparison start or graph build finishes a crossfade in flight at once. `prepareNext` is a no-op. With
no crossfade set the element path is exactly one element: `lib/dsp/processor.worklet.ts`
(built by `bun run build:worklet` to the gitignored `public/dsp-processor.js`, loaded by `lib/dsp/processor-module.ts`
`loadProcessor(ctx)`, the one place that checks AudioWorklet support, calls
`audioWorklet.addModule("/dsp-processor.js?v=" + ABI_VERSION)` and `compileDsp()`, for the meters and the Lab alike) runs one `AnalysisSession` per node
(`@workspace/dsp/live`'s `createLiveLoudnessMeter`/`createLiveSpectrumMeter`) against the `dsp.wasm` `Module`
the main thread compiles once through `@workspace/dsp/host/browser`'s `compileDsp()` and hands every node in
`processorOptions`; `lib/dsp/processor-protocol.ts` carries `DSP_PROCESSOR`, the role option types and the
message types, kept apart from the worklet's own implementation because it is imported as ordinary values from
the main thread (`attachMeters`, `lab-engine.ts`), and the worklet file extends the global `AudioWorkletProcessor`,
which exists only inside the audio thread. Role `"player"` holds up to two sources (`slot` `"a"`/`"b"`), each copied
once into `dsp_alloc`'d interleaved stereo (a mono file is doubled) with its own `Chain`; it runs both chains every
quantum and outputs each chain's output times its own linear gain ramp (`route`: the active slot to its gain, the
other to 0, over `ROUTE_RAMP_SECONDS`, 12 ms), places `"b"` at `"a"`'s read plus `offset` (a negative read plays
a lead-in from a silent buffer), and `promote` makes `"b"` the only source where it is. A third slot, `"next"`
(`SourceSlot`), holds a crossfade's incoming source silent and unread; `crossfade(seconds, seq)` makes it `"a"`
from its start, fading in over `seconds` after its own chain's latency, while the old `"a"` plays on as `"b"`
fading out from the gain it was heard at, each through its own chain and summed once; `params` and `curve` skip the
outgoing chain, it is dropped once its gain rests at 0 or its source runs out, and a `seek` or a `load` into `"a"`
drops it at once; it never posts `ended` or pre-chain meter frames. It
advances each read position by what `chain.process` consumed, remembers every `params`/`bypass`/`curve` command and
replays them onto a chain a later `load` creates, posts `position` (heard frame = read − latency × source rate,
stamped with `currentTime` and the last seek's `seq`) every 50 ms, `loudness`/`spectrum` on its output as side `"mix"` always, and on each source's consumed frames before its
chain as sides `"a"`/`"b"` while `"b"` is loaded, `gr` every 10 ms while the compressor is not bypassed, and, once the source and the chain's latency
tail have played, `position` at the end, `pause`, then `ended`. `play` after the end starts over, as an element
does. Frames reach the store's
`subscribeLoudness((side, frame) => …)` about every 10 ms and `subscribeSpectrum((side, db) => …)` about every hop,
85 ms at 48 kHz), `silentEngine` for SSR. Turbopack cannot remap `@workspace/dsp`'s internal `.js`-suffixed
relative imports (needed for the server's NodeNext typecheck) back to the `.ts` files that exist — unlike Bun and
TypeScript's own "bundler" resolution, and unlike webpack, whose equivalent knob
(`experimental.extensionAlias`) is explicitly unsupported under Turbopack — so `next.config.ts`'s
`turbopack.rules` runs `turbopack/strip-relative-js-extension.cjs` over `packages/dsp/src/**/*.ts` first.
`music-player/use-side-frames.ts` `useSideFrames(subscribe, active, draw)`
is the generic rAF loop both `loudness/use-loudness-frames.ts` `useLoudnessFrames` and
`spectrum/use-spectrum-frames.ts` `useSpectrumFrames` wrap over their store subscription, gated on `useRouted()`
(`isLive(active, routed)`). **Routing is what costs background playback**: iOS suspends an `AudioContext` when the
device locks, and an element routed through one falls silent with it, so playback stays on the elements' own
output until a surface calls `requestAnalysis()` through the `useAnalysis(wanted?)` hook — `LavaField`, the
sheet's own `PlayingLoudness` and an entity page's `LiveLoudnessScale`/`LiveSpectrumScale` all ask this way.
`requestAnalysis(onTouch)` itself is the one gate: it refuses on a coarse pointer (`(pointer: coarse)`, read
fresh on every call) for whichever surface calls it, present or future, unless the playback policy's
`analysisOnTouch` (false by default) says a touch device may route, so nothing that asks for analysis ever routes
a phone through Web Audio on its own (PROJ-790). A/B comparison has its own gate rather than sharing this one —
`startCompare` reads the pointer itself and picks `engine.compare` over the Lab (PROJ-838, above) — since a
comparison needs a second source and a mute-based swap that `requestAnalysis`'s graph has no equivalent for.
`PlayingLight`'s room breath never asks; it shows a
live level only once something else has turned the graph on. `NowPlaying`'s `RoutedNotice` shows "Lab on ·
playback stops when the screen locks" whenever `showsRoutedNotice(routed, coarse)` is true. The engine starts
the context and waits for `running` **before** `createMediaElementSource`, because routing cannot be undone and
a context that never starts would leave the player silent with no way back; a context that will not run is
closed and the elements are left untouched.
`player-queue.ts` pure transforms over `{ tracks, order, pos }` (`qIndex` survives shuffle). `player-storage.ts`
localStorage `music_player_prefs` (volume, muted, repeat, shuffle), `music_player_lab` (`LabSettings` minus the
dangerous auditions: `stereo`, `bands`, `device`, `dim` are written and read back as defaults) and
`music_player_queue` (kept queue, above), through `playerWriters(storage)`, each on a 300 ms debounce (no storage,
no writes); `readStoredSettings(storage, initial, { rememberAuditions })` overlays the stored blobs on `initial`
(with `rememberAuditions` off every audition comes back at `initial`'s) and reads a prefs blob that still carries
`rate` as `{ mode: "linked", speed: clampSpeed(rate) }` (unless a Lab blob already exists), rewriting both blobs
without it. `SPEED_MIN` 0.5, `SPEED_MAX` 2, `SPEED_STEP` 0.01, `PITCH_MIN/MAX` ±12 live in `lib/dsp/lab-settings.ts`
beside `DEFAULT_LAB`, whose values come from the generated `PARAMS` table; they are the Lab's hard bounds (the
palette's `speed `/`pitch ` commands read them), and the Lab policy's ranges, which the store clamps to and the
sliders stop at, sit inside them. `player-metadata.ts` serial per-asset `getMusicPlayerMetadata` prefetch (skipped
when `metadataResolved`). `play-track.ts` `trackToPlayable(trackId, { versionToPlay, noAudioFallback }, title?)`
(`chooseVersion`: primary else highest, or highest; with no track audio, the newest audio attachment unless the
policy says `none`), `audioToPlayable(trackId, audio, title?)` (also the kept queue's builder) /
`collectionToPlayable(collectionId, versionToPlay)` (the collection route takes the pick and chooses per track
server-side). `owners.ts` `ownerRoute(track)`
reads the entity registry's `pageRoute` for `track.ownerType`, so a project-owned item links to the project
root like every other kind; the now-playing menu's "Go to …" label comes from the same kind's `nouns.singular`.
`use-playback.ts` `usePlayback({ kind, id, title?, collectionId?, playable? })` → `{ isLoaded, showPause, loading,
toggle, playInContext, queueNext, queueLast }` — the one playback hook (`PlayAffordance`, `CardPlayButton`,
sheet Play row). `PlayGlyph.tsx`: `GlyphSwap({ slot, …span props })` — one grid cell, `AnimatePresence initial={false}`
over the keyed mark — and `PlayGlyph({ playing, loading? })` on top of it; every play/pause control renders through
`PlayGlyph` (transport, `PlayAffordance`, `CardPlayButton`, `MiniPlayer`, sheet Play row, `ShareMasthead`) and the
repeat mode and the share row's number/volume mark through `GlyphSwap`. `player-hooks.ts`: `useMusicPlayerStore`, `useCurrentTrack`, `useCurrentAssetId`, `useUpcoming`,
`useIsPlaying`, `useDuration`, `usePlayerPrefs`, `usePlayerActions`, `useVolumeControllable`, `useCompareProgress`,
`useAudibleSide`/`useComparedSide` (`audible-side.ts`: a ready comparison's active source and the other one, else
`"mix"` while the Lab is live, else `"a"`; the live scales and `PlayingLight` read these, and a captioned scale adds
`LabCaption`'s "after the Lab" while the side is `"mix"`), `useIsCurrent(kind,
id, assetId?)`, `useCurrentArt`, `useAnalyser`, `useRouted`, `useAnalysis(wanted?, allowCoarse?)` (ask for the
graph; see above), `useRoutedNotice` (`showsRoutedNotice`), `useProgressFrames(draw)` (the only progress reader: calls
`draw(seconds)` on each `subscribeProgress` emission and after each commit, and the reader writes the DOM, never
React state; `writeText`/`writeAttribute` skip unchanged writes). `types.ts`: `MusicPlayerTrack` (`ownerType:
EntityKind`, `asset`, `trackAudio? { id, version, isPrimary, lufs? }`, accent hue/chroma,
`metadataResolved?`), `PlayerSize = "card" | "full"`. UI: `MusicPlayer` (desktop `hidden md:flex` card anchored
in the sidebar column, floating when the sidebar is collapsed; `ArtField`, `Transport`/`SecondaryControls
.Volume/.Overflow` at `size="card"`, `QueuePopover` → lazy `QueueList` (dnd-kit), `SidebarReveal`, `Scrub
size="card" detached`); `MiniPlayer` (dock slot, hairline `Scrub`, `TrackCell size="xl"` identity, tap or upward
drag calls `openFromCover`; the strip is an `m.div drag="y"` held to a 48 px stop, started from the identity's
`onPointerDownCapture` through `useDragControls` on touch only, snapped back by `dragSnapToOrigin`, and committed by
`flick.ts` `flickCommits(travel, velocityPxPerMs, reach)`; the click after a drag is swallowed);
`NowPlayingHost` lazy-loads `NowPlaying` once a track is loaded (or on first open)
and keeps it mounted, so the first open can morph; `now-playing-state.ts` is the view's state as one value
(`NowPlayingState`, `CLOSED`, `opened`, `OPENED_FROM_COVER`, `coverArrived`) and `now-playing-context.tsx`
`useNowPlaying()` → `{ open, setOpen,
openFromCover, fromCover, coverInSheet, view: "player"|"queue"|"lab", setView }` (closes on route change, adjusted during
render; closing is a transition, opening from the cover opens the sheet and moves the cover's name one frame
later, which is the commit the sheet's presence wrapper adds); `CoverMorph` names the dock thumb or the sheet cover `now-playing-cover` on phones, whichever
`coverInSheet` says, and the sheet fades instead of sliding when `fromCover`; `NowPlaying` = full-screen bottom `Sheet` at every width (`md:max-w-lg`
column): `ArtField scrim="full"` + `LavaField` (cover palette from `lib/cover-palette.ts` as analyser-driven blobs;
sim in `lava-field.ts`), cover, `Scrub size="full"`, `Transport size="full"`, mute/volume (hidden when not
controllable)/speed/queue/`TrackAudioDropdown` via `use-version-switch.ts`; the player and queue panes trade places
through `AnimatePresence mode="wait"` keyed by `view`. Swipe-to-dismiss is the Drawer's — the haptic fires from
`onOpenChange` when `details.reason === "swipe"`, and the scrub row and the queue pane carry
`data-base-ui-swipe-ignore` because they own their own vertical pointers. `Scrub` (`size: card|full|hairline`; `scrub-math.ts`
`clampPosition`/`keyboardSeek`/`progressReadout(seconds, duration, display)` → `{ position, fraction, lead, trail,
valueText }`, the two times either side of the bar laid out by the viewer's `format.playerTime` (elapsed and
`-remaining`, elapsed and total, or `-remaining` and total; `--:--` for whatever the unknown duration decides;
the share masthead always reads elapsed / total); the draw writes `--v`, the times and the slider's `aria-value*`,
and marks the slider `data-seeking`
for the frames a tap on the bar or a keyboard seek glides over — a deadline in a ref, never state, because dropping
the transition property mid-flight would cancel it). `ArtField` cross-fades the cover layers through
`AnimatePresence` keyed by cover id, linear both ways, with no CSS keyframes behind it. `PlayAffordance` (play/pause + Play from here / Play next / Add to queue /
Download; right-click opens the menu; `data-active` keeps hover-revealed row controls visible).

**The Lab view** (`components/lab/`): `LabView` renders while `view === "lab"`, toggled by an `IconButton` in
`SecondaryRow` (the speed popover it replaced lives in `SpeedPitch` now). Reads `useCompare()` itself and, while
`compare?.unmatched` (a coarse pointer's touch comparison, PROJ-838), shows one line saying the Lab isn't
available instead of its sections — every one of them needs the Lab, which an unmatched comparison never
engages, so they are hidden rather than left inert. Otherwise, four sections, each a `LabSection`
(a `RailLabel`-shaped `h3` over a hairline): `SpeedPitch` (mode `SegmentedPill`; the two `Slider`s, gated by
`showsSpeedSlider`/`showsPitchSlider` in `lab-view-model.ts`, give way to a `Meter` or the unavailable copy
(`slidersReady(phase)`) while `useLab().phase` is `"preparing"`/`"unavailable"`, per DESIGN.md's Lab paragraph);
every rack module goes through `RackModule` (pill, optional `aside`, body in a `HeightReveal`) and every
parameter row through `RackSliderRow` (`rack-columns.ts` widths). `RackEq` (`EqCurveOverlay` — a response line
from `eq-response.ts`'s RBJ biquad magnitude and its fill to 0 dB (`fillToLevelPath` in
`spectrum-geometry.ts`), plus one numbered, draggable `role="slider"` handle per active band, positioned by
`eq-curve-geometry.ts`'s fraction-space geometry over `LiveSpectrumScale` at `EQ_DRAWING_SIZE`
(`SPECTRUM_DRAWING_HEIGHT` in `SpectrumScale.tsx` sizes both), sharing its viewBox rather than duplicating its
live line; the engaged handle's readout and placement come from `eq-bands.ts` — plus a folded "Bands" list of
`RackBand` rows for the active slots only (`activeBandIndices`, `freeBandIndex` for "Add band", and
`EQ_FILTER_ITEMS` passed as the `Select`'s `items` so the trigger prints a label); a shift-drag's Q anchors to
the Q and pointer position `qDragStep` first sees shift held at, not the live value, so repeated events at the
same position don't keep re-multiplying it), `RackComp` (`GrMeter` on `RulerScale` with `GR_RULER` from
`gr-scale.ts`, reading `useGrFrames`/`subscribeGr` off the store; its bar still moves under reduced motion, just
without `meter-ballistics.ts`'s easing, via `meterStep`), `RackReverb`; every rack slider's range comes from
`lab-settings.ts`'s `paramRange(paramId)` over the generated `PARAMS` table, not a hand-copied pair of numbers.
`Auditions` (stereo/crossfeed/dim/normalise/device `TogglePill` rows, plus band-solo and polarity) and `MatchEq`
(a `Select` of this track's other versions that carry a stored spectrum — `matchEqGains` from
`@workspace/dsp/match-eq`, recomputed in a `useEffect` keyed on the reference and this version's own spectrum, so
a `matchEq` restored from storage gets a curve on mount; the store itself clears a stale `matchEq` — the
reference audio is the one now playing, or the queue moved to a different track — in `loadCurrent`, so a Lab
left engaged with an old curve is never stuck once the view isn't mounted to catch it); `Bounce` (the store's `bounce` and `uploadBounce` actions and `useBounce()` — selected on its own, not through
`useLab`, so a checkpoint re-renders only this section — through `bounceView` (`bounce-view.ts`, pure) to a caption,
buttons and a print: the version's stored peaks as `.wave` bars whose `--played` follows the render fraction, held
whole through encode, local download and optional upload; `downloaded` names the saved file and exposes an opt-in
`Upload` button when the current item belongs to a project track, `done` links the uploaded attachment by name to the
track page with `hrefFromParsedRoute(ownerRoute(current), projectId)`, a render `failed` clears the print while an
upload `failed` keeps the print and `Upload` button for retry). `lib/dsp/bounce.ts` splits the pipeline into two
functions: `bounce(input, deps, onProgress, signal)` downloads and decodes its own copy of the source (independent of
whether the Lab is engaged for live playback) straight into a throwaway `OfflineAudioContext` at a fixed 48 kHz,
probes a main-thread `Chain` (`@workspace/dsp/chain` + `@workspace/dsp/host/browser`'s `loadDsp()`) for the current
settings' latency to size the real render context (`ceil(frames / speed) + latency`), runs the same
`dsp-processor.js` `"player"` role there with `suspend()` checkpoints every five seconds of output, encodes the result
to 24-bit FLAC in `flac-encode.worker.ts` (wrapping the pure `flac-encode.ts` `encodeFlac24`, which takes a loaded
libFLAC instance from the `libflacjs` package), saves it locally via `downloadBlob` (`lib/download.ts`), and returns
the encoded `File` for optional upload; `uploadBounce(input, deps, onProgress, signal)` then reads the server's upload
cap (`uploadLimit()` → `GET /api/uploads/limits`), stops with "This bounce is N MB; uploads are limited to M MB." when
the encoded file's exact size passes the cap, uploads with `uploadAsset` — mapping the route's `too_big` validation
answer (`tooBigMaximum` in `upload-client.ts`) to the same message — and attaches with `attachAssetTo` — the latter
imported dynamically inside `bounce.ts` since it is a server action whose module reaches `server-only`, which a plain
top-level import would drag into every test that imports the store. `lab-engine.ts` exports `loadSourceBytes` (the
download-with-cap-and-copy-fallback half of `load`) so the bounce shares it rather than re-implementing the cap logic. `lib/dsp/bounce-name.ts`'s `bounceName(title,
version, settings)` composes the attachment's name from the non-default settings alone, in the Lab's own
top-to-bottom order, reusing `LAB_AUDITIONS`' labels for every audition it covers. `LabControls.curve` (on the
hybrid engine) is the match-EQ curve `setEqCurve` last set, read back by the bounce since it lives on the
engine rather than in `LabSettings`. The worker loads libFLAC's `libflac.min.wasm` build by dynamic import, so
neither the glue nor the `.wasm` joins the page bundle; the glue finds its binary through a
`FLAC_SCRIPT_LOCATION` file-name-to-URL map it reads from `process.env` (Turbopack's polyfill supplies a
`process` in the worker, so `self` is never consulted), set to the bundler's `new URL(..., import.meta.url)`
before the import. Under `bun test`, `flac-encode.test.ts` loads the same build from disk with `fetch`
hidden, since Bun's `fetch` throws on a bare path where the glue expects a rejection. `lib/dsp/lab-auditions.ts`'s
`LAB_AUDITIONS` registry (key, label, group, `isOn`, `set`) is the one table `Auditions`, `commands/lab.ts`,
`OverflowMenu` and the palette's `lab ` command all read, so a new audition is one entry rather than a
dispatch-by-kind chain repeated in four places. `TogglePill` (`packages/ui`, wraps Base UI's `Toggle`) and
`SegmentedPill` (wraps `ToggleGroup`, single-select) are shared with `AudioCompareControls`' A·B and "Match
loudness" pills. Palette: `pitch `, `lab ` (an audition name, toggling it; `labAuditionOn` in `action-context.ts`
re-exports the registry's own lookup) and the `open-lab` action; hotkeys `l`, `h m`, `h d` — `commands/lab.ts`'s
`LAB_COMMANDS`, chords rather than `shift+m`/`shift+d`, for reach (see the hotkeys section's `lab.ts` bullet).

**Track audio and loudness** (`track-audio/`, `loudness/`): `GET /api/tracks/{id}` returns `audios` +
`primaryAudio`; `TrackAudioProvider({ audios, primaryAudio })`/`useTrackAudio()` → `selected`,
`setSelectedAudioId`, `comments`, `reloadComments`, `commentMarks`, `registerScrollTarget`, `scrollToComment`,
`commentsOpen`. `TrackAudioSection` (masthead): `PlayAffordance` + `TrackWaveform` (comment pins seek + open the
panel; hovering or keyboard-focusing a pin shows a `FloatingNote` above it with author, timecode and
excerpt, from `comments/excerpt.ts` `excerptOf`; the pins are `useCommentThread`'s `commentMarks`, derived from
root comments with a numeric `positionMs`, so a reply never produces a pin, and `ShareRoom` derives its own from
the same hook; each pin carries `resolved` (`resolvedAt != null`) and `resolvedBy`, and `WaveMarks` draws the
resolved look itself. The comments pill reads `versionCommentsLabel(count, version, resolvedCount)`: "3 comments
on v2 · 1 resolved", then "All 3 resolved on v2" once every root is resolved (`isAllResolved`), when its outline
softens to `border-rule` and the panel head takes the same label and drops the bare count) + meta row (`TrackAudioDropdown` versions/star-primary with LUFS per version, `VersionBadge`,
`LoudnessLabel`, `AudioAnalysisWatcher` while `analysisOutstanding(selected)` (`analysis-outstanding.ts`: the
version's `analysisVersion` is null or behind `@workspace/dsp/version`'s `ANALYSIS_VERSION`, not just `lufs ==
null` — a version already carrying loudness can still be due a newer analysis), `AudioCommentPanel` popover → `AudioCommentSection`
with `CommentCompose positionMs`); switching versions while playing → `playAt(swapVersion(…), store.getProgress())`.
`TrackAudioDropdown` (also `NowPlaying` and `AudioCompareControls`) is a `DropdownMenu` under a pointer and a
`BottomSheet` titled "Versions" below the phone breakpoint (`useIsMobile`), where each row stacks name over meta,
the star is an `IconButton size="touch"` beside the row, and choosing a version closes the sheet. Both shells share
`track-audio/version-rows.ts` (`versionRowLine` "−16.3 LUFS · 14 Sept 2026", `byNewest`, `primaryStarLabel`) and the
`VersionRowBody` in the component; the selected row carries `aria-current`. A version bounced from a commit also says "from commit 'added strings'" (`fromCommitLabel`, plain text in both shells, a second line in the row); the masthead strip's `FromCommitLink` links the selected version to that commit's row (`fromCommitHref`: the session's history with `?commits=500` so the row is loaded, plus `checkpoints=1` for a checkpoint, to `#commit-<id>`; plain text for a commit on a branch the log does not show).
`AudioCompareControls` (meta row): idle, a "Compare" `TrackAudioDropdown` of the other versions →
`startCompare(toPlayable(other))` + `play()`; while `useCompare()`'s A side is the selected version, a visually
hidden `role="status"` line per phase, then `ComparePhase` (a `Meter` and "Preparing comparison · v4 62%", or the
unavailable reason; also shown in the Lab's TIME & PITCH block) until ready, then an `A · B` segmented pill
(`swapCompare`) and, on a fine pointer, a "Match loudness" `TogglePill` (`setCompareMatched`; disabled unless both
LUFS are known) — `comparing.unmatched` (PROJ-838) shows `unmatchedCompareLine(selected.lufs,
comparing.b.trackAudio?.lufs)` in its place instead, since there is nothing to match: "Levels not matched" alone,
or with "· B is +1.4 LU" / "· A is +0.8 LU" naming whichever version is louder and by how much, when both carry a
LUFS figure — and an × (`onEnd`: `TrackAudioSection` ends the comparison and selects B's version when B was
heard). Pushes the `track-audio` hotkey scope and binds `v` (swap A/B) while ready. `CompareChangeStrip` renders
`ChangeStrip` (label "Change to v4") from `compare.diff` in the section's grid under the waveform, on A's
timeline, reading and seeking through the store — null for an unmatched comparison, which never reads a diff.
`compare-view.ts` holds the pure view state (`compareControlsView`, `compareAnnouncement`, `loudnessMatchable`,
`unmatchedCompareLine`, `hearSideLabel`, `compareStripProps`).
The section hoists both versions' peaks through `measures.ts` `useTrackAudioMeasure<number[]>(id, "peaks")` (`?? []`
at the call site) and draws them against one `peakCeiling`; the audible side is the played wave, the other sits
behind it.
**Lazy per-version measurements** (`track-audio/measures.ts`): `createMeasurementStore(fetchOne, missing)` is the
cache — one entry per version for the page's life, one request however many readers ask, a
`MEASUREMENT_RETRY_DELAYS_MS` ladder (3/6/12/24 s) over the 404 the server answers with while the analysis has not
run, `snapshot(key)` memoised per id list (`measurementKey(ids)`) so a `useSyncExternalStore` reader is handed the
same map back — and `createTrackAudioMeasurement(fetchOne, missing)` is its React skin: `{ load, use(id),
useMany(ids) }`, where the hooks also re-ask for missing ids through `useJobsFinish(ANALYSIS_KINDS, …)` whenever
one analysis job finishes, so a version whose analysis outlasts the ladder fills in without a remount even while a
project backfill or another version's job is still running (a drain would wait for all of them). `loadMissing` on
an id whose ladder is still out marks it to read once more after the current read rather than skipping it, since
that read may have been answered before the job stored its value. One instance is built lazily per
`MeasureName` (`@workspace/api` enums) and cached in a module-level registry, so a page that never asks about
`spectrum` never allocates its store; `useTrackAudioMeasure<T>(id, measure)` and `useTrackAudioMeasures<T>(ids,
measure)` pick the right instance, `T` being the caller's own knowledge of the measure's shape (`number[]` for
`peaks`, `@workspace/dsp/spectrum`'s `Spectrum` for `spectrum`) — the registry itself stays server-side.
`lib/client-api.ts` `clientGetTrackAudioMeasure<T>(id, measure)` is the one fetcher, returning null on a 404;
`clientGetTrackAudioDiff(id, otherId)` is a plain, unretried read (a 404 is a real answer, not a queued job) behind
`useTrackAudioDiff(id, otherId)`, which resets to null during render on a new pair rather than in an effect.
`ANALYSIS_KINDS` lives in `track-audio/analysis-kinds.ts`, shared by the loader and `AudioAnalysisWatcher`.
`TrackAudioDialog`: candidate audios, `FileUploader`, link/unlink (`actions/track-audios.ts`); a candidate's bin
goes through the `audioVersion` delete gate, its `ConfirmDeleteDialog` nested inside the dialog's popup and naming
the version the file plays as, when it is one.
`AudioAnalysisWatcher({ eachJob })` is `useJobsDrain(ANALYSIS_KINDS, …)` (`audio_analysis`/`audio_backfill`) →
`router.refresh()`, plus a refresh per finished job through `useJobsFinish` with `eachJob` (the track section, so its
spectrogram image and detected key and BPM land while a backfill still runs; the collection page, while runtime,
loudness or spectrum is pending, keeps one refresh per drain). The meter's presentational half lives in
`@workspace/ui` (`docs/agents/packages.md`, "The signature gear"): `@workspace/ui/lib/loudness` `formatSignedDecimal`,
`formatLufs`, `formatTruePeak` (full "TP ±X.X dB" string), `formatTruePeakValue` (the same figure without the "TP"
unit, for a caller pairing it with `LoudnessUnit`), `loudnessMeasuredLabel(measured, total)` ("x measured" once
every track with audio is measured, "x of y measured" while pending — `total` counts only tracks with audio, never
the collection's full track count). `@workspace/ui/components/loudness/ruler-scale` `RulerScale` is the general meter drawing (`min`/`max`, `stops`, an
optional `reference` hairline, `marks`, `band`, `pointer`, `was` (a faint tick where the value was and a caret that
travels from it), over `@workspace/ui/lib/ruler-scale`'s `positionOf`/`markTitle` pure value-to-position formula);
`loudness-scale` `LoudnessScale` is its −28…0 LUFS preset (−14 reference), and `TEMPO_RULER` (in
`lib/ruler-scale.ts`) the 60–200 BPM preset `collection/CollectionTempo` and the save diff's tempo readout share. `loudness-reading` `LoudnessReading` (headline figure, `pending`) is the
last of the moved half. The client's `loudness/` keeps what needs the app: `TrackLoudness` (track rail: selected version's
reading + scale of all versions), `CollectionLoudness` (collection rail: median, min–max band, measured count). Both, and the now-playing sheet,
draw `LiveLoudnessScale` (`LoudnessScale` + `live` slot: momentary bar, hold tick, short-term needle, A/B needles
while comparing; `M`/`S`/`Peak` figures above the ruler, led by an optional `caption`) for an `owner` (`PlaybackOwner` or `"any"`); it paints from
`loudness/use-loudness-frames.ts` `useLoudnessFrames(active, draw)`, a two-line wrapper over
`music-player/use-side-frames.ts`'s `useSideFrames`, one rAF loop over the latest frame per side, with
`lib/meter-ballistics.ts` (`follow`, `holdPeak`, `meterFraction`, `roomEnergy`).
`@workspace/ui/components/loudness/loudness-unit` `LoudnessUnit({ unit: "LUFS" | "TP" | "M" | "S" })`: the unit as a focusable `<abbr>` wrapped in a `Tooltip`
(the root layout's `TooltipProvider` already covers it — no per-instance provider), explaining the unit on hover or
keyboard focus. Every LUFS/TP reading renders the figure and the unit as siblings so the unit alone carries the
tooltip: `LoudnessLabel`, `TrackLoudness` and `CollectionLoudness` all pair a bare `formatLufs`/`formatTruePeakValue`
figure with a `LoudnessUnit`.
**Spectrum** (`spectrum/`): the same split one measurement over. `spectrum-geometry.ts` is the drawing's coordinate
system — `VIEW_WIDTH` 1000 × `VIEW_HEIGHT` 100, log `xOf(hz)` over 20 Hz–20 kHz, `yOf(db, window)` clamped to the
window, `curvePath`/`areaPath`/`envelopePath`, `SPECTRUM_RULER`, `SPECTRUM_LABELLED`, `hzLabel`.
`SpectrumScale` is pure markup (one `<svg viewBox="0 0 1000 100" preserveAspectRatio="none">` stretched by its
container, every stroke `vectorEffect="non-scaling-stroke"`, so no `ResizeObserver` and no `devicePixelRatio`):
ruler ticks and baseline in `rule-strong`, an optional `art/15` envelope, `other` curves as `ink/25` lines, the
`selected` curve as an `art/20` area under an `art` line, the `live` slot last inside the svg, and a numerals row
below for the four labelled stops. `LiveSpectrumScale` adds `LiveLoudnessScale`'s `owner` flags plus a
`useInView(ref)` gate — the rail scrolls internally, so an off-screen block's loop rests — and writes two `<path>`
`d` attributes per frame from `use-spectrum-frames.ts`, following each band with `follow` (40 ms attack, 320 ms
release) toward the frame or the window's floor and stopping once every band has settled there. Wrappers:
`TrackSpectrum` (track rail; every measured version through `useTrackAudioMeasures<Spectrum>(ids, "spectrum")`, the one under the caret
`selected`, "measuring…" while it has no curve), `CollectionSpectrum` (collection rail; the mean curve inside the
min–max envelope from `GET /collections/{id}/status`'s `spectrum`, `loudnessMeasuredLabel` as the label action) and
`PlayingSpectrum` in `NowPlaying` (captioned "Spectrum" under the loudness meter; a track with no version draws the
live line alone on `SPECTRUM_WINDOW_FALLBACK`; hidden below a 62.5rem-tall viewport, the height the sheet needs for
cover, identity and both meters with captions open, so phones and most laptop windows show loudness only). All three take their window from `@workspace/dsp/spectrum`'s
`spectrumWindow`, so every curve in a block shares one 48 dB scale.
`track/TrackWaveform` is the wave's container: `ActiveWave` when its asset is current (progress written to the
wave's `--played` by `useProgressFrames` through `playedBars`, lit against each bar's `--i` in `motion.css`;
click/keyboard seek, pins; the elapsed/remaining clock), else `IdleWave` → play. It draws with
`@workspace/ui/components/waveform`'s parts (`waveSurface`, `WaveBars`, `WaveStack`, `WaveMarks`) and
`@workspace/ui/lib/waveform-bars` (`barCountFor(width)` — `clamp(24, width/4, 160)`, `MAX_BARS` — plus
`bucketOf(seconds, durationSeconds, count?)`, the bar a moment lands on and the strips' shared geometry,
`peakCeiling(...series)` and `toBars(peaks, count, scale?)`); the bar count is resize-observed per instance
(`useWaveBars`), which is the one thing the static `Waveform` in `@workspace/ui` does not do. The caller always
passes `peaks`, plus optional `comparePeaks` (drawn static behind at 60 % opacity, same bar count) and a shared
`scale`; `size` `md` (h-12, default) or `lg` (h-20, the track masthead). `CommentMark` carries an optional
`author`/`excerpt`; `WaveMarks` renders one `FloatingNote placement="above"` for whichever pin is hovered or
keyboard-focused (state tracks the mark and its anchor button together, set from the event's own `currentTarget` so
nothing is read from a ref during render); a mark without an `excerpt` shows no note. Touch never hovers, so
`FloatingNote`'s own `coarse:hidden` keeps tap-to-seek-and-open the only touch behaviour.
`clientGetTrackAudioMeasure` returns null for the 404 the server sends while analysis is queued.

**Strips** (`track-audio/`): `MeasureStack` renders under `TrackWaveform` in `TrackAudioSection`: a `TogglePill`
legend, each pill wrapped in a `Tooltip` naming what it draws (`STRIP_EXPLAINERS`), for the three strips there
are — Loudness, Spectrogram, Change — (`strip-legend.ts` `STRIP_IDS`/`STRIP_LABELS`/`STRIP_EXPLAINERS`/
`DEFAULT_STRIP_IDS`/`knownStrips`/`toggleStrip`, `DEFAULT_STRIP_IDS` all three since that is everything there is)
read through `use-selected-strips.ts`'s `useSelectedStrips()` — the visuals policy's `strips` (unknown ids dropped by
`knownStrips`), until the legend is toggled this session, a module-level `useSyncExternalStore` choice shared by
every track page and kept nowhere — then one `StripRow`
(the shared 24px caption + click/keyboard seek surface, over `music-player/scrub-math.ts`'s
`clampPosition`/`keyboardSeek`) per chosen strip. On phones (`useIsMobile()`), `MeasureStack` replaces the multi-strip
stack with a local `SegmentedPill` switcher (`Loudness | Spectrum | Changes`, filtered to available strips and hidden
when only one is available) showing Waveform + 1 active strip without mutating `visuals.strips`. `MeasureStack` takes `live` (the player is on this version) and
writes the playhead fraction to its own `--playhead` from `useProgressFrames`; each `StripRow` translates a 1px
line by it, shown through `group-data-live/strips`. Each strip is a thin render layer over a pure value-to-geometry
module tested standalone: `loudness-strip.ts`, `change-strip.ts`. `strip-curve.ts`'s `curveSegments`/`areaSegments`
turn a fraction series into SVG path segments, one per contiguous run of known values, so a gap in the loudness
curve breaks the line instead of drawing a false slope across it. `strip-bins.ts`'s `resampleMean` is the shared
per-bar averaging `LoudnessStrip`/`ChangeStrip` use. `ChangeStrip` takes the change map, the summary and the
geometry as props with no fetching inside, so PROJ-811's Lab compare draws through the same component.
The server keeps analysers, columns and a measure route for sections, correlation, clipping, silence and
pitch too; no client strip reads them, since the legend only ever offers the three above.
`@workspace/session-diff/musical-key`'s `parseMusicalKey`/`circleOfFifthsPosition` back both the rail's Adopt action and
`collection/circle-of-fifths.ts`'s placement math. `parseMusicalKey` reads either writer's spelling — the
estimator's `F♯ minor` and a session-derived `C# Major` alike (mode case-insensitive, `#` folded to the `♯` the
circle's tables use) — and answers with a lowercase `scale`. Every key a person reads is spelt by `format.key`
from its two halves (`keyParts` splits a detected key string), and the circle's ring labels by `spokeLabel` in
`format.keyNotation`.

**Rail: detected key/BPM and duplicates**: `DetectedMeta` (track rail) replaces the KEY·BPM `RailBlock` when a
field is empty: the primary version's detection with a `detected` hint, a `?` under 0.1 confidence
(`LoudnessUnit`'s fine/coarse tooltip-or-popover pattern), and — when the track has a main session — an `Adopt`
action. `adopt-detected.ts`'s `adoptKeyPatches`/`adoptTempoPatch` build the fields `DetectedMeta` merges into one
`patchEntityFields("session", id, body)` mutation (`entities/mutations.ts`):
a track's key/tempo are derived from its main session's `rootNote`/`scale`/`tempo`
(`deriveTrackMusicMeta`, `apps/server/src/entities/track/queries.ts`), not a field on the track itself, so adopting
writes there and the rail reads it back through the same derivation. `version-rows.ts`'s
`duplicateFlagLabel`/`duplicateOfVersion` and `DuplicateFlag` (a `StatusChip flag`) show "same audio as v3" on
`TrackAudioDropdown`'s rows and `TrackAudioSection`'s version trigger when `duplicateOfId` is set; the tracks table
carries the same fact as `ListTrack.duplicateOfVersion`, resolved server-side from the primary audio's
`duplicateOfId` since a listing never carries every version.

**Collection rail: tempo and keys** (`collection/`): `CollectionTempo` (the `RulerScale` tempo preset, a tick per
track, the median under the caret) and `CollectionKeys` (client; `circle-of-fifths.ts`'s `keyDots`/`keyLabels` — twelve
major labels around a ring, a dot button per track at its key, minor keys on an inner ring at their relative
major's spoke; it also takes `tempo` so a dot's `FloatingNote` names the BPM and the playing track's dot pulses at
`beatSeconds(bpm)` through `.key-beat` in globals.css) read `GET /collections/{id}/status`'s `tempo`/`keys`, each carrying one entry per track (`{id, title, bpm}` /
`{id, title, key}`) rather than an aggregate, since a ring or a per-track tick needs the individual tracks.

**Notebook** (`notebook/`): `NotebookShell` (`NotebookContext { summaries, upsert, remove }` seeded from the
server list; two `ScrollRoot` panes from `md:`, named `pane="notes"`/`"note"` so they keep separate scroll
offsets, below that `usePathname() !== NOTES_HREF` picks list or editor), `NoteList`
(search via `noteMatches`, pinned/unpinned, linked-track chip), `NoteEditor` (mounted by `NotebookNote`
surface `"notebook"` and `track/TrackLyricsEditor` surface `"track"`; takes `layout({ status, menu, editor })`;
wraps `NoteEditorSession` keyed by an `epoch` that bumps when the URL names another row or the server `version` is
ahead — callers pass no `key`; the lyrics toggle is a `⋯` menu checkbox and new notes default to lyrics mode),
`save-queue.ts` `createSaveQueue` (one request in flight, later edits merge; first flush is `create` guarded by
`isBlankDocument` from `@workspace/ui/lib/block-document`, then `save(id, version, patch)`; 409 → `conflict` locked until Reload; states
`draft|saved|unsaved|saving|conflict|error`), `copy-note-text.ts` (`GET /notes/:id/text` → clipboard via a pending
`ClipboardItem` for Safari), `LinkNoteDialog` (note → track, project-scoped `LinkPickerDialog`). Note helpers in
`lib/utils.ts`: `noteTitle`, `noteMatches`, `noteIdFromPath`. `lib/rich-text.ts` `richTextDocument` parses a
BlockNote JSON string for `jsonb` fields (undefined on empty/invalid).

**Track page sections** (`track/`): `TrackRunningOrder` (RSC, the masthead eyebrow: `runningOrder(siblings,
trackId)` from `running-order.ts` renders "Track N of M" and, when the track was reached through a collection,
a `<nav aria-label="Running order">` of up to two chevron `Link`s to the neighbouring tracks in that collection's
order), `TrackLyrics` (RSC: the linked note via `cachedNote` →
`LyricsProvider` (the trigger prefixes from `useSetting`) > `TrackLyricsEditor`, an `EmptySection` (empty without a note; `+ Lyrics` and `LinkNoteAction collapsed`
join the add line for editors) around a `CollapsibleSection keepMounted prominence="primary"` around `NoteEditor` — existing note or
`{ draft: { trackId } }` so the first keystroke creates one; `LinkNoteAction` links an existing unlinked note),
`TrackRelationsSection` (edges with directional verbs, `RelationSelector`), `TrackLabelsSection` (`LabelsCell` with
`listHref` = `track/all`, so each badge links to the tracks list filtered to that label), `TrackArtists` (the
byline's artists, each an `AppLink` to `track/all?artist=<name>`; for editors the page passes `getProjectArtists`'s
promise as `vocabulary` and a picker popover — a hover pencil, or "Add artists" when none are credited —
credits and uncredits through `patchEntityFields` with `useOptimistic`; `artist-credits.ts` resolves a typed name to
the project's existing spelling ignoring case, since the server's `artist` filter is an exact match),
`TrackPrioritySection` (the track's own level as a `PriorityBadge`, a dropdown of the project's scale, which the
track page reads beside the labels, → `patchEntityFields({ priorityId })`), `TrackExplicitToggle` (rail checkbox,
`useOptimistic` → `patchEntityFields`). An explicit track wears an `Explicit` flag chip in the masthead byline and an
`E` flag beside its title in the tracks table, which also has a hidden-by-default `explicit` checkbox column and filter.
`TrackLifecycle.tsx` holds the page's write actions, all `SectionAction` text actions shown to editors only.
`TrackRailActions` is the rail's last block, after CREATED·UPDATED: "Archive track" then "Delete track" for a live
track, "Delete track" alone for an archived one. `UnarchiveAction` sits in the byline beside the `ArchivedFlag`,
which every role sees on an archived track. Archive and Unarchive run `archiveTracks`/`unarchiveTracks` on the one id
and hand the result to `toastActionResult` (Undo included); the refresh brings in the flag and the page stays. Delete
confirms through `ConfirmDeleteDialog` ("Delete {title}?"), then runs `removeEntity` through `applyMutation` with a
router whose `refresh` pushes the project's `track-all` route, so the route invalidation is the navigation and the
deleted track's page never re-renders; it toasts "Deleted {title}", and a failure toasts the error and the page stays. The track's sessions table asks for
`archived: "include"` (the first page in `modules/track/page.tsx`, later pages through the session kind's
`pageQueryOf` whenever `scope.trackId` is set), so an archived track still lists its own sessions.

**Project page** (`project/`): `SamplesInventory({ projectId, library })` (async RSC, mounted on the project page in its own Suspense between the plugin
inventory and the heatmap; `project/index.tsx` reads `?library=1`/`0` with `route-module.ts`'s `flagOr(value,
fallback)` (`1` on, `0` off, anything else `fallback` — here `undefined`), and `ProjectPage` resolves an absent flag to
the shell policy's `inventoryDefaults.samples.library`. It reads
`getProjectSamples`, `cachedSessionSummaries` and `cachedPolicies()` together, feeds `samplesGraph` into a compact
`Patchbay` of 8 sets and 12 samples inside `PatchbayControls`, with the lede counts, an "All samples" link carrying
the Library state, and `SamplesLibraryToggle`, a client `AppLink` styled with `TOGGLE_PILL` whose href flips
`?library=` on the project page (left out when the flipped state is the default);
renders `null` with no sample at all or on an action error), `PluginInventory({ projectId, plugins, sessionCount })` (async
RSC: awaits `cachedSessionSummaries` and `cachedPolicies()`, feeds `pluginsGraph` into the same compact `Patchbay` of 8 sets and 12 devices
inside `PatchbayControls`, with the lede "{n} devices across {m} sets" and an "All devices" link; `sessionCount` is
unused, the set count comes from the graph; renders `null` with no device or on a session-read error). The palette's
"Go to plugins" reaches the plugins page, as "Go to samples" reaches the samples page; both build their own trailing
crumb rather than extending `createBreadcrumbs`;
`lib/samples-graph.ts` is the samples surfaces' one data step: `samplesGraph(usage, sessions, { projectId, show,
library, stock?, defaults, trackTitles? })` → `{ samples, left, right, cables, counts }` (the rows, the sets and samples as
`PatchNode` lists with their `PatchCable`s, ready for `layoutPatchbay` or `inventoryWeb`, and the lede's counts,
which follow the Library toggle but not the tab), and `samplesPageHref(projectId, { show?, library?, stock?, sample?
}, defaults)` builds every link into `/samples`, writing each view param given (`library`/`stock` as `1` or `0`)
unless it equals the viewer's default for it (`SamplesDefaults`, the shell policy's `inventoryDefaults.samples`), so
the plain page has the plain URL and a bare URL opens the viewer's default view; `lib/plugins-graph.ts` is the
plugins surfaces' one data step, the same shape: `pluginsGraph(usage, sessions, { projectId, origin?, stock?,
defaults, trackTitles? })` → `{ plugins, left, right,
cables, counts }` (left nodes are sets linking to their session, right nodes are devices whose id and label are the
device name, `meta` is `deviceMeta` ("Nimbus Audio · VST3", "Built-in") and `href` is the device's row, carrying
`stock`; every cable is a `WebCable` whose `uses` is that session's `sessionTracks` entry; `origin` filters the
graph and the rows alike; a session id the list does not know is dropped with its cables, a device with no
`sessionIds` keeps its row and node but gets no cable; `counts` is `{ devices, sets, thirdParty }` and ignores the
tab), and `pluginsPageHref(projectId, { origin?: "all" | PluginOrigin, stock?, device? }, defaults)` builds every
link into `/plugins` against `inventoryDefaults.plugins` the same way. The page and the compact `PluginInventory`
both call it; `inventory-data.ts` hands both graphs their defaults from `cachedPolicies()`, the client rows read
`useShellPolicy()`, and `SessionSamples` takes them as a prop from the session page. Both graphs build their left rail with `setNodes(sessions, used, {
projectId, trackTitles? })` (`lib/set-nodes.ts`: the sessions a graph cabled, each labelled by name with its
track's title as meta and linking to its session page).
`lib/inventory-web.ts` turns a graph into the pages' web: `inventoryWeb({ left, right, cables }, { minShared,
stock, item, pause? })` → `{ web: ConstellationData, stock: StockItem[] }`, async. An item fewer than `minShared`
sets use folds into its sets' "+n own" (plugins pass 1, samples 2); an item more than `STOCK_SHARE` (40 %) of the
page's sets use, and at least `STOCK_MIN_SETS` (5), is the stock chain: listed in `stock` most used first (`{ id,
label, sets, href }`) and drawn only with `stock` on; an item no set uses, and a set left with no drawn edge, are not
drawn. Sets become circles (count "{n} devices · +{m} own", link "Open set"), items squares sized by the square root
of their sets within a narrow band (count "in {n} sets", link "Show row", `warn` when missing). An edge's weight is
`rarityOf(sets)` = `1 / log2(1 + sets)`, its thickness `thicknessOf(uses)` = `min(3, 1 + log2(uses))`, 1 with no
`uses`. The positions are ForceAtlas2 (Barnes-Hut, `edgeWeightInfluence` 1 on those weights, gravity 0.5, slow-down
2, 300 iterations in passes of 25 with `pause` awaited between them) from a circular layout in input order, then
scaled so the longer side is about 1000 px and spread by noverlap (margin 3 px), so the result depends only on the
input. `key` hashes the node ids and edges. It imports ForceAtlas2 and noverlap and runs on the server only; no
client component imports it. `lib/inventory-data.ts` (`server-only`) holds the pages' request-scoped reads:
`cachedPluginsGraph(projectId, origin, stock)` / `cachedSamplesGraph(projectId, show, library, stock)` (the usage,
session and track reads in one `cache`d step, a failed read an empty list, returning `{ usage, graph }`) and
`cachedPluginsWeb` / `cachedSamplesWeb` (the graph's `inventoryWeb`, memoised for the request, handing the event
loop back before and between the layout's passes so the page's head streams first); nothing is cached across
requests.
The **inventory recipe** (`components/inventory/`) is the page shape both pages share:
`InventoryPage({ crumbs, title, lede, filters, web?, rows })` (a server-renderable shell: `ScrollRoot` + `PAGE`, an
`InventorySearchProvider` around a `PageHead` whose action is `InventoryFilters`, then `InventoryWeb` inside a
`Suspense` whose fallback is `ConstellationPlaceholder`, then `rows`; it knows nothing of what it lists; with no
`web`, as on a page with no usage at all, the rows' empty line stands alone). `filters` is `{ tabs: { param, active,
fallback, items }, searchPlaceholder, library?: { param, on, fallback, label }, expandParam }`: `InventoryFilters`
(client) writes the tab param and the library param (`1` or `0`), each left out when it equals its `fallback`, the
page's default, with `router.replace`, dropping
`expandParam` so a filter change closes the open row and keeping every other param (`stock` included); the search
box (labelled by its placeholder) writes only to `inventory-search-context.tsx` (`useInventorySearch()` → `{ search,
setSearch, query }`, `query` trimmed and lower-cased). The Library toggle is `TogglePill`, a real button with
`aria-pressed`. `web` is `InventoryWebProps` `{ layout, label, stock, toggleHref }`: `InventoryWeb` (async server
component) calls `layout()` when it renders, after the head, awaits it and renders `InventoryConstellation` (when
there are nodes) and `StockChainStrip` (when there is a stock chain) in a `gap-3` column, or nothing.
`InventoryConstellation` (client) loads `@workspace/ui`'s `Constellation` through `next/dynamic` with `ssr: false`
and `ConstellationPlaceholder` while it loads, and hands it the search as `highlight` and an `AppLink` with
`scroll={false}` for the note's link out. `StockChainStrip` (client, for `TOGGLE_PILL`) is a `LABEL` "Stock
chain", one chip per item ("Echo · 476 sets", `tabular-nums`, an `AppLink` to its row, `scroll={false}`) and a text
link to `toggleHref`: "Show stock chain", or "Hide stock chain" once drawn. `rows` is a node that reads the search
itself. `hooks/use-reveal-open-row.ts`'s `useRevealOpenRow(open)` returns the ref both row lists wrap themselves in
and, when `open` names a new row whose `aria-current` element is outside the window, scrolls it to the centre
(instantly under reduced motion): a row opened by the web's "Show row" or a link straight to it. The samples page
(`modules/project/samples.tsx`, `SamplesPage({ projectId, searchParams })`) parses `?show=` (`missing` or `all`),
`?library=`, `?stock=` (`1`/`0`, through `flagOr`) and `?sample=`, each view param the URL does not set taking the
shell policy's `inventoryDefaults.samples`; awaits `cachedProject`, `cachedSamplesGraph` and, with `sample`
set, `getSampleSessions` together; and renders `InventoryPage` with the lede "{n} samples across {m} sets · {k}
shared by more than one · {j} missing" (also the web's `label`), tabs All · Missing, Library toggle, a `web` whose
`layout` is `cachedSamplesWeb` and `SampleRows`. `SampleRows` (client, `{ projectId, samples, view, emptyLine,
expanded? }`, `view` the show, library and stock state) filters by filename or folder against the search ("No
samples match."), links each row through `samplesPageHref` (the open row links back without `sample`, marked
`aria-current`) and, under the open row, lists its sets (`expanded.sessions`, read by the page) as session links; a
missing sample shows struck through with "missing", as on the session page. A `?sample=` naming no visible row opens
nothing. `emptyLine` is chosen by the page: the no-usage copy ("No set has reported its samples yet. Scan a project
folder to fill this."), "Nothing missing." on the Missing tab, or "Every sample is in the Library. Turn Library on to
see them." when only Library samples exist and the toggle is off. The plugins page (`modules/project/plugins.tsx`,
`PluginsPage`) is the recipe's second instance: it parses `?origin=` (`all`, `plugin` or `builtin`), `?stock=` and
`?device=`, the unset view params taking `inventoryDefaults.plugins`; awaits `cachedProject`, `cachedPluginsGraph`
(given `undefined` for all) and, with `device` set, `getPluginSessions`
together; and renders `InventoryPage` with the lede "{n} devices across {m} sets · {k} third-party", tabs All ·
Plugins · Built-in on `?origin=`, no Library toggle, `expandParam: "device"`, a `web` whose `layout` is
`cachedPluginsWeb` and `PluginRows` (client, `{ projectId, plugins, origin, stock, emptyLine, expanded? }`: filters by
device name or manufacturer against the search ("No devices match."), links each row through `pluginsPageHref` with
the open row marked `aria-current`, and under it lists the sessions carrying the device with the tracks it sits on).
The empty line is the no-usage copy ("No devices yet. Track a project folder with dit to read what its
sessions use.") or "Nothing here." on a tab with nothing on it;
`ProjectStats.tsx` exports only `ProjectByline`;
`ProjectRailCounts`; `LinkFormDialog` (children = trigger; `edit={{ index, link }}` edits that link)/`LinkItems`
(client component; project `links` jsonb via `patchField`, every write sends the whole array built by
`lib/links.ts` `replaceLinkAt`/`removeLinkAt`, and a link is addressed by its index, never its URL. An editor's row is
the anchor beside a pencil (edit dialog) and a bin (removes at once, an error toasts), both `REVEAL_ON_HOVER`; a
viewer's row is the anchor alone);
`DeleteProjectButton` (named confirmation → `deleteProject` → "/"; rendered by the settings Danger zone tab). `collection/CollectionProgress` (average completion `Meter`).

**History page and the commit log** (`modules/session/history.tsx`, `components/session/`). The page is a `PageHead`
titled with the set's name, the lede counted over the whole history from the session detail's `history`
(`48 commits · 212 saves · 3 machines · first seen 14 Mar 2026 · 38h in the set`, the last only once time was counted, from `GET /sessions/:id` and never the loaded
window; "No saves yet." with none),
then COMPARING (the card above, only with `?from=&to=`), then LOG. The page fetches the session's saves (500, for the
compare pickers and the chips' baselines) and the commits of `main` (`getSessionCommits(sessionId, { branch, limit })`,
`FIRST_COMMITS` 30, or `MOST_COMMITS` 500 once `?commits=500`, which "Older commits" writes in place with its progress
shown on the button; at 500 it says "Showing the latest 500 commits."). `?from=`/`?to=` are checked against those saves
and against the saves the loaded commits cover (`knownSaves`), so a compare link for a commit older than the 500th save
still resolves; one that names neither is dropped. `?checkpoints=1` is "Show checkpoints" (the
toggle only appears when the log holds a checkpoint; its label stays "Show checkpoints" and `aria-pressed` carries
the state). The log's model is `@workspace/ui/lib/commit-log`:
`buildCommits({ commits, saves?, capabilities?, format? })` words each commit's chips against the previous commit's
own save and each covered save's against the save before it on its branch (a baseline beyond what was loaded leaves
`chipsKnown` false, drawing nothing rather than a wrong diff; a commit that covers no save has no row),
`foldLog(commits, showCheckpoints)` folds a
checkpoint under the next named commit ("2 checkpoints · 14 saves", `foldLabel`) and leaves those newer than the
latest named commit as quiet rows (newest first), `uncommittedSaves` is the saves after the newest commit (their own fold at the head
of the log), `compareHref(historyHref, fromId, toId)`, `clearCompareHref(historyHref)` and `ditCheckoutCommand(hash)`
(`dit checkout a1b2c3d4 -b restore-a1b2c3d4`) are the strings rows write. `historyHref` there is the page's address
as it is shown (the page builds it from its own query), so a compare or a clear swaps `from` and `to` and keeps
`commits` and `checkpoints`. `CommitLog` (`session-structure/commit-log.tsx`, server-rendered,
native `<details>` folds) draws the rows, each with the time in the set it stands for (`format.timeInSet`; a named row sums its folded checkpoints, `foldedTimeInSet`; nothing, never "0m", when none was counted), and takes `renderCommitActions`/`renderSaveActions`; `SaveLog` draws saves with
no commit at all ("Every save is here. Name one with dit to make it a commit."). `SessionCommitLog` /
`SessionSaveLog` bind this app's actions: `CommitRowActions` (Compare = the commit's save as `to` and the previous
commit's as `from`; Download set, an anchor to `/api/commits/:id/set`; Restore on this computer, shown to editors. It is live (`RestoreOnButton`, a `projammr://dit/checkout/:commitId` link, tooltip "Restores on <name>") when a machine in the session's presence tracks the repo (`restoreOn`, the machine's name, from `getSessionPresence`; a failed read leaves it null); otherwise disabled with "Needs dit on this computer.";
Download with samples, an anchor to `/api/commits/:id/archive`, present only while `samplesHeld` > 0 (`offersSamplesZip`) with the tooltip "12 of 15 samples included" (`samplesIncluded`, `lib/sample-state.ts`); Copy dit command, with the "Run it in the project
folder…" tooltip and a "Copied" state). Compare and Download set carry tooltips naming what they act on ("Compare with
the commit before it on main", "Download the set from main · studio"), as do `SaveRowActions` (Compare with the save
before; Download set at
`/api/saves/:id/set`, tooltip "Download the set saved on studio", disabled for a `pruned` save with "Content of uncommitted saves is kept for <n> days; this one
has expired." — `n` is the session detail's `history.contentRetentionDays`, the instance's retention setting, told to every member). A viewer gets everything but Restore.
The ruler sits under the head (`HistoryRuler`, a client wrapper: click scrolls to the row, opening its fold; drag or
click + shift-click writes `?from=&to=`; Esc clears them; the rest of the query stays; `asOf` fixed at mount). The session page's HISTORY section renders the first six rows of the same log (checkpoints folded) with "All n
commits" when the set has commits, and the first six saves as the same save rows (`SessionSaveLog`) when it has none.

**Session page** (`modules/session/`): the diff lives in `@workspace/session-diff` and its drawing in `@workspace/ui`, so the marketing site
renders the same thing. `@workspace/session-diff` (`diffSave`, `diffSaves`, `diffStructure`,
`changedTrackCount`, `DiffChip { kind, sign, from, to }`, the facet registry) does the computation, gated by the
session's `dawCapabilities`. The page fetches its saves (`VISIBLE_SAVES + 1`) in the same `Promise.all` as the
project and session, and both the STRUCTURE card and HISTORY read that one list. STRUCTURE is a `SaveDiffCard` of
the session row (what the section's count and clip totals read, and what a rescan refreshes even when the file's
save time has not moved, where a recorded save keeps its first reading) against `lib/save-before.ts`'s
`saveBefore(saves, session.localFileUpdatedAt)`, the newest recorded save older than the current file; with
none, or one without `meta`, it is a first save. It is wrapped in `SaveDiffControls` (`defaultMode="whole"`,
keyed by the compared pair) with `SaveDiffModeSwitch` and `SaveDiffStepper` in its `actions`, and `daw` is the
session's `dawVersion`. The history page's COMPARING is the same card (`defaultMode="changes"`, keyed by
`from:to`, since a `?from=&to=` navigation keeps the segment mounted) with `CompareControls` in its `when` slot
in place of the save times and the `to` save's `dawVersion` as `daw`, inside a wrapper carrying the session's art
vars (`artVarsFromArtwork`), since the history page has no `ArtProvider`. The render-only primitives under `@workspace/ui/components/session-structure/` are
server-rendered here: `save-diff-card` `SaveDiffCard`, `set-skyline` `SetSkyline`, `diff-readouts`
`DiffReadouts`, `diff-chip-list` `DiffChipList` (`compact`), `structure-outline` `StructureOutline` (nested
groups, `master`/`other` tracks get their own glyph, a return track shows its own name rather than a lettered
position, auto-open changed groups, unchanged runs behind `<details>`, depth 16 / 256-track caps), `sample-delta`
`SampleDelta`, `save-timeline` `SaveTimeline` (the project feeds' timeline: groups by day —
`Today`/`Yesterday` via the formatter set's `dayLabel`, else a dated label; `asOf` prop defaults
to `new Date()` for a server render, a client caller fixes it at mount so hydration agrees; `marked` rows; every
client caller passes `link={AppLink}`, since the default is a plain `<a>`). Controls: `CompareControls` (the
`From`/`To` pickers and Clear, writing `?from=&to=` through `useParamWriter`),
`OpenInLiveFlag` (`components/session/`, a server `StatusChip flag` in the art colour in the byline while the detail's `openOn` is set: "Open in Live on Studio Mac"; the byline's "saved … ago" falls back to the newest save's time for a set dit never saw), `TimeInSetRail` (the rail's TIME IN THE SET row, `format.timeInSet` of the detail's `history.timeInSet`, absent at 0), `RepositoryRail` (in `modules/session/page.tsx`: the rail's REPOSITORY row, the repo's name linking to its page; the name is the session detail's `repoName`, so the row costs no fetch; absent for a session with no `repoId`), `MainToggle` (optimistic star, `setSessionMain`, static glyph for viewers), `OpenInDawButton`
(`projammr://session/:id`; `holder` prop, the first machine in the session's presence that tracks the repo, from `holderOfSession` in `components/session/open-in-daw.ts`; disabled with "Needs dit on the computer that has this set." when there is no holder, else tooltip "Opens the file on <name>"; the table's rows use `holderOfRepo` over the caller's machines, read once per page by `getMachines()` in the session list's `loadScope` and the track page and carried as the session table's `scope.machines`: an online machine that has pushed the row's repo, by the machine list's `pushedRepos`). The blur/visibility race that detects a missing handler is `useDeepLink()`, and the "Projammr desktop app required" dialog is `DeepLinkFallbackDialog`, both under `components/deep-link/` as the shared mechanics for any `projammr://` sender; its body is the constant "This link needs dit running on this computer." for every sender (no `action` prop). The STRUCTURE section (renamed from SET) hides tempo/time signature/key/tracks/DAW-version
rail rows and the whole section via `lib/daw.ts` `dawCanReport`/`structureEmptyLabel` when the session's
`dawCapabilities` says its DAW never reports that field, instead of showing a perpetually-pending "Not set".
The SAMPLES section is an `EmptySection` gated the same way (`dawCanReport(session, "samplePaths")` or a dit repo (`session.repoId`), whose sets report their references whatever its DAW's module says, and empty
with no samples) around `components/session/SessionSamples` (`{ session, usage, defaults }`, a server component; in a dit repo (`session.repoId`) each row also states its place via `sampleState` (`lib/sample-state.ts`: "on the hub" with a Download anchor to `/api/samples/<object>?repo=<id>` from the detail's `held`/`object`, "not pushed", "outside the project folder" for outside and library kinds, "missing" winning over all; a set with no repo says nothing),
`defaults` the shell policy's samples-page defaults its links are written against). The page
starts `getProjectSamples(projectId)` beside the other promises; a failed load leaves `usage` undefined and the rows
without reach. Each row is the filename in ink over its folder (`sampleFileName` / `sampleFolder` from
`@workspace/ui/lib/sample-path`), a `status: "missing"` sample carries the `−` glyph, the struck name and the word
"missing" (the `SampleDelta` removal treatment), and "in {n} other sets" (`SampleUsage.sessions` less this session;
none at 0) links through `samplesPageHref(projectId, { sample, library }, defaults)`, `library` on for a `library`
sample and off for any other.
Above the rows, "Live can't find {n} samples" shows when any sample is `missing` and "Collect All and Save in Live
brings these into the project." when any is `outside`; `unknown` says nothing.

**Work heatmap** (`work-heatmap/`): `lib/heatmap-range.ts` `trailingWeekRange(weeks, asOf, timeZone)` (the
window ends on `asOf`'s local day in that zone; returns `from`/`to` (`to` exclusive) and `today` as
UTC-midnight calendar days for the grid and `streaks`, and `query` `{ from, to, tz }` as the instants of local
midnight the server is asked for; the wall clock is `@workspace/ui/lib/formatters`' `zonedParts`), `YEAR_WEEKS`
(53), `hasSaves(days)`, `yearHeatmapQuery(timeZone, asOf?)` (the query a server render uses to decide whether a
year grid is shown, in `cachedFormatters()`' zone). `hooks/use-heatmap-window.ts` `useHeatmapWindow(weeks)` gives
the three heatmap components that window in the formatter set's zone, plus its `weekStart` for `Heatmap`: the
zone the server rendered in through hydration, so the markup matches the server's, and the browser's own after
it (they differ only before the zone cookie is first written, when the grid moves and fetches once more).
`@workspace/ui` `lib/heatmap.ts` `streaks(days, asOf)` returns `longest`,
`since` (days since the last active day, `null` when there is none) and `current` (the run of consecutive
active days still ongoing — ends on `asOf`'s day or the day before, `0` otherwise). `WorkHeatmap` (project page,
`YEAR_WEEKS`, `@workspace/ui` `Heatmap` + `streaks()`, lede reads `{n} saves on {d} days · on a {current}-day
streak · longest streak {longest} days · last save {when}`, dropping the streak clause under two days and the
longest clause when it repeats `current`; filters on its own params `wc/wl/wd/wday` via
`clientGetProjectHeatmap`, embeds `RecentSaves` → `clientGetProjectSaves` rendered through
`SaveTimeline`; `saveEntries`/`SaveEntry` live in `save-entries.ts`, outside the `"use client"`
`RecentSaves.tsx`, so `NewSection` can call them from a server component), `ProfileHeatmap` (`/me/heatmap`, unfiltered), `TrackWorkHeatmap` (12-week rail block,
caption `{n} days in the last 3 months · last save {when}` via `streaks().since`). Both ledes phrase the last
save through `@workspace/ui/lib/day-label` `lastSaveLabel(since)` (`today`/`yesterday`/`{n} days ago`).

**Project home** (`project-home/`, mounted by `modules/project/page.tsx`): `TodayReadout.tsx` (client; the
`WeekStrip` above one sentence from `today-copy.ts` `todaySentence`, which reads `use(today)` for renders, saves
and `quiet.total` plus the running jobs of `useProjectJobs`; an `ActionError` counts as zero), `WeekStrip.tsx` +
`week-strip.ts` (`weekStripCaption`; the trailing seven days as a strip, fetched in the viewer's zone), `NewSection.tsx` (async RSC: the day's renders as `RenderRow`s, then the saves through `saveEntries` into
`NewSaves.tsx`, a client leaf that draws the `SaveTimeline` in `useFormat()`'s zone against the server
render's own clock (`asOf`), so the server's HTML and hydration group the same days),
`RenderRow.tsx` (one playable render row) + `playable.ts` (`renderToPlayable`, the player's track for exactly
the version that landed), `QuietSection.tsx`
(async RSC: the quiet tracks, oldest first, with a trailing link to the sorted track list) + `quiet-copy.ts`
(the since and more labels; the threshold is `project-conventions.quietAfterDays`, read by the RSC, and the "since yesterday" wording of `TodayReadout`/`NewSection` follows `project-conventions.todayNewHours` through `today-copy.ts` `newWindowLabel`), `JobsSection.tsx` (client; running and queued jobs from the jobs
stream, no props) + `in-flight.ts` (`inFlightJobs`, `inFlightCount`), `RecentActivitySection.tsx` (async RSC:
the latest eight activity rows through `ActivityList`). Each block renders nothing when it has nothing to show.

**Sharing** (`sharing/` owner side, `share/` public): `SharingRail` (async RSC, `listSharelinks`) →
`ShareLinkRows` (copy, convert connected↔snapshot, edit, delete) → `ShareDialog` (`shareType` connected|snapshot,
description, expiry, private comments, downloads; a new link's draft starts from the project's `project-sharing.*`
settings via `useSetting`, editing a link starts from the link) → `ShareVersionPicker` (per-track version + title when freezing
a collection). `lib/share-links.ts` (`NEVER_EXPIRES`, `hasExpired`, `expiryLabel`, `SHARE_TYPE_DESCRIPTIONS`,
`defaultAudio`, `sharePath`, and for the public page `ShareErrorKind`, `shareErrorKind(error)` — 410 `code:
"revoked"` → `revoked`, any other 410 → `expired`, 404 → `invalid`, anything else `null` — `SHARE_UNAVAILABLE`
(each kind's `title`/`body`), `shareTitle(sharelink)` (the title or "Shared audio", for the masthead, the unfurl and
the poster alike) and `shareFacts(sharelink)`, the "Shared collection · 4 tracks · 14 min" line).
`getSharelink` passes the server's envelope through; `share/[token]/page.tsx` renders a `CenteredPageShell` with the
kind's copy (HTTP 200, no footer) and throws a `null` kind to `share/[token]/error.tsx` ("Can't reach Projammr",
"Try again"); `share/[token]/loading.tsx` is the skeleton streamed while the read is in flight. Public: `ShareRoom.tsx` `ShareRoomProvider` holds the page's state (`useShareRoom()`: `entries`, the
current `index`/`entry` — the player's queue wins over the reader's pick — `loaded`, `artwork`, `select`, `start`,
`seek`, `jumpToComment` and the current entry's `thread`, a `useCommentThread`), renders `ArtProvider` as the page's
art field and scroll container, and wraps its children in a `CommentBackendProvider` on `shareCommentBackend`. The
page is the room around four parts, top to bottom: `ShareMasthead` (eyebrow of `shareFacts`, title, byline of a
`VersionBadge` or the audio's date, description, the play control or full `Transport` beside `TrackWaveform` with
`DurationReadout`, the download link when enabled, "Nothing to play yet." when no track has audio),
`ShareTrackList` (no props; nothing under two entries; `SectionHead` "Tracks", one hairline row per entry with
number, title, `VersionBadge` and timecode, the current row marked by a travelling band and `aria-current`),
`ShareComments` (nothing without an entry; `SectionHead` "Comments", the visibility line from
`isCommentsPrivate`, then `AudioCommentSection` for a member/guest `viewerId`, else read-only `CommentList`, a
guest-sign-in lead and `ShareSignIn` (`AuthCard` guest tab, register hidden)) and `ShareFooter`;
`share-backend.ts` `shareCommentBackend(token, viewerId)`; `share-playables.ts`
`shareStreamUrl`/`shareCoverUrl`/`shareEntries`
(queue entries with `metadataResolved: true`; tracks without audio dropped).

**Settings and auth**: `settings/` holds the editors the hub's panes render (`settings-hub/panes/`):
`SettingsTabNav` (snap-scrolling 44 px links; the hub's phone nav), `SettingsPriorities` (the Priorities
pane: the project's scale, bottom level first, on the same `ColourList`/`ColourItem`/`InlineForm` shape as
Statuses and Labels, one more control per row — a drag handle plus up/down arrows over `useDragSensors`
and dnd-kit, and "Make default" — and a `PriorityLevelForm` (name, colour) that swaps the row the way
`ColourItem`'s does; `DeleteLevelDialog` grows from `LabelItem`'s `AlertDialog` into `ConfirmDeleteDialog`'s
`children` slot: it shows how many tracks, collections and sessions hold the level
(`priority-scale.ts`'s `levelUsage`/`usageSentence`) and a `PriorityMenu` (`fields/priority.tsx`, exported
for this) to pick which level takes them, the default preselected and, with only one other level, shown
read-only instead of a picker; the default's own bin is disabled with "Make another level the default
first". A reorder (drag or an arrow) sends the whole order as `ids` and disables every arrow and handle
until that call answers, restoring the list on a failure; a refused reorder, default or delete also refreshes the
route, since a refusal usually means the scale changed elsewhere), `SettingsMembers`
(`ASSIGNABLE_ROLES` admin/editor/viewer, owner row static, invites; the invite form shows to a role satisfying
`project-sharing.whoMayInvite` (the pending list stays admin-only), defaults its role to `project-sharing.inviteRole`,
offers only roles at or below the caller's own, and states "Expires in N days" from `project-sharing.inviteDays`; the caller's own row carries a Leave button, in
place of Remove, that opens `project/LeaveProjectDialog` — an `AlertDialog` over `leaveProject`, which shows the
last-owner 409 inside the dialog; on success the action itself clears the `currentProject` cookie and `redirect("/")`s,
never `written()`, whose refresh would re-render the left project's route as not-found), `SettingsStatuses` and `SettingsLabels` (the Statuses and Labels panes, both
viewer-visible, built on one shape: `ColourList` is the section head with an Add control that opens a one-line form
at the top of the list, `ColourItem` is a row that swaps for its one-line form, and `InlineForm` is the form shell
with Save, Cancel and Escape). A row is a `StatusPill` whose background is the item's own colour, ink chosen by
`getContrastColour`, `ColourRowAction` for its hover- and focus-revealed pencil and bin; Add, pencil and bin are for
editors and up. `StatusItem`/`SettingsStatusForm` (name, description, colour, completion; sorted by percentage, no bin on
a shared status; delete through the `status` delete gate's `ConfirmDeleteDialog`, "Delete “{name}”?", saying its
tracks and collections move to the default status) and `LabelItem`/`SettingsLabelForm` (name, colour; delete through
the `label` gate's `ConfirmDeleteDialog`, "Delete “{name}”?") are each pane's part; both forms use `ColourInput`; `actions/labels.ts`
`createLabel`/`updateLabel`/`deleteLabel`, and `LabelsCell`'s picker links an editor here with "Manage labels"),
`SettingsRelationTypes` (the Relation types pane, the same `ColourList` shell with no colour to draw, so its
rows are plain `Row`s: `RelationTypeItem`/`SettingsRelationTypeForm` (name only), up/down icon buttons that
reorder and stay visible rather than hover-reveal, `useOptimistic` showing a move the moment it is clicked; a
type still in use shows its count, tied to its disabled delete button by `aria-describedby`;
`actions/relation-types.ts` `createRelationType`/`renameRelationType`/`reorderRelationTypes`/
`deleteRelationType`), `SettingsImageGrid`. `auth/` `AuthWrapper`, `CenteredPageShell` (`wide`), `InviteFlow` (signed out: an `AuthCard`
with the register child then the sign-in child, both `defaultEmail` = the preview's `email` and `lockEmail`, no guest
tab; signed in: Accept → `acceptInvite` + `setProjectCookie`; the invite page's shell carries the "Join {project}"
heading and `generateMetadata` titles the tab from the same `cache()`d `getInvitePreview`), `ProfilePage` (avatar via `useFileDrop` + `uploadImage`, name/email/
password via `authClient`, `ProfileHeatmap`; identity only, every preference being the settings hub's; `emailEnabled`,
`passwordRule` and `selfDeletion` are read once in `(app)/profile/page.tsx` through `actions/instance.ts`'s
`getInstance()` and passed down (an unreadable instance is assumed to have mail, the widest password rule and
deletion on; the server refuses what its own policy does not allow either way) — the new password is held to the
rule, `DeleteAccountSection` is left out while `selfDeletion` is off, and `emailEnabled` decides both the change-email path
(Better Auth's own `changeEmail` with mail, `PATCH /me/email` behind a current-password field without) and
whether account deletion needs a password or only a mailed confirmation; `DevicesSection` lists
`authClient.listSessions()` with a per-row `revokeSession`, `describeDevice`/`sortByLastActive`/
`revokeDeviceSession` factored into `auth/devices.ts` so they are unit-testable without a DOM; `DeleteAccountSection`
reads `GET /me/deletion-plan` and gates the destructive call behind the shared `ConfirmDeleteDialog`), `ProjectCookieUpdater`.
`AuthWrapper` reads the three sign-in states off `lib/sign-in-copy.ts`'s `signInCopy({hasUsers, registration})`
(the wording over `@workspace/ui/lib/sign-in-state`'s `signInState`, no accounts yet → bootstrap copy, win over registration since bootstrap defaults it "open"; closed → hides
Register; open → plain) and feeds `@workspace/ui`'s `AuthCard`/`LoginForm` a `recovery: {kind:"link",href} |
{kind:"message",text}` (an explicit variant rather than two optional props) — a link to `/forgot-password`
when the instance has mail, otherwise a line saying to ask the instance admin. It and `share/ShareSignIn` write
`AuthCard`'s tab children (`AuthCardSignIn`, `AuthCardRegister`, `AuthCardGuest`) from `auth-card-tabs`, since the
card itself is loaded through `next/dynamic`, which drops `AuthCard.SignIn` and the rest. `ForgotPasswordForm`/
`ResetPasswordForm` back those two pages (`authClient.requestPasswordReset`/`resetPassword`, the Better Auth
core client methods, not a plugin); the reset page reads `getInstance()` for the password rule the form holds a
new password to, and `AuthWrapper` passes the instance's rule to `AuthCardRegister` the same way.

**Admin** (`components/admin/`, instance-wide, not project-scoped; the settings hub's Users, Storage and About panes
render them): `AdminUsersTable` (`Table variant="entity"`, row actions, the reset-link `Dialog`),
`AdminStorageSection` (`Rows`/`Row` + `Meter`, mirrors `SettingsStorage`), `AdminAboutSection`
(version + update line). Registration is the Instance section's Access group row, not a component here. Pure logic lives beside them, tested without a DOM: `admin-users-logic.ts`
(`isOnlyEnabledAdmin`, `resetLinkDialogReducer`), `update-availability.ts`.

## Lib / hooks

`lib/`: `utils.ts` (route constants and `noteHref`/`isNotesPath`/`noteIdFromPath`/`noteTitle`/`noteMatches`,
`hrefFromParsedRoute`, `redirect`, `createBreadcrumbs` (a project entity's `Crumb[]` trail — project, then
whichever of collection/track/session it was reached through, each linking to that entity's own page; a track
alongside a collection keeps the collection in its href), `mediaProxyUrl`/`assetUrl`/`imageUrl`
(`IMAGE_WIDTHS`)/`mediaDownloadUrl`, `collectionSorter`); `formatters.ts` (`server-only`: `viewerFormat(projectId?)` →
`{ prefs, zone }`, the viewer's `FormatPrefs` from their effective settings (with the project's layer when
given) and the zone `"auto"` reads as for this request — the zone cookie, else the server's own zone;
`cachedFormatters(projectId?)` → the `formattersFor(prefs, zone)` set every server component and share metadata
formats with; both React `cache`d per request and project, keyed on `projectId ?? null` so a call with no
argument and one with `undefined` share an entry) and `zone-cookie.ts` (`ZONE_COOKIE` `viewer_zone`, `zoneFromCookie`
(a value the runtime knows as a zone, else null), `zoneCookie(zone)` (the `document.cookie` write: path `/`, a
year, `samesite=lax`)); `components/format/ZoneCookie.tsx` writes the browser's zone into the cookie once per load.
Every date, time, duration, size, loudness, count, key and tempo a person reads goes through the formatter set:
`useFormat()` in a client component, `<Formatted>` in a table cell or peek field, `cachedFormatters()` in a
server component (which passes it as `format` to a server-rendered `@workspace/ui` component);
`art.ts` (`artVarsFromArtwork` — the cover's accent
through `@workspace/ui/lib/art`'s `artVarsFromAccent`, with the API's image URL as `--art-image`; tested);
`css-utils.ts` (`getContrastColour`);
`cover-palette.ts` (`paletteFromPixels`, `loadCoverPalette`); `drag-sensors.ts`; API base URLs come from
`@workspace/api/lib/api-base-url` (`serverApiBaseUrl`, `FALLBACK_API_URL`) — there is no `lib/env.ts`;
`heatmap-range.ts`; `lyrics-dictionary.ts`;
`peek-param.ts` (`parsePeek`, `resolvePeek`, `stepPeek`, `PEEK_PARAM`, read/write helpers); `release.ts`
(`releasePhrase`); `rich-text.ts`; `roles.ts`; `route-parser.ts`; `session-state.ts`;
`session.ts`; `settings/` (the effective read, provider, hooks and write queue; see Settings); `storage-limit.ts` (`storageLimitFailure(failure)` reads the server's 413 `code: "storage_limit"` envelope out of either an upload's raw response text or an already-parsed body, and `storageLimitMessage` turns it into "This project is at its 50 GB storage limit" — every upload call site runs a failure through it before falling back to its own message, until `ActionError` itself carries `code`); `sw-classify.ts` (the service worker's `classify(url, request)` plus `STATIC_CACHE`/`IMAGE_CACHE`/
`SHELL_CACHE`/`OFFLINE_URL`/`IMAGE_CACHE_LIMIT`; `public/sw.js` repeats the same `classify` body and
`sw-classify.test.ts` compares the two texts); `auth-server.ts`; `request-cookie.ts`; `server-api.ts`; `server-data.ts`; `browser-api.ts`;
`client-api.ts`; `notes-client.ts`; `share-links.ts`; `share-proxy.ts`; `sign-out.ts`;
`table-params.ts`.

`hooks/`: `use-copied` (`useCopied()` → `{ copied, copy(text) }`, a copy through `useCopyText` that reads
`copied` for 1.5 s after it lands; `CopyButton` and the commit row's Copy dit command both use it),
`use-current-route` (`{ projectId, route } | null`), `use-tab-context`, `use-entity-mutations`,
`use-inline-edit` (`{ entityType, entityId, fieldName, value, prepare? }` → draft/save/Enter/Escape state machine),
`use-long-press` (`longPressHandlers` pure factory + `useLongPress`), `use-origin` (`window.location.origin`,
`""` on the server), `use-param-writer` (`useParamWriter()` → `{ write(changes), pending }`: sets or, with `null`,
drops query parameters, keeps the rest and `router.replace`s without scrolling; the history page's controls write
through it), `use-project-role`, `use-reveal-open-row` (`useRevealOpenRow(open)`, the inventory rows'
scroll to a row opened from elsewhere), `use-shallow-stable` (`useShallowStable(value)` → the previous object
while every own member still matches, for a hook that returns memoised members in a fresh literal).
Table-specific hooks (`use-table-url-state`, `use-peek-row`,
`use-saved-views`, `use-cell-clipboard`) live in `components/tables/`, player hooks in `music-player/player-hooks.ts`,
palette hooks in `command-palette/`, hotkey hooks in `hotkeys/`.

## Styling

Tailwind v4 CSS-first, no config file; `postcss.config.mjs` re-exports `@workspace/ui/postcss.config`. The root
layout imports `@workspace/ui/styles/globals.css` (the app has no stylesheet of its own; BlockNote `.bn-*`
overrides live under `.doc` there). Fonts: four `next/font/local` loaders — `--font-heading` (Redaction 35),
`--font-display-clean` (Redaction 0), `--font-sub` (Departure Mono), `--font-mono` (Spline Sans Mono, the document
default). Tokens, type scale, neutral spine (`paper/ink/rule/glass` — `--color-glass`/`--color-glass-edge` are
registered), artwork channel (`--art*`), motion: DESIGN.md. Variants: `dark`, `stack` (≤1180px), `phone` (<768px,
matching `useIsMobile`), `fine`/`coarse` pointer, `rail-seam`. Dock reservation: `--tabbar`/`--miniplayer` are
`0px` until `body:has([data-slot="tabbar"]):not([data-keyboard])`/`body[data-miniplayer]` under the phone query;
`--dock` is declared on `body` (a
`var()` inside a custom property resolves on the declaring element) and `CANVAS`/`PAGE`/`PAGE_WIDE` carry
`pb-(--dock)`; `--player-card` sizes the desktop card and the sidebar footer clearance. `.on-art` is the
over-artwork text shadow — never re-spell it. Hover reveals: `REVEAL_ON_HOVER` matches an unnamed `group`; inside
a `Row` (`group/row`) use the `/row` variant with a `fine:` gate. Editors use `md:text-small` so the 16px floor
wins on phones. Dark mode = `.dark` class, from `appearance.theme` (Settings → The theme).

## Tests

64 `bun test` files, all `*.test.ts`, co-located (`lib/*`, `tables/*`, `tables/cards/*`, `command-palette/*`,
`music-player/*`, `spectrum/spectrum-geometry`, `track-audio/*`, `notebook/save-queue`, `dock/tabs`,
`jobs/jobs-poll`, `hooks/*`, `app/manifest`). `bun run test` in
`apps/client` (`bun test --parallel`, each file in its own global; `@` resolves through `tsconfig` paths), or
`bun run test` at the root for every suite but the server's. `bunfig.toml` preloads
`packages/test/src/dom.ts` (the same preload `packages/ui` uses) before every file, registering a happy-dom
window and patching what happy-dom gets wrong for this codebase (Motion, Base UI exit detection,
`EventTarget` identity, `IntersectionObserver`); component tests render with `@testing-library/react`
(`render`, `screen`, `fireEvent`) the way `packages/ui/src/components/alert-dialog.test.tsx` does. A suite
that needs `typeof window === "undefined"` or a stubbed `window` uses `stubGlobal` from
`@workspace/test/globals` for that one value rather than relying on the absence of a DOM. Pure `lib`/`hooks`
tests run renderless where a DOM adds nothing: DOM-touching predicates take `Element | null` and are
tested with fakes carrying `closest`/`contains`; shared data a test needs from a `.tsx` file goes in a
`.ts` module (`app/icon-ids.ts`). A test importing anything that
imports `@/actions/*` must `mock.module` those modules and then `await import` the module under test
(`mock.module` is not hoisted; `server-only` throws outside `react-server`). A `mock.module` lasts for the whole
process, so `lib/settings/provider.test.tsx` and `settings-hub/SettingRow.test.tsx`, which mock
`@workspace/settings`, pass only under `bun run test` (a global per file), never in one `bun test <dir>`;
`player-store.test.ts` passes a fake engine through `createPlayerStore({ createEngine, fetchDiff, initial,
persist, resolveQueue })` for the Lab slice, the comparison, the policies, the kept queue and the crossfade (on
`jest.useFakeTimers()`), and otherwise stubs `window`, `Audio` (the engine builds two, playback and probe — pick
the one with listeners),
`localStorage`, `MediaMetadata`, `navigator.mediaSession` with `stubGlobal` from `@workspace/test/globals`. `tsconfig` excludes `**/*.test.ts`.

Three happy-dom behaviours the table suites work around. The window starts on `about:blank`, where
`history.replaceState` to a real path is ignored, so a suite that reads or writes the URL calls
`window.happyDOM.setURL(<origin + path>)` before rendering and resets it in `afterEach`
(`parts/Cards.test.tsx`, `AssetsTable.test.tsx`). A Radix dropdown trigger opens on
`fireEvent.keyDown(trigger, { key: "ArrowDown" })`, not on a pointer event; a context menu opens on
`fireEvent.contextMenu(row)`. An element leaving through `AnimatePresence` (the bulk bar, a closing draft row)
stays in the DOM under test even with Motion's animations skipped, so a suite asserts the close through a proxy
(the trigger's `aria-expanded`, the selection count, the control that replaced it) rather than waiting for the
element to go.

`entities/api.test.ts` holds the repo's only fake `ApiClient`: a `GET/POST/PATCH/PUT/DELETE` object whose
methods all record into one shared `calls` array, which is what makes "the right verb hit the right path
with the right body" a single assertion. A suite that needs to fake the client copies that one rather than
inventing a second shape.

## Gotchas

1. `proxy.ts` not `middleware.ts`; export `proxy`. `/notes` and `/profile` are gated like `/project`. It also
   forwards `X-Forwarded-For` unchanged on `/api/*` and `/.well-known/*` — adding no hop, so both routes to the
   API agree with the server's `TRUSTED_PROXY_HOPS = 1` (`server-api.md`).
2. All `/project/[projectId]/*` URLs are parsed by hand — extend `route-parser.ts` + `modules/` (and
   `routeSegments`), never add file routes under `[projectId]`.
3. `params`/`searchParams` are Promises; dynamic segments are **strings** — coerce `projectId` with `Number()` at
   the route boundary so `cachedProject` sees the key the layout used.
4. Browser and server API clients are cookie-authenticated through the `/api` rewrite; there is no Bearer token
   or interceptor in the client. Uploads bypass server actions (1 MB cap). Media URLs go through `/media/*`
   (project pages) or `/share/:token/*` (share pages).
5. Every in-app link is `AppLink` (`components/navigation/AppLink.tsx`), never `next/link` directly, so the
   pending hint needs nobody to remember it. A `no-restricted-imports` rule in `apps/client/eslint.config.js`
   forbids `next/link`'s default import in `src/**`, with `AppLink.tsx` itself the one exemption; named
   exports such as `useLinkStatus` are untouched.
6. TanStack Table is v9 — v8 examples don't apply. zod v4, TypeScript 7, React 19 (React Compiler lint:
   `react-hooks/immutability` refuses writes to a ref received as an argument — create it inside the hook;
   `react-hooks/set-state-in-effect` rejects `useEffect(() => setX())` — adjust state during render instead).
7. `images.unoptimized: true`; `next/image` and `<img>` are both used on proxied URLs.
8. `bun run dev` is plain `next dev`; another port is `bun --bun next dev -p 3001`. `next dev` writes
   untracked `apps/client/AGENTS.md`/`CLAUDE.md`; leave them uncommitted. Better Auth refuses sign-in from
   :3001 but a session made at :3000 carries over.
9. `Description` never revalidates its `value` prop (edits live in a ref; `patchEntity` does no `revalidatePath`) —
   a parent that swaps variants must own the document.
10. Deep imports like `@workspace/ui/components/block-editor/lyrics/context` resolve through the client's tsconfig
    `paths` + `transpilePackages`, not the package's `exports` map.
11. `SheetContent` placement comes from `SIDE_CLASSES` as plain utilities, so a consumer `className` overrides
    them. Motion animates the sheet panel's `translate` property for the entrance and exit, so a `translate-*`
    class on a sheet is overwritten; the panel's `transform` belongs to the swipe (or, with `swipe={false}`, to a
    consumer's own drag writing `style.transform`, as `NowPlaying` does).
12. The sheet's entrance is a Motion animation, not a CSS one, so no `animationend` fires on the panel;
    `NowPlaying.useSettled` falls back to its timeout. Two modal layers must not trade in one commit — run the
    follow-up from `SheetContent onClosed` (`RowActionSheet`).
13. `setPointerCapture` on a drag region retargets the release, so buttons inside never click — bail on controls
    (`isControlWithin`) and give the region `touch-none`. dnd-kit draggables need `TouchSensor` + `touch-none`.
14. `Meter` (`packages/ui` table.tsx) defaults to `flex-1`; override width with `flex-none`, not `shrink-0`.
    `Row`/`Rows` take `as={AppLink}` only when nothing inside needs its own link.
15. Sonner `offset`/`mobileOffset` accept `calc(var(--dock) + …)` strings; `mobileOffset` applies under 600px, not
    768px. `agent-browser set device` does not set `(pointer: coarse)`, so `coarse:` styles cannot be verified there.
16. The palette's `add`/`move` flow is driven from `CommandPalette.tsx` rather than `PREFIX_COMMANDS` and is not
    project-gated, so it opens an empty picker on `/notes`.
17. The page subtree remounts on every entity→entity navigation (the layout router keys on the dynamic
    segment), which is why `arrivalKind` (`@workspace/ui/components/motion/arrival`) decides "load" vs "nav"
    per mount rather than per container. `window` never scrolls (`(app)/layout.tsx:67-72` pin it; `CANVAS` is
    the scroll container an entity page publishes through `CanvasRootProvider`), so the masthead's
    scroll-linked recession reads `useCanvasScroll()`, never `window.scrollY`. Route-level exit animation is
    impossible outside `<ViewTransition>`; only three named boundaries survive there —
    `masthead-art`/`masthead`/`rail` (`ArtMorph.tsx`) and `now-playing-cover` (`CoverMorph.tsx`) — a table row
    or the home list carries none. `PlayingLight` writes inline `opacity` on `.masthead__tone` directly (the
    frame above it, `.masthead__art`, is Motion's); `useReducedMotion` for a DOM-writing loop like this one,
    `LavaField` or `LiveLoudnessScale` comes from `@workspace/ui/lib/motion`, not a client-local hook.
18. A motion value put in `style` after mount takes the property over cleanly: Motion's
    `updateMotionValuesFromProps` calls `addValue`, which unbinds whatever the `animate` variant left there.
    The variant does not re-fire on later renders either — `animateChanges` compares the resolved values,
    not the identity of the `variants` object — so an element may carry `animate="shown"` and a bound
    motion value at once, which is how the arrival hands the masthead over to the scroll.
19. Motion 13.3's `useScroll` takes no `layoutEffect` option; it always uses a layout
    effect and falls back to a deferred microtask when the `container` ref is not hydrated yet. That
    fallback is what lets a provider _inside_ the scroll container take the container's own ref, since refs
    attach child-first.
20. Scroll offsets are lost on every back navigation on purpose-built inner containers: Next's traverse copies
    the previous scroll intent through untouched (`segment-cache/navigation.js` `completeTraverseNavigation`)
    and keeps one bfcache entry without `cacheComponents`, so the container is a new element at `scrollTop` 0.
    Next writes no per-entry id into `history.state` (`{ __NA, __PRIVATE_NEXTJS_INTERNALS_TREE }` only) and its
    `HistoryUpdater` rebuilds that object on any same-entry `replaceState` (`router.refresh()`,
    `use-table-url-state`'s `router.replace`), wiping custom keys; its patched `replaceState` short-circuits on
    data carrying `__NA`, so a re-stamp dispatches nothing. The offsets are therefore kept by the app:
    `useScrollRestoration` (`@workspace/ui/hooks/use-scroll-restoration`) saves and restores them per history
    entry, and the only two components that create a scroll ref — `ArtProvider` and `ScrollRoot`, the
    notebook's panes included — call it, so every scroll container in the app is covered. A restored page
    binds the masthead's scroll-linked recession from its first frame instead of waiting for the arrival
    (`bindsScroll` in `components/motion/masthead-scroll.ts`).
21. The soft keyboard: the viewport export carries `interactiveWidget: "resizes-content"`, which shrinks
    Android Chrome's layout viewport so `h-dvh` and the fixed `Dock` follow it above the keyboard; iOS ignores
    the hint and only shrinks the visual viewport. `useKeyboardInset` (`@workspace/ui/hooks/use-keyboard-inset`)
    covers both from one `useSyncExternalStore` over `visualViewport`'s `resize`/`scroll` — `focusin` is not the
    signal, since it fires for buttons and programmatic focus and a hardware keyboard covers nothing. `Dock.tsx`
    sets `data-keyboard` and `--keyboard` (px) on `body` from the hook's value (the tab bar's own
    `data-slot="tabbar"` is static markup, not a body flag), the container takes `hidden` while the flag is up
    (the whole dock hides), and the phone media block in `globals.css` zeroes `--tabbar`/`--miniplayer` under
    `body[data-keyboard]` so `--dock` collapses with it.
    `SCROLL` and `CANVAS` add `scroll-pb-(--dock)`, which fixes the browser's own caret reveal and Next's `#id`
    `scrollIntoView` together; `command.tsx`'s phone height reads `--keyboard` directly since the palette has no
    `--dock` to fall back on.
22. `/media/images/**` (with `?w=`) is artwork; `/media/assets/**` is audio and every other upload, told apart
    by path segment, never by extension — `sw-classify.ts` routes on that split, and only the images half is
    ever cached. The service worker is registered from the root layout in production builds only, takes over on
    the next cold start (no `skipWaiting()`), and `sign-out.ts` deletes `pj-images-v1` before the reload so one
    account's covers never outlive its session.
23. Installed iOS app, `black-translucent` + `viewport-fit=cover`: WebKit bug 301108 (open on iOS 26–27) reports
    `innerHeight`, `100dvh`/`svh` and `position: fixed; bottom: 0` one status bar short, so the dock floated ~81pt
    above the screen edge on a device (2026-09-16). `statusBarStyle` is `"default"` for that reason. `<body>` is the flex column
    that owns the shell height and every `<main>` fills it with `min-h-0 flex-1`, so the `OfflineBanner` in
    normal flow above them shortens the shell instead of pushing it under the dock.
24. `min-height` does nothing on an inline box: `coarse:min-h-11` on `LoudnessUnit`'s `<abbr>` never applied
    until it became `coarse:inline-flex`. `VERSION_TRIGGER` carries no `min-w-0` for the same family of reason:
    a `flex: 1 1 0%` item with `shrink-0` children collapsed under its own badge on a crowded phone line.
25. `public/sw.js` precaches `/apple-icon` and `/icon/*` by bare path while Next links them with a content hash
    (`/apple-icon?<hash>`), so the shell cache is keyed by pathname (`shellKey`) and the precached entry is
    the one served. iOS fetches home-screen icons outside Safari and does not trust a user-installed CA, so under
    Caddy `tls internal` the installed app gets iOS's monogram tile; only a publicly trusted certificate fixes it.
26. The engines' one `AnalyserNode` (owned by `audio-output.ts`) sits after the element's fade and the Lab's gain and `LavaField` rewrites its `fftSize`, dB range
    and smoothing on every play (`lava-field.ts` `configureAnalyser`), so no second reader can share it: a
    per-source, pre-gain reading goes through the AudioWorklet tap `attachMeters` makes, like loudness.
    `useAnalyser` is deliberately not reactive; the `isPlaying` publish after the first play is what
    re-renders its readers. The rail scrolls internally (`Rail` is `overflow-y-auto`), so a rAF loop in a rail
    block is not paused by being scrolled out of view the way a hidden tab pauses it; gate it on `useInView`.
27. `use-side-frames.ts` gates every live meter on `useRouted()`: an engine that is routed must post
    `loudness`/`spectrum` frames on the side `useAudibleSide` names (the Lab's player role posts `"mix"`, and
    `"a"`/`"b"` pre-chain only while comparing), or every scale and the room's breath read dead while it is live.
28. `loadCurrent` takes the position as an argument and handles all three cases itself, so no caller checks
    whether the item is already loaded: a new source sets `pendingSeek` and loads; the same source already loaded
    (`duration > 0`) seeks at once, because no `duration` event is coming; the same source still loading parks the
    position for the `duration` callback. A call carrying no position (a reorder, an enqueue, metadata arriving)
    leaves a position waiting on a load in flight alone. `playAt` keeps the queue when the item is already current,
    and replaces it otherwise. A seek in place keeps a comparison that is on side A and ends one that is on side B.
    The deferred seek runs only from the `duration` event,
    so an engine must emit `duration` after every `load`, and `pause` before `ended`, or the store's transport
    state lies. The hybrid engine forwards only the live engine's events, so the Lab's `duration` after its own
    load (the element is live then) never reaches the store; the element's does.
29. An engaged Lab routes on any pointer (it plays through the shared context), so a phone loses lock-screen
    playback while it is live; a released Lab leaves the element unrouted unless something asked for analysis.
    The shared context stays open after a release. The site's CSP ships report-only
    (`@workspace/security-headers`); an enforcing one still needs `'wasm-unsafe-eval'` for `dsp.wasm`.
30. A client-held list fetched once into component state (`SidebarCollectionItem`'s tracks, fetched on first
    expand and kept until it unmounts) does not see a write made elsewhere unless it subscribes to the
    `InvalidationKey` that write declares (`lib/mutation.ts`'s `onInvalidated`); a plain `router.refresh()`
    re-renders server components only and leaves such state untouched. The sidebar's collection item
    subscribes to `"collection-tracks"` and clears its list on invalidation, which lets its own fetch effect
    run again while it stays open.
31. A server component passing an object to a client component serialises **the whole object**, not the
    subset the child's prop type declares. `Pick<Project, "id" | "name" | "role">` on the receiving side
    documents intent; it does not narrow the Flight payload, and that payload ships in the page. A `Project`
    read from `GET /api/projects/{id}` carries its rich-text `description` and its full `attachments` array,
    each row holding `assetPath`, `localFilepath`, `localFileMachineName` and `fingerprint` — so the parent
    narrows at the call site (`project={{ id, name, role }}`) rather than trusting the child's type to do it.
32. The `design-tokens` ESLint rule matches a hex-colour literal **anywhere** in a `src/**/*.{ts,tsx}` file,
    not only inside a class-name string, so a fixture or a form that legitimately carries a real hex (a
    status colour, a test row) needs the same `eslint-disable-next-line no-restricted-syntax` that
    `ColourInput.tsx` already uses. `lint:ci` runs at `--max-warnings 0`, so it is a hard failure.
33. `@next/next/no-assign-module-variable` fires on `module` used as a plain identifier, not only as an
    assignment target, so a local named `module` — the obvious name when mapping over entity modules — fails
    `lint:ci`. Name it `entity`, `mod`, or the kind.

## Repo page (`modules/project/repo.tsx`)

`/project/:pid/repo/:repoId`, a `PageHead` page (a repo is not an entity, so no masthead or rail). `actions/repos.ts`
holds the reads (`getRepo`, `getProjectRepos`, `getTrackRepos`, `getCollectionRepos`, all in the `Repo` shape, one
`GET /repos/:id` payload with every set's session name and branch tips); `cachedRepo` in `lib/server-data.ts` is the
request-cached read the page, its title and the session rail's row share. The page `notFound()`s when `repo.projectId`
is not the URL's project (the API gates a repo on its own project, not the URL's). Head: the repo name as title, the
project crumb, the lede `LastPushLine` (`components/repo/LastPush.tsx`: "Last push 2h ago from studio-mac"; `lib/repo-copy.ts`'s
`lastPushWhen` and `ownMachineHref`: the machine's name is a `MachineLink` to its row in Settings → Devices when the repo's
`lastPushMachine.userId` is the signed-in user's, plain text for anyone else's or for a viewer with no session;
"Nothing pushed yet." when `lastPushAt` is null; `lastPushLine` is the same line as text for `ProjectRepos`) and `RepoPushSamples` in the action slot. Body: a SETS section,
one `Row` per set (session name linking to the session) with its branches nested, `main` first, each showing the tip
commit's message and time since and a "Download set" anchor to `/api/commits/:id/set` (same-origin through the proxy, no
blob round trip); a branch with no tip says "No commits yet". A repo with no sets shows the head alone.
`RepoPushSamples` (`components/repo/`) is a labelled `Switch` over the repo's effective `pushSamples`, optimistic like
`MainToggle`: an editor's flip calls the `setRepoPushSamples` server action (`PATCH /repos/:id`, through `written()` so the
route re-renders in its response) and a failure toasts and rolls back; a viewer sees it read-only (disabled, the setting
visible), and when the instance forces it (`pushSamplesForced`) it is on and locked with "On for every repository on
this instance." beneath. A STORAGE section under the head reads `storageLine` (`lib/repo-copy.ts`): "Sets 12 MB · Samples
1.1 GB" plus "1.2 GB saved by sharing" when `sharedBytes` > 0, in the head's action slot. The SETS head's action is **Download repository**, an anchor to `/api/repos/:id/archive` (every set's `main` tip, held samples, a manifest), shown once a set has a `main` tip.
