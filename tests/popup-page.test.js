/* SPDX-License-Identifier: MIT */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.join(__dirname, "..", "src");
const POPUP_DIR = path.join(SRC_DIR, "popup");

const html = fs.readFileSync(path.join(POPUP_DIR, "popup.html"), "utf8");
const script = fs.readFileSync(path.join(POPUP_DIR, "popup.js"), "utf8");
const css = fs.readFileSync(path.join(POPUP_DIR, "popup.css"), "utf8");

function attributeValues(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

test("every ID used by popup.js exists in the popup", () => {
  const used = new Set(attributeValues(script, /getElementById\("([^"]+)"\)/g));
  const defined = new Set(attributeValues(html, /\sid="([^"]+)"/g));

  assert.ok(used.size >= 8);
  for (const id of used) {
    assert.ok(defined.has(id), `popup.js looks up #${id}, but popup.html has no such id`);
  }
});

test("popup labels point at existing controls", () => {
  const labels = attributeValues(html, /<label[^>]*\sfor="([^"]+)"/g);
  const defined = new Set(attributeValues(html, /\sid="([^"]+)"/g));
  assert.ok(labels.length > 0);
  for (const id of labels) {
    assert.ok(defined.has(id), `label references #${id}, which does not exist`);
  }
});

test("all local popup assets resolve", () => {
  const references = attributeValues(html, /(?:src|href)="([^"]+)"/g).filter(
    (reference) => !/^(?:[a-z]+:|#|\/\/)/i.test(reference)
  );
  assert.ok(references.length >= 3);
  for (const reference of references) {
    assert.ok(fs.existsSync(path.resolve(POPUP_DIR, reference)), `missing asset ${reference}`);
  }
});

test("the popup loads its modules and controller in order", () => {
  const sources = attributeValues(html, /<script[^>]*\ssrc="([^"]+)"/g);
  assert.deepEqual(sources, [
    "../lib/cache-policy.js",
    "../lib/settings.js",
    "../lib/site-control.js",
    "popup.js",
  ]);
});

test("the popup has no inline script or event handlers", () => {
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
});

test("popup.js is strict and uses the namespaced modules", () => {
  assert.match(script, /^"use strict";/m);
  assert.match(script, /window\.CacheLongerPolicy/);
  assert.match(script, /window\.CacheLongerSettings/);
  assert.match(script, /window\.CacheLongerSiteControl/);
  assert.match(script, /browser\.tabs\.query/);
  assert.match(script, /browser\.runtime\.openOptionsPage/);
});

test("popup styles cover the controls it creates", () => {
  for (const className of ["header", "site", "quick", "button", "toggle", "message", "link"]) {
    assert.ok(css.includes(`.${className}`), `popup.css should define .${className}`);
  }
});

test("the manifest opens the popup and declares its title", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC_DIR, "manifest.json"), "utf8"));
  assert.equal(manifest.browser_action.default_popup, "popup/popup.html");
  assert.match(manifest.browser_action.default_title, /Site controls/);
});
