/* SPDX-License-Identifier: MIT */
/*
 * Cache even Longer 2.1 -- header policy.
 *
 * Pure, dependency-free decision logic. It takes a webRequest details object
 * plus normalised settings, and returns either "leave the response alone" or
 * a complete replacement responseHeaders array.
 *
 * Loaded as a classic script by the background page and the options page, and
 * require()d directly by the Node test suite (see the UMD footer).
 */

"use strict";

(function (global) {
  const DAY_SECONDS = 86400;
  const MAX_DURATION_DAYS = 3650;
  const MAX_SWR_DAYS = 365;
  const DEFAULT_DURATION_DAYS = 180;
  const DEFAULT_SWR_DAYS = 7;

  /*
   * Statuses whose headers are safe to extend:
   *   200 -- normal successful response
   *   203 -- cacheable "non-authoritative" 200
   *   304 -- Not Modified; refreshes the stored headers of an existing entry.
   *          Extending it keeps a long lifetime from collapsing back to a
   *          short one after the first revalidation.
   *
   * Everything else (redirects, 204, 206 partial content, 4xx, 5xx) is left
   * alone: caching an error or a byte range for months is not "longer
   * caching", it is a broken page.
   */
  const CACHEABLE_STATUS = new Set([200, 203, 304]);

  const RESOURCE_TYPE_IDS = [
    "image",
    "stylesheet",
    "script",
    "font",
    "media",
    "xmlhttprequest",
    "other",
  ];

  const DEFAULT_RESOURCE_TYPES = ["image", "stylesheet", "script", "font"];

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    durationDays: DEFAULT_DURATION_DAYS,
    resourceTypes: Object.freeze([...DEFAULT_RESOURCE_TYPES]),
    neverShorten: true,
    respectNoStore: true,
    skipSetCookie: true,
    staleWhileRevalidate: false,
    staleWhileRevalidateDays: DEFAULT_SWR_DAYS,
    onlyFingerprinted: false,
    debugLogging: false,
    excludedUrls: "",
  });

  /**
   * Starting points for the options page. Presets deliberately do not touch
   * `enabled`, `excludedUrls` or `debugLogging`; those are user context, not
   * cache policy.
   */
  const PRESETS = Object.freeze({
    safe: Object.freeze({
      durationDays: 30,
      resourceTypes: Object.freeze(["image", "stylesheet", "script", "font"]),
      neverShorten: true,
      respectNoStore: true,
      skipSetCookie: true,
      staleWhileRevalidate: false,
      staleWhileRevalidateDays: DEFAULT_SWR_DAYS,
      onlyFingerprinted: true,
    }),
    balanced: Object.freeze({
      durationDays: 180,
      resourceTypes: Object.freeze([...DEFAULT_RESOURCE_TYPES]),
      neverShorten: true,
      respectNoStore: true,
      skipSetCookie: true,
      staleWhileRevalidate: true,
      staleWhileRevalidateDays: 7,
      onlyFingerprinted: false,
    }),
    aggressive: Object.freeze({
      durationDays: 365,
      resourceTypes: Object.freeze(["image", "stylesheet", "script", "font", "media"]),
      neverShorten: true,
      respectNoStore: true,
      skipSetCookie: true,
      staleWhileRevalidate: true,
      staleWhileRevalidateDays: 30,
      onlyFingerprinted: false,
    }),
  });

  /* ------------------------------------------------------------------ *
   * Settings
   * ------------------------------------------------------------------ */

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function asBoolean(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }

  /**
   * Turn arbitrary stored/user input into a complete, safe settings object.
   * Unknown resource types are dropped; an empty type list is respected.
   * The returned object also carries the derived `durationSeconds` and the
   * compiled `excludeMatchers` so no work is repeated per request.
   */
  function normalizeSettings(raw) {
    const input = raw && typeof raw === "object" ? raw : {};

    const requestedDays = Number(input.durationDays);
    const durationDays = Number.isFinite(requestedDays)
      ? clamp(Math.round(requestedDays), 1, MAX_DURATION_DAYS)
      : DEFAULT_DURATION_DAYS;

    let resourceTypes;
    if (Array.isArray(input.resourceTypes)) {
      resourceTypes = [
        ...new Set(input.resourceTypes.filter((type) => RESOURCE_TYPE_IDS.includes(type))),
      ];
    } else {
      resourceTypes = [...DEFAULT_RESOURCE_TYPES];
    }

    const excludedUrls = typeof input.excludedUrls === "string" ? input.excludedUrls : "";

    const requestedSwrDays = Number(input.staleWhileRevalidateDays);
    const staleWhileRevalidateDays = Number.isFinite(requestedSwrDays)
      ? clamp(Math.round(requestedSwrDays), 1, MAX_SWR_DAYS)
      : DEFAULT_SWR_DAYS;

    return {
      enabled: asBoolean(input.enabled, DEFAULT_SETTINGS.enabled),
      durationDays,
      resourceTypes,
      neverShorten: asBoolean(input.neverShorten, DEFAULT_SETTINGS.neverShorten),
      respectNoStore: asBoolean(input.respectNoStore, DEFAULT_SETTINGS.respectNoStore),
      skipSetCookie: asBoolean(input.skipSetCookie, DEFAULT_SETTINGS.skipSetCookie),
      staleWhileRevalidate: asBoolean(
        input.staleWhileRevalidate,
        DEFAULT_SETTINGS.staleWhileRevalidate
      ),
      staleWhileRevalidateDays,
      onlyFingerprinted: asBoolean(
        input.onlyFingerprinted,
        DEFAULT_SETTINGS.onlyFingerprinted
      ),
      debugLogging: asBoolean(input.debugLogging, DEFAULT_SETTINGS.debugLogging),
      excludedUrls,
      durationSeconds: durationDays * DAY_SECONDS,
      excludeMatchers: compileExclusions(excludedUrls),
    };
  }

  /**
   * Compile the exclusions textarea into anchored regular expressions.
   *
   * A line is a glob where `*` matches any run of characters and everything
   * else is literal. Pattern forms:
   *
   *   example.com          -> any scheme, that exact host, any path
   *   *.example.com        -> any scheme, any subdomain (not the bare host)
   *   example.com/api/*    -> any scheme, that host, paths under /api/
   *   https://example.com/*  -> fully qualified glob
   *
   * Blank lines and lines starting with "#" are ignored. Patterns are matched
   * case-insensitively against the request URL.
   */
  function compileExclusions(text) {
    const matchers = [];
    for (const line of String(text || "").split(/\r?\n/)) {
      const pattern = line.trim();
      if (!pattern || pattern.startsWith("#")) continue;

      let regex;
      try {
        regex = exclusionPatternToRegex(pattern);
      } catch (error) {
        // Escaping makes this practically unreachable, but a bad pattern
        // must never take the header listener down.
        continue;
      }
      matchers.push({ source: pattern, regex });
    }
    return matchers;
  }

  function exclusionPatternToRegex(pattern) {
    const schemeEnd = pattern.indexOf("://");
    const scheme = schemeEnd === -1
      ? "[a-z][a-z0-9+.-]*"
      : globToRegexSource(pattern.slice(0, schemeEnd));
    const rest = schemeEnd === -1 ? pattern : pattern.slice(schemeEnd + 3);

    const slash = rest.indexOf("/");
    const authority = slash === -1 ? rest : rest.slice(0, slash);
    const path = slash === -1 ? "" : rest.slice(slash);

    // A pattern without an explicit port should match that host on any port
    // (very common for localhost and development servers).
    const port = /:\d+$/.test(authority) ? "" : "(?::\\d+)?";

    return new RegExp(
      `^${scheme}://${globToRegexSource(authority)}${port}${path ? globToRegexSource(path) : "(?:/.*)?"}$`,
      "i"
    );
  }

  function globToRegexSource(glob) {
    return glob
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
  }

  function matchExclusion(url, settings) {
    const matchers = settings && settings.excludeMatchers;
    if (!Array.isArray(matchers) || matchers.length === 0) return null;

    let target = String(url || "");
    try {
      target = new URL(target).href;
    } catch (error) {
      // Keep the raw string; it still matches literal patterns.
    }

    for (const matcher of matchers) {
      if (matcher.regex.test(target)) return matcher.source;
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * HTTP header helpers
   * ------------------------------------------------------------------ */

  function headerName(header) {
    return header && typeof header.name === "string" ? header.name.toLowerCase() : "";
  }

  function headerValues(headers, wantedName) {
    const values = [];
    for (const header of headers) {
      if (headerName(header) === wantedName && typeof header.value === "string") {
        values.push(header.value);
      }
    }
    return values;
  }

  function hasHeader(headers, wantedName) {
    return headers.some((header) => headerName(header) === wantedName);
  }

  /**
   * Split a comma-separated header value without breaking quoted strings
   * such as `no-cache="Set-Cookie, Authorization"`.
   */
  function splitOnCommas(value) {
    const parts = [];
    let current = "";
    let quoted = false;
    let escaped = false;

    for (const character of String(value)) {
      if (escaped) {
        current += character;
        escaped = false;
      } else if (character === "\\" && quoted) {
        current += character;
        escaped = true;
      } else if (character === '"') {
        quoted = !quoted;
        current += character;
      } else if (character === "," && !quoted) {
        parts.push(current);
        current = "";
      } else {
        current += character;
      }
    }
    parts.push(current);

    return parts.map((part) => part.trim()).filter(Boolean);
  }

  function parseCacheControl(values) {
    const directives = [];
    for (const value of values) {
      for (const raw of splitOnCommas(value)) {
        const equals = raw.indexOf("=");
        const name = (equals === -1 ? raw : raw.slice(0, equals)).trim().toLowerCase();
        if (!name) continue;
        directives.push({
          name,
          value: equals === -1 ? null : raw.slice(equals + 1).trim(),
          raw,
        });
      }
    }
    return directives;
  }

  function directiveValue(directive) {
    if (!directive || directive.value === null) return null;
    return directive.value.replace(/^"(.*)"$/, "$1").trim();
  }

  function findDirective(directives, name) {
    return directives.find((directive) => directive.name === name) || null;
  }

  function parseHttpDate(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    // The classic "already expired" values are not real dates.
    if (trimmed === "0" || trimmed === "-1") return 0;
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /** Seconds the response has already spent in caches, per the Age header. */
  function parseAgeSeconds(headers) {
    const value = headerValues(headers, "age")[0];
    if (typeof value !== "string") return 0;
    const seconds = Number.parseInt(value, 10);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  }

  /** Longest stale-while-revalidate window already present, in seconds. */
  function existingSwrSeconds(directives) {
    let longest = 0;
    for (const directive of directives) {
      if (directive.name !== "stale-while-revalidate") continue;
      const seconds = Number.parseInt(directiveValue(directive), 10);
      if (Number.isFinite(seconds)) longest = Math.max(longest, seconds);
    }
    return Math.max(0, longest);
  }

  /*
   * Conservative content-hash detection: 8+ hex characters delimited by
   * punctuation in the last path segment, or a common version query parameter.
   * It intentionally misses base64 hashes rather than risking false positives.
   */
  const FINGERPRINT_PATH = /(?:^|[._-])([a-f0-9]{8,})(?=[._-]|$)/i;
  const FINGERPRINT_QUERY = /[?&](?:v|ver|version|hash|h|cb)=[a-f0-9]{8,}(?:&|$)/i;

  function isFingerprintedUrl(url) {
    try {
      const parsed = new URL(url);
      if (FINGERPRINT_QUERY.test(parsed.search)) return true;
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments.length === 0) return false;
      return FINGERPRINT_PATH.test(segments[segments.length - 1]);
    } catch (error) {
      return false;
    }
  }

  /**
   * Remaining freshness lifetime of the response, in seconds, after accounting
   * for the Age header. `no-cache` always wins: it forces revalidation no matter
   * what max-age says.
   */
  function existingLifetime(directives, headers, nowMs, ageSeconds = 0) {
    if (findDirective(directives, "no-cache")) return 0;

    const age = Number.isFinite(ageSeconds) ? Math.max(0, ageSeconds) : 0;

    const maxAge = findDirective(directives, "max-age");
    if (maxAge) {
      const seconds = Number.parseInt(directiveValue(maxAge), 10);
      if (Number.isFinite(seconds)) return Math.max(0, seconds - age);
    }

    const expiresValue = headerValues(headers, "expires")[0];
    const expiresAt = parseHttpDate(expiresValue);
    if (expiresAt === null) return 0;

    const dateValue = headerValues(headers, "date")[0];
    const dateAt = parseHttpDate(dateValue);
    const base = dateAt === null ? nowMs : dateAt;
    return Math.max(0, Math.floor((expiresAt - base) / 1000) - age);
  }

  /**
   * Replace the first Cache-Control/Expires header in place, drop duplicate
   * copies, and append missing ones. Other headers keep their order, name
   * casing and unknown properties.
   */
  function rewriteHeaders(headers, cacheControlValue, expiresValue) {
    const output = [];
    let replacedCacheControl = false;
    let replacedExpires = false;

    for (const header of headers) {
      if (!header || typeof header.name !== "string") {
        if (header) output.push({ ...header });
        continue;
      }

      const name = headerName(header);
      if (name === "cache-control") {
        if (!replacedCacheControl) {
          output.push({ name: header.name, value: cacheControlValue });
          replacedCacheControl = true;
        }
      } else if (name === "expires") {
        if (!replacedExpires) {
          output.push({ name: header.name, value: expiresValue });
          replacedExpires = true;
        }
      } else {
        output.push({ ...header });
      }
    }

    if (!replacedCacheControl) {
      output.push({ name: "Cache-Control", value: cacheControlValue });
    }
    if (!replacedExpires) {
      output.push({ name: "Expires", value: expiresValue });
    }

    return output;
  }

  /* ------------------------------------------------------------------ *
   * Public decision function
   * ------------------------------------------------------------------ */

  function unchanged(reason, extra) {
    return { changed: false, reason, ...(extra || {}) };
  }

  /**
   * Decide what to do with one response.
   *
   * @param {object} details  webRequest onHeadersReceived details
   * @param {object} settings output of normalizeSettings()
   * @param {number} [nowMs]  injectable clock for tests
   * @returns {{changed: boolean, reason: string, headers?: object[]}}
   */
  function planHeaderChanges(details, settings, nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();

    if (!details || typeof details !== "object") return unchanged("invalid-request");
    if (!settings || settings.enabled !== true) return unchanged("disabled");

    const method = String(details.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") return unchanged("method");

    if (!Array.isArray(settings.resourceTypes)) return unchanged("invalid-settings");
    if (!settings.resourceTypes.includes(String(details.type || ""))) {
      return unchanged("resource-type");
    }

    if (details.fromCache === true) return unchanged("served-from-cache");

    if (!CACHEABLE_STATUS.has(details.statusCode)) {
      return unchanged("status-code", { statusCode: details.statusCode });
    }

    const headers = details.responseHeaders;
    if (!Array.isArray(headers)) return unchanged("no-response-headers");

    const url = String(details.url || "");
    if (!/^https?:\/\//i.test(url)) return unchanged("non-http-url");

    const excludedBy = matchExclusion(url, settings);
    if (excludedBy) return unchanged("excluded", { pattern: excludedBy });

    if (settings.onlyFingerprinted && !isFingerprintedUrl(url)) {
      return unchanged("not-fingerprinted");
    }

    // `Vary: *` means "never reusable"; overriding that is never safe.
    const varyStar = headerValues(headers, "vary").some((value) =>
      splitOnCommas(value).some((vary) => vary === "*")
    );
    if (varyStar) return unchanged("vary-star");

    if (settings.skipSetCookie && hasHeader(headers, "set-cookie")) {
      return unchanged("set-cookie");
    }

    const directives = parseCacheControl(headerValues(headers, "cache-control"));
    if (settings.respectNoStore && findDirective(directives, "no-store")) {
      return unchanged("no-store");
    }

    const targetSeconds = Number.isFinite(settings.durationSeconds)
      ? settings.durationSeconds
      : normalizeSettings(settings).durationSeconds;
    if (!Number.isFinite(targetSeconds) || targetSeconds <= 0) {
      return unchanged("invalid-duration");
    }

    const ageSeconds = parseAgeSeconds(headers);
    const previousLifetime = existingLifetime(directives, headers, now, ageSeconds);

    const swrEnabled = settings.staleWhileRevalidate === true;
    const swrDays = Number.isFinite(settings.staleWhileRevalidateDays)
      ? Math.max(1, Math.round(settings.staleWhileRevalidateDays))
      : DEFAULT_SWR_DAYS;
    const configuredSwrSeconds = swrEnabled ? swrDays * DAY_SECONDS : 0;
    const previousSwrSeconds = existingSwrSeconds(directives);
    const swrSeconds = swrEnabled
      ? Math.max(previousSwrSeconds, configuredSwrSeconds)
      : previousSwrSeconds;
    const hasMustRevalidate = Boolean(findDirective(directives, "must-revalidate"));

    // Rewrite when the remaining lifetime is too short, when neverShorten is
    // off and it is too long, or when SWR needs to be added/extended and
    // must-revalidate must be dropped for it to take effect.
    const lifetimeNeedsRewrite = settings.neverShorten
      ? previousLifetime < targetSeconds
      : previousLifetime !== targetSeconds;
    const swrNeedsRewrite =
      swrEnabled && (previousSwrSeconds < configuredSwrSeconds || hasMustRevalidate);

    if (!lifetimeNeedsRewrite && !swrNeedsRewrite) {
      return unchanged("already-long-enough", {
        previousLifetime,
        targetSeconds,
      });
    }

    const newRemaining = settings.neverShorten
      ? Math.max(previousLifetime, targetSeconds)
      : targetSeconds;
    // Age describes time already spent in a shared cache. Adding it keeps the
    // configured lifetime measured from receipt instead of from the origin.
    const newMaxAge = newRemaining + ageSeconds;

    // Preserve every directive that does not fight the new freshness period.
    // Notably: keep `private`, `immutable`, `no-transform`, `proxy-revalidate`,
    // `s-maxage` and unrelated extensions; drop only the ones that force
    // revalidation or set a shorter life.
    //
    // `immutable` is preserved if the origin sent it, but it is never added.
    // Firefox lets `immutable` skip forced validation in some paths (for
    // example DevTools "Disable Cache"), which would undermine a reliable
    // force-refresh. Shift+Reload bypasses the cache entirely, but the add-on
    // should not make fresh loads less reliable.
    const kept = [];
    for (const directive of directives) {
      if (directive.name === "max-age" || directive.name === "no-cache") continue;
      if (directive.name === "no-store") continue; // only reachable when overridden
      if (directive.name === "stale-while-revalidate") {
        if (swrEnabled) continue; // replaced by the merged value below
        kept.push(directive.raw);
        continue;
      }
      if (swrEnabled && directive.name === "must-revalidate") continue;
      kept.push(directive.raw);
    }

    const parts = [...kept, `max-age=${newMaxAge}`];
    if (swrEnabled && swrSeconds > 0) {
      parts.push(`stale-while-revalidate=${swrSeconds}`);
    }
    const cacheControl = parts.join(", ");
    const expires = new Date(now + newRemaining * 1000).toUTCString();

    return {
      changed: true,
      reason: "extended",
      headers: rewriteHeaders(headers, cacheControl, expires),
      cacheControl,
      expires,
      previousLifetime,
      previousSwrSeconds,
      swrSeconds,
      targetSeconds,
      ageSeconds,
      newMaxAge,
    };
  }

  const api = {
    DAY_SECONDS,
    MAX_DURATION_DAYS,
    MAX_SWR_DAYS,
    DEFAULT_DURATION_DAYS,
    DEFAULT_SWR_DAYS,
    DEFAULT_SETTINGS,
    PRESETS,
    RESOURCE_TYPE_IDS,
    DEFAULT_RESOURCE_TYPES,
    normalizeSettings,
    compileExclusions,
    matchExclusion,
    isFingerprintedUrl,
    parseAgeSeconds,
    existingSwrSeconds,
    splitOnCommas,
    parseCacheControl,
    existingLifetime,
    planHeaderChanges,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.CacheLongerPolicy = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
