/* SPDX-License-Identifier: MIT */
/*
 * Cache even Longer 2.1 -- helpers for the per-site popup.
 *
 * Kept separate from popup.js so the exclusion-list manipulation can be tested
 * in Node without a DOM.
 */

"use strict";

(function (global) {
  /** Return the host[:port] pattern for a web URL, or null if it is not one. */
  function sitePattern(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      return parsed.host || null;
    } catch (error) {
      return null;
    }
  }

  /** Append a pattern unless that exact line already exists. */
  function addExclusion(text, pattern) {
    const wanted = String(pattern || "").trim();
    if (!wanted) return String(text || "");

    const current = String(text || "");
    if (current.split(/\r?\n/).some((line) => line.trim() === wanted)) {
      return current;
    }

    const base = current.trimEnd();
    return base ? `${base}\n${wanted}` : wanted;
  }

  /** Remove every line equal to the pattern, preserving comments and blanks. */
  function removeExclusion(text, pattern) {
    const wanted = String(pattern || "").trim();
    if (!wanted) return String(text || "");
    return String(text || "")
      .split(/\r?\n/)
      .filter((line) => line.trim() !== wanted)
      .join("\n");
  }

  /** Count actual patterns, ignoring blank lines and comments. */
  function countExclusionPatterns(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")).length;
  }

  function isoDate(now) {
    const date = now instanceof Date ? now : new Date(now);
    const value = Number.isFinite(date.getTime()) ? date : new Date();
    return value.toISOString().slice(0, 10);
  }

  /** Plain-text export: a dated comment header plus the exclusion list as-is. */
  function exclusionsExport(text, now = new Date()) {
    const body = String(text || "").trimEnd();
    const header = [
      "# Cache even Longer — excluded sites and URLs",
      `# Exported ${isoDate(now)}`,
      "",
    ].join("\n");
    return body ? `${header}${body}\n` : header;
  }

  function exclusionsFilename(now = new Date()) {
    return `cache-even-longer-exclusions-${isoDate(now)}.txt`;
  }

  /**
   * Merge imported patterns into the current list without destroying comments
   * or existing entries. Headers/comments from the imported file are skipped;
   * exact duplicate patterns are ignored.
   */
  function mergeExclusions(current, imported) {
    const currentText = String(current || "").trimEnd();
    const existing = new Set(
      currentText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    );

    const additions = [];
    for (const raw of String(imported || "").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || existing.has(line)) continue;
      existing.add(line);
      additions.push(line);
    }

    return {
      text: additions.length
        ? currentText
          ? `${currentText}\n${additions.join("\n")}`
          : additions.join("\n")
        : currentText,
      added: additions.length,
    };
  }

  const api = {
    sitePattern,
    addExclusion,
    removeExclusion,
    countExclusionPatterns,
    exclusionsExport,
    exclusionsFilename,
    mergeExclusions,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.CacheLongerSiteControl = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
