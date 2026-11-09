/* SPDX-License-Identifier: MIT */
"use strict";

/*
 * Structural checks for the options page. These do not emulate a DOM; they
 * catch the failure mode that matters most without a browser: an element ID or
 * asset reference that the controller expects but the page does not provide.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const OPTIONS_DIR = path.join(__dirname, "..", "src", "options");
const SRC_DIR = path.join(__dirname, "..", "src");

const html = fs.readFileSync(path.join(OPTIONS_DIR, "options.html"), "utf8");
const script = fs.readFileSync(path.join(OPTIONS_DIR, "options.js"), "utf8");
const css = fs.readFileSync(path.join(OPTIONS_DIR, "options.css"), "utf8");

function attributeValues(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

test("every ID used by options.js exists in the page", () => {
  const used = new Set(attributeValues(script, /getElementById\("([^"]+)"\)/g));
  const defined = new Set(attributeValues(html, /\sid="([^"]+)"/g));

  assert.ok(used.size >= 10, "expected the controller to look up several elements");
  for (const id of used) {
    assert.ok(defined.has(id), `options.js looks up #${id}, but options.html has no such id`);
  }
});

test("every label's for attribute points at an existing control", () => {
  const labels = attributeValues(html, /<label[^>]*\sfor="([^"]+)"/g);
  const defined = new Set(attributeValues(html, /\sid="([^"]+)"/g));
  assert.ok(labels.length > 0);
  for (const id of labels) {
    assert.ok(defined.has(id), `label references #${id}, which does not exist`);
  }
});

test("all local asset references in the page resolve", () => {
  const references = attributeValues(html, /(?:src|href)="([^"]+)"/g).filter(
    (reference) => !/^(?:[a-z]+:|#|\/\/)/i.test(reference)
  );
  assert.ok(references.length >= 3);
  for (const reference of references) {
    const resolved = path.resolve(OPTIONS_DIR, reference);
    assert.ok(fs.existsSync(resolved), `missing local asset: ${reference}`);
  }
});

test("the page loads policy, settings and controller in that order", () => {
  const sources = attributeValues(html, /<script[^>]*\ssrc="([^"]+)"/g);
  assert.deepEqual(sources, [
    "../lib/cache-policy.js",
    "../lib/settings.js",
    "../lib/site-control.js",
    "options.js",
  ]);
});

test("the options page has no inline script or inline event handlers", () => {
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i, "inline <script> would violate the default CSP");
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, "inline event handlers would violate the default CSP");
});

test("options.js runs in strict mode and uses the namespaced modules", () => {
  assert.match(script, /^"use strict";/m);
  assert.match(script, /window\.CacheLongerPolicy/);
  assert.match(script, /window\.CacheLongerSettings/);
});

test("the stylesheet styles the elements the controller creates", () => {
  for (const className of [
    "type-option",
    "type-name",
    "type-hint",
    "preset",
    "profile",
    "profile-grid",
    "swr-row",
    "exclusion-actions",
    "export-status",
    "status",
  ]) {
    assert.ok(css.includes(`.${className}`), `options.css should define .${className}`);
  }
});

test("profile buttons map to policy presets", () => {
  const policy = require("../src/lib/cache-policy.js");
  const presets = [...html.matchAll(/data-preset="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(presets.sort(), Object.keys(policy.PRESETS).sort());
});

test("the manifest names the fork and exposes a settings toolbar button", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC_DIR, "manifest.json"), "utf8"));
  assert.equal(manifest.name, "Cache even Longer");
  assert.match(manifest.description, /fork of Cache Longer/);
  assert.ok(manifest.browser_action, "browser_action is required for the toolbar button");
  assert.match(manifest.browser_action.default_title, /Site controls/);
  assert.equal(manifest.browser_action.default_popup, "popup/popup.html");
  assert.ok(fs.existsSync(path.join(SRC_DIR, manifest.browser_action.default_popup)));

  const icons = manifest.browser_action.default_icon;
  for (const [size, iconPath] of Object.entries(icons)) {
    assert.ok(fs.existsSync(path.join(SRC_DIR, iconPath)), `missing toolbar icon ${size}`);
  }
});

test("the options page uses the renamed add-on in its title and heading", () => {
  assert.match(html, /<title>Cache even Longer — Settings<\/title>/);
  assert.match(html, /<h1>Cache even Longer<\/h1>/);
});

test("the manifest points at the options page that exists", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC_DIR, "manifest.json"), "utf8"));
  assert.equal(manifest.options_ui.page, "options/options.html");
  assert.ok(fs.existsSync(path.join(SRC_DIR, manifest.options_ui.page)));
});
