# Roadmap — after 2.1

**Status:** 2.1.0 ships the cache-lifecycle ideas that were worth implementing:
optional stale-while-revalidate, a per-site toolbar popup, Safe/Balanced/
Aggressive profiles, fingerprint-only mode, and Age-aware lifetimes.

The remaining ideas are lower-value quality-of-life work. The HTTP cache itself
is now close to exhausted for a WebExtension: Firefox exposes no API to inspect
entries, measure size, evict a URL, or change partitioning/eviction.

## Shipped in 2.1.0

| Feature | Notes |
| --- | --- |
| `stale-while-revalidate` | Opt-in, 1–365 day window. `must-revalidate` is removed when enabling it, because Firefox checks that directive first. |
| Per-site toolbar popup | Status, exclude/include, quick lifetime, all-settings link. No `tabs` permission needed. |
| Quick profiles | Safe (30 days, fingerprint-only, no SWR), Balanced (180 days, 7-day SWR), Aggressive (365 days, 30-day SWR, media). |
| Fingerprint-only mode | Conservative hex-hash / version-query detection. |
| Age-aware lifetimes | `Age` is subtracted from remaining freshness and added to the new `max-age`. |
| Exclusion import/export | Plain-text backup/share; import merges without deleting existing patterns. |
| Force-refresh guarantee | No `immutable` is ever added and no request/reload flags are touched. |

## Remaining quality-of-life ideas

### Visibility and statistics

Count responses extended this session and bytes indicated by `Content-Length`.
Show a small “last decision” line in the popup: extended, skipped (`no-store`,
`Set-Cookie`, `Vary: *`, status, exclusion, not fingerprinted), or already long
enough. Keep counters in memory; no per-request storage writes.

**Impact:** low–medium (trust and debugging). **Effort:** medium.

### Import/export full settings

The exclusion list already has plain-text import/export. A JSON format for all
settings would also cover lifetime, SWR and resource-type choices. **Impact:**
low. **Effort:** small–medium.

### Keyboard shortcuts

`commands` entries for “open popup/settings” and “toggle enabled”. **Impact:**
low. **Effort:** small.

### Localization

`_locales` + `browser.i18n` for the popup and options page. **Impact:** reach.
**Effort:** medium.

### MV3 adapter

The policy module is transport-independent. An MV3 port would replace the
background adapter and revisit event-page lifetime; the rules stay the same.
**Impact:** future-proofing. **Effort:** medium.

### Browser-level tests

Marionette or Playwright against the fixture server, covering:
real response headers, popup interactions, Shift+Reload, and the SWR window.
**Impact:** confidence. **Effort:** medium–large.

## Deliberately not done

| Idea | Why not |
| --- | --- |
| Add `immutable` | Firefox can skip forced validation in some paths (e.g. DevTools “Disable Cache”). A guaranteed force-refresh is more important than saving a revalidation. Origin `immutable` is preserved, never synthesized. |
| Clear cache for one site | Firefox does not implement the Chrome-only `origins`/`origin` filters of `browsingData`; only a global cache clear is available. |
| Clear the whole cache from a button | `browsingData.removeCache()` exists, but it forces a cold cache for every site — too blunt for this add-on. |
| Inspect cache entries or size | No WebExtension API exposes Firefox’s HTTP cache contents or size. |
| Evict one URL / enforce a cache budget | No API; `about:cache` is not scriptable. |
| Change partitioning or eviction | Controlled by Firefox. |
| Control service-worker Cache API entries | A separate storage layer; the add-on only sees HTTP responses. |
| Prefetch/prerender links speculatively | High privacy and bandwidth risk; easy to make browsing worse. |
| `stale-if-error` | Firefox’s HTTP cache does not appear to implement it. |

## What the remaining work cannot fix

- First-load latency (a cold cache cannot help).
- Layout shift, JavaScript jank or font swaps.
- Cache eviction under memory/disk pressure.
- Per-site HTTP cache clearing (without clearing everything).
- Service-worker or memory-cache behaviour.

## References

- [MDN — `Cache-Control`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control)
- [MDN — `browsingData`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/browsingData)
- [Firefox source — `nsHttp.cpp`](https://searchfox.org/mozilla-central/source/netwerk/protocol/http/nsHttp.cpp)
- [Firefox source — `StaticPrefList.yaml`](https://searchfox.org/mozilla-central/source/modules/libpref/init/StaticPrefList.yaml)
