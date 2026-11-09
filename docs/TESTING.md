# Testing — Cache even Longer 2.1

There are two layers: **automated tests that run in Node** (no browser needed)
and a **manual runtime checklist** for Firefox. The Node tests cover the policy,
exclusion grammar, settings storage and the background page wiring; they cannot
prove that Firefox’s network stack exposes headers exactly as expected.

Temporary installation was verified in **Firefox 159.0.1** with
`web-ext run`; the browser reported `Installed … as a temporary add-on`. The
full network-header checklist below has **not** been executed here, because the
headless setup used for that check was not driven through the fixture page.

## Automated tests

```sh
cd cache-even-longer
npm test
```

Expected result: **96 passing tests, 0 failures**. The suite uses the built-in
`node:test` runner and has no runtime dependencies.

| File | What it covers |
| --- | --- |
| `tests/cache-policy.test.js` | Settings normalisation; exclusion patterns (hosts, subdomains, paths, schemes, ports, lookalike hosts); method/type/status/fromCache guards; `Vary: *`; `Set-Cookie`; `no-store`; `max-age`; `no-cache`; `private`/`public`; preserved directives; duplicate headers; `Expires`; duration arithmetic; quoted comma parsing. |
| `tests/background.test.js` | Real `cache-policy.js`, `settings.js` and `background.js` executed in a VM with a fake `browser` object; listener filter/spec; default and stored settings; disabled mode; storage-change propagation; storage failure fallback; save/load round-trip; malformed stored data. |
| `tests/site-control.test.js` | Host/port extraction, adding/removing exclusion lines, counting patterns, dated export formatting/export filename, and non-destructive import merging. |
| `tests/popup-page.test.js` | Structural checks on the toolbar popup: IDs and labels, local assets, script order, no inline code, namespaced modules, stylesheet classes, manifest popup linkage. |
| `tests/options-page.test.js` | Structural checks on the options page: every element ID and label target exists, local assets resolve, scripts load in dependency order, no inline script/handlers (CSP), stylesheet classes, manifest name, toolbar button and icon paths, manifest linkage. |

The integration test runs the three real source files in the order the manifest
declares them, so a missing global or a wrong script order fails the test.

Useful targeted runs:

```sh
node --test tests/cache-policy.test.js
node --test tests/background.test.js
node --test --test-name-pattern="no-store" tests/cache-policy.test.js
```

### Static and packaging checks

```sh
npm run check     # manifest shape, referenced files, JS syntax, forbidden paths
npm run build     # check + dist/cache_even_longer-2.1.0.xpi + .sha256
npm run lint      # Mozilla web-ext lint
```

Expected:

- `npm run check`: `result : OK`.
- `npm run build`: an XPI with 22 entries, `manifest.json` at the root, a `LICENSE`, no
  `__MACOSX/`, `META-INF/` or `.DS_Store`, and a SHA-256 file beside it.
- `npm run lint`: **0 errors, 2 warnings** about `strict_min_version` predating
  support for `data_collection_permissions` in Firefox 140 / Android 142. The
  warnings are expected and explained in [INSTALL.md](INSTALL.md).

## Manual runtime checklist

### Setup

1. Start the fixture server:

   ```sh
   npm run test-server
   ```

2. In Firefox, open `about:debugging#/runtime/this-firefox`, click **Load
   Temporary Add-on…**, and select `src/manifest.json`.
3. Confirm the add-on appears and the **Cache even Longer** toolbar button opens
   the site popup. The popup’s **All settings** link opens the full options page.
4. Open <http://127.0.0.1:8787/>.
5. Open DevTools → **Network**, enable “Disable Cache” for the first run, and
   reload with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>.

For each request: select it, open **Response Headers**, and compare with the
table below. The values shown are what the extension sent to the cache, which is
the point of the test.

### Default settings (180 days)

| Route | Status / server header | Expected result |
| --- | --- | --- |
| `/style.css` | 200, `max-age=60` | `Cache-Control: max-age=15552000`, `Expires` ≈ now + 180 days |
| `/script.js` | 200, `max-age=60` | extended the same way |
| `/image.svg` | 200, `max-age=3600` | extended the same way |
| `/image.4f3c2a91.svg` | 200, `max-age=3600` | extended the same way |
| `/style.4f3c2a91.css` | 200, `max-age=60` | extended the same way |
| `/must-revalidate.css` | 200, `max-age=60, must-revalidate` | extended; `must-revalidate` preserved while SWR is off |
| `/aged.css` | 200, `max-age=60`, `Age: 3600` | `max-age=15555600` (target + Age), `Expires` ≈ now + 180 days |
| `/long.js` | 200, `max-age=31536000, immutable` | unchanged; no `Expires` added |
| `/expires-only.svg` | 200, `Expires` only (now + 1 h) | `Cache-Control: max-age=15552000` added; `Expires` replaced with now + 180 days |
| `/private.json` | 200, `private, max-age=60` | `private, max-age=15552000`; no `public` |
| `/no-store.json` | 200, `no-store` | unchanged |
| `/cookie.json` | 200, `Set-Cookie`, `max-age=60` | unchanged, cookie header kept |
| `/vary-star.json` | 200, `Vary: *` | unchanged |
| `/error-404.json` | 404, `max-age=60` | unchanged |
| `/partial.bin` | 206, `Content-Range` | unchanged |
| `/api/data.json` | 200, `max-age=0`, fetched by script | unchanged (XHR/fetch is off by default) |
| `/redirect` | 302 | unchanged |
| `/` (document) | 200, `no-store` | unchanged (documents are never touched) |

`Expires` should be a UTC string exactly 180 × 86400 seconds after the response
time, not a calendar-month approximation.

### Settings variations

Change one setting at a time, save, hard-reload the page, and re-check:

| Change | Expected |
| --- | --- |
| Lifetime → 30 days | `/style.css` becomes `max-age=2592000` |
| Enabled → off | Every route keeps its server headers |
| Add `127.0.0.1` to exclusions | Every route keeps its server headers |
| Add `127.0.0.1:8787/style.css` to exclusions | Only `/style.css` is skipped |
| Enable XHR and fetch | `/api/data.json` becomes `max-age=15552000` |
| Turn off “Respect no-store” | `/no-store.json` becomes `max-age=15552000`; `no-store` is gone |
| Turn off “Skip Set-Cookie” | `/cookie.json` is extended; `Set-Cookie` remains |
| Turn off “Never shorten” | `/long.js` becomes `max-age=15552000`, dropping to the configured target |
| Lifetime → 1 day | `/style.css` becomes `max-age=86400`; `Expires` is one day later |
| Enable SWR with a 7-day window | `/style.css` becomes `max-age=15552000, stale-while-revalidate=604800`; `/must-revalidate.css` loses `must-revalidate` |
| Enable fingerprint-only mode | `/style.css` is skipped; `/style.4f3c2a91.css` is still extended |
| Load the Safe profile | 30 days, fingerprinted only, SWR off |
| Load the Balanced profile | 180 days, SWR 7 days, all selected types |
| Load the Aggressive profile | 365 days, SWR 30 days, media included |
| Set SWR days to 14 and reload | `/style.css` shows `stale-while-revalidate=1209600` |

### Toolbar popup

- [ ] The popup shows the current host and “Active on this site”.
- [ ] **Exclude this site** adds the exact host to the exclusions textarea;
      reopening the options page shows the line.
- [ ] **Include this site** removes that line and the status returns to active.
- [ ] The quick lifetime selector changes the policy without opening settings.
- [ ] The master toggle pauses/resumes the extension.
- [ ] On an `about:` page the site controls are disabled and the popup explains
      that it is not an HTTP(S) site.
- [ ] The popup renders correctly in light and dark mode.

### Debug logging

1. Enable **Log decisions to the browser console**, save.
2. In `about:debugging`, click **Inspect** on the add-on and open its console.
3. Hard-reload the test page.

Expected: `[Cache even Longer] extend …` lines for rewritten assets and filtered
`[Cache even Longer] skip <reason> …` lines for `no-store`, `set-cookie`,
`vary-star`, `excluded`, `not-fingerprinted`, `status-code` and
`already-long-enough`. Resource-type skips and cache hits stay quiet.

### Options page

- [ ] The toolbar button is visible (pin it from the extensions menu if needed)
      and clicking it opens the site popup, not a full page.
- [ ] **All settings** in the popup opens the options page in a tab.
- [ ] Saving shows a success message and the chosen lifetime is used on the next
      response without restarting Firefox.
- [ ] Reloading the options page shows the saved values.
- [ ] `0`, `-1`, `1.5`, `3651` and an empty lifetime show the inline error and
      focus the field; nothing is saved.
- [ ] Preset buttons (30/90/180/365) fill the field and highlight themselves.
- [ ] Safe / Balanced / Aggressive fill the expected fields and leave site
      exclusions unchanged.
- [ ] The SWR checkbox enables and disables the stale-window input.
- [ ] An SWR window of `0`, `366`, `1.5` or empty shows the inline error.
- [ ] The fingerprint-only checkbox round-trips through save and reload.
- [ ] **Export list** downloads a dated `.txt` file containing the current
      textarea content and the `# Cache even Longer` header.
- [ ] **Import list** merges a text file into the current list, does not delete
      existing patterns/comments, skips duplicates, and leaves the form dirty
      until **Save settings**.
- [ ] “Restore defaults” asks for confirmation and restores 180 days plus the
      safety switches.
- [ ] Changing a control shows “Unsaved changes”; closing the tab prompts.
- [ ] The enable switch at the top is saved only with **Save settings**.
- [ ] Light and dark mode both render readably (`about:preferences` → Appearance).
- [ ] The page is usable at a narrow window width.

### Installation and lifecycle

- [ ] Temporary install via `src/manifest.json` works in release Firefox.
- [ ] After **Reload** in `about:debugging`, settings persist and the listener
      still works.
- [ ] Closing Firefox removes the temporary add-on (expected).
- [ ] A signed build (if produced through AMO) installs permanently via
      `about:addons` → gear → **Install Add-on From File…**.
- [ ] `about:addons` shows only the expected host permission warning for
      `http://*/*` and `https://*/*`.

### Force refresh check

1. Load the fixture page and let `/style.css` be cached with the 180-day policy.
2. Hold **Shift** and click Reload (or press Ctrl+Shift+R / Cmd+Shift+R).
3. In DevTools → Network, `/style.css` should be a fresh network request, not
   `fromCache`.
4. The new response should still show `max-age=15552000` and must **not**
   contain `immutable`.

Shift+Reload bypasses the HTTP cache, so the add-on cannot prevent it. If a site
has a service worker, use DevTools → Application → Service Workers → **Bypass
for network** for a true network fetch.

### Cache behaviour notes

- The first load may show `fromCache` responses for assets already in the cache;
  those are deliberately skipped. Use “Disable Cache” plus a hard reload, or
  clear the site’s cache, before comparing.
- After the extension has cached an asset, a normal reload may show the
  **stored** headers from the first fetch. That is the correct outcome; inspect
  the first network response, not the revalidated one.
- If a route shows no change, confirm the request type in DevTools. Firefox
  labels XHR/fetch as `xmlhttprequest`, which is off by default.

## Regression checklist for future edits

Before merging a change:

1. `npm test` — all green.
2. `npm run check` — manifest and referenced files valid.
3. `npm run lint` — no new errors.
4. Add a test for any new branch in `planHeaderChanges`; the function is pure, so
   every rule should be expressible as a table test.
5. Reproduce at least the default-settings manual table in Firefox.
6. Confirm **Shift+Reload still fetches from the network** and that no response
   gains `immutable`.
7. Bump `manifest.version` and `package.json` version together; otherwise the
   build script’s output name and the add-on version diverge.
8. If the manifest changes, check the AMO-required keys again
   (`browser_specific_settings.gecko.id`, `data_collection_permissions`).

## Known gaps

- A headless Firefox 159 check confirmed temporary installation, but the full
  network-header/popup checklist below has not been executed.
- No automated test for the options-page or popup DOM; both are plain code with
  no framework and are checked structurally plus manually.
- Firefox for Android is neither declared nor tested.
- Cache eviction, partitioning and service-worker caches are outside the test
  surface because the extension does not control them.
