# AMO release description — Cache even Longer 2.1.0

Copy-ready text for the AMO submission form. All blocks below are plain text so
they can be pasted without formatting surprises. See
[AMO_SUBMISSION.md](AMO_SUBMISSION.md) for the submission process, ID choices
and license/ownership notes.

## Fields at a glance

| AMO field | Value |
| --- | --- |
| Add-on name | **Cache even Longer** |
| Version | **2.1.0** |
| Summary | See below (229 characters, under AMO’s 250 limit) |
| Category | **Web Development** (primary), **Other** (secondary) |
| Tags | `cache`, `performance`, `http`, `headers`, `offline` |
| License | **MIT** |
| Support email / site | Use the support address on your AMO account |
| Privacy policy | Not required: no data leaves the device |
| Source code upload | Not required: plain, unminified JavaScript with no build step |
| Compatibility | Firefox 115+ desktop |
| Data collection | `none` |

## Add-on name

```text
Cache even Longer
```

## Summary

```text
Extends how long Firefox caches static files, with configurable lifetimes, a per-site popup, stale-while-revalidate, fingerprint-only mode and safety rules for private or uncacheable responses. A renamed fork of Cache Longer 1.0.
```

## Full description

```text
Cache even Longer keeps static files in Firefox’s HTTP cache for longer, so
repeated visits load faster and use less bandwidth. It is a renamed,
safety-focused fork of the original Cache Longer 1.0 (MIT, by Rimu Atkinson).

Unlike a blanket “cache everything” extension, it only extends responses that
are safe to extend, and leaves everything else exactly as the server sent it.

WHY A RENAMED FORK
The 1.0 add-on forced a six-month public lifetime onto every matching response.
This fork keeps the same goal but adds a configurable policy and safety limits:
private responses stay private, explicit no-store instructions are respected by
default, and errors or partial responses are never cached for months. It is
renamed so the two add-ons are not confused.

WHAT IT DOES
- Sets a configurable freshness lifetime (1–3650 days; default 180) for images,
  stylesheets, scripts and fonts.
- Optionally includes media, XHR/fetch and other subresources.
- Merges Cache-Control instead of replacing it, and adds a matching Expires
  header.
- Optionally adds stale-while-revalidate, so an expired file can be shown
  immediately while Firefox refreshes it in the background.
- Optionally limits changes to fingerprinted URLs: files whose names contain a
  content hash or version query.
- Accounts for the Age header, so time already spent in a CDN cache does not
  shorten the configured lifetime.
- Never adds “public”; keeps private, immutable, s-maxage, no-transform and
  other directives. `must-revalidate` is kept unless the optional stale window
  is enabled, in which case it must be dropped for Firefox to use that window.
- “Never shorten” is on by default, so responses that already ask for a longer
  lifetime are left alone.

SAFETY RULES
- Respects Cache-Control: no-store by default.
- Skips responses that set cookies by default.
- Skips Vary: * responses.
- Only touches 200, 203 and 304 responses to GET/HEAD requests.
- Never changes the page document, frames, redirects, 204, 206, errors or
  non-HTTP URLs.
- Never rewrites a response already served from cache.

CONTROL
- The toolbar popup shows whether the current site is active or excluded, with
  one-click exclude/include and a quick lifetime selector.
- Quick profiles: Safe (30 days, fingerprinted only), Balanced (180 days with a
  7-day stale window) and Aggressive (365 days with a 30-day stale window and
  media included).
- Exclude hosts, subdomains, paths or URL prefixes with wildcard patterns.
- Export the exclusion list as a dated plain-text file and import/merge another
  list without deleting existing patterns.
- Pause the add-on without removing it.
- Optional debug logging shows every allow/skip decision in the extension
  console.

FORCE REFRESH
The add-on never adds immutable and never modifies request headers or reload
flags. Shift+Reload (Ctrl+Shift+R / Cmd+Shift+R) still bypasses the HTTP cache
completely. A service worker can still serve from its own cache; use DevTools →
Application → Service Workers → “Bypass for network” for those sites.

PRIVACY
No telemetry, no analytics, no network requests, no remote code. Settings are
stored locally with browser.storage.local. The manifest declares
data_collection_permissions.required = ["none"].

PERMISSIONS
storage stores your settings. webRequest, webRequestBlocking and host
permissions for http/https are required to inspect and replace response
headers. The popup reads the active tab URL through those host permissions; it
does not request the tabs permission. The add-on has no content scripts and does
not read page content.

COMPATIBILITY
Firefox 115+ on desktop. Firefox for Android is not declared or tested.

GOOD TO KNOW
The HTTP cache is a hint: Firefox may evict entries early, and files already in
the cache keep their stored headers until they expire or are re-fetched.
Service-worker caches are separate and are not modified. Stale-while-revalidate
can show content that is a little out of date during its configured window; turn
it off if that is not acceptable. The add-on does not cache whole pages.

LICENSE
MIT. Cache Longer was originally created by Rimu Atkinson; this renamed fork is
Cache even Longer. The MIT notice is included in the package.
```

## Release notes for 2.1.0

```text
Cache even Longer 2.1.0 is the first AMO release of the renamed fork and a
safety-focused rewrite of Cache Longer 1.0.

- Configurable cache lifetime from 1 to 3650 days, with 30/90/180/365-day
  presets.
- Optional stale-while-revalidate with a 1–365 day window (off by default).
- Per-site toolbar popup: active/excluded status, exclude/include, quick
  lifetime, and a link to all settings.
- Quick profiles: Safe, Balanced and Aggressive.
- Fingerprint-only mode for safer aggressive lifetimes.
- Age-aware lifetime calculation for CDN-cached responses.
- Per-type controls for images, stylesheets, scripts, fonts, media, XHR/fetch
  and other subresources.
- Wildcard exclusions for hosts, subdomains, paths and non-default ports, with
  plain-text import/export.
- Safety rules: respects no-store by default, skips Set-Cookie and Vary: *
  responses, and only acts on 200/203/304.
- “Never shorten” by default.
- Preserves private, immutable, s-maxage and other Cache-Control directives;
  never adds public or immutable.
- Force refresh remains a true cache bypass.
- MIT license and attribution now ship inside the package.
```

## Notes for reviewers

```text
This is a renamed fork of the existing Cache Longer add-on (version 1.0, MIT,
by Rimu Atkinson). It uses blocking webRequest only to rewrite Cache-Control and
Expires on static subresources. It does not inject content scripts, read page
content, use tabs, make network requests, or execute remote code. Host
permissions are limited to http/https because webRequest needs them to inspect
response headers. All policy logic is in src/lib/cache-policy.js; the code is
plain, unminified JavaScript with no build step. The popup reads the active tab
URL through the existing host permissions and only edits local settings.
Data collection is declared as "none".

Compared with 1.0, this is a substantial rewrite rather than a repackaging: the
policy engine, settings UI, popup and safety checks are new, and the
unconditional public/6-month override has been removed. Manifest V2 is used
because blocking webRequest response-header modification is the core mechanism.
```

## Privacy statement (if AMO asks)

```text
Cache even Longer does not collect, transmit or sell any data. It has no
telemetry, analytics, accounts or network requests. Settings remain in
browser.storage.local on the user's device.
```

## Short “What’s new” version

```text
Cache even Longer 2.1.0 adds optional stale-while-revalidate, a per-site toolbar
popup, Safe/Balanced/Aggressive profiles, fingerprint-only mode, Age-aware
lifetimes and exclusion-list import/export — on top of the 2.0 safety rewrite.
```

## Suggested support/reviewer notes

- The add-on is MIT-licensed; the notice is included in the package.
- The 1.0 listing is a separate add-on under the original author’s account.
  This fork uses its own Gecko GUID and name.
- The add-on does not read page content. Host permissions exist only because
  `webRequest` needs them to see response headers; the popup uses them to read
  the active tab’s host.
- If AMO asks for a source archive: upload the repository (or the `src/`
  directory plus this documentation) and note that no build or minification
  step is used.
