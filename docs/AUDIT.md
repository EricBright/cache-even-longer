# Audit — Cache Longer 1.0

**Scope:** the signed `cache_longer-1.0.xpi` downloaded from the add-on
distribution, as extracted into
[`cache-longer-source/`](../cache-longer-source/). The original files are kept
untouched as evidence; the rewrite lives in [`src/`](../src/) and ships as
**Cache even Longer 2.1**.

**Method:** line-by-line review of the two source files, comparison with the
HTTP caching rules in RFC 9111, reproduction of the package contents with
`unzip -l`, static validation, and a behaviour-by-behaviour test suite. There is
no Firefox binary in the development environment, so runtime verification is
documented as a manual checklist in [TESTING.md](TESTING.md) and was not
executed here.

**Summary:** 24 findings — 1 critical, 6 high, 10 medium, 5 low and 2
informational. The most serious defect is that every response was rewritten to
`public`, discarding `private` and `no-store`; the second most serious is that
error, redirect and partial-content responses were given a multi-month lifetime.
Both are fixed in 2.0.0 and carried forward in 2.1.0.

## Findings at a glance

| ID | Severity | Finding | Legacy location | Status |
| --- | --- | --- | --- | --- |
| F-01 | Critical | Forces `public`, drops `private`/`no-store`, ignores `Set-Cookie` | `cache_longer.js:16-27` | Fixed |
| F-02 | High | Rewrites errors and redirects for months | `cache_longer.js:4-34` | Fixed |
| F-03 | High | Rewrites `206 Partial Content` as a full response | `cache_longer.js:4-34` | Fixed |
| F-04 | High | Shortens responses that were already cached longer | `cache_longer.js:17` | Fixed |
| F-05 | High | Caches responses that set cookies | `cache_longer.js:4-34` | Fixed |
| F-06 | High | Caches `Vary: *` responses | `cache_longer.js:4-34` | Fixed |
| F-07 | Medium | Rewrites responses already served from cache | `cache_longer.js:4-34` | Fixed |
| F-08 | Medium | Assumes `responseHeaders` is always present | `cache_longer.js:11` | Fixed |
| F-09 | Medium | Implicit global `new_expires`; no strict mode | `cache_longer.js:10` | Fixed |
| F-10 | Medium | `setMonth(+6)` overflow; `max-age` ≠ `Expires` | `cache_longer.js:8-10,17` | Fixed |
| F-11 | Medium | Duplicate headers are not collapsed | `cache_longer.js:11-20` | Fixed |
| F-12 | Medium | All other `Cache-Control` directives are discarded | `cache_longer.js:17` | Fixed |
| F-13 | Medium | Hard-coded lifetime; `storage` permission unused | `cache_longer.js:9,17`; `manifest.json:19` | Fixed |
| F-14 | Medium | No exclusions or per-site escape hatch | whole file | Fixed |
| F-15 | Medium | Fixed, incomplete resource-type filter | `cache_longer.js:33` | Fixed |
| F-16 | Low | No error containment around the listener | `cache_longer.js:4-34` | Fixed |
| F-17 | Low | Unconditional console logging, no debug switch | `cache_longer.js:1` | Fixed |
| F-18 | Low | `<all_urls>` is broader than the feature needs | `manifest.json:19` | Fixed |
| F-19 | High | Missing AMO-required metadata; submission risk | `manifest.json` | Fixed |
| F-20 | Medium | XPI ships macOS resource-fork junk | `cache_longer-1.0.xpi` | Fixed |
| F-21 | Low | No tests, no build step, no documentation | repository | Fixed |
| F-24 | Low | MIT notice not shipped with the package | `cache_longer-1.0.xpi` | Fixed |
| F-22 | Info | `Pragma: no-cache` is not handled | `cache_longer.js` | Deliberate |
| F-23 | Info | `Expires` is added even when `Cache-Control` exists | `cache_longer.js:21-27` | Kept |

## Critical and high findings

### F-01 — Every response is forced to `public` (critical, privacy)

**Evidence.** The listener replaces the value of every `Cache-Control` header
with `public, max-age=15780000` (`cache_longer.js:16-19`) and adds the same
header when none exists (`:25-27`). Because the whole value is replaced, a
server that sent

```http
Cache-Control: private, no-store
```

or

```http
Cache-Control: private, max-age=0
```

had that instruction erased and replaced with a directive that explicitly
invites shared caches to store the response. Adding `public` also overrides the
usual rule that responses to requests with an `Authorization` header must not be
stored by shared caches.

**Impact.** Authenticated API payloads, personalised images, account pages and
one-time tokens could be written to a shared cache or reused across contexts.
At minimum, a response the origin marked “never store” was stored for six
months. This is the defect that most justifies the rewrite.

**Fix.** The policy never adds `public`; it preserves `private`, keeps
`no-store` responses untouched by default, and skips `Set-Cookie` responses
(`src/lib/cache-policy.js`). The `public` directive from the origin is preserved
if present, but it is never invented.

**Tests.** “private is preserved and public is never added”, “no-store is
respected by default”, “no-store can be overridden…”, “responses with Set-Cookie
are skipped by default”.

### F-02 — Errors and redirects are given a six-month lifetime (high)

**Evidence.** There is no `details.statusCode` check. A `404` image, a `500`
script, a `301`/`302` stylesheet response or a `204` is rewritten exactly like a
`200`.

**Impact.** A broken deployment or a transient server error becomes sticky for
months. Recovery requires manually clearing the cache; users cannot tell why a
site is still serving an old error page. Redirects with a long lifetime also
make URL changes hard to roll back.

**Fix.** Only `200`, `203` and `304` are rewritten. `204`, `206`, redirects,
client errors and server errors are skipped. `304` is included intentionally:
it is how a stored entry refreshes its metadata, and extending it prevents a
long lifetime from collapsing back to a short one at the first revalidation.

**Tests.** “only cacheable statuses are rewritten”.

### F-03 — Partial content is treated as a complete response (high)

**Evidence.** No status check, so `206 Partial Content` responses — used for
range requests, resumable downloads and some font/image fetches — receive
`max-age` and `Expires` for the whole response.

**Impact.** A partially cached body can be considered fresh for six months.
Depending on how the range is stored and reused, this produces truncated images,
fonts or media, and the failure is hard to connect to the extension.

**Fix.** `206` is excluded by the status allowlist.

**Tests.** “only cacheable statuses are rewritten” includes `206`.

### F-04 — Longer cache lifetimes are shortened (high)

**Evidence.** `cache_longer.js:17` always writes `max-age=15780000` (about
182.6 days). A server that sent `max-age=31536000, immutable` had its one-year
lifetime reduced to six months. The add-on named “Cache Longer” made caching
shorter.

**Impact.** Lost offline/performance benefit, and surprising behaviour for
fingerprinted assets that are designed to be cached forever.

**Fix.** The policy parses the existing freshness lifetime (`max-age`, or
`Expires` − `Date`) and, with `neverShorten` on by default, leaves the response
alone when the existing lifetime is at least the configured target. `no-cache`
is treated as a zero lifetime because it forces revalidation regardless of
`max-age`.

**Tests.** “an already longer max-age is preserved”, “neverShorten can be turned
off…”, “a lifetime exactly equal to the target is left alone”, “a far-future
Expires is preserved”.

### F-05 — Responses with `Set-Cookie` are cached (high)

**Evidence.** No inspection of `Set-Cookie`.

**Impact.** Responses that establish or refresh a session are typically
personalised. Caching the body for months can show stale account data, replay a
one-time action, or serve content from a previous login state in another tab.

**Fix.** Responses carrying `Set-Cookie` are skipped by default. The option can
be turned off for users who know a particular site is safe.

**Tests.** “responses with Set-Cookie are skipped by default”, “Set-Cookie
responses can be opted in, and the cookie header survives”.

### F-06 — `Vary: *` responses are cached (high)

**Evidence.** `Vary` is never inspected.

**Impact.** `Vary: *` means the response cannot be reused for any other request.
Overriding it is a protocol violation, and Firefox may still refuse to reuse the
entry, so the extension’s headers do nothing except obscure the origin’s intent.

**Fix.** Any `Vary` value containing `*` is skipped, case-insensitively and
across comma-separated values.

**Tests.** “Vary: * is never cached over”.

### F-19 — Missing AMO metadata blocks or delays publishing (high)

**Evidence.** `manifest.json` has no `browser_specific_settings`, no Gecko ID,
no `strict_min_version`, and no `data_collection_permissions`.

**Impact.** Since **3 November 2025**, new extensions submitted to
addons.mozilla.org must declare `browser_specific_settings.gecko.data_collection_permissions`.
Without it, a submission is rejected. A Gecko ID is also needed for a stable
identity (and therefore stable `storage.local` settings) when loading
temporarily or updating. Without a minimum version, the add-on may be offered to
Firefox versions that cannot verify current signatures.

**Fix.** `manifest.json` now declares:

```json
"browser_specific_settings": {
  "gecko": {
    "id": "{b2aeb8c2-b8ec-4375-afc3-21d58bcc6b3a}",
    "strict_min_version": "115.0",
    "data_collection_permissions": { "required": ["none"] }
  }
}
```

The declaration is accurate: the add-on makes no network requests and has no
telemetry. The ID is a GUID generated for this fork; use the original listing’s
GUID only if you own that AMO account, or generate another ID for a new fork.

**Tests.** `scripts/build.mjs` refuses to build without these keys.

## Medium findings

### F-07 — Responses served from cache are rewritten

**Evidence.** No `details.fromCache` check.

**Impact.** At best a no-op; at worst it updates cache metadata for an entry that
was already reused, causing churn. The extension should only act on the network
response that creates a cache entry.

**Fix.** `fromCache === true` is skipped.

**Tests.** “responses already served from cache are not rewritten”.

### F-08 — `responseHeaders` is assumed to exist

**Evidence.** `for (var header of details.responseHeaders)` (`:11`).

**Impact.** If Firefox supplies no header list (network error, some cached or
synthetic responses), the listener throws a `TypeError`. The request itself
continues, but that response is not handled and the console fills with errors.

**Fix.** `Array.isArray(headers)` guard, plus a `try/catch` around the whole
listener that logs and returns `undefined`.

**Tests.** “missing responseHeaders cannot crash the listener”; the integration
test suite also exercises the listener directly.

### F-09 — Implicit global and non-strict code

**Evidence.** `new_expires` is assigned without `var`/`let` at `:10`; there is
no `"use strict"`.

**Impact.** In a classic background page the value becomes a property of the
global object. Any other script using the same name collides, and moving the
file into a module or strict context throws a `ReferenceError`.

**Fix.** All modules use `"use strict"`, local `const`/`let`, and expose a single
namespace object (`CacheLongerPolicy`, `CacheLongerSettings`).

**Tests.** Static check: every script is parsed with `node --check`; the policy
module is loaded in strict mode by the tests.

### F-10 — Month arithmetic and inconsistent durations

**Evidence.** `d.setMonth(d.getMonth() + 6)` (`:9`) and
`max-age=15780000` (`:17`). `15780000` seconds is **182.64 days**, while six
calendar months are 181–184 days. `setMonth` also overflows: 31 August + 6
months lands on 2 or 3 March, not 28 February.

**Impact.** `Expires` and `max-age` disagree, and the expiry date can be off by
several days. Behaviour depends on the day the request happens, which makes the
add-on inconsistent — exactly the reported symptom.

**Fix.** The lifetime is configured in whole days, converted to seconds, and
`Expires` is computed as `now + targetSeconds * 1000` in UTC. There is no
calendar arithmetic left.

**Tests.** “the configured duration controls max-age and Expires”, “duration is
clamped…”, “the classic Expires: 0 means expired”.

### F-11 — Duplicate headers survive as duplicates

**Evidence.** The loop replaces the value of every matching header (`:11-20`).

**Impact.** A response with two `Cache-Control` headers ends up with two
identical values. Header handling becomes ambiguous and tooling reports
duplicates.

**Fix.** `rewriteHeaders` replaces the first occurrence, removes later ones, and
appends the header only if it was absent.

**Tests.** “duplicate Cache-Control and Expires headers collapse to one each”.

### F-12 — All other cache directives are discarded

**Evidence.** The full `Cache-Control` value is replaced (`:17`).

**Impact.** `immutable`, `no-transform`, `must-revalidate`,
`stale-while-revalidate`, `stale-if-error`, `s-maxage` and vendor directives are
lost. In particular, `s-maxage` belongs to shared caches and should not be
silently rewritten by a browser extension.

**Fix.** Only `max-age` and `no-cache` are removed from the copy; `no-store` is
removed only when the user explicitly overrides it. Every other directive is
kept, including its original spelling and value.

**Tests.** “immutable, no-transform, must-revalidate and stale-while-revalidate
survive”, “s-maxage is left untouched for shared caches”.

### F-13 — Hard-coded policy, unused permission

**Evidence.** `max-age=15780000` and `setMonth(+6)` are literals; `storage` is
requested in `manifest.json:19` but never used.

**Impact.** Users cannot choose a shorter, safer lifetime or turn the add-on off
for a site. Requesting an unused permission is also a review and trust problem.

**Fix.** The `storage` permission now backs the options page. Lifetime is
configurable from 1 to 3650 days, with presets, and the whole feature has an
enable switch.

**Tests.** “settings.save stores only user-editable fields and round-trips”,
“settings.load normalises malformed stored data”, “honours a stored duration”,
“returns undefined when the extension is disabled”.

### F-14 — No exclusions

**Evidence.** None of the logic consults the URL.

**Impact.** A single broken site forces the user to disable the add-on globally.

**Fix.** A wildcard exclusion list supports exact hosts, subdomains, path
prefixes and fully qualified URLs, including hosts on non-default ports.

**Tests.** The exclusion tests cover bare hosts, lookalike hosts, subdomains,
path anchoring, schemes and ports.

### F-15 — Fixed, incomplete resource-type filter

**Evidence.** `types: ["font", "image", "script", "stylesheet"]`
(`cache_longer.js:33`).

**Impact.** Media, XHR/fetch and “other” requests cannot be covered even when a
user wants them. There is no way to narrow the set either.

**Fix.** The manifest listener is registered for all `http(s)` requests; the
policy checks a configurable per-type set. Documents, frames, redirects and
errors remain excluded no matter what is selected.

**Tests.** “only the configured resource types are touched”, “returns undefined
for responses that are not rewritten”.

### F-20 — Archive junk and signature fragility

**Evidence.** `unzip -l cache_longer-1.0.xpi` reports `__MACOSX/._cache_longer.js`,
`__MACOSX/._icon.png` and `__MACOSX/._manifest.json`, alongside
`META-INF/*.rsa|sf|mf` signature files.

**Impact.** The resource forks are useless payload and trip package linters.
The signature means any edited file invalidates the package: the downloaded XPI
cannot be repackaged as the new version. Keeping the signed copy next to an
edited one also invites accidentally shipping a stale signature.

**Fix.** `src/` contains no junk and no `META-INF`; `scripts/build.mjs` rejects
those paths if they ever appear, builds a clean unsigned XPI and writes its
SHA-256 next to it. The original signed XPI stays in `cache-longer-source/` as
read-only evidence.

**Tests.** Build check: the archive has 22 entries, `manifest.json` at its root,
the MIT `LICENSE`, and no `__MACOSX` or `META-INF` entries.

## Low and informational findings

### F-16 — No error containment

The listener body is unprotected. A malformed header, a missing field or a bug
in the date code throws out of the callback. The request is not cancelled by
that (Firefox handles the failure), but the response is skipped silently and the
cause is buried in the console.

**Fixed:** the listener wraps the decision in `try/catch`, logs a namespaced
error with the URL, and returns `undefined` so the request proceeds untouched.

### F-17 — Console noise

`cache_longer.js:1` logs on every background start, unconditionally and without
a prefix.

**Fixed:** logging is namespaced and gated behind the debug option. Skipped
resource types and cache hits are quiet even in debug mode.

### F-18 — `<all_urls>` is broader than needed

The listener only handles `font`, `image`, `script` and `stylesheet`, yet the
manifest requests every scheme including `file:` and `ftp:`. Rewriting headers
for `file:` URLs is meaningless and broad host permissions raise the install
warning.

**Fixed:** permissions are narrowed to `http://*/*` and `https://*/*`, and the
policy also rejects non-HTTP URLs defensively.

### F-21 — No tests, build step or documentation

The shipped source is a single script and a manifest with no way to reproduce
the package, verify a change or understand the intended policy.

**Fixed:** 96 automated tests, a validating build script, a fixture server, and
the documents in this directory.

### F-24 — MIT notice is not shipped with the package (low, compliance)

**Evidence.** The public AMO listing shows the MIT License, but the downloaded
XPI and the extracted `cache-longer-source/` contain no `LICENSE` file.

**Impact.** MIT requires the copyright and permission notice to accompany copies
and substantial portions of the software. A redistributed build without it is an
attribution gap, even though the listing names the licence.

**Fix.** [`LICENSE`](../LICENSE) is at the repository root and an identical copy
is shipped inside the package as `src/LICENSE`. `scripts/build.mjs` fails the
build if either copy is missing or if they drift apart.

**Tests.** Build check: `checkLicense()`.

### F-22 — `Pragma: no-cache` is not handled (informational)

RFC 9111 defines `Pragma` only for HTTP/1.0 backwards compatibility and only for
requests; modern Firefox makes freshness decisions from `Cache-Control`. Left
untouched deliberately rather than removing a header the extension does not
need to understand.

### F-23 — `Expires` is added even when `Cache-Control` exists (informational)

The legacy code added `Expires` whenever it was missing. HTTP/1.1 caches ignore
`Expires` when `max-age` is present, so this is redundant but harmless, and it
helps old proxies and caches. The rewrite keeps the behaviour, and keeps both
values consistent.

## How the fixes are verified

| Finding | Automated tests |
| --- | --- |
| F-01 | `private is preserved…`, `no-store is respected…`, `Set-Cookie…skipped` |
| F-02 | `only cacheable statuses are rewritten` |
| F-03 | `only cacheable statuses are rewritten` (`206`) |
| F-04 | `already longer max-age is preserved`, `neverShorten…`, `far-future Expires…` |
| F-05 | `responses with Set-Cookie…`, `Set-Cookie responses can be opted in…` |
| F-06 | `Vary: * is never cached over` |
| F-07 | `responses already served from cache…` |
| F-08 | `missing responseHeaders cannot crash…` |
| F-10 | `configured duration controls max-age and Expires` |
| F-11 | `duplicate Cache-Control and Expires headers collapse…` |
| F-12 | `immutable…survive`, `s-maxage is left untouched…` |
| F-13 | settings round-trip and background duration tests |
| F-14 | all exclusion tests, including ports and lookalike hosts |
| F-15 | `only the configured resource types…` |
| F-19 | `scripts/build.mjs` manifest validation |
| F-20 | `scripts/build.mjs` archive inspection |
| F-24 | `scripts/build.mjs` licence check |

Run them with:

```sh
cd cache-even-longer
npm test
npm run check
npm run build
```

Runtime behaviour must still be confirmed in Firefox; [TESTING.md](TESTING.md)
contains the exact routes and expected headers.

## Deliberate non-goals

- **Repairing the 1.0 package.** Its signature cannot survive edits. 2.1 is a
  separate unsigned build.
- **Overriding `no-store` by default.** The switch exists for experimentation,
  but the safe default is to obey the origin.
- **Beating cache size limits.** Firefox still evicts entries; a long lifetime
  is a maximum, not a guarantee.
- **Caching documents.** Only subresources are considered, so the extension
  cannot pin a whole page or bypass a site’s navigation freshness rules.
- **Removing `Vary` variants or cache partitioning.** Firefox’s per-site cache
  partitioning remains in force.
- **Migrating to Manifest V3.** Blocking `webRequest` response-header
  modification is the core mechanism. The policy module is transport-agnostic,
  so a future port would only need a new adapter.
- **Signing the rebuild.** Only addons.mozilla.org can issue a signature that
  release Firefox trusts. The build is intentionally unsigned; see
  [INSTALL.md](INSTALL.md) and [AMO_SUBMISSION.md](AMO_SUBMISSION.md).

## References

- RFC 9111 — HTTP Caching: <https://www.rfc-editor.org/rfc/rfc9111>
- MDN — `Cache-Control`: <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control>
- MDN — `webRequest.onHeadersReceived`: <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/onHeadersReceived>
- MDN — `browser_specific_settings` (data collection and minimum version):
  <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings>
- Firefox Extension Workshop — built-in consent for data collection:
  <https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/>
