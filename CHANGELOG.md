# Changelog

All notable changes to Cache even Longer are recorded here. Versions use
[semantic versioning](https://semver.org/). The 2.x line is a safety rewrite of
the original **Cache Longer 1.0**, renamed to avoid confusion with the upstream
add-on; see [docs/AUDIT.md](docs/AUDIT.md) for the full list of defects that
motivated it.

## [2.1.0] — 2026-11-09

Adds cache-lifecycle controls on top of the 2.0 safety rewrite, without giving
up the guarantee that a force refresh always works.

### Added

- Optional `stale-while-revalidate` with a configurable 1–365 day window
  (off by default). When enabled, `must-revalidate` is removed from rewritten
  responses because Firefox would otherwise ignore the stale window.
- Toolbar popup with the current host, active/excluded status, a one-click
  exclude/include toggle, a quick lifetime selector and an **All settings**
  link.
- Quick profiles: **Safe** (30 days, fingerprinted only, no SWR), **Balanced**
  (180 days, 7-day SWR) and **Aggressive** (365 days, 30-day SWR, media
  included).
- Fingerprint-only mode: only rewrite URLs with a recognisable content hash or
  version query.
- Age-aware arithmetic: `Age` is subtracted from the remaining lifetime and
  added to the new `max-age`, so a CDN-cached response still receives the
  configured duration from receipt.
- Site-control helpers for reading a host and editing the exclusion list.
- Exclusion-list export/import: export the current list to a dated text file;
  import merges new patterns, ignores comments/duplicates, and leaves the list
  unsaved for review.
- Popup and site-control structural tests; the suite is now 96 tests.

### Changed

- The toolbar button now opens a compact popup instead of jumping straight to
  the options page.
- Settings now include `staleWhileRevalidate`, `staleWhileRevalidateDays` and
  `onlyFingerprinted`; malformed or older stored settings are normalised.
- The options page adds the profile buttons, SWR controls and fingerprint-only
  toggle.

### Fixed

- A response carrying a large `Age` no longer delivers less than the configured
  lifetime.
- Adding SWR to a response that already had a longer lifetime no longer
  shortens that lifetime.
- `must-revalidate` no longer silently defeats an enabled SWR window.

### Security

- `immutable` is still preserved when an origin sends it but is never added, so
  the add-on does not create new paths that skip forced validation.
- All 2.0 safety defaults remain: `no-store`, `Set-Cookie`, `Vary: *`, status
  allowlist, no `public`, and no document rewriting.

## [2.0.0] — 2026-11-09

A safety-focused rewrite, renamed **Cache even Longer**. The extension still
does one thing — extend how long Firefox reuses static subresources — but it now
refuses to do that when the response says it must not be cached, and every
policy can be configured.

### Added

- Options page with an enable switch, configurable cache lifetime (1–3650 days,
  presets for 30/90/180/365), and immediate application of saved settings.
- Toolbar button that opens the settings page directly (`browser_action` plus
  `browser.runtime.openOptionsPage()`), with 16/32px toolbar icons. Superseded
  by the site-control popup in 2.1.0.
- Per-type control over which subresources are touched (images, stylesheets,
  scripts, fonts, media, XHR/fetch, other).
- Wildcard exclusion list for hosts, subdomains and URL prefixes, including
  hosts on non-default ports.
- Safety switches: respect `Cache-Control: no-store` (on by default) and skip
  responses with `Set-Cookie` (on by default).
- “Never shorten an existing cache lifetime” option, on by default.
- Optional debug logging of every allow/skip decision.
- Dependency-free test suite covering the policy, exclusion grammar,
  settings storage, background wiring and options-page structure.
- Build script that validates the manifest, referenced files and JavaScript
  syntax, then produces a clean, checksummed XPI.
- Local fixture server with one route per decision branch for manual testing.
- Install/sign workflow: `npm run dev` for a temporary Firefox, `npm run lint`
  with Mozilla's validator, and `npm run sign` for AMO unlisted signing.
- MIT `LICENSE` with Rimu Atkinson’s copyright preserved and the fork’s
  copyright added; an identical copy ships inside the XPI and the build fails if
  the two copies drift.
- Documentation: audit, design notes, installation/signing guide, AMO
  submission guide (ID/licence caveats), copy-ready AMO listing/release
  description, a cache-lifecycle roadmap, and a manual test plan.

### Changed

- Renamed the add-on to **Cache even Longer** and updated the manifest, options
  page, console namespace and documentation. The fork keeps its own Gecko GUID.
- Cache lifetime is configured in days instead of a hard-coded six months.
- `Cache-Control` is merged rather than replaced: `private`, `immutable`,
  `no-transform`, `must-revalidate`, `s-maxage`, `stale-while-revalidate` and
  unknown directives are preserved. `public` is never added.
- Only responses to `GET`/`HEAD` requests are considered.
- Manifest now declares a fork-owned Gecko GUID, `strict_min_version` 115.0 and
  the required `data_collection_permissions` (`none`).
- Permissions narrowed from `<all_urls>` to `http://*/*` and `https://*/*`.
- Force refresh is left untouched: the add-on never modifies request headers or
  reload flags, and never adds `immutable`. Preserving an origin’s `immutable`
  remains, but it is not synthesized.
- Icons redrawn as a neutral clock-and-plus mark, since the lifetime is no
  longer fixed at six months.
- New icon sizes (16/32/48/96 px), a simplified 16/32px toolbar clock, and
  scalable SVG sources.

### Fixed

- Private or authenticated responses are no longer made public.
- `no-store`, `Set-Cookie` and `Vary: *` responses are no longer cached.
- Error responses (4xx/5xx), redirects, `204` and `206` partial responses are
  no longer given a multi-month lifetime.
- Responses already served from the cache (`fromCache`) are no longer rewritten.
- Already-long lifetimes are no longer shortened by default.
- `Expires` is computed from exact days instead of `Date.setMonth()`, removing
  end-of-month overflow and matching the `max-age` value exactly.
- Duplicate `Cache-Control` and `Expires` headers are collapsed to one each.
- Missing `details.responseHeaders` no longer throws inside the listener.
- Header rewriting no longer relies on an implicit global variable.
- Listener errors are contained and logged instead of escaping into the request.

### Security

- Private browsing/authenticated content can no longer be marked `public` by
  this extension.
- `no-store` is honoured by default, so explicitly sensitive responses are not
  written to the HTTP cache.
- The add-on makes no network requests, has no telemetry, and declares
  `data_collection_permissions.required = ["none"]`.

### Packaging

- The build no longer ships `__MACOSX`, `.DS_Store`, `META-INF` signatures or
  other archive junk.
- A SHA-256 checksum is written next to the XPI so two builds can be compared.
- The XPI now ships the MIT notice (`LICENSE`), so attribution travels with the
  distributed copy.
- The signed 1.0 download is kept untouched in `cache-longer-source/` for
  reference; editing it would invalidate its signature anyway.

## [1.0.0] — original release

- Single background script that forced `Expires` to six months and
  `Cache-Control` to `public, max-age=15780000` on fonts, images, scripts and
  stylesheets.
- No options, no exclusions, no status or privacy checks.
