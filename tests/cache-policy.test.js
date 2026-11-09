/* SPDX-License-Identifier: MIT */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const policy = require("../src/lib/cache-policy.js");

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0); // 15 Jan 2026 12:00:00 UTC
const TARGET = 180 * 86400;
const TARGET_EXPIRES = "Tue, 14 Jul 2026 12:00:00 GMT";

function makeSettings(overrides = {}) {
  return policy.normalizeSettings(overrides);
}

function makeDetails(overrides = {}) {
  return {
    method: "GET",
    type: "image",
    statusCode: 200,
    url: "https://example.com/assets/logo.png",
    responseHeaders: [],
    ...overrides,
  };
}

function header(name, value) {
  return { name, value };
}

function values(headers, name) {
  return headers
    .filter((h) => h.name.toLowerCase() === name)
    .map((h) => h.value);
}

function headerValue(headers, name) {
  const found = values(headers, name);
  assert.equal(found.length, 1, `expected exactly one ${name} header, got ${found.length}`);
  return found[0];
}

/* ------------------------------------------------------------------ *
 * Settings normalisation
 * ------------------------------------------------------------------ */

test("defaults are safe and complete", () => {
  const settings = makeSettings(null);
  assert.equal(settings.enabled, true);
  assert.equal(settings.durationDays, 180);
  assert.equal(settings.durationSeconds, TARGET);
  assert.deepEqual(settings.resourceTypes, ["image", "stylesheet", "script", "font"]);
  assert.equal(settings.neverShorten, true);
  assert.equal(settings.respectNoStore, true);
  assert.equal(settings.skipSetCookie, true);
  assert.equal(settings.debugLogging, false);
  assert.equal(settings.excludedUrls, "");
  assert.deepEqual(settings.excludeMatchers, []);
});

test("duration is clamped and numeric strings are accepted", () => {
  assert.equal(makeSettings({ durationDays: 0 }).durationDays, 1);
  assert.equal(makeSettings({ durationDays: -20 }).durationDays, 1);
  assert.equal(makeSettings({ durationDays: 999999 }).durationDays, policy.MAX_DURATION_DAYS);
  assert.equal(makeSettings({ durationDays: "90" }).durationDays, 90);
  assert.equal(makeSettings({ durationDays: 30.6 }).durationDays, 31);
  assert.equal(makeSettings({ durationDays: "nonsense" }).durationDays, 180);
});

test("unknown resource types are dropped and duplicates removed", () => {
  const settings = makeSettings({ resourceTypes: ["image", "bogus", "image", "media"] });
  assert.deepEqual(settings.resourceTypes, ["image", "media"]);
});

test("an explicitly empty resource type list is respected", () => {
  assert.deepEqual(makeSettings({ resourceTypes: [] }).resourceTypes, []);
});

test("non-boolean toggles fall back to defaults", () => {
  const settings = makeSettings({ enabled: "false", neverShorten: 0, respectNoStore: null });
  assert.equal(settings.enabled, true);
  assert.equal(settings.neverShorten, true);
  assert.equal(settings.respectNoStore, true);
});

test("exclusion lines ignore blanks and comments", () => {
  const settings = makeSettings({
    excludedUrls: "# internal sites\n\n  example.com  \n# example.org\n",
  });
  assert.equal(settings.excludeMatchers.length, 1);
  assert.equal(settings.excludeMatchers[0].source, "example.com");
});

/* ------------------------------------------------------------------ *
 * Exclusion matching
 * ------------------------------------------------------------------ */

test("bare host patterns match the host at any path and scheme but not lookalikes", () => {
  const settings = makeSettings({ excludedUrls: "example.com" });
  assert.ok(policy.matchExclusion("https://example.com/a.js", settings));
  assert.ok(policy.matchExclusion("http://example.com", settings));
  assert.ok(policy.matchExclusion("https://example.com", settings));
  assert.equal(policy.matchExclusion("https://example.com.evil.test/a.js", settings), null);
  assert.equal(policy.matchExclusion("https://notexample.com/a.js", settings), null);
  assert.equal(policy.matchExclusion("https://sub.example.com/a.js", settings), null);
});

test("wildcard subdomain patterns do not match the bare host", () => {
  const settings = makeSettings({ excludedUrls: "*.example.com" });
  assert.ok(policy.matchExclusion("https://cdn.example.com/a.js", settings));
  assert.equal(policy.matchExclusion("https://example.com/a.js", settings), null);
});

test("host patterns also match non-default ports", () => {
  const settings = makeSettings({ excludedUrls: "example.com" });
  assert.ok(policy.matchExclusion("http://example.com:8787/a.js", settings));
  assert.ok(policy.matchExclusion("https://example.com:443/a.js", settings));
  assert.equal(policy.matchExclusion("http://example.com:8787.evil/a.js", settings), null);

  const withPort = makeSettings({ excludedUrls: "example.com:8080" });
  assert.ok(policy.matchExclusion("http://example.com:8080/a.js", withPort));
  assert.equal(policy.matchExclusion("http://example.com:9090/a.js", withPort), null);
});

test("path globs are anchored", () => {
  const settings = makeSettings({ excludedUrls: "example.com/api/*" });
  assert.ok(policy.matchExclusion("https://example.com/api/v1/data", settings));
  assert.equal(policy.matchExclusion("https://example.com/other/api", settings), null);
});

test("fully qualified patterns respect the scheme", () => {
  const settings = makeSettings({ excludedUrls: "https://example.com/*" });
  assert.ok(policy.matchExclusion("https://example.com/a.js", settings));
  assert.equal(policy.matchExclusion("http://example.com/a.js", settings), null);
});

test("a fully qualified bare host matches with or without a trailing path", () => {
  const settings = makeSettings({ excludedUrls: "https://example.com" });
  assert.ok(policy.matchExclusion("https://example.com", settings));
  assert.ok(policy.matchExclusion("https://example.com/a.js", settings));
});

/* ------------------------------------------------------------------ *
 * Early bail-outs
 * ------------------------------------------------------------------ */

test("does nothing when disabled", () => {
  const plan = policy.planHeaderChanges(makeDetails(), makeSettings({ enabled: false }), NOW);
  assert.equal(plan.changed, false);
  assert.equal(plan.reason, "disabled");
});

test("only GET and HEAD are touched", () => {
  const settings = makeSettings();
  assert.equal(policy.planHeaderChanges(makeDetails({ method: "POST" }), settings, NOW).reason, "method");
  assert.equal(policy.planHeaderChanges(makeDetails({ method: "GET" }), settings, NOW).changed, true);
  assert.equal(policy.planHeaderChanges(makeDetails({ method: "HEAD" }), settings, NOW).changed, true);
});

test("only the configured resource types are touched", () => {
  const settings = makeSettings();
  assert.equal(policy.planHeaderChanges(makeDetails({ type: "media" }), settings, NOW).reason, "resource-type");
  const withMedia = makeSettings({ resourceTypes: ["image", "media"] });
  assert.equal(policy.planHeaderChanges(makeDetails({ type: "media" }), withMedia, NOW).changed, true);
});

test("responses already served from cache are not rewritten", () => {
  const plan = policy.planHeaderChanges(makeDetails({ fromCache: true }), makeSettings(), NOW);
  assert.equal(plan.changed, false);
  assert.equal(plan.reason, "served-from-cache");
});

test("only cacheable statuses are rewritten", () => {
  const settings = makeSettings();
  for (const statusCode of [0, 204, 206, 301, 404, 500]) {
    const plan = policy.planHeaderChanges(makeDetails({ statusCode }), settings, NOW);
    assert.equal(plan.changed, false, `status ${statusCode} should not be rewritten`);
    assert.equal(plan.reason, "status-code");
  }
  for (const statusCode of [200, 203, 304]) {
    assert.equal(
      policy.planHeaderChanges(makeDetails({ statusCode }), settings, NOW).changed,
      true,
      `status ${statusCode} should be rewritten`
    );
  }
});

test("missing responseHeaders cannot crash the listener", () => {
  const details = makeDetails();
  delete details.responseHeaders;
  const plan = policy.planHeaderChanges(details, makeSettings(), NOW);
  assert.equal(plan.changed, false);
  assert.equal(plan.reason, "no-response-headers");
});

test("non-http URLs are ignored", () => {
  for (const url of ["ftp://example.com/a.png", "file:///tmp/a.png", "data:image/png;base64,AA"]) {
    assert.equal(policy.planHeaderChanges(makeDetails({ url }), makeSettings(), NOW).reason, "non-http-url");
  }
});

test("excluded URLs are skipped and report the matching pattern", () => {
  const plan = policy.planHeaderChanges(
    makeDetails(),
    makeSettings({ excludedUrls: "example.com" }),
    NOW
  );
  assert.equal(plan.changed, false);
  assert.equal(plan.reason, "excluded");
  assert.equal(plan.pattern, "example.com");
});

test("Vary: * is never cached over", () => {
  for (const value of ["*", "Accept-Encoding, *", " * "]) {
    const plan = policy.planHeaderChanges(
      makeDetails({ responseHeaders: [header("Vary", value)] }),
      makeSettings(),
      NOW
    );
    assert.equal(plan.changed, false);
    assert.equal(plan.reason, "vary-star");
  }
});

test("responses with Set-Cookie are skipped by default", () => {
  const details = makeDetails({ responseHeaders: [header("Set-Cookie", "sid=abc; HttpOnly")] });
  assert.equal(policy.planHeaderChanges(details, makeSettings(), NOW).reason, "set-cookie");
});

test("Set-Cookie responses can be opted in, and the cookie header survives", () => {
  const details = makeDetails({ responseHeaders: [header("Set-Cookie", "sid=abc; HttpOnly")] });
  const plan = policy.planHeaderChanges(details, makeSettings({ skipSetCookie: false }), NOW);
  assert.equal(plan.changed, true);
  assert.deepEqual(values(plan.headers, "set-cookie"), ["sid=abc; HttpOnly"]);
});

/* ------------------------------------------------------------------ *
 * Cache-Control handling
 * ------------------------------------------------------------------ */

test("no-store is respected by default", () => {
  const details = makeDetails({ responseHeaders: [header("Cache-Control", "no-store")] });
  const plan = policy.planHeaderChanges(details, makeSettings(), NOW);
  assert.equal(plan.changed, false);
  assert.equal(plan.reason, "no-store");
});

test("no-store can be overridden, and is removed when overridden", () => {
  const details = makeDetails({ responseHeaders: [header("Cache-Control", "private, no-store")] });
  const plan = policy.planHeaderChanges(details, makeSettings({ respectNoStore: false }), NOW);
  assert.equal(plan.changed, true);
  assert.equal(headerValue(plan.headers, "cache-control"), "private, max-age=15552000");
});

test("a short max-age is extended", () => {
  const details = makeDetails({ responseHeaders: [header("Cache-Control", "max-age=3600")] });
  const plan = policy.planHeaderChanges(details, makeSettings(), NOW);
  assert.equal(plan.changed, true);
  assert.equal(plan.previousLifetime, 3600);
  assert.equal(headerValue(plan.headers, "cache-control"), "max-age=15552000");
  assert.equal(headerValue(plan.headers, "expires"), TARGET_EXPIRES);
});

test("max-age=0 is extended", () => {
  const details = makeDetails({ responseHeaders: [header("Cache-Control", "max-age=0")] });
  assert.equal(policy.planHeaderChanges(details, makeSettings(), NOW).changed, true);
});

test("no-cache is removed so the extension can actually extend the lifetime", () => {
  const details = makeDetails({ responseHeaders: [header("Cache-Control", "no-cache, max-age=600")] });
  const plan = policy.planHeaderChanges(details, makeSettings(), NOW);
  assert.equal(plan.changed, true);
  assert.equal(plan.previousLifetime, 0);
  assert.equal(headerValue(plan.headers, "cache-control"), "max-age=15552000");
});

test("quoted no-cache field lists with commas are parsed and removed", () => {
  const details = makeDetails({
    responseHeaders: [header("Cache-Control", 'no-cache="Set-Cookie, Authorization", max-age=0')],
  });
  const plan = policy.planHeaderChanges(details, makeSettings(), NOW);
  assert.equal(plan.changed, true);
  assert.equal(headerValue(plan.headers, "cache-control"), "max-age=15552000");
});

test("an already longer max-age is preserved", () => {
  const details = makeDetails({ responseHeaders: [header("Cache-Control", "max-age=31536000")] });
  const plan = policy.planHeaderChanges(details, makeSettings(), NOW);
  assert.equal(plan.changed, false);
  assert.equal(plan.reason, "already-long-enough");
  assert.equal(plan.previousLifetime, 31536000);
});

test("neverShorten can be turned off, shortening a longer lifetime", () => {
  const details = makeDetails({ responseHeaders: [header("Cache-Control", "max-age=31536000")] });
  const plan = policy.planHeaderChanges(details, makeSettings({ neverShorten: false }), NOW);
  assert.equal(plan.changed, true);
  assert.equal(headerValue(plan.headers, "cache-control"), "max-age=15552000");
});

test("a lifetime exactly equal to the target is left alone", () => {
  const details = makeDetails({ responseHeaders: [header("Cache-Control", "max-age=15552000")] });
  assert.equal(policy.planHeaderChanges(details, makeSettings(), NOW).reason, "already-long-enough");
});

test("private is preserved and public is never added", () => {
  const details = makeDetails({ responseHeaders: [header("Cache-Control", "private, max-age=60")] });
  const plan = policy.planHeaderChanges(details, makeSettings(), NOW);
  const cacheControl = headerValue(plan.headers, "cache-control");
  assert.match(cacheControl, /(^|, )private(,|$)/);
  assert.doesNotMatch(cacheControl, /public/);
});

test("immutable, no-transform, must-revalidate and stale-while-revalidate survive", () => {
  const details = makeDetails({
    responseHeaders: [
      header(
        "Cache-Control",
        "public, immutable, no-transform, must-revalidate, stale-while-revalidate=86400, max-age=60"
      ),
    ],
  });
  const plan = policy.planHeaderChanges(details, makeSettings(), NOW);
  const cacheControl = headerValue(plan.headers, "cache-control");
  for (const directive of [
    "public",
    "immutable",
    "no-transform",
    "must-revalidate",
    "stale-while-revalidate=86400",
  ]) {
    assert.ok(cacheControl.includes(directive), `${directive} should be preserved`);
  }
  assert.match(cacheControl, /max-age=15552000/);
});

test("never adds immutable to a response that did not send it", () => {
  const details = makeDetails({ responseHeaders: [header("Cache-Control", "max-age=60")] });
  const plan = policy.planHeaderChanges(details, makeSettings(), NOW);
  assert.equal(headerValue(plan.headers, "cache-control"), "max-age=15552000");
  assert.doesNotMatch(headerValue(plan.headers, "cache-control"), /immutable/);
});

test("s-maxage is left untouched for shared caches", () => {
  const details = makeDetails({
    responseHeaders: [header("Cache-Control", "s-maxage=900, max-age=60")],
  });
  const plan = policy.planHeaderChanges(details, makeSettings(), NOW);
  assert.equal(headerValue(plan.headers, "cache-control"), "s-maxage=900, max-age=15552000");
});

test("header names are matched case-insensitively and keep their original casing", () => {
  const details = makeDetails({
    responseHeaders: [header("CACHE-CONTROL", "MAX-AGE=60"), header("EXPIRES", "0")],
  });
  const plan = policy.planHeaderChanges(details, makeSettings(), NOW);
  assert.equal(plan.changed, true);
  assert.deepEqual(values(plan.headers, "cache-control"), ["max-age=15552000"]);
  assert.equal(plan.headers.find((h) => h.name === "CACHE-CONTROL").value, "max-age=15552000");
  assert.equal(plan.headers.find((h) => h.name === "EXPIRES").value, TARGET_EXPIRES);
});

test("duplicate Cache-Control and Expires headers collapse to one each", () => {
  const details = makeDetails({
    responseHeaders: [
      header("Cache-Control", "max-age=60"),
      header("Cache-Control", "public"),
      header("Expires", "0"),
      header("Expires", "0"),
    ],
  });
  const plan = policy.planHeaderChanges(details, makeSettings(), NOW);
  assert.equal(values(plan.headers, "cache-control").length, 1);
  assert.equal(values(plan.headers, "expires").length, 1);
});

test("a response with no cache headers gets both headers", () => {
  const details = makeDetails({
    responseHeaders: [header("Content-Type", "image/png"), header("ETag", '"abc"')],
  });
  const plan = policy.planHeaderChanges(details, makeSettings(), NOW);
  assert.equal(plan.changed, true);
  assert.equal(plan.headers.length, 4);
  assert.equal(headerValue(plan.headers, "cache-control"), "max-age=15552000");
  assert.equal(headerValue(plan.headers, "expires"), TARGET_EXPIRES);
  assert.equal(headerValue(plan.headers, "content-type"), "image/png");
  assert.equal(headerValue(plan.headers, "etag"), '"abc"');
});

test("the input header array and its objects are not mutated", () => {
  const original = [
    header("Cache-Control", "max-age=60"),
    header("Expires", "0"),
    header("X-Test", "keep"),
  ];
  const snapshot = JSON.parse(JSON.stringify(original));
  policy.planHeaderChanges(makeDetails({ responseHeaders: original }), makeSettings(), NOW);
  assert.deepEqual(original, snapshot);
});

/* ------------------------------------------------------------------ *
 * Expires handling
 * ------------------------------------------------------------------ */

test("an Expires-only response is extended", () => {
  const details = makeDetails({
    responseHeaders: [header("Expires", "Wed, 21 Oct 2015 07:28:00 GMT")],
  });
  const plan = policy.planHeaderChanges(details, makeSettings(), NOW);
  assert.equal(plan.changed, true);
  assert.equal(plan.previousLifetime, 0);
  assert.equal(headerValue(plan.headers, "expires"), TARGET_EXPIRES);
  assert.equal(headerValue(plan.headers, "cache-control"), "max-age=15552000");
});

test("existing lifetime from Expires is measured against the Date header", () => {
  const details = makeDetails({
    responseHeaders: [
      header("Date", "Thu, 15 Jan 2026 12:00:00 GMT"),
      header("Expires", "Fri, 16 Jan 2026 12:00:00 GMT"),
    ],
  });
  const plan = policy.planHeaderChanges(details, makeSettings(), NOW);
  assert.equal(plan.changed, true);
  assert.equal(plan.previousLifetime, 86400);
});

test("a far-future Expires is preserved", () => {
  const details = makeDetails({
    responseHeaders: [
      header("Date", "Thu, 15 Jan 2026 12:00:00 GMT"),
      header("Expires", "Thu, 15 Jan 2027 12:00:00 GMT"),
    ],
  });
  const plan = policy.planHeaderChanges(details, makeSettings(), NOW);
  assert.equal(plan.changed, false);
  assert.equal(plan.reason, "already-long-enough");
});

test("the classic Expires: 0 means expired", () => {
  const details = makeDetails({ responseHeaders: [header("Expires", "0")] });
  const plan = policy.planHeaderChanges(details, makeSettings(), NOW);
  assert.equal(plan.changed, true);
  assert.equal(plan.previousLifetime, 0);
});

/* ------------------------------------------------------------------ *
 * Duration and helper functions
 * ------------------------------------------------------------------ */

test("the configured duration controls max-age and Expires", () => {
  const days = 30;
  const plan = policy.planHeaderChanges(
    makeDetails(),
    makeSettings({ durationDays: days }),
    NOW
  );
  assert.equal(headerValue(plan.headers, "cache-control"), `max-age=${days * 86400}`);
  assert.equal(
    headerValue(plan.headers, "expires"),
    new Date(NOW + days * 86400 * 1000).toUTCString()
  );
});

test("splitOnCommas respects quoted commas and escaped quotes", () => {
  assert.deepEqual(policy.splitOnCommas('a="1,2", b, c="x\\"y"'), ['a="1,2"', "b", 'c="x\\"y"']);
});

test("parseCacheControl normalises names and keeps values", () => {
  const directives = policy.parseCacheControl(["Public, Max-Age = 60", 'no-cache="a, b"']);
  assert.deepEqual(
    directives.map((d) => [d.name, d.value]),
    [
      ["public", null],
      ["max-age", "60"],
      ["no-cache", '"a, b"'],
    ]
  );
});

/* ------------------------------------------------------------------ *
 * 2.1 features: SWR, Age-aware lifetime, fingerprint mode, presets
 * ------------------------------------------------------------------ */

test("2.1 defaults keep SWR and fingerprint-only off", () => {
  const settings = makeSettings(undefined);
  assert.equal(settings.staleWhileRevalidate, false);
  assert.equal(settings.staleWhileRevalidateDays, 7);
  assert.equal(settings.onlyFingerprinted, false);
  assert.equal(settings.durationDays, 180);
});

test("SWR days are clamped and non-boolean switches fall back", () => {
  assert.equal(makeSettings({ staleWhileRevalidateDays: 0 }).staleWhileRevalidateDays, 1);
  assert.equal(makeSettings({ staleWhileRevalidateDays: 9999 }).staleWhileRevalidateDays, 365);
  assert.equal(makeSettings({ staleWhileRevalidateDays: "14" }).staleWhileRevalidateDays, 14);
  assert.equal(makeSettings({ staleWhileRevalidateDays: "nonsense" }).staleWhileRevalidateDays, 7);
  assert.equal(makeSettings({ staleWhileRevalidate: "yes" }).staleWhileRevalidate, false);
});

test("fingerprint detection recognises hashes and version queries", () => {
  for (const url of [
    "https://example.com/app.4f3c2a91.js",
    "https://example.com/app-4f3c2a91.js",
    "https://example.com/styles.524f6c762af549da.css",
    "https://example.com/chunk.4f3c2a91.chunk.js",
    "https://example.com/4f3c2a91.js",
    "https://example.com/image.20240101.png",
    "https://example.com/app.js?v=4f3c2a91",
    "https://example.com/app.js?ver=20240101",
  ]) {
    assert.equal(policy.isFingerprintedUrl(url), true, url);
  }
  for (const url of [
    "https://example.com/app.js",
    "https://example.com/styles.css",
    "https://example.com/app.js?v=1",
    "https://example.com/app.js?version=latest",
    "https://example.com/abcdefgh.js",
  ]) {
    assert.equal(policy.isFingerprintedUrl(url), false, url);
  }
});

test("onlyFingerprinted skips URLs that do not look content-addressed", () => {
  const settings = makeSettings({ onlyFingerprinted: true });
  const hashed = policy.planHeaderChanges(
    makeDetails({ url: "https://example.com/app.4f3c2a91.js" }),
    settings,
    NOW
  );
  assert.equal(hashed.changed, true);

  const plain = policy.planHeaderChanges(
    makeDetails({ url: "https://example.com/app.js" }),
    settings,
    NOW
  );
  assert.equal(plain.changed, false);
  assert.equal(plain.reason, "not-fingerprinted");
});

test("SWR is added with a configured window and must-revalidate is dropped", () => {
  const details = makeDetails({
    responseHeaders: [header("Cache-Control", "private, max-age=60, must-revalidate")],
  });
  const settings = makeSettings({ staleWhileRevalidate: true, staleWhileRevalidateDays: 7 });
  const plan = policy.planHeaderChanges(details, settings, NOW);
  assert.equal(plan.changed, true);
  assert.equal(
    headerValue(plan.headers, "cache-control"),
    "private, max-age=15552000, stale-while-revalidate=604800"
  );
  assert.equal(plan.swrSeconds, 604800);
});

test("SWR is not added when the setting is off, and origin directives are kept", () => {
  const details = makeDetails({
    responseHeaders: [
      header("Cache-Control", "max-age=60, stale-while-revalidate=86400, must-revalidate"),
    ],
  });
  const plan = policy.planHeaderChanges(details, makeSettings(), NOW);
  const cacheControl = headerValue(plan.headers, "cache-control");
  assert.match(cacheControl, /stale-while-revalidate=86400/);
  assert.match(cacheControl, /must-revalidate/);
  assert.match(cacheControl, /max-age=15552000/);
});

test("a longer origin SWR window is preserved when the setting is on", () => {
  const details = makeDetails({
    responseHeaders: [header("Cache-Control", "max-age=60, stale-while-revalidate=9999999")],
  });
  const settings = makeSettings({ staleWhileRevalidate: true, staleWhileRevalidateDays: 7 });
  const plan = policy.planHeaderChanges(details, settings, NOW);
  assert.equal(headerValue(plan.headers, "cache-control"), "max-age=15552000, stale-while-revalidate=9999999");
  assert.equal(plan.swrSeconds, 9999999);
});

test("SWR is added without shortening an already-long lifetime", () => {
  const details = makeDetails({
    responseHeaders: [header("Cache-Control", "max-age=31536000")],
  });
  const settings = makeSettings({ staleWhileRevalidate: true, staleWhileRevalidateDays: 7 });
  const plan = policy.planHeaderChanges(details, settings, NOW);
  assert.equal(plan.changed, true);
  assert.equal(plan.previousLifetime, 31536000);
  assert.equal(
    headerValue(plan.headers, "cache-control"),
    "max-age=31536000, stale-while-revalidate=604800"
  );
});

test("SWR works with a response that had no cache headers", () => {
  const details = makeDetails({ responseHeaders: [] });
  const settings = makeSettings({ staleWhileRevalidate: true, staleWhileRevalidateDays: 7 });
  const plan = policy.planHeaderChanges(details, settings, NOW);
  assert.equal(
    headerValue(plan.headers, "cache-control"),
    "max-age=15552000, stale-while-revalidate=604800"
  );
});

test("Age is subtracted from the existing lifetime and added to the new max-age", () => {
  const details = makeDetails({
    responseHeaders: [header("Cache-Control", "max-age=15552000"), header("Age", "3600")],
  });
  const plan = policy.planHeaderChanges(details, makeSettings(), NOW);
  assert.equal(plan.changed, true);
  assert.equal(plan.previousLifetime, 15548400);
  assert.equal(plan.ageSeconds, 3600);
  assert.equal(headerValue(plan.headers, "cache-control"), "max-age=15555600");
  assert.equal(headerValue(plan.headers, "expires"), TARGET_EXPIRES);

  // 180 days minus an hour is still shorter than the 180-day target.
  assert.equal(plan.previousLifetime < TARGET, true);
});

test("Age can make an apparently long lifetime too short", () => {
  const details = makeDetails({
    responseHeaders: [header("Cache-Control", "max-age=31536000"), header("Age", "31500000")],
  });
  const plan = policy.planHeaderChanges(details, makeSettings(), NOW);
  assert.equal(plan.changed, true);
  assert.equal(plan.previousLifetime, 36000);
  assert.equal(headerValue(plan.headers, "cache-control"), "max-age=47052000");
});

test("a long remaining lifetime with Age is left alone", () => {
  const details = makeDetails({
    responseHeaders: [header("Cache-Control", "max-age=31536000"), header("Age", "3600")],
  });
  const plan = policy.planHeaderChanges(details, makeSettings(), NOW);
  assert.equal(plan.changed, false);
  assert.equal(plan.reason, "already-long-enough");
});

test("invalid or missing Age is treated as zero", () => {
  for (const age of [undefined, "abc", "-5"]) {
    const headers = [header("Cache-Control", "max-age=60")];
    if (age !== undefined) headers.push(header("Age", age));
    const plan = policy.planHeaderChanges(makeDetails({ responseHeaders: headers }), makeSettings(), NOW);
    assert.equal(plan.ageSeconds, 0, String(age));
    assert.equal(headerValue(plan.headers, "cache-control"), "max-age=15552000");
  }
});

test("presets are safe, normalise cleanly, and differ in the expected way", () => {
  const safe = makeSettings(policy.PRESETS.safe);
  assert.equal(safe.durationDays, 30);
  assert.equal(safe.onlyFingerprinted, true);
  assert.equal(safe.staleWhileRevalidate, false);

  const balanced = makeSettings(policy.PRESETS.balanced);
  assert.equal(balanced.durationDays, 180);
  assert.equal(balanced.staleWhileRevalidate, true);
  assert.equal(balanced.staleWhileRevalidateDays, 7);
  assert.equal(balanced.onlyFingerprinted, false);

  const aggressive = makeSettings(policy.PRESETS.aggressive);
  assert.equal(aggressive.durationDays, 365);
  assert.equal(aggressive.staleWhileRevalidateDays, 30);
  assert.deepEqual([...aggressive.resourceTypes], ["image", "stylesheet", "script", "font", "media"]);

  for (const preset of Object.values(policy.PRESETS)) {
    const normalised = makeSettings(preset);
    assert.equal(normalised.neverShorten, true);
    assert.equal(normalised.respectNoStore, true);
    assert.equal(normalised.skipSetCookie, true);
  }
});
