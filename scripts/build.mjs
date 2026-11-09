#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
/*
 * Build and validate the Cache even Longer XPI.
 *
 *   node scripts/build.mjs           # validate, then write dist/cache_even_longer-<version>.xpi
 *   node scripts/build.mjs --check   # validate only, write nothing
 *
 * The XPI is an unsigned ZIP. It is meant for temporary installation through
 * about:debugging or for signing with `web-ext sign`.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");
const CHECK_ONLY = process.argv.includes("--check");

const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (entry.isFile()) {
      files.push(full);
    } else {
      fail(`unsupported filesystem entry: ${path.relative(ROOT, full)}`);
    }
  }
  return files.sort();
}

function requireFile(relativePath, label) {
  const full = path.join(SRC, relativePath);
  if (!existsSync(full)) {
    fail(`${label}: missing file ${relativePath}`);
    return false;
  }
  return true;
}

function checkScriptSyntax(files) {
  for (const file of files.filter((name) => name.endsWith(".js"))) {
    try {
      execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    } catch (error) {
      const output = String(error.stderr || error.message).trim();
      fail(`JavaScript syntax error in ${path.relative(ROOT, file)}\n${output}`);
    }
  }
}

function checkManifest(files) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(SRC, "manifest.json"), "utf8"));
  } catch (error) {
    fail(`manifest.json is not valid JSON: ${error.message}`);
    return null;
  }

  if (manifest.manifest_version !== 2) {
    fail("manifest_version must be 2 (blocking webRequest is required)");
  }
  for (const key of ["name", "version", "description"]) {
    if (typeof manifest[key] !== "string" || manifest[key].trim() === "") {
      fail(`manifest.${key} must be a non-empty string`);
    }
  }
  if (!/^\d{1,4}(\.\d{1,4}){0,3}$/.test(String(manifest.version))) {
    fail(`manifest.version "${manifest.version}" is not a valid Firefox version`);
  }

  const gecko = manifest.browser_specific_settings?.gecko;
  const id = typeof gecko?.id === "string" ? gecko.id : "";
  const validId =
    /^[a-zA-Z0-9._-]*@[a-zA-Z0-9._-]+$/.test(id) ||
    /^\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}$/.test(id);
  if (!validId) {
    fail(
      "browser_specific_settings.gecko.id must be an email-style ID or a braced GUID"
    );
  }
  if (!gecko?.strict_min_version) {
    warn("browser_specific_settings.gecko.strict_min_version is not set");
  }
  const requiredData = gecko?.data_collection_permissions?.required;
  if (!Array.isArray(requiredData) || !requiredData.includes("none")) {
    fail(
      "browser_specific_settings.gecko.data_collection_permissions.required must include \"none\" (AMO requirement since November 2025)"
    );
  }

  const permissions = new Set(manifest.permissions || []);
  for (const permission of ["storage", "webRequest", "webRequestBlocking"]) {
    if (!permissions.has(permission)) fail(`manifest.permissions is missing "${permission}"`);
  }
  if (!permissions.has("http://*/*") || !permissions.has("https://*/*")) {
    fail("manifest.permissions must include http://*/* and https://*/*");
  }
  if (permissions.has("<all_urls>")) {
    warn("<all_urls> is broader than needed; prefer http://*/* and https://*/*");
  }

  const scripts = manifest.background?.scripts;
  if (!Array.isArray(scripts) || scripts.length === 0) {
    fail("manifest.background.scripts must list the background scripts");
  } else {
    for (const script of scripts) requireFile(script, "background script");
  }

  const optionsPage = manifest.options_ui?.page;
  if (typeof optionsPage !== "string") {
    fail("manifest.options_ui.page is required");
  } else if (requireFile(optionsPage, "options page")) {
    checkPageReferences(path.join(SRC, optionsPage));
  }

  for (const [size, iconPath] of Object.entries(manifest.icons || {})) {
    if (requireFile(iconPath, `icon ${size}`)) {
      const dimensions = pngDimensions(path.join(SRC, iconPath));
      if (dimensions && Number(size) !== dimensions.width) {
        warn(`icon ${iconPath} is ${dimensions.width}px wide but declared as ${size}px`);
      }
    }
  }

  if (!manifest.icons || Object.keys(manifest.icons).length === 0) {
    warn("manifest.icons is empty");
  }

  const action = manifest.browser_action;
  if (!action) {
    fail("manifest.browser_action is required for the settings toolbar button");
  } else {
    const actionIcons = action.default_icon;
    if (typeof actionIcons === "string") {
      requireFile(actionIcons, "browser action icon");
    } else {
      for (const [size, iconPath] of Object.entries(actionIcons || {})) {
        if (requireFile(iconPath, `browser action icon ${size}`)) {
          const dimensions = pngDimensions(path.join(SRC, iconPath));
          if (dimensions && Number(size) !== dimensions.width) {
            warn(
              `browser action icon ${iconPath} is ${dimensions.width}px wide but declared as ${size}px`
            );
          }
        }
      }
    }
    if (!action.default_title) warn("manifest.browser_action.default_title is empty");

    const popupPage = action.default_popup;
    if (typeof popupPage !== "string") {
      fail("manifest.browser_action.default_popup is required for the site-control popup");
    } else if (requireFile(popupPage, "popup page")) {
      checkPageReferences(path.join(SRC, popupPage));
    }
  }

  const relativeFiles = new Set(files.map((file) => path.relative(SRC, file).split(path.sep).join("/")));
  for (const script of scripts || []) {
    if (!relativeFiles.has(script)) fail(`background script ${script} is not in the source tree`);
  }

  return manifest;
}

function checkPageReferences(pagePath) {
  const html = readFileSync(pagePath, "utf8");
  const directory = path.dirname(pagePath);
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const reference = match[1];
    if (/^(?:[a-z]+:|#|\/\/)/i.test(reference)) continue;
    const resolved = path.resolve(directory, reference);
    if (!existsSync(resolved)) {
      fail(`options page references missing file: ${reference}`);
    }
  }
}

function pngDimensions(filePath) {
  try {
    const buffer = readFileSync(filePath);
    if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  } catch (error) {
    return null;
  }
}

function checkLicense() {
  const rootLicense = path.join(ROOT, "LICENSE");
  const packagedLicense = path.join(SRC, "LICENSE");

  if (!existsSync(rootLicense)) fail("LICENSE is missing from the repository root");
  if (!existsSync(packagedLicense)) {
    fail("src/LICENSE is missing; the MIT notice must ship inside the XPI");
    return;
  }
  if (
    existsSync(rootLicense) &&
    readFileSync(rootLicense, "utf8") !== readFileSync(packagedLicense, "utf8")
  ) {
    fail("src/LICENSE has drifted from LICENSE; keep the packaged copy identical");
  }
}

function checkForbiddenEntries(files) {
  const forbiddenDirectories = new Set(["__MACOSX", "META-INF", ".git", ".svn"]);
  for (const file of files) {
    const relative = path.relative(SRC, file);
    const parts = relative.split(path.sep);
    if (parts.some((part) => forbiddenDirectories.has(part))) {
      fail(`forbidden path in package: ${relative}`);
    }
    if (/^(?:\.DS_Store|Thumbs\.db)$/.test(parts.at(-1))) {
      fail(`forbidden file in package: ${relative}`);
    }
    if (/\.(?:xpi|zip|log)$/i.test(relative)) {
      warn(`build artifact inside src/: ${relative}`);
    }
  }
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function main() {
  if (!existsSync(SRC)) {
    console.error(`Source directory not found: ${SRC}`);
    process.exit(1);
  }

  const files = walk(SRC);
  checkLicense();
  checkForbiddenEntries(files);
  checkScriptSyntax(files);
  const manifest = checkManifest(files);

  if (errors.length > 0) {
    for (const message of errors) console.error(`ERROR  ${message}`);
    for (const message of warnings) console.warn(`WARN   ${message}`);
    console.error(`\nValidation failed with ${errors.length} error(s).`);
    process.exit(1);
  }

  for (const message of warnings) console.warn(`WARN   ${message}`);

  const sourceBytes = files.reduce((total, file) => total + statSync(file).size, 0);
  console.log(`${manifest.name} ${manifest.version}`);
  console.log(`  source : src/ (${files.length} files, ${humanSize(sourceBytes)})`);
  console.log(
    `  check  : manifest, ${files.filter((f) => f.endsWith(".js")).length} scripts, options page, popup, icons, toolbar button`
  );

  if (CHECK_ONLY) {
    console.log("  result : OK (check only, no package written)");
    return;
  }

  if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true });
  const artifactBase = manifest.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const output = path.join(DIST, `${artifactBase}-${manifest.version}.xpi`);
  try {
    execFileSync("zip", ["-r", "-X", "-q", output, ".", "-x", "*.DS_Store", "-x", "__MACOSX/*"], {
      cwd: SRC,
      stdio: "pipe",
    });
  } catch (error) {
    console.error(`Could not create the XPI. Is the "zip" command installed?\n${error.message}`);
    process.exit(1);
  }

  const entries = execFileSync("unzip", ["-Z1", output], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  if (!entries.includes("manifest.json")) {
    console.error("Built archive does not contain manifest.json at its root.");
    process.exit(1);
  }

  // Keep a checksum next to the artifact so builds can be compared.
  const digest = execFileSync("sha256sum", [output], { encoding: "utf8" }).split(/\s+/)[0];
  writeFileSync(`${output}.sha256`, `${digest}  ${path.basename(output)}\n`);

  console.log(`  output : dist/${path.basename(output)} (${humanSize(statSync(output).size)}, ${entries.length} entries)`);
  console.log(`  sha256 : ${digest}`);
  console.log("  result : OK (unsigned; see docs/INSTALL.md for install and signing)");
}

main();
