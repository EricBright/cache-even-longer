# Installing Cache even Longer

## The short version

Firefox release builds only install add-ons that **Mozilla has signed**. The
`dist/cache_even_longer-2.1.0.xpi` produced by this repository is unsigned, so
**“Install Add-on From File…” will always refuse it**. That is Mozilla’s
signature policy, not a fault in the XPI: the package is valid and Mozilla’s own
linter reports zero errors.

There are two practical routes:

1. **Temporary install** through `about:debugging` — works immediately in any
   Firefox, lasts until Firefox restarts, no account needed.
2. **Permanent install** after signing through addons.mozilla.org (AMO) — free,
   needs an AMO account and API key, and produces a normal signed XPI.

A third route, for developers, launches Firefox with a temporary profile and
loads the add-on automatically (`npm run dev`).

> The original `cache-longer-source/cache_longer-1.0.xpi` installs because
> Mozilla signed _that exact file_. Editing any byte — including changing the
> version number — invalidates its signature. A signature cannot be copied to a
> new build; only AMO can issue a new one.

## Route 1 — temporary install (recommended for testing)

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

This is the only route that works in a normal release Firefox without an AMO
account.

## Route 2 — permanent install through AMO signing

AMO can sign an **unlisted** (“self-distributed”) add-on. The resulting XPI is
signed by Mozilla and installs in release Firefox like any other add-on. It is
not listed in AMO search unless you choose the listed channel. The submission
checklist, ID/ownership decisions and listing copy are in
[AMO_SUBMISSION.md](AMO_SUBMISSION.md).

### 2.1 Create the credentials

1. Sign in at <https://addons.mozilla.org/developers/>.
2. Create an API key at
   <https://addons.mozilla.org/developers/addon/api/key/>.
   You get an **API key** (JWT issuer) and an **API secret**.
3. Keep them out of shell history if you can: put them in environment variables
   or a local untracked file.

### 2.2 Decide on the add-on ID first

The manifest currently uses a GUID generated specifically for this fork:

```json
"id": "{b2aeb8c2-b8ec-4375-afc3-21d58bcc6b3a}"
```

You do **not** need to request this from Mozilla. An add-on ID is a string you
choose; AMO only checks that it is unique when it first signs that ID. A random
UUID is effectively guaranteed to be unique and does not imply ownership of
anyone’s domain.

Two accepted forms:

- **GUID:** `{8-4-4-4-12 hexadecimal digits}` — generated locally, as above.
- **Email-style:** `cache-longer@your-domain.example` — use a domain you
  control, although AMO does not verify domain ownership.

Generate your own GUID with Node:

```sh
node -e "console.log('{'+require('node:crypto').randomUUID()+'}')"
```

Then replace the `id` in `src/manifest.json` and rebuild. Changing the ID later
makes it a different add-on from AMO’s point of view: stored settings do not
carry over and it cannot be submitted as an update to the previous identity.

**If you own the original AMO listing**, use its GUID
`{d533177a-94cc-4e48-8e75-3187f0a81236}` instead and submit 2.1.0 as an
update. Otherwise, keep the generated fork GUID.

### 2.3 Sign

```sh
cd cache-even-longer
npm install                 # installs web-ext (one time)
export WEB_EXT_API_KEY="user:12345:67"
export WEB_EXT_API_SECRET="0123456789abcdef..."
npm run sign
```

`npm run sign` runs:

```sh
web-ext sign --source-dir src --artifacts-dir dist/signed --channel unlisted
```

AMO validates the package, signs it, and `web-ext` downloads the signed XPI into
`dist/signed/`. The file name usually ends in `-an+fx.xpi`; that is the file to
install. The unsigned `dist/cache_even_longer-2.1.0.xpi` remains in `dist/` for
reference and should not be confused with the signed copy.

### 2.4 Install the signed file

1. Open `about:addons`.
2. Click the gear icon → **Install Add-on From File…**.
3. Select the signed `.xpi` from `dist/signed/`.
4. Confirm the permission prompt.

Firefox now treats it as a normal add-on: it survives restarts and updates
through AMO if you keep the same ID and versioning.

### 2.5 Manual alternative

If you prefer the web UI, upload the unsigned ZIP/XPI as a new add-on at
<https://addons.mozilla.org/developers/addon/submit/> and choose
**“On your own”** (unlisted). AMO returns a signed XPI to download.

## Route 3 — Developer Edition or Nightly

Developer Edition and Nightly can be configured to allow unsigned add-ons:

1. Open `about:config`.
2. Set `xpinstall.signatures.required` to `false`.
3. Install the unsigned XPI through `about:addons`.

This restriction is deliberately not disableable in release Firefox. Do not
turn it off in a daily-use browser just to install one add-on; prefer Route 1 or
Route 2.

## Route 4 — live development with `web-ext run`

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

```sh
npm run check     # manifest, referenced files, JS syntax
npm run lint      # Mozilla web-ext lint
npm run build     # dist/cache_even_longer-2.1.0.xpi + .sha256
unzip -l dist/cache_even_longer-2.1.0.xpi
```

The archive should have `manifest.json` at its root and no `__MACOSX/`,
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
| “This add-on could not be installed because it appears to be corrupt.” or “not verified” | The XPI is unsigned. | Use Route 1, or sign it (Route 2). |
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
