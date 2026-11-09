# Cache even Longer

Cache even Longer asks Firefox to keep **images, stylesheets, scripts and fonts** in
its HTTP cache for a configurable number of days instead of the short lifetimes
many sites send.

Version 2.1 builds on the safety-focused 2.0 rewrite of **Cache Longer 1.0** by
Rimu. The fork is renamed **Cache even Longer** so it is not confused with the
upstream add-on. It refuses to extend responses the origin marked as
uncacheable, never shortens a lifetime that is already longer, and lets you
choose what it touches. The original signed XPI is kept untouched in
[`cache-longer-source/`](cache-longer-source/) for reference; the full defect
list is in [docs/AUDIT.md](docs/AUDIT.md).

## What’s new in 2.1

- **Stale-while-revalidate** (off by default): after a file expires, serve the
  cached copy immediately and refresh it in the background.
- **Per-site popup** on the toolbar button: current-site status, exclude/include,
  quick lifetime, and a link to all settings.
- **Quick profiles**: Safe, Balanced and Aggressive starting points.
- **Fingerprint-only mode**: only extend URLs that look content-addressed.
- **Age-aware lifetimes**: account for time already spent in a CDN cache.
- **Exclusion import/export**: back up or share the excluded-sites list as plain
  text.
- **Force refresh remains untouched**: `immutable` is preserved if the origin
  sends it, but never added.

> **Installing it:** a rebuilt XPI is unsigned, and release Firefox only installs
> Mozilla-signed add-ons. Use the temporary `about:debugging` route, or sign the
> package through AMO. Both are documented step by step in
> [docs/INSTALL.md](docs/INSTALL.md).

## What changed from 1.0

| 1.0 behaviour | 2.1 behaviour |
| --- | --- |
| Replaced `Cache-Control` with `public, max-age=15780000` | Merges the header, preserves `private`/`immutable`/`s-maxage`/… and never adds `public` |
| Cached `no-store`, `Set-Cookie` and `Vary: *` responses | Skips them by default |
| Cached 404s, redirects and `206` partial content | Only `200`, `203` and `304` are touched |
| Shortened one-year `immutable` assets to six months | “Never shorten” is the default |
| Hard-coded six months | 1–3650 days, with presets |
| No way to exclude a site | Wildcard host/subdomain/URL exclusions |
| Unconditional console logging | Optional, namespaced debug logging |
| No visible UI besides the add-ons manager | Toolbar popup with site status, exclusions and quick lifetime |
| No revalidation strategy | Optional stale-while-revalidate; Age-aware remaining freshness |
| No way to target only immutable assets | Fingerprint-only mode for safer aggressive lifetimes |
| `__MACOSX` junk in the package; no AMO metadata | Clean validated build with the required Gecko ID and data-collection declaration |

## Install

There are two supported ways to run it; the full details, troubleshooting table
and explanations are in [docs/INSTALL.md](docs/INSTALL.md).

**Temporary (works now, any Firefox, no account):**

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Choose `src/manifest.json`.
4. Click the **Cache even Longer** toolbar button for site controls, or use
   **All settings** in that popup for the full options page.

Temporary add-ons disappear when Firefox restarts.

**Permanent (requires AMO signing):**

```sh
npm install
export WEB_EXT_API_KEY="…"
export WEB_EXT_API_SECRET="…"
npm run sign
```

Install the signed `.xpi` produced in `dist/signed/` via
`about:addons` → gear icon → **Install Add-on From File…**. An unsigned
`dist/cache_even_longer-2.1.0.xpi` is also produced by `npm run build`, but Firefox
will refuse to install it permanently — that is Mozilla’s signature policy, not
a packaging error. See [docs/INSTALL.md](docs/INSTALL.md) for the install
routes, [docs/AMO_SUBMISSION.md](docs/AMO_SUBMISSION.md) for the submission
checklist and ID/licence decisions, and
[docs/RELEASE_DESCRIPTION.md](docs/RELEASE_DESCRIPTION.md) for copy-ready AMO
listing text and release notes.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Enabled | on | Master switch. |
| Cache lifetime | 180 days | 1–3650 days; presets for 30, 90, 180 and 365. |
| Never shorten an existing lifetime | on | Leaves responses alone when the server already asks for longer. |
| Respect `Cache-Control: no-store` | on | Never overrides an explicit “do not store”. |
| Skip responses that set cookies | on | Avoids caching personalised or session-bound responses. |
| Resource types | images, CSS, JS, fonts | Media, XHR/fetch and “other” can be enabled explicitly. |
| Serve stale while revalidating | off | Adds `stale-while-revalidate`; the stale window is 1–365 days (default 7). |
| Only fingerprinted URLs | off | Only extend URLs with a content hash or version query. |
| Excluded sites and URLs | empty | One wildcard pattern per line; export to a dated text file or import/merge a list. |
| Debug logging | off | Prints allow/skip decisions to the extension console. |

The toolbar button opens a compact popup with the current site’s status, a
one-click exclude/include toggle, a quick lifetime selector and a link to this
page. Profiles (Safe / Balanced / Aggressive) fill in the fields; they never
change site exclusions.

**Exclusion import/export:** the exclusions card exports the current list to a
dated plain-text file (comments included). Import merges new patterns into the
current list, ignores comments and exact duplicates, and leaves the result
unsaved so you can review it before pressing **Save settings**.

**SWR and force refresh:** enabling stale-while-revalidate removes
`must-revalidate` when a response is rewritten, because Firefox would otherwise
ignore the stale window. Shift+Reload still bypasses the cache entirely.

Settings are stored in `browser.storage.local` and applied on the next response;
no restart is needed. Files that are already in the cache keep their stored
headers until they expire or are re-fetched.

## How it decides

For every `http(s)` response the background page runs a single pure function,
[`planHeaderChanges`](src/lib/cache-policy.js):

1. Is the extension enabled? Is it a `GET`/`HEAD` for a selected subresource
   type, over HTTP(S)?
2. Skip responses already served from cache, excluded URLs, non-fingerprinted
   URLs (when that mode is on), `Vary: *`, `Set-Cookie` responses and
   `no-store` responses (the last two are configurable).
3. Only act on `200`, `203` and `304`.
4. Read the remaining freshness from `max-age` (or `Expires` − `Date`), subtract
   the `Age` header and treat `no-cache` as zero. If it is already long enough
   and “never shorten” is on — and no SWR change is needed — do nothing.
5. Merge `Cache-Control`: drop `max-age`, `no-cache`, and (when SWR is enabled)
   `must-revalidate`; keep every other directive, add `max-age=<remaining + Age>`
   and optionally `stale-while-revalidate=<window>`.
6. Set `Expires` to `now + remaining` in UTC.
7. Return a new header array, or `undefined` when nothing should change.

The decision is synchronous because blocking `webRequest` listeners must answer
synchronously; settings are cached in memory and refreshed through
`storage.onChanged`. [docs/DESIGN.md](docs/DESIGN.md) explains the rules in
detail, including why some directives are deliberately preserved.

## Project layout

```text
cache-even-longer/
├── .github/workflows/ci.yml  # CI: tests, validation and unsigned build
├── cache-longer-source/   # pristine signed 1.0 download (do not edit)
├── dist/                  # generated XPI, checksum, signed artifacts (ignored)
├── docs/
│   ├── AUDIT.md           # 1.0 findings, severity, evidence, fix mapping
│   ├── DESIGN.md          # decision pipeline, header policy, architecture
│   ├── INSTALL.md         # temporary install, AMO signing, troubleshooting
│   ├── AMO_SUBMISSION.md  # listed vs unlisted, ID/licence, submission steps
│   ├── RELEASE_DESCRIPTION.md  # copy-ready AMO listing and 2.1.0 release notes
│   ├── ROADMAP.md         # remaining cache-lifecycle ideas and hard limits
│   └── TESTING.md         # automated tests and manual browser checklist
├── scripts/
│   ├── build.mjs          # validate + package + checksum
│   ├── render-icons.sh    # SVG -> PNG (ImageMagick 7)
│   └── test-server.mjs    # local fixture server for manual testing
├── src/                   # the extension itself
│   ├── background.js
│   ├── manifest.json
│   ├── LICENSE            # MIT notice shipped inside the XPI
│   ├── icons/
│   ├── lib/
│   │   ├── cache-policy.js   # pure decision logic
│   │   ├── settings.js       # storage wrapper
│   │   └── site-control.js   # popup exclusion helpers
│   ├── popup/               # toolbar popup (site status + quick controls)
│   └── options/
├── tests/                 # node:test, no browser required
├── LICENSE                # MIT licence (root copy, kept in sync with src/LICENSE)
├── CHANGELOG.md
├── README.md
└── package.json
```

## Development

Requires Node.js 20+; `npm test`, `npm run check` and `npm run build` have no
runtime dependencies. `web-ext`, `zip` and ImageMagick are optional and only
needed for the commands that use them.

```sh
npm test             # 96 tests: policy, exclusions, settings, background, popup and options structure
npm run check        # validate manifest, files, JS syntax (no package)
npm run build        # dist/cache_even_longer-2.1.0.xpi + .sha256
npm run lint         # Mozilla web-ext lint (0 errors, 2 expected warnings)
npm run test-server  # fixtures on http://127.0.0.1:8787/
npm run dev          # temporary Firefox via web-ext (needs npm install + Firefox)
npm run sign         # AMO unlisted signing (needs API credentials)
npm run icons        # re-render PNGs from src/icons/{icon,toolbar}.svg
```

The test suite runs entirely in Node, with a mocked `browser` object for the
background page. It cannot prove that Firefox’s network stack behaves the same
way; [docs/TESTING.md](docs/TESTING.md) contains a route-by-route manual
checklist using the fixture server. GitHub Actions runs `npm test`,
`npm run check` and `npm run build` on pushes to `main` and on pull requests
(see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Compatibility and permissions

- Firefox 115+ desktop (Manifest V2, blocking `webRequest`).
- Permissions: `storage`, `webRequest`, `webRequestBlocking`,
  `http://*/*`, `https://*/*`. No `<all_urls>`, no `tabs`, no content scripts.
- Firefox for Android is not declared or tested. Documents (`main_frame`),
  frames and non-HTTP URLs are never modified.
- AMO’s validator reports two **non-blocking** warnings because the declared
  Firefox 115 floor predates `data_collection_permissions` (Firefox 140/142).
  The package still signs; see [docs/INSTALL.md](docs/INSTALL.md) for the
  options if you want a clean report.
- The add-on stays on Manifest V2 because blocking response-header modification
  is the whole mechanism. The policy module is transport-independent, so an MV3
  adapter can be added without rewriting the rules.

### Force refresh is untouched

Firefox maps **Shift+Reload** (and Ctrl+Shift+R / Cmd+Shift+R) to
`LOAD_FLAGS_BYPASS_CACHE | LOAD_FLAGS_BYPASS_PROXY`: the HTTP cache is skipped
before response headers matter. Cache even Longer only rewrites response
headers, never request headers or reload flags, and **never adds `immutable`**,
so it cannot prevent a hard reload.

A service worker can still serve from its own Cache API even on a hard reload.
For those sites, use DevTools → Application → Service Workers → **Bypass for
network**, or clear the site data. The add-on does not touch service-worker
caches.

## Privacy

Cache even Longer makes no network requests, has no telemetry and no remote code. It
declares:

```json
"data_collection_permissions": { "required": ["none"] }
```

Settings live in `storage.local`. The extension sees URLs and response headers
for HTTP(S) requests only because `webRequest` requires host access to do its
job; nothing is logged unless debug logging is enabled, and nothing is sent
anywhere.

## Troubleshooting

| Symptom | Where to look |
| --- | --- |
| Firefox refuses the XPI | [docs/INSTALL.md](docs/INSTALL.md) — it is unsigned, or your Firefox is older than 115. |
| Nothing is cached for longer | Enable debug logging, then check type, exclusion, status, `fromCache`, `no-store`/`Set-Cookie`, and whether the file was already cached. |
| A site shows stale content | Add it to the exclusion list, or lower the lifetime. `no-store` and `Set-Cookie` responses are already skipped by default. |
| A file is stuck in the cache | Shift+Reload or Ctrl+Shift+R bypasses the HTTP cache. If the site uses a service worker, use DevTools → Application → Service Workers → **Bypass for network**. |
| Options page is blank | Check the page console; reload the temporary add-on after editing files. |
| Popup says “Not a website” | The active tab is `about:`, `file:` or another non-HTTP(S) page; open a normal website. |
| Popup is not on the toolbar | Open the extensions (puzzle-piece) menu and pin Cache even Longer. |

## Credits and provenance

Original add-on **Cache Longer**, by [Rimu Atkinson](https://rimu.geek.nz),
version 1.0. This fork is named **Cache even Longer**. The signed download and
its extracted files are preserved unmodified in
[`cache-longer-source/`](cache-longer-source/) so the audit can be reproduced.

The original code is **MIT-licensed**. [`LICENSE`](LICENSE) preserves Rimu
Atkinson’s copyright and adds the fork’s copyright; the same notice is packaged
as `src/LICENSE`, as MIT requires when distributing copies. You may modify and
redistribute the add-on provided the copyright and permission notice are
retained.
