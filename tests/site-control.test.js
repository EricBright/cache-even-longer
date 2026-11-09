/* SPDX-License-Identifier: MIT */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const site = require("../src/lib/site-control.js");

test("sitePattern returns host and port for web URLs only", () => {
  assert.equal(site.sitePattern("https://example.com/path"), "example.com");
  assert.equal(site.sitePattern("http://example.com:8787/path"), "example.com:8787");
  assert.equal(site.sitePattern("https://sub.example.com/"), "sub.example.com");
  assert.equal(site.sitePattern("about:preferences"), null);
  assert.equal(site.sitePattern("file:///tmp/page.html"), null);
  assert.equal(site.sitePattern("not a url"), null);
});

test("addExclusion appends a host pattern once", () => {
  assert.equal(site.addExclusion("", "example.com"), "example.com");
  assert.equal(site.addExclusion("example.com", "example.com"), "example.com");
  assert.equal(
    site.addExclusion("# comment\nexample.org\n", "example.com"),
    "# comment\nexample.org\nexample.com"
  );
});

test("removeExclusion removes only the exact pattern line", () => {
  const text = "# comment\nexample.com\nexample.org\n\nexample.com";
  assert.equal(site.removeExclusion(text, "example.com"), "# comment\nexample.org\n");
  assert.equal(site.removeExclusion(text, "missing.com"), text);
  assert.equal(site.removeExclusion("", "example.com"), "");
});

test("countExclusionPatterns ignores comments and blank lines", () => {
  assert.equal(site.countExclusionPatterns(""), 0);
  assert.equal(site.countExclusionPatterns("# comment\n\nexample.com\n*.example.org"), 2);
});

test("exclusionsExport adds a dated header and preserves the list", () => {
  const date = new Date("2026-11-09T12:00:00Z");
  const content = site.exclusionsExport("# keep\nexample.com", date);
  assert.match(content, /^# Cache even Longer/);
  assert.match(content, /# Exported 2026-11-09/);
  assert.match(content, /# keep\nexample\.com\n$/);
  assert.equal(site.exclusionsFilename(date), "cache-even-longer-exclusions-2026-11-09.txt");
});

test("mergeExclusions appends only new patterns and preserves current comments", () => {
  const merged = site.mergeExclusions(
    "example.com\n# keep this\n",
    "# exported header\nexample.com\nexample.org\nexample.org\n"
  );
  assert.equal(merged.added, 1);
  assert.equal(merged.text, "example.com\n# keep this\nexample.org");

  const duplicate = site.mergeExclusions("example.com", "example.com");
  assert.equal(duplicate.added, 0);
  assert.equal(duplicate.text, "example.com");

  const empty = site.mergeExclusions("", "example.org\n# comment");
  assert.equal(empty.added, 1);
  assert.equal(empty.text, "example.org");

  const commentsOnly = site.mergeExclusions("example.com", "# just a comment");
  assert.equal(commentsOnly.added, 0);
  assert.equal(commentsOnly.text, "example.com");
});
