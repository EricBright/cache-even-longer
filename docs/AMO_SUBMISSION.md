# Submitting Cache even Longer to AMO

Mozilla is the only party that can produce a signature release Firefox accepts.
This guide covers both submission routes and the decisions that have to be made
before uploading.

## Which route?

| | Unlisted (self-distributed) | Listed on AMO |
| --- | --- | --- |
| Appears in AMO search | No | Yes |
| Public listing metadata, screenshots, license | Not needed (or minimal) | Required |
| Review | Automated validation, possible policy review | Listing + technical review |
| Updates | You distribute the signed file; optional `update_url` | AMO hosts and updates it |
| Best for | A personal fork, internal use, testing | A maintained public add-on |

For a fork that is not the original author’s, **unlisted** is the honest and
simplest route: Mozilla signs the build, but it is not presented as a new public
product using someone else’s name.

## What the existing listing tells us

The public AMO listing at <https://addons.mozilla.org/en-US/firefox/addon/cache-longer/>
is:

- name: **Cache Longer**
- slug: `cache-longer`
- GUID: `{d533177a-94cc-4e48-8e75-3187f0a81236}`
- author: **Rimu**
- version 1.0, last updated 16 May 2021
- license: **MIT License**

That means:

1. **The fork has its own ID.** The manifest now uses
   `{b2aeb8c2-b8ec-4375-afc3-21d58bcc6b3a}`, a GUID generated for
   this fork. It is not the original GUID, so AMO treats it as a separate
   add-on, not an update to the existing listing.
2. **If you are the original author**, set the manifest ID to
   `{d533177a-94cc-4e48-8e75-3187f0a81236}`, bump the version, and submit it as
   a new version to update the existing listing. Do not create a duplicate
   listing.
3. **If this is a fork**, keep the generated GUID, or replace it with an
   email-style ID on a domain you control (for example
   `cache-even-longer@your-domain.example`). Do not use the original GUID or the
   original author’s domain: the listing belongs to another account and AMO
   will reject the submission.
4. **Licensing is MIT.** The public listing shows the MIT License, and the
   repository’s [`LICENSE`](../LICENSE) preserves Rimu Atkinson’s copyright
   while adding the fork’s copyright. An identical copy ships inside the XPI as
   `src/LICENSE`. A listed submission should select **MIT** in AMO’s licence
   list. MIT permits forks and redistribution as long as the copyright and
   permission notice are retained — keep both copies with the source.

### How add-on IDs work

An ID is a self-chosen identity, not something Mozilla issues in advance. AMO
checks uniqueness when it first signs that ID. For Manifest V2, omitting the ID
lets AMO assign a GUID at signing time, but then temporary installs get a new
identity each time and cannot reuse their stored settings — so an explicit ID is
strongly recommended.

Generate one locally:

```sh
node -e "console.log('{'+require('node:crypto').randomUUID()+'}')"
```

Use either the braced GUID form or an email-style string. Changing the ID later
starts a new add-on identity: settings are not carried over and it cannot be
uploaded as an update to the old listing.

## Before uploading

1. Decide the ID as described above and edit `src/manifest.json`.
2. Bump the version if this is not the first upload (`manifest.version` and
   `package.json` version).
3. Run the full local checks:

   ```sh
   npm test
   npm run check
   npm run lint     # 0 errors; 2 expected min-version warnings
   npm run build
   ```

4. Upload `dist/cache_even_longer-2.1.0.xpi`. It is a ZIP with `manifest.json` at its
   root; AMO accepts `.xpi` and `.zip`.
5. If you changed source files, rebuild; do not upload a stale artifact.

The extension is plain, readable JavaScript with no bundling or minification,
so AMO is unlikely to request a source-code archive. Keep the repository
available anyway; reviewers appreciate reproduction instructions.

## Route A — unlisted signing through the web UI

1. Sign in at <https://addons.mozilla.org/developers/>.
2. Click **Submit a New Add-on**.
3. Choose **“On your own”** (self-distribution).
4. Upload the `.xpi`.
5. Let the validator run. There should be no errors. If it reports a warning
   about the minimum version, that is the known metadata warning described in
   [INSTALL.md](INSTALL.md), not a blocker.
6. Confirm the submission. AMO signs the version; you may need to wait for
   approval (usually minutes for unlisted, up to 24 hours if manual review is
   queued).
7. Download the signed `.xpi` from **My Add-ons** and install it through
   `about:addons` → gear → **Install Add-on From File…**.

## Route B — unlisted signing with `web-ext`

```sh
cd firefox-cache-longer
export WEB_EXT_API_KEY="user:12345:67"
export WEB_EXT_API_SECRET="0123456789abcdef..."
npm run sign
```

The signed file is written to `dist/signed/`. The first run with a brand-new ID
creates a new unlisted add-on; an ID already claimed by another account fails.
This is the same submission as Route A, just automated.

## Route C — listed on AMO

Use **Submit a New Add-on → “On this site”**. You will need:

- name, summary and a full description;
- an add-on URL slug (must be unique; `cache-even-longer` is a good choice, and `cache-longer` is taken by the original);
- category and up to two tags;
- a licence (MIT);
- a support email or site;
- screenshots (optional but recommended);
- a privacy policy only if data leaves the device — it does not here;
- notes for reviewers.

Copy-ready text is in [RELEASE_DESCRIPTION.md](RELEASE_DESCRIPTION.md): add-on
name, 229-character summary, full description, 2.1.0 release notes, reviewer
notes and a privacy statement. The description is plain text, so it can be
pasted directly into the AMO form.

Suggested categories: **Web Development** (primary) and **Other** (secondary).
Tags: `cache`, `performance`, `http`, `headers`, `offline`. Licence: **MIT**.

## Data collection declaration

Already in the manifest:

```json
"data_collection_permissions": { "required": ["none"] }
```

This is accurate: no data is transmitted off the device. Do not change it unless
the behaviour changes.

## Updates and self-distribution

- **Listed:** upload each new version to the same AMO listing; AMO handles
  updates.
- **Unlisted:** distribute the signed file yourself. Firefox only auto-updates
  unlisted add-ons when `browser_specific_settings.gecko.update_url` points at
  an HTTPS update manifest. No `update_url` is configured here, so updates are
  manual.

## Troubleshooting submissions

| Response | Meaning | Action |
| --- | --- | --- |
| “An add-on with this ID already exists” | The ID belongs to another account, or you are trying to update the original listing without ownership. | Use your own new ID for a fork, or sign in to the owning account to update the existing listing. |
| “The add-on could not be validated” | A manifest or packaging error. | Run `npm run check` and `npm run lint`; fix the reported file. |
| Warning about `strict_min_version` and data collection | The manifest supports Firefox 115 but the data-collection key was introduced in 140. | Expected and harmless; see [INSTALL.md](INSTALL.md). |
| Request for source code | The uploaded package is minified or generated. | Not expected here; if asked, upload the repository source and build instructions. |
| Manual review delay | A policy or technical review is queued. | Wait; unlisted signing is usually faster than a listed review. |

If AMO rejects the Manifest V2 package outright, tell me and I will prepare an
MV3 variant. The decision logic is isolated in `src/lib/cache-policy.js`, so
only the manifest and background adapter need to change.
