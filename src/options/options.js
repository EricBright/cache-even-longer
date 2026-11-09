/* SPDX-License-Identifier: MIT */
/*
 * Cache even Longer 2.1 -- options page controller.
 *
 * Plain DOM code, no framework: the page is small and must keep working in
 * Firefox without any build step.
 */

"use strict";

(function () {
  const policy = window.CacheLongerPolicy;
  const settingsApi = window.CacheLongerSettings;
  const siteApi = window.CacheLongerSiteControl;

  const RESOURCE_TYPES = [
    { id: "image", label: "Images", hint: "Photos, icons, SVG and other image files." },
    { id: "stylesheet", label: "Stylesheets", hint: "CSS files loaded by pages." },
    { id: "script", label: "Scripts", hint: "JavaScript and other executable resources." },
    { id: "font", label: "Fonts", hint: "Web fonts used by pages." },
    { id: "media", label: "Audio and video", hint: "Large files; they still count toward the cache size limit." },
    { id: "xmlhttprequest", label: "XHR and fetch", hint: "API responses. Only enable this if you know the API is static." },
    { id: "other", label: "Other", hint: "Anything else, such as beacons and manifests." },
  ];

  const form = document.getElementById("settings-form");
  const enabledInput = document.getElementById("enabled");
  const durationInput = document.getElementById("duration-days");
  const durationError = document.getElementById("duration-error");
  const swrEnabledInput = document.getElementById("swr-enabled");
  const swrDaysInput = document.getElementById("swr-days");
  const swrError = document.getElementById("swr-error");
  const onlyFingerprintedInput = document.getElementById("only-fingerprinted");
  const neverShortenInput = document.getElementById("never-shorten");
  const respectNoStoreInput = document.getElementById("respect-no-store");
  const skipSetCookieInput = document.getElementById("skip-set-cookie");
  const debugLoggingInput = document.getElementById("debug-logging");
  const excludedUrlsInput = document.getElementById("excluded-urls");
  const importButton = document.getElementById("import-exclusions");
  const importFileInput = document.getElementById("import-exclusions-file");
  const exportButton = document.getElementById("export-exclusions");
  const exportStatus = document.getElementById("export-status");
  const typeContainer = document.getElementById("resource-types");
  const presetButtons = [...document.querySelectorAll(".preset")];
  const profileButtons = [...document.querySelectorAll(".profile")];
  const profileStatus = document.getElementById("profile-status");
  const saveButton = document.getElementById("save-button");
  const resetButton = document.getElementById("reset-button");
  const statusElement = document.getElementById("status");
  const versionElement = document.getElementById("version");

  let typeInputs = new Map();
  let dirty = false;

  function setStatus(message, kind) {
    statusElement.textContent = message;
    statusElement.classList.toggle("is-success", kind === "success");
    statusElement.classList.toggle("is-error", kind === "error");
  }

  function setExportStatus(message, kind) {
    exportStatus.textContent = message;
    exportStatus.classList.toggle("is-error", kind === "error");
  }

  function buildTypeOptions() {
    for (const type of RESOURCE_TYPES) {
      const label = document.createElement("label");
      label.className = "type-option";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "resourceType";
      input.value = type.id;

      const name = document.createElement("span");
      name.className = "type-name";
      name.textContent = type.label;

      const hint = document.createElement("span");
      hint.className = "type-hint";
      hint.textContent = type.hint;

      label.append(input, name, hint);
      typeContainer.append(label);
      typeInputs.set(type.id, input);
    }
  }

  function syncTypeHighlights() {
    for (const input of typeInputs.values()) {
      const option = input.closest(".type-option");
      if (option) option.classList.toggle("is-checked", input.checked);
    }
  }

  function selectedTypes() {
    return [...typeInputs.entries()]
      .filter(([, input]) => input.checked)
      .map(([id]) => id);
  }

  function syncPresets() {
    const days = Number(durationInput.value);
    for (const button of presetButtons) {
      const active = Number(button.dataset.days) === days;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  function syncSwrControls() {
    const enabled = swrEnabledInput.checked;
    swrDaysInput.disabled = !enabled;
    if (!enabled) {
      swrDaysInput.removeAttribute("aria-invalid");
      swrError.textContent = "";
      swrError.hidden = true;
    }
  }

  function validateDuration() {
    const raw = durationInput.value.trim();
    const days = Number(raw);
    const valid =
      raw !== "" &&
      Number.isInteger(days) &&
      days >= 1 &&
      days <= policy.MAX_DURATION_DAYS;

    if (!valid) {
      durationInput.setAttribute("aria-invalid", "true");
      durationError.textContent = `Enter a whole number of days between 1 and ${policy.MAX_DURATION_DAYS}.`;
      durationError.hidden = false;
      return null;
    }

    durationInput.removeAttribute("aria-invalid");
    durationError.textContent = "";
    durationError.hidden = true;
    return days;
  }

  function validateSwrDays() {
    if (!swrEnabledInput.checked) {
      swrDaysInput.removeAttribute("aria-invalid");
      swrError.textContent = "";
      swrError.hidden = true;
      const stored = Number(swrDaysInput.value);
      return Number.isInteger(stored) && stored >= 1 && stored <= policy.MAX_SWR_DAYS
        ? stored
        : policy.DEFAULT_SWR_DAYS;
    }

    const raw = swrDaysInput.value.trim();
    const days = Number(raw);
    const valid =
      raw !== "" &&
      Number.isInteger(days) &&
      days >= 1 &&
      days <= policy.MAX_SWR_DAYS;

    if (!valid) {
      swrDaysInput.setAttribute("aria-invalid", "true");
      swrError.textContent = `Enter a whole number of days between 1 and ${policy.MAX_SWR_DAYS}.`;
      swrError.hidden = false;
      return null;
    }

    swrDaysInput.removeAttribute("aria-invalid");
    swrError.textContent = "";
    swrError.hidden = true;
    return days;
  }

  function readForm() {
    const durationDays = validateDuration();
    if (durationDays === null) {
      durationInput.focus();
      return null;
    }

    const staleWhileRevalidateDays = validateSwrDays();
    if (staleWhileRevalidateDays === null) {
      swrDaysInput.focus();
      return null;
    }

    return {
      enabled: enabledInput.checked,
      durationDays,
      resourceTypes: selectedTypes(),
      neverShorten: neverShortenInput.checked,
      respectNoStore: respectNoStoreInput.checked,
      skipSetCookie: skipSetCookieInput.checked,
      staleWhileRevalidate: swrEnabledInput.checked,
      staleWhileRevalidateDays,
      onlyFingerprinted: onlyFingerprintedInput.checked,
      debugLogging: debugLoggingInput.checked,
      excludedUrls: excludedUrlsInput.value,
    };
  }

  function populate(settings) {
    enabledInput.checked = settings.enabled;
    durationInput.value = String(settings.durationDays);
    neverShortenInput.checked = settings.neverShorten;
    respectNoStoreInput.checked = settings.respectNoStore;
    skipSetCookieInput.checked = settings.skipSetCookie;
    swrEnabledInput.checked = settings.staleWhileRevalidate;
    swrDaysInput.value = String(settings.staleWhileRevalidateDays);
    onlyFingerprintedInput.checked = settings.onlyFingerprinted;
    debugLoggingInput.checked = settings.debugLogging;
    excludedUrlsInput.value = settings.excludedUrls;

    for (const [id, input] of typeInputs) {
      input.checked = settings.resourceTypes.includes(id);
    }
    syncTypeHighlights();
    syncSwrControls();

    dirty = false;
    syncPresets();
    validateDuration();
    validateSwrDays();
  }

  function applyPreset(name) {
    const preset = policy.PRESETS[name];
    if (!preset) return;

    durationInput.value = String(preset.durationDays);
    swrEnabledInput.checked = preset.staleWhileRevalidate;
    swrDaysInput.value = String(preset.staleWhileRevalidateDays);
    onlyFingerprintedInput.checked = preset.onlyFingerprinted;
    neverShortenInput.checked = preset.neverShorten;
    respectNoStoreInput.checked = preset.respectNoStore;
    skipSetCookieInput.checked = preset.skipSetCookie;

    for (const [id, input] of typeInputs) {
      input.checked = preset.resourceTypes.includes(id);
    }

    syncTypeHighlights();
    syncSwrControls();
    syncPresets();
    validateDuration();
    validateSwrDays();
    markDirty();

    const label = name.charAt(0).toUpperCase() + name.slice(1);
    profileStatus.textContent = `${label} profile loaded. Review and press Save settings.`;
  }

  function markDirty() {
    if (dirty) return;
    dirty = true;
    setStatus("Unsaved changes. Press “Save settings” to apply them.", "");
  }

  async function init() {
    if (!policy || !settingsApi || !siteApi) {
      setStatus("Cache even Longer could not load its own scripts. Reload the page or reinstall the add-on.", "error");
      form.querySelectorAll("input, textarea, button").forEach((element) => {
        element.disabled = true;
      });
      enabledInput.disabled = true;
      return;
    }

    buildTypeOptions();
    syncSwrControls();

    try {
      versionElement.textContent = "v" + browser.runtime.getManifest().version;
    } catch (error) {
      versionElement.textContent = "";
    }

    try {
      const settings = await settingsApi.load();
      populate(settings);
    } catch (error) {
      console.error("[Cache even Longer] could not load settings", error);
      setStatus("Could not load saved settings. The defaults are shown.", "error");
      populate(policy.normalizeSettings({}));
    }
  }

  presetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      durationInput.value = button.dataset.days;
      validateDuration();
      syncPresets();
      markDirty();
    });
  });

  profileButtons.forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.preset));
  });

  exportButton.addEventListener("click", () => {
    const count = siteApi.countExclusionPatterns(excludedUrlsInput.value);
    if (count === 0) {
      setExportStatus("No exclusion patterns to export.", "error");
      return;
    }

    const content = siteApi.exclusionsExport(excludedUrlsInput.value);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = siteApi.exclusionsFilename();
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportStatus(`Exported ${count} pattern${count === 1 ? "" : "s"}.`, "success");
  });

  excludedUrlsInput.addEventListener("input", () => setExportStatus("", ""));

  importButton.addEventListener("click", () => importFileInput.click());

  importFileInput.addEventListener("change", async () => {
    const file = importFileInput.files && importFileInput.files[0];
    importFileInput.value = "";
    if (!file) return;

    if (file.size > 256 * 1024) {
      setExportStatus("That file is too large (256 KB limit).", "error");
      return;
    }

    try {
      const text = (await file.text()).replace(/^\uFEFF/, "");
      if (text.includes("\u0000")) {
        setExportStatus("That file does not look like a text exclusion list.", "error");
        return;
      }

      const merged = siteApi.mergeExclusions(excludedUrlsInput.value, text);
      if (merged.added === 0) {
        setExportStatus("No new exclusion patterns found in that file.", "");
        return;
      }

      excludedUrlsInput.value = merged.text;
      markDirty();
      setExportStatus(
        `Imported ${merged.added} pattern${merged.added === 1 ? "" : "s"} from ${file.name}. Review and save.`,
        "success"
      );
      excludedUrlsInput.focus();
    } catch (error) {
      console.error("[Cache even Longer] could not import exclusions", error);
      setExportStatus(`Could not read that file: ${error.message}`, "error");
    }
  });

  enabledInput.addEventListener("change", markDirty);

  durationInput.addEventListener("input", () => {
    durationInput.removeAttribute("aria-invalid");
    durationError.hidden = true;
    syncPresets();
    markDirty();
  });

  swrDaysInput.addEventListener("input", () => {
    swrDaysInput.removeAttribute("aria-invalid");
    swrError.hidden = true;
  });

  form.addEventListener("input", markDirty);
  form.addEventListener("change", () => {
    syncTypeHighlights();
    syncSwrControls();
    markDirty();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const raw = readForm();
    if (!raw) return;

    saveButton.disabled = true;
    setStatus("Saving…", "");

    try {
      const saved = await settingsApi.save(raw);
      populate(saved);
      profileStatus.textContent = "";
      let message = `Saved. New responses are cached for ${saved.durationDays} ${
        saved.durationDays === 1 ? "day" : "days"
      }`;
      if (saved.staleWhileRevalidate) {
        message += `, with a ${saved.staleWhileRevalidateDays}-day stale window`;
      }
      setStatus(`${message}.`, "success");
    } catch (error) {
      console.error("[Cache even Longer] could not save settings", error);
      setStatus(`Could not save settings: ${error.message}`, "error");
    } finally {
      saveButton.disabled = false;
    }
  });

  resetButton.addEventListener("click", async () => {
    if (!window.confirm("Restore all Cache even Longer settings to their defaults?")) return;

    try {
      const saved = await settingsApi.save(policy.DEFAULT_SETTINGS);
      populate(saved);
      profileStatus.textContent = "";
      setStatus("Defaults restored and saved.", "success");
    } catch (error) {
      console.error("[Cache even Longer] could not restore defaults", error);
      setStatus(`Could not restore defaults: ${error.message}`, "error");
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  init();
})();
