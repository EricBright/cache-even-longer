#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
/*
 * Local fixture server for manually testing Cache even Longer in Firefox.
 *
 *   node scripts/test-server.mjs        (or: npm run test-server)
 *   PORT=9000 node scripts/test-server.mjs
 *
 * Open http://127.0.0.1:8787/ and follow the table on the page. DevTools ->
 * Network -> select a request -> Response Headers shows what the extension
 * actually sent to the browser cache.
 *
 * The server intentionally sends a different cache policy on every route so
 * every branch of the extension's decision logic can be exercised by hand.
 * It is a development tool and is not part of the packaged extension.
 */

import { createServer } from "node:http";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const LOGO = Date.now();

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Cache even Longer test page</title>
  <link rel="stylesheet" href="/style.css">
  <script src="/script.js" defer></script>
</head>
<body>
  <h1>Cache even Longer test page</h1>
  <p class="lead">
    Open DevTools &rarr; Network, reload with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>,
    then click a request and inspect <strong>Response Headers</strong>.
  </p>

  <p id="script-status">Waiting for script.js&hellip;</p>
  <img src="/image.svg" width="96" height="96" alt="Test image">
  <img src="/image.4f3c2a91.svg" width="96" height="96" alt="Fingerprinted test image">

  <h2>Routes and expected behaviour</h2>
  <table>
    <thead><tr><th>Route</th><th>Server sends</th><th>Extension should</th></tr></thead>
    <tbody>
      <tr><td><a href="/style.css">/style.css</a></td><td>max-age=60</td><td>extend to your configured lifetime</td></tr>
      <tr><td><a href="/script.js">/script.js</a></td><td>max-age=60</td><td>extend</td></tr>
      <tr><td><a href="/image.svg">/image.svg</a></td><td>max-age=3600</td><td>extend</td></tr>
      <tr><td><a href="/style.4f3c2a91.css">/style.4f3c2a91.css</a></td><td>max-age=60</td><td>extend; survives “fingerprinted only”</td></tr>
      <tr><td><a href="/must-revalidate.css">/must-revalidate.css</a></td><td>max-age=60, must-revalidate</td><td>extend; with SWR on, drop must-revalidate</td></tr>
      <tr><td><a href="/aged.css">/aged.css</a></td><td>max-age=60, Age: 3600</td><td>extend; max-age includes Age</td></tr>
      <tr><td><a href="/image.4f3c2a91.svg">/image.4f3c2a91.svg</a></td><td>max-age=3600</td><td>extend; survives “fingerprinted only”</td></tr>
      <tr><td><a href="/long.js">/long.js</a></td><td>max-age=31536000, immutable</td><td>leave alone (already longer)</td></tr>
      <tr><td><a href="/expires-only.svg">/expires-only.svg</a></td><td>Expires only</td><td>extend</td></tr>
      <tr><td><a href="/private.json">/private.json</a></td><td>private, max-age=60</td><td>extend but keep <code>private</code></td></tr>
      <tr><td><a href="/no-store.json">/no-store.json</a></td><td>no-store</td><td>leave alone</td></tr>
      <tr><td><a href="/cookie.json">/cookie.json</a></td><td>Set-Cookie + max-age=60</td><td>leave alone</td></tr>
      <tr><td><a href="/vary-star.json">/vary-star.json</a></td><td>Vary: *</td><td>leave alone</td></tr>
      <tr><td><a href="/error-404.json">/error-404.json</a></td><td>404 + max-age=60</td><td>leave alone</td></tr>
      <tr><td><a href="/partial.bin">/partial.bin</a></td><td>206 + Content-Range</td><td>leave alone</td></tr>
      <tr><td><a href="/api/data.json">/api/data.json</a></td><td>max-age=0</td><td>leave alone unless XHR/fetch is enabled</td></tr>
      <tr><td><a href="/redirect">/redirect</a></td><td>302</td><td>leave alone</td></tr>
    </tbody>
  </table>

  <p class="note">
    <code>/cookie.json</code> sets a cookie; <code>/no-store.json</code> and
    <code>/vary-star.json</code> are the two responses that must never be put in the cache.
    Change the options in the extension and reload to compare.
  </p>
</body>
</html>`;

const CSS = `
:root { color-scheme: light dark; }
body {
  max-width: 900px; margin: 40px auto; padding: 0 20px;
  font: 15px/1.55 system-ui, sans-serif;
  background: Canvas; color: CanvasText;
}
h1 { letter-spacing: -0.02em; }
.lead { color: GrayText; }
table { border-collapse: collapse; width: 100%; margin-top: 12px; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid GrayText; vertical-align: top; }
th { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.04em; }
code, kbd { font-family: ui-monospace, monospace; font-size: 0.9em; }
.note { margin-top: 24px; color: GrayText; }
#script-status { color: green; font-weight: 600; }
`;

const SCRIPT = `
document.getElementById("script-status").textContent = "script.js loaded.";
console.info("[Cache even Longer test page] script.js executed");
`;

const IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <rect width="96" height="96" rx="18" fill="#0060df"/>
  <circle cx="48" cy="48" r="26" fill="#fff"/>
  <path d="M48 33v15l10 6" fill="none" stroke="#0060df" stroke-width="6" stroke-linecap="round"/>
</svg>`;

const ROUTES = new Map([
  ["/", { type: "text/html; charset=utf-8", cacheControl: "no-store", body: PAGE }],
  ["/style.css", { type: "text/css; charset=utf-8", cacheControl: "max-age=60", body: CSS }],
  ["/script.js", { type: "text/javascript; charset=utf-8", cacheControl: "max-age=60", body: SCRIPT }],
  ["/image.svg", { type: "image/svg+xml", cacheControl: "max-age=3600", body: IMAGE }],
  ["/image.4f3c2a91.svg", { type: "image/svg+xml", cacheControl: "max-age=3600", body: IMAGE }],
  ["/style.4f3c2a91.css", { type: "text/css; charset=utf-8", cacheControl: "max-age=60", body: CSS }],
  ["/must-revalidate.css", { type: "text/css; charset=utf-8", cacheControl: "max-age=60, must-revalidate", body: CSS }],
  ["/aged.css", { type: "text/css; charset=utf-8", cacheControl: "max-age=60", headers: { Age: "3600" }, body: CSS }],
  ["/long.js", {
    type: "text/javascript; charset=utf-8",
    cacheControl: "public, max-age=31536000, immutable",
    body: `console.info("long.js loaded at ${LOGO}");`,
  }],
  ["/expires-only.svg", {
    type: "image/svg+xml",
    body: IMAGE,
    // No Cache-Control at all: freshness comes from Expires alone.
    headers: () => ({ Expires: new Date(Date.now() + 3600 * 1000).toUTCString() }),
  }],
  ["/private.json", {
    type: "application/json; charset=utf-8",
    cacheControl: "private, max-age=60",
    body: JSON.stringify({ visibility: "private" }),
  }],
  ["/no-store.json", {
    type: "application/json; charset=utf-8",
    cacheControl: "no-store",
    body: JSON.stringify({ visibility: "no-store" }),
  }],
  ["/cookie.json", {
    type: "application/json; charset=utf-8",
    cacheControl: "max-age=60",
    headers: { "Set-Cookie": "cl_demo=1; Path=/; HttpOnly; SameSite=Lax" },
    body: JSON.stringify({ cookies: true }),
  }],
  ["/vary-star.json", {
    type: "application/json; charset=utf-8",
    cacheControl: "max-age=60",
    headers: { Vary: "*" },
    body: JSON.stringify({ vary: "*" }),
  }],
  ["/error-404.json", {
    status: 404,
    type: "application/json; charset=utf-8",
    cacheControl: "max-age=60",
    body: JSON.stringify({ error: "not found" }),
  }],
  ["/partial.bin", {
    status: 206,
    type: "application/octet-stream",
    cacheControl: "max-age=60",
    headers: { "Content-Range": "bytes 0-3/4", "Accept-Ranges": "bytes" },
    body: "abcd",
  }],
  ["/api/data.json", {
    type: "application/json; charset=utf-8",
    cacheControl: "max-age=0",
    body: JSON.stringify({ generatedAt: new Date().toISOString() }),
  }],
  ["/redirect", { status: 302, headers: { Location: "/" }, body: "" }],
  ["/favicon.ico", { status: 204, body: "" }],
]);

const server = createServer((request, response) => {
  const pathname = new URL(request.url || "/", `http://${request.headers.host || HOST}`).pathname;
  const route = ROUTES.get(pathname);

  if (!route) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`No fixture for ${pathname}\n`);
    console.log(`404 ${request.method} ${pathname}`);
    return;
  }

  const headers = {
    ...(route.type ? { "Content-Type": route.type } : {}),
    ...(route.cacheControl ? { "Cache-Control": route.cacheControl } : {}),
    ...(typeof route.headers === "function" ? route.headers() : route.headers || {}),
  };

  response.writeHead(route.status || 200, headers);
  if (request.method === "HEAD" || route.status === 204) {
    response.end();
  } else {
    response.end(route.body);
  }
  console.log(`${route.status || 200} ${request.method} ${pathname}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Try: PORT=${PORT + 1} npm run test-server`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log("Cache even Longer fixture server");
  console.log(`  http://${HOST}:${PORT}/`);
  console.log("  Load the extension from src/manifest.json via about:debugging, then inspect Network.");
});
