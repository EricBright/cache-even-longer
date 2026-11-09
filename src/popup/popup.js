/* SPDX-License-Identifier: MIT */
/*
 * Cache even Longer 2.1 -- toolbar popup controller.
 *
 * The popup is a quick status/control surface; the full policy editor remains
 * in options.html. It needs the host permissions already granted to webRequest
 * to read the active tab's URL; no `tabs` permission is required for http(s).
 */

"use strict";

(function () {
  const policy = window.CacheLongerPolicy;
  const settingsApi = window.CacheLongerSettings;
  const siteApi = window.CacheLongerSiteControl;

  const enabledInput = document.getElementById("enabled");
  const summary = document.getElementById("summary");
  const siteHost = document.getElementById("site-host");
  const siteStatus = document.getElementById("site-status");
  const siteToggle = document.getElementById("site-toggle");
  const lifetimeSelect = document.getElementById("lifetime");
  const policySummary = document.getElementById("policy-summary");
  const message = document.getElementById("message");
  const openSettings = document.getElementById("open-settings");
  const version = document.getElementById("version");

  const LIFETIME_OPTIONS = [30, 90, 180, 365];

  let settings = null;
  let activeUrl = "";
  let activePattern = null;
  let excludedBy = null;
  let busy = false;

  function setMessage(text, kind) {
    message.textContent = text || "";
    message.classList.toggle("is-success", kind === "success");
    message.classList.toggle("is-error", kind === "error");
  }

  function setBusy(value) {
    busy = value;
    enabledInput.disabled = value;
    lifetimeSelect.disabled = value;
    siteToggle.disabled = value || !activePattern;
  }

  function describePolicy(policySettings) {
    const parts = [`${policySettings.durationDays} days`];
    if (policySettings.staleWhileRevalidate) {
      parts.push(`stale ${policySettings.staleWhileRevalidateDays}d`);
    }
    if (policySettings.onlyFingerprinted) parts.push("fingerprinted only");
    return parts.join(" · ");
  }

  function renderSite() {
    if (!activePattern) {
      siteHost.textContent = "Not a website";
      siteStatus.textContent = "This page is not an HTTP(S) site; there is nothing to exclude.";
      siteToggle.textContent = "Nothing to exclude";
      siteToggle.disabled = true;
      return;
    }

    siteHost.textContent = activePattern;

    if (!settings.enabled) {
      siteStatus.textContent = "Extension is paused.";
    } else if (excludedBy) {
      siteStatus.textContent = `Excluded by “${excludedBy}”.`;
    } else {
      siteStatus.textContent = "Active on this site.";
    }

    siteToggle.textContent = excludedBy ? "Include this site" : "Exclude this site";
    siteToggle.disabled = busy;
  }

  function renderLifetime() {
    const values = [...new Set([...LIFETIME_OPTIONS, settings.durationDays])].sort(
      (a, b) => a - b
    );
    lifetimeSelect.replaceChildren();

    for (const days of values) {
      const option = document.createElement("option");
      option.value = String(days);
      option.textContent = days === 365 ? "1 year (365 days)" : `${days} days`;
      option.selected = days === settings.durationDays;
      lifetimeSelect.append(option);
    }
    lifetimeSelect.value = String(settings.durationDays);

    const bits = [];
    if (settings.staleWhileRevalidate) {
      bits.push(`stale window ${settings.staleWhileRevalidateDays} days`);
    }
    bits.push(
      settings.onlyFingerprinted ? "fingerprinted URLs only" : "selected resource types"
    );
    if (settings.resourceTypes.length === 0) bits.push("no types selected");
    policySummary.textContent = bits.join(" · ");
  }

  function render() {
    if (!settings) return;
    enabledInput.checked = settings.enabled;
    summary.textContent = settings.enabled ? describePolicy(settings) : "Paused";
    renderSite();
    renderLifetime();
  }

  async function persist(patch, successMessage) {
    if (!settings) return;
    const next = policy.normalizeSettings({ ...settings, ...patch });

    setBusy(true);
    setMessage("Saving…", "");
    try {
      settings = await settingsApi.save(next);
      excludedBy = activePattern ? policy.matchExclusion(activeUrl, settings) : null;
      render();
      setMessage(successMessage, "success");
    } catch (error) {
      setMessage(`Could not save: ${error.message}`, "error");
      render();
    } finally {
      setBusy(false);
    }
  }

  async function init() {
    if (!policy || !settingsApi || !siteApi) {
      setMessage("Could not load the add-on scripts. Reload the popup.", "error");
      enabledInput.disabled = true;
      siteToggle.disabled = true;
      lifetimeSelect.disabled = true;
      return;
    }

    try {
      version.textContent = "v" + browser.runtime.getManifest().version;
    } catch (error) {
      version.textContent = "";
    }

    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      activeUrl = (tabs[0] && tabs[0].url) || "";
    } catch (error) {
      activeUrl = "";
    }
    activePattern = activeUrl ? siteApi.sitePattern(activeUrl) : null;

    settings = await settingsApi.load();
    excludedBy = activePattern ? policy.matchExclusion(activeUrl, settings) : null;
    render();
  }

  enabledInput.addEventListener("change", () => {
    persist(
      { enabled: enabledInput.checked },
      enabledInput.checked ? "Enabled." : "Paused."
    );
  });

  siteToggle.addEventListener("click", () => {
    if (!settings || !activePattern) return;

    if (excludedBy) {
      persist(
        { excludedUrls: siteApi.removeExclusion(settings.excludedUrls, excludedBy) },
        `Removed the “${excludedBy}” exclusion.`
      );
    } else {
      persist(
        { excludedUrls: siteApi.addExclusion(settings.excludedUrls, activePattern) },
        `Excluded ${activePattern}. Already-cached files keep their current lifetime.`
      );
    }
  });

  lifetimeSelect.addEventListener("change", () => {
    const days = Number(lifetimeSelect.value);
    if (!Number.isInteger(days) || days < 1) return;
    persist({ durationDays: days }, `Cache lifetime set to ${days} days.`);
  });

  openSettings.addEventListener("click", () => {
    browser.runtime.openOptionsPage().catch((error) => {
      setMessage(`Could not open settings: ${error.message}`, "error");
    });
  });

  init();
})();
