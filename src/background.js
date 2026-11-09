/* SPDX-License-Identifier: MIT */
/*
 * Cache even Longer 2.1 -- background event page.
 *
 * Registers one blocking onHeadersReceived listener and delegates every
 * decision to cache-policy.js. Settings are cached in memory because a
 * blocking listener must answer synchronously; the cache is refreshed from
 * storage.onChanged, so saving the options page takes effect immediately.
 */

"use strict";

(function (global) {
  const policy = global.CacheLongerPolicy;
  const settingsApi = global.CacheLongerSettings;
  if (!policy || !settingsApi) {
    console.error("[Cache even Longer] required modules did not load");
    return;
  }

  const { normalizeSettings, planHeaderChanges } = policy;

  /** Logs the reasons that are actually interesting when debugging. */
  const QUIET_REASONS = new Set(["resource-type", "served-from-cache", "disabled"]);

  let settings = normalizeSettings({});
  let settingsRevision = 0;
  let listenerRegistered = false;

  function log(...args) {
    if (settings.debugLogging) console.debug("[Cache even Longer]", ...args);
  }

  function onHeadersReceived(details) {
    try {
      const plan = planHeaderChanges(details, settings, Date.now());

      if (!plan.changed) {
        if (!QUIET_REASONS.has(plan.reason)) {
          log("skip", plan.reason, details && details.url);
        }
        return undefined;
      }

      log(
        "extend",
        details.url,
        `${plan.previousLifetime}s remaining; max-age ${plan.newMaxAge}s`,
        plan.cacheControl
      );
      return { responseHeaders: plan.headers };
    } catch (error) {
      // A broken response must never take the request down with it.
      console.error("[Cache even Longer] failed to inspect response", details && details.url, error);
      return undefined;
    }
  }

  function registerListener() {
    if (listenerRegistered) return;
    browser.webRequest.onHeadersReceived.addListener(
      onHeadersReceived,
      { urls: ["http://*/*", "https://*/*"] },
      ["blocking", "responseHeaders"]
    );
    listenerRegistered = true;
    log("listener registered");
  }

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes || !changes.settings) return;
    settingsRevision += 1;
    settings = normalizeSettings(changes.settings.newValue);
    log("settings updated", settings);
  });

  // Wait for stored settings before registering so a user who has disabled the
  // extension never gets a few rewritten responses during startup.
  settingsApi
    .load()
    .then((loaded) => {
      if (settingsRevision === 0) settings = loaded;
      log("settings loaded", settings);
    })
    .catch((error) => {
      console.error("[Cache even Longer] could not load settings; using defaults", error);
    })
    .finally(registerListener);
})(typeof globalThis !== "undefined" ? globalThis : this);
