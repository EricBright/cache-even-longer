# Installing Cache even Longer

## The short version

Firefox release builds only install add-ons that **Mozilla has signed**. Version
2.1.0 is already signed and published:

- [Cache even Longer on AMO](https://addons.mozilla.org/en-US/firefox/addon/cache-even-longer/)
- [Signed XPI on GitHub](https://github.com/EricBright/cache-even-longer/releases/tag/v2.1.0)

Most users should install the published build (Route 1). A local `npm run build`
is unsigned and cannot be installed permanently; use it only for temporary
testing.

- **Route 1:** install the published build — recommended for users.
- **Route 2:** temporary install from source — for testing local changes.
- **Route 3:** sign a new version through AMO — for maintainers.
- **Route 4:** Developer Edition or Nightly — unsigned testing.
- **Route 5:** `web-ext run` — live development.

> The original `cache-longer-source/cache_longer-1.0.xpi` installs because
> Mozilla signed _that exact file_. Editing any byte — including changing the
> version number — invalidates its signature. A signature cannot be copied to a
> new build; only AMO can issue a new one.

## Route 1 — install the published build (recommended)

1. Open the [AMO listing](https://addons.mozilla.org/en-US/firefox/addon/cache-even-longer/).
2. Click **Add to Firefox** and confirm the permission prompt.
3. The add-on is installed permanently and updates through AMO.

The exact signed XPI is also attached to the
[v2.1.0 GitHub release](https://github.com/EricBright/cache-even-longer/releases/tag/v2.1.0).
To use that copy, download `cache_even_longer-2.1.0.xpi`, open `about:addons`,
click the gear icon → **Install Add-on From File…**, and select the file. It is
the same Mozilla-signed package, not a separate build.

## Route 2 — temporary install (development)

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…**.
3. Select `src/manifest.json` from this repository.
   If your Firefox file picker accepts archives, you can select
   `dist/cache_even_longer-2.1.0.xpi` instead.
4. The add-on appears in the list. Click the **Cache even Longer** toolbar
   button for site controls, then **All settings** for the full options page.
   Click **Reload** in `about:debugging` after changing source files.

What to expect:

- The add-on is active until Firefox closes or you remove it; temporary add-ons
  are not restored on the next start.
- Signature checks are bypassed by design for this developer route.
- Settings are stored under the manifest’s Gecko ID, so they survive a
  **Reload** in the same profile. They may not survive a full Firefox restart.
- `about:addons` may show the add-on with a “temporary” marker.

This is the only route that tests local source changes without signing them.

## Route 3 — sign a new version through AMO (maintainers)

Version 2.1.0 is already signed. Skip this route unless you are publishing a new
version. The manifest ID belongs to the listed add-on, so `npm run sign`
submits the new version to that listing. Use `npm run sign:unlisted` only for a
self-distributed build.

### 3.1 Create the credentials

1. Sign in at <https://addons.mozilla.org/developers/>.
2. Create an API key at
   <https://addons.mozilla.org/developers/addon/api/key/>.
   You get an **API key** (JWT issuer) and an **API secret**.
3. Keep them out of shell history if you can: put them in environment variables
   or a local untracked file.

### 3.2 Check the add-on ID

The published fork uses this GUID:

```json
"id": "{b2aeb8c2-b8ec-4375-afc3-21d58bcc6b3a}"
```

Keep it for updates. Changing the ID creates a different add-on from AMO’s point
of view: stored settings do not carry over and it cannot be submitted as an
update to the existing listing.

### 3.3 Bump the version

Bump `version` in both `src/manifest.json` and `package.json` before signing.
AMO rejects a version that already exists.

### 3.4 Sign

```sh
cd cache-even-longer
npm install                 # installs web-ext (one time)
export WEB_EXT_API_KEY="user:12345:67"
export WEB_EXT_API_SECRET="0123456789abcdef..."
npm run sign
```

`npm run sign` runs:

```sh
web-ext sign --source-dir src --artifacts-dir dist/signed --channel listed
```

For a self-distributed build instead:

```sh
npm run sign:unlisted
# web-ext sign ... --channel unlisted
```

AMO validates the package, signs it, and `web-ext` downloads the signed XPI into
`dist/signed/`. The filename varies; for the listed 2.1.0 build it is
`cache_even_longer-2.1.0.xpi`. Use the file AMO provides, not the unsigned
`dist/cache_even_longer-<version>.xpi` build.

### 3.5 Install the signed file

1. Open `about:addons`.
2. Click the gear icon → **Install Add-on From File…**.
3. Select the signed `.xpi` from `dist/signed/`.
4. Confirm the permission prompt.

Firefox now treats it as a normal add-on: it survives restarts and updates
through AMO if you keep the same ID and versioning.

### 3.6 Manual alternative

If you prefer the web UI, upload the unsigned ZIP/XPI at
<https://addons.mozilla.org/developers/addon/submit/>. Choose the listed channel
to update the public listing, or **“On your own”** for a self-distributed build.
AMO returns a signed XPI to download.

### 3.7 Mirror the signed XPI on GitHub (optional)

AMO remains the canonical download and update channel. To keep a GitHub mirror:

1. Download the signed XPI from AMO: **Developer Hub → Manage Status &
   Versions → version → Files**.
2. Verify that it contains `META-INF/` signature entries.
3. Record its SHA-256 checksum.
4. Create a GitHub release tagged `v<version>` and attach the signed XPI and
   checksum file. Link to the AMO listing in the release notes.

Do not attach the unsigned `dist/cache_even_longer-<version>.xpi` as the install
asset; Firefox will refuse it.

## Route 4 — Developer Edition or Nightly

Developer Edition and Nightly can be configured to allow unsigned add-ons:

1. Open `about:config`.
2. Set `xpinstall.signatures.required` to `false`.
3. Install the unsigned XPI through `about:addons`.

This restriction is deliberately not disableable in release Firefox. Do not
turn it off in a daily-use browser just to install one add-on; prefer Route 1 or
Route 3.

## Route 5 — live development with `web-ext run`

```sh
cd cache-even-longer
npm install
npm run test-server     # optional: fixture page on http://127.0.0.1:8787/
npm run dev             # in a second terminal
```

`web-ext run` starts Firefox with a throwaway profile, installs the add-on
temporarily, and reloads it when files under `src/` change. If Firefox is not on
`PATH`, point `FIREFOX_BIN` at the binary:

```sh
FIREFOX_BIN=/path/to/firefox npm run dev
```

## Verifying the package before installing

The checks below apply to a locally built unsigned XPI. A signed AMO download
will additionally contain `META-INF/`; that directory is the signature, not
junk.

```sh
npm run check     # manifest, referenced files, JS syntax
npm run lint      # Mozilla web-ext lint
npm run build     # dist/cache_even_longer-2.1.0.xpi + .sha256
unzip -l dist/cache_even_longer-2.1.0.xpi
```

The unsigned archive should have `manifest.json` at its root and no `__MACOSX/`,
`META-INF/` or `.DS_Store` entries.

`npm run lint` reports **0 errors and 2 warnings**:

```text
"strict_min_version" requires Firefox 115, which was released before
version 140 introduced support for
"browser_specific_settings.gecko.data_collection_permissions".

"strict_min_version" requires Firefox for Android 115, which was released
before version 142 introduced support for the same key.
```

These are **warnings, not errors**, and AMO still accepts the package. They
exist because the manifest declares support back to Firefox 115, while
`data_collection_permissions` was only introduced in Firefox 140 (desktop) and
142 (Android). Firefox 115–139 simply ignore the unknown metadata key; the
add-on still works, and the declaration is mandatory for new AMO submissions
regardless. Removing it to silence the warning would fail AMO validation.

The Android line appears because Android inherits
`browser_specific_settings.gecko.strict_min_version` when there is no
`gecko_android` block. This manifest has no `gecko_android` block, so AMO treats
the add-on as desktop-only; the warning does not mean Android support is
claimed.

Options if you want a cleaner report:

| Choice | Warnings | Trade-off |
| --- | --- | --- |
| Keep `115.0` (current) | 2 | Broadest support; warnings are cosmetic. |
| Raise to `140.0` | 1 (Android only) | Clears the desktop warning; keeps ESR 140. |
| Raise to `142.0` | 0 | Clears both; drops Firefox 140/141 and older. |
| Add a `gecko_android` block | 0 | **Declares Android support**; only do this if it is tested. |

Changing `strict_min_version` requires a rebuild and a version bump if the
current version has already been uploaded. The submitted 2.1.0 package is fine
with the warnings; the add-on does not collect or transmit any data, so `none` is
the correct declaration either way.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| “This add-on could not be installed because it appears to be corrupt.” or “not verified” | The XPI is unsigned. | Install the published build (Route 1), or sign a new version (Route 3). |
| “This add-on is not compatible with your version of Firefox.” | Firefox is older than `strict_min_version` (115), or the build targets a platform you did not declare. | Update Firefox or lower `strict_min_version` in `src/manifest.json` and rebuild. |
| AMO says the add-on ID is already in use. | The ID belongs to another AMO account. | Change `browser_specific_settings.gecko.id` and sign again. |
| AMO rejects `data_collection_permissions`. | Missing or malformed declaration. | Keep `"required": ["none"]`; `npm run check` enforces it. |
| The add-on loads but nothing changes. | Disabled, wrong resource type, excluded site, `fromCache`, `no-store`, `Set-Cookie`, `Vary: *`, non-200 status, cache hit. | Enable debug logging in Options, then watch the extension console in `about:debugging`. Check [TESTING.md](TESTING.md). |
| The Options page is blank. | A script failed to load, or the add-on was not reloaded after an edit. | Check the page console, then Reload the temporary add-on. |
| The popup says “Not a website”. | The active tab is an `about:`, `file:` or other non-HTTP(S) page. | Open a normal website; there is nothing to exclude on internal pages. |
| The toolbar button is missing. | It is in the extensions (puzzle-piece) menu rather than pinned. | Pin Cache even Longer from that menu. |
| Headers look unchanged for a file already in the cache. | Existing cache entries keep their stored headers. | Hard-reload the page or clear the cache for that site; new responses are the ones rewritten. |

## Security notes

- Only install **signed** builds permanently. A temporary install should not be
  left enabled across restarts out of habit; it is a development tool.
- The add-on makes no network requests and has no telemetry. Its settings live
  in `storage.local` and never leave Firefox.
- The extension modifies response headers for every `http(s)` subresource it is
  allowed to see. Review the default safety switches before disabling
  `no-store` protection or enabling XHR/fetch caching.
