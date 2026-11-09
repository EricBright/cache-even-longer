/* SPDX-License-Identifier: MIT */
"use strict";

/*
 * Integration tests for the background page and settings storage.
 *
 * A tiny fake `browser` object is injected into a VM context, then the three
 * real source files are executed in the same order as the manifest lists them.
 * This catches wiring mistakes that pure policy tests cannot see.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = path.join(__dirname, "..", "src");
const SCRIPT_FILES = ["lib/cache-policy.js", "lib/settings.js", "background.js"];
const SCRIPTS = SCRIPT_FILES.map((file) => ({
  file,
  source: fs.readFileSync(path.join(SRC, file), "utf8"),
}));

function makeDetails(overrides = {}) {
  return {
    method: "GET",
    type: "image",
    statusCode: 200,
    url: "https://example.com/assets/logo.png",
    responseHeaders: [{ name: "Cache-Control", value: "max-age=60" }],
    ...overrides,
  };
}

function headerValue(headers, name) {
  const found = headers.filter((h) => h.name.toLowerCase() === name);
  assert.equal(found.length, 1, `expected one ${name} header`);
  return found[0].value;
}

async function createHarness(storedSettings, options = {}) {
  const state = {
    storage: { settings: storedSettings === undefined ? undefined : structuredClone(storedSettings) },
    storageError: options.storageError || null,
    headersListener: null,
    storageListeners: [],
    filter: null,
    extraInfoSpec: null,
    consoleErrors: [],
    consoleWarnings: [],
  };

  const browser = {
    storage: {
      local: {
        async get(key) {
          if (state.storageError) throw state.storageError;
          return { [key]: state.storage[key] };
        },
        async set(values) {
          Object.assign(state.storage, values);
        },
      },
      onChanged: {
        addListener(listener) {
          state.storageListeners.push(listener);
        },
      },
    },
    webRequest: {
      onHeadersReceived: {
        addListener(listener, filter, extraInfoSpec) {
          state.headersListener = listener;
          state.filter = filter;
          state.extraInfoSpec = extraInfoSpec;
        },
      },
    },
  };

  const sandbox = {
    browser,
    console: {
      debug() {},
      info() {},
      log() {},
      warn(...args) {
        state.consoleWarnings.push(args);
      },
      error(...args) {
        state.consoleErrors.push(args);
      },
    },
  };
  vm.createContext(sandbox);

  for (const script of SCRIPTS) {
    vm.runInContext(script.source, sandbox, { filename: script.file });
  }

  // Let the asynchronous settings load settle and the listener register.
  for (let attempt = 0; attempt < 50 && !state.headersListener; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.ok(state.headersListener, "background page should register a listener");

  return {
    state,
    sandbox,
    invoke(details) {
      return state.headersListener(details);
    },
  };
}

test("registers a blocking listener for http(s) URLs", async () => {
  const harness = await createHarness({});
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.state.filter)),
    { urls: ["http://*/*", "https://*/*"] }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.state.extraInfoSpec)),
    ["blocking", "responseHeaders"]
  );
});

test("rewrites a response using default settings", async () => {
  const harness = await createHarness(undefined);
  const result = harness.invoke(makeDetails());
  assert.ok(result, "listener should return a BlockingResponse");
  assert.equal(headerValue(result.responseHeaders, "cache-control"), "max-age=15552000");
});

test("honours a stored duration", async () => {
  const harness = await createHarness({ durationDays: 7 });
  const result = harness.invoke(makeDetails());
  assert.equal(headerValue(result.responseHeaders, "cache-control"), "max-age=604800");
});

test("returns undefined when the extension is disabled", async () => {
  const harness = await createHarness({ enabled: false });
  assert.equal(harness.invoke(makeDetails()), undefined);
});

test("returns undefined for responses that are not rewritten", async () => {
  const harness = await createHarness({});
  assert.equal(harness.invoke(makeDetails({ statusCode: 404 })), undefined);
  assert.equal(harness.invoke(makeDetails({ type: "main_frame" })), undefined);
});

test("storage changes apply immediately without a restart", async () => {
  const harness = await createHarness({});
  assert.ok(harness.invoke(makeDetails()));

  harness.state.storageListeners[0](
    { settings: { newValue: { enabled: false } } },
    "local"
  );
  assert.equal(harness.invoke(makeDetails()), undefined);

  harness.state.storageListeners[0](
    { settings: { newValue: { enabled: true, durationDays: 1 } } },
    "local"
  );
  assert.equal(
    headerValue(harness.invoke(makeDetails()).responseHeaders, "cache-control"),
    "max-age=86400"
  );
});

test("changes in other storage areas are ignored", async () => {
  const harness = await createHarness({});
  harness.state.storageListeners[0](
    { settings: { newValue: { enabled: false } } },
    "sync"
  );
  assert.ok(harness.invoke(makeDetails()));
});

test("a storage failure falls back to defaults and still registers", async () => {
  const harness = await createHarness(undefined, { storageError: new Error("quota") });
  assert.ok(harness.state.consoleWarnings.length >= 1, "load failure should be reported");
  const result = harness.invoke(makeDetails());
  assert.equal(headerValue(result.responseHeaders, "cache-control"), "max-age=15552000");
});

test("settings.save stores only user-editable fields and round-trips", async () => {
  const harness = await createHarness({});
  const settings = harness.sandbox.CacheLongerSettings;

  const saved = await settings.save({
    durationDays: 30,
    resourceTypes: ["image"],
    excludedUrls: "example.com",
    debugLogging: true,
  });
  assert.equal(saved.durationSeconds, 30 * 86400);

  const stored = harness.state.storage.settings;
  assert.deepEqual(Object.keys(stored).sort(), [
    "debugLogging",
    "durationDays",
    "enabled",
    "excludedUrls",
    "neverShorten",
    "onlyFingerprinted",
    "resourceTypes",
    "respectNoStore",
    "skipSetCookie",
    "staleWhileRevalidate",
    "staleWhileRevalidateDays",
  ]);
  assert.equal(stored.durationSeconds, undefined);
  assert.equal(stored.excludeMatchers, undefined);

  const loaded = await settings.load();
  assert.equal(loaded.durationDays, 30);
  assert.deepEqual([...loaded.resourceTypes], ["image"]);
  assert.equal(loaded.excludeMatchers.length, 1);
});

test("settings.load normalises malformed stored data", async () => {
  const harness = await createHarness({
    durationDays: -4,
    resourceTypes: ["image", "not-a-type"],
    enabled: "yes",
  });
  const loaded = await harness.sandbox.CacheLongerSettings.load();
  assert.equal(loaded.durationDays, 1);
  assert.deepEqual([...loaded.resourceTypes], ["image"]);
  assert.equal(loaded.enabled, true);
});
