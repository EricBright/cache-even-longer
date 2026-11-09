# Design — Cache even Longer 2.1

This document is the behaviour contract for the rewrite. [AUDIT.md](AUDIT.md)
explains what was wrong with 1.0; this file explains what 2.1 does and why.

## Goals

- Extend the browser-cache lifetime of static subresources (images, CSS,
  JavaScript, fonts, optionally media and XHR) to a user-chosen duration.
- Never make caching less safe than the origin intended:
  - obey `no-store` by default;
  - skip `Set-Cookie` and `Vary: *` responses;
  - never turn a private response into a public one;
  - never cache errors, redirects or partial content.
- Never shorten a lifetime that is already longer, unless explicitly asked.
- Make every decision observable and testable without a browser.
- Keep the extension dependency-free at runtime and small enough to audit.

## Non-goals

- Pinning whole documents or bypassing navigation freshness rules.
- Managing Firefox’s cache size, eviction or partitioning.
- Replacing a service worker’s Cache API entries (that is a different cache).
- Providing a proxy or a shared-cache control plane.
- Being a general-purpose header editor.

## Decision pipeline

`planHeaderChanges(details, settings, now)` is a pure function: same inputs,
same output, no I/O. It returns `{ changed, reason, headers? }`. The background
listener only turns a changed plan into `{ responseHeaders }`.

Checks run in this order, and the first failing check wins:

| # | Reason | Condition |
| --- | --- | --- |
| 1 | `invalid-request` | `details` is not an object. |
| 2 | `disabled` | `settings.enabled` is not `true`. |
| 3 | `method` | Method is not `GET` or `HEAD`. |
| 4 | `invalid-settings` | `settings.resourceTypes` is not an array. |
| 5 | `resource-type` | `details.type` is not in the enabled set. |
| 6 | `served-from-cache` | `details.fromCache === true`. |
| 7 | `status-code` | Status is not `200`, `203` or `304`. |
| 8 | `no-response-headers` | `details.responseHeaders` is not an array. |
| 9 | `non-http-url` | URL does not start with `http://` or `https://`. |
| 10 | `excluded` | URL matches a user exclusion pattern. |
| 11 | `not-fingerprinted` | Fingerprint-only mode is on and the URL has no recognisable content hash/version. |
| 12 | `vary-star` | Any `Vary` value contains `*`. |
| 13 | `set-cookie` | A `Set-Cookie` header exists and the option is on. |
| 14 | `no-store` | `Cache-Control` contains `no-store` and the option is on. |
| 15 | `invalid-duration` | Target lifetime is not a positive number. |
| 16 | `already-long-enough` | Remaining lifetime ≥ target, `neverShorten` is on, and no SWR change is required. |
| 17 | `extended` | Rewrite and return new headers. |

The order is chosen so that cheap checks (type, status) come before header
parsing, and safety checks come before any rewriting. The reason strings are
what debug logging prints, which makes field reports diagnosable.

### Why statuses `200`, `203` and `304`

- `200` is the normal body response that creates a cache entry.
- `203` is a cacheable “non-authoritative” `200`.
- `304` carries no body but refreshes the stored headers. If it were ignored, a
  long lifetime could collapse back to a short one at the first revalidation.

`204` (no content), `206` (partial content), redirects, `4xx` and `5xx` are
excluded. Giving a `206` a fresh lifetime of months is how truncated fonts and
images happen.

## Header policy

### `Cache-Control`

The policy parses every `Cache-Control` header, splits directives on commas
while respecting quoted strings, and then merges:

| Directive | Behaviour | Why |
| --- | --- | --- |
| `max-age` | Removed; one new `max-age=<remaining + Age>` is appended | The extension’s purpose; adding `Age` keeps the window measured from receipt. |
| `no-cache` | Removed | It forces revalidation on every use, so freshness would stay at zero. |
| `no-store` | Response is skipped unless the user overrides it; removed when overridden | “Never write this to disk” is a privacy instruction. |
| `private` | Preserved | The response is still only for the local browser cache. |
| `public` | Preserved if the origin sent it, **never added** | Adding it can expose authenticated content to shared caches. |
| `s-maxage` | Preserved unchanged | It applies to shared caches, which this extension does not manage. |
| `must-revalidate` | Preserved, except removed when stale-while-revalidate is enabled | Firefox checks `must-revalidate` before the SWR window, so leaving it would make SWR a no-op. |
| `proxy-revalidate` | Preserved | Applies to shared caches; it does not block Firefox’s private-cache SWR. |
| `immutable` | Preserved if the origin sent it, **never added** | Firefox can skip forced validation in some paths (e.g. DevTools Disable Cache); adding it would weaken force-refresh. |
| `stale-while-revalidate` | Preserved; optionally added or extended when the SWR setting is on | The setting only raises the window; a longer origin value is never shortened. |
| `stale-if-error` | Preserved | Firefox does not appear to implement it, so it is left alone. |
| `no-transform`, vendor directives, unknown tokens | Preserved | Dropping unrelated directives changes semantics. |

Duplicate `Cache-Control` headers are combined into one output header. The
first occurrence keeps its name and position; later copies are removed. Missing
headers are appended with canonical casing.

### `Expires`

- Recomputed as `new Date(now + newRemaining * 1000).toUTCString()`, where
  `newRemaining` is the remaining lifetime after `Age` is taken into account.
- Replaces the first `Expires` header; duplicates are removed; a missing one is
  appended.
- Kept even when `Cache-Control: max-age` is present: HTTP/1.1 caches prefer
  `max-age`, while older caches can still use `Expires`.

### Other headers

- `Vary` is inspected only for `*`; other values are left alone. Firefox stores
  separate variants as usual.
- `Set-Cookie` causes a skip by default; other `Set-*` headers are untouched.
- `Age` is read, not rewritten: it reduces the remaining freshness Firefox will
  see, so the policy subtracts it when measuring the existing lifetime and adds
  it back to the new `max-age`.
- `ETag`, `Last-Modified`, `Date`, `Pragma` and everything else are untouched.
  Response `Pragma` is obsolete for freshness in modern Firefox, so removing it
  would add risk for no benefit.

### Existing lifetime

The “already long enough” test uses the same freshness model a browser uses:

1. If `no-cache` is present → `0` (revalidation is mandatory).
2. Else if `max-age` parses to a number → `max(0, value − Age)`.
3. Else if `Expires` parses → `max(0, Expires − Date − Age)`, using the current
   time if `Date` is missing or invalid.
4. Else → `0`.

`Age` is the number of seconds the response has already spent in shared caches
(CDNs commonly send it). Treating it as zero would make a “180-day” rewrite
deliver less than 180 days when the response arrives with a large `Age`.

`Expires: 0` and `Expires: -1` are treated as “already expired”, not as dates.
`s-maxage` is deliberately not used: it describes shared caches, not Firefox’s
private cache.

The configured duration is converted with exact arithmetic:
`durationDays × 86400` seconds. There is no calendar-month arithmetic anywhere,
so 31 August + 180 days is a fixed instant rather than an accidental March
overflow.

### Stale-while-revalidate

When enabled, the policy merges a `stale-while-revalidate=<seconds>` directive
into the rewritten response. It uses the larger of the origin’s existing window
and the configured window, so it never shortens the origin policy. If
`must-revalidate` is present it is removed, because Firefox checks
`must-revalidate` first and would otherwise ignore the stale window.

The window is opt-in and off by default. Serving stale content is a behavioural
change; Shift+Reload still bypasses the cache entirely.

### Fingerprint-only mode

When enabled, the policy only rewrites URLs that look content-addressed. The
detection is deliberately conservative:

- 8+ hexadecimal characters delimited by punctuation in the final path segment
  (`app.4f3c2a91.js`, `styles.524f6c762af549da.css`, `chunk-4f3c2a91.js`);
- a `v`, `ver`, `version`, `hash`, `h` or `cb` query parameter with 8+ hex
  characters.

Base64-style hashes are not detected, so the mode may skip some fingerprinted
assets; that is safer than false positives. Documents are never touched, and
the mode composes with the exclusion list and all safety checks.

## Settings model

Stored under the single key `settings` in `browser.storage.local`.

| Key | Type | Default | Normalisation |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Non-booleans fall back to the default. |
| `durationDays` | number | `180` | Numeric strings accepted; rounded; clamped to 1–3650. |
| `resourceTypes` | string[] | `image`, `stylesheet`, `script`, `font` | Unknown IDs dropped, duplicates removed; an empty list is respected. |
| `neverShorten` | boolean | `true` | Default on. |
| `respectNoStore` | boolean | `true` | Default on. |
| `skipSetCookie` | boolean | `true` | Default on. |
| `staleWhileRevalidate` | boolean | `false` | Default off. |
| `staleWhileRevalidateDays` | number | `7` | Rounded; clamped to 1–365. |
| `onlyFingerprinted` | boolean | `false` | Default off. |
| `debugLogging` | boolean | `false` | Default off. |
| `excludedUrls` | string | `""` | Newline-separated patterns; comments allowed. |

Two derived fields are rebuilt on every load and never stored:

- `durationSeconds` — `durationDays × 86400`.
- `excludeMatchers` — compiled regular expressions, so no pattern is compiled
  per request.

`PRESETS` (Safe, Balanced, Aggressive) are policy-only starting points. Applying
one fills the policy fields but never changes `enabled`, `excludedUrls` or
`debugLogging`. The options page treats a preset as an edit: the user still
presses **Save settings** to apply it.

`toStored()` writes only the eight user-editable fields. Unknown or malformed
stored data is normalised instead of crashing, which also makes upgrades from
future schema versions safe.

## Exclusion grammar

Each non-empty line is a glob. `#` starts a comment. `*` matches any run of
characters; everything else is literal. Matching is anchored and
case-insensitive, against the URL normalised with `new URL(...).href`.

| Pattern | Compiled meaning |
| --- | --- |
| `example.com` | `scheme://example.com[:port][/…]` — exact host, any path |
| `*.example.com` | any subdomain, but not the bare host |
| `example.com/api/*` | that host, paths starting `/api/` |
| `https://example.com/*` | only HTTPS, any path |
| `example.com:8080` | that host and port only |

If a pattern does not specify a port, an optional `:<digits>` is allowed before
the path. This makes `localhost` and `127.0.0.1` usable against development
servers without having to remember the port. Anchoring prevents `example.com`
from matching `example.com.evil.test`. An invalid regex cannot escape the
compiler because every metacharacter is escaped first.

Host-only patterns do **not** match subdomains; use `*.example.com` for that.

The options page can export the current list to a dated plain-text file and
import another list. Import is non-destructive: it appends new patterns, ignores
comments and exact duplicates, preserves existing comments, and leaves the form
dirty until the user saves. Export uses the current textarea contents, including
unsaved edits.

## Architecture

```text
src/lib/cache-policy.js   pure rules, parsing, exclusion compiler, UMD export
src/lib/settings.js       storage.local wrapper, defaults, serialisation
src/lib/site-control.js   host pattern, exclusion editing, import/export helpers
src/background.js         listener lifecycle, cached settings, debug logging
src/popup/…               toolbar popup: site status, exclusion, quick lifetime
src/options/…             full HTML/CSS/JS settings page
```

Runtime flow:

```text
Firefox webRequest.onHeadersReceived (blocking, responseHeaders)
        │
        ▼
background.onHeadersReceived(details)
        │  settings cached in memory
        ▼
cache-policy.planHeaderChanges(details, settings, Date.now())
        │
        ├── unchanged → return undefined (request proceeds untouched)
        └── changed   → return { responseHeaders: newHeaders }
```

### Why settings are cached in memory

A blocking `webRequest` listener must return a `BlockingResponse`
synchronously. Awaiting `storage.local.get()` per request would either delay
every response or require returning a `Promise`, which is not desirable for a
hot path. Instead:

1. The background page loads settings once, before registering the listener.
2. Saving the options page triggers `storage.onChanged`, which replaces the
   in-memory object synchronously.
3. A revision counter prevents a slow initial load from overwriting a newer
   change that arrived while loading.

Registering only after the initial load means a user who disabled the extension
does not get a few rewritten responses during browser startup. The small delay
only affects the first few requests after startup, and unmodified responses are
the safe failure mode.

### Error containment

`background.js` wraps the whole decision in `try/catch`. If anything throws, it
logs a namespaced error (with the URL) and returns `undefined`; the request
continues exactly as if the extension were absent. The policy also validates
its inputs instead of assuming `responseHeaders`, `type`, or `method` exist.

### Toolbar popup

`manifest.browser_action` declares a toolbar button with 16/32/48px icons, the
tooltip “Cache even Longer — Site controls”, and `popup/popup.html`.

The popup shows:

- whether the extension is enabled and whether the current host is excluded;
- a one-click exclude/include toggle that edits the same `excludedUrls` text the
  options page uses;
- a quick cache-lifetime selector;
- a short policy summary and an **All settings** link.

It reads the active tab URL with `tabs.query`. The extension already has host
permissions for http(s), so no `tabs` permission is required. If the URL is not
an HTTP(S) page, the site controls are disabled. Saving from the popup writes
`storage.local`, which the background page picks up through `storage.onChanged`
just like the options page.

### Manifest choice

The add-on uses Manifest V2 with a persistent background page because blocking
`webRequest` response-header modification is the core mechanism, and it needs a
listener that is always present. Firefox supports MV2 today; an MV3 port would
need to deal with event-page lifecycle and the same blocking permission. The
policy module does not depend on the manifest version, so a port would only
replace `background.js` with an adapter.

`declarativeNetRequest` is not used because the decision depends on response
data that static rules cannot inspect well (status, `fromCache`, parsed
`Cache-Control`, `Set-Cookie`, `Vary`), and because it would fragment the logic
between a declarative rule set and the runtime.

### Force refresh

Shift+Reload (and Ctrl+Shift+R / Cmd+Shift+R) is wired to
`Browser:ReloadSkipCache`, which sets `LOAD_FLAGS_BYPASS_CACHE` and
`LOAD_FLAGS_BYPASS_PROXY`. Firefox skips the HTTP cache before any response
header is considered, so it fetches from the network even when an asset was
cached with a multi-month lifetime.

The add-on cannot interfere with that:

- it only listens to `onHeadersReceived`; it never modifies request headers,
  cancels/redirects requests, or observes the reload flags;
- it never adds `immutable` (it only preserves an origin’s value), so it does
  not create an additional path that skips forced validation;
- documents are never touched at all.

Normal reload is different: it may reuse fresh cached subresources, which is the
purpose of the add-on. A service worker can still serve from its own Cache API
even on a hard reload; use DevTools → Application → Service Workers → “Bypass
for network” for those sites. See [ROADMAP.md](ROADMAP.md) for why `immutable`
promotion is deliberately excluded.

## Security and privacy model

- The extension never adds `public`; it only preserves what the origin sent.
- `no-store` is a hard stop by default.
- Responses carrying `Set-Cookie` are skipped by default.
- `Vary: *` is a hard stop; the response is not reusable by definition.
- Only `200`/`203`/`304` are touched.
- Host permissions are limited to `http://*/*` and `https://*/*`.
- There are no content scripts, no remote code, no network requests and no
  telemetry. The data-collection declaration is `none`.
- Debug logging may print URLs to the local browser console; it is off by
  default and never leaves the machine.

## Known limitations

- **Cache is a hint.** Firefox may evict an entry early due to size limits or
  user actions; the extension cannot guarantee that a file survives.
- **Already-cached entries keep their headers.** The extension only changes
  responses as they are received; it cannot retroactively rewrite the cache.
- **Partitioning remains.** Firefox keys its HTTP cache by top-level site;
  extending a lifetime does not make an entry shared across sites.
- **Service worker caches are separate.** The Cache API is untouched.
- **`304` handling depends on exposed headers.** If a response carries no header
  list, there is nothing to rewrite.
- **No `immutable` promotion.** The extension extends time but never claims a
  body will never change. Adding `immutable` could skip forced validation in
  some reload paths, so it is deliberately not generated.
- **SWR can serve stale content.** When enabled, Firefox may return a stale copy
  for the configured window while it revalidates. Shift+Reload still bypasses
  the cache.
- **Fingerprint detection is conservative.** It recognises hex hashes and common
  version query parameters, not base64-style hashes. It may skip some
  fingerprinted assets rather than risk false positives.
- **Age handling is approximate.** The policy subtracts the `Age` header from
  the existing lifetime and adds it to the new `max-age`; the browser’s full
  age calculation also includes time since receipt, which is negligible at
  rewrite time.
- **Desktop only.** Firefox for Android is not declared or tested.

## Future work

- Import/export of settings and a “recent decisions” inspector.
- An MV3 adapter reusing `cache-policy.js`.
- Optional statistics (responses extended, bytes potentially saved) kept
  locally.
- Browser-level integration tests (Marionette/Playwright) against the fixture
  server.
- Keyboard shortcuts and localization.
