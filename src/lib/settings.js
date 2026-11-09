/* SPDX-License-Identifier: MIT */
/*
 * Cache even Longer 2.1 -- settings persistence.
 *
 * Small wrapper around browser.storage.local. All validation lives in
 * cache-policy.js so the background page, the options page and the tests
 * agree on what a valid settings object looks like.
 */

"use strict";

(function (global) {
  const policy = global.CacheLongerPolicy;
  if (!policy) {
    throw new Error("Cache even Longer: cache-policy.js must load before settings.js");
  }

  const STORAGE_KEY = "settings";

  /** Keep only the user-editable fields; derived values are rebuilt on load. */
  function toStored(settings) {
    const clean = policy.normalizeSettings(settings);
    return {
      enabled: clean.enabled,
      durationDays: clean.durationDays,
      resourceTypes: [...clean.resourceTypes],
      neverShorten: clean.neverShorten,
      respectNoStore: clean.respectNoStore,
      skipSetCookie: clean.skipSetCookie,
      staleWhileRevalidate: clean.staleWhileRevalidate,
      staleWhileRevalidateDays: clean.staleWhileRevalidateDays,
      onlyFingerprinted: clean.onlyFingerprinted,
      debugLogging: clean.debugLogging,
      excludedUrls: clean.excludedUrls,
    };
  }

  async function load() {
    let stored = null;
    try {
      const result = await browser.storage.local.get(STORAGE_KEY);
      stored = result ? result[STORAGE_KEY] : null;
    } catch (error) {
      console.warn("[Cache even Longer] could not read settings; using defaults", error);
    }
    return policy.normalizeSettings(stored);
  }

  async function save(settings) {
    const clean = policy.normalizeSettings(settings);
    await browser.storage.local.set({ [STORAGE_KEY]: toStored(clean) });
    return clean;
  }

  const api = { STORAGE_KEY, toStored, load, save };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.CacheLongerSettings = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
