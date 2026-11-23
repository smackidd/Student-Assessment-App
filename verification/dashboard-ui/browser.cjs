const { test: base, expect } = require("@playwright/test");
const { build } = require("./bundler.cjs");
const path = require("node:path");
const fs = require("node:fs/promises");
const root = path.resolve(__dirname, "../..");
const origin = "http://127.0.0.1:18473";

async function bundle() {
  const result = await build({
    absWorkingDir: root, entryPoints: [path.join(__dirname, "fixture.jsx")], outfile: "fixture.js",
    write: false, bundle: true, format: "iife", jsx: "automatic", minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "isolated-views", setup(b) {
      b.onResolve({ filter: /^acceptance:views$/ }, () => ({ path: path.join(root, "app/page.tsx"), namespace: "views" }));
      b.onLoad({ filter: /.*/, namespace: "views" }, async ({ path: file }) => ({
        contents: await fs.readFile(file, "utf8") + "\nexport { Dashboard, StudentReport };",
        resolveDir: root, loader: "tsx"
      }));
      b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: path.join(__dirname, "firestore.cjs") }));
      b.onResolve({ filter: /^(?:firebase\/|@\/lib\/(?:firebase|student-database|organization-auth)$)/ }, ({ path }) =>
        ({ path, namespace: "forbidden", sideEffects: false }));
      b.onLoad({ filter: /.*/, namespace: "forbidden" }, ({ path }) => ({
        contents: path.endsWith("organization-auth") ? "module.exports = {organizationId:'fixture-org'}" :
          path.endsWith("/firebase") ? "module.exports = {firebaseApp:{synthetic:true}}" : "module.exports = {}", loader: "js"
      }));
    }}]
  });
  return new Map(result.outputFiles.map(file => ["/" + path.basename(file.path), file.contents]));
}

const test = base.extend({
  assets: [async ({}, use) => use(await bundle()), { scope: "worker" }],
  isolated: [async ({ context, page, assets }, use) => {
    const failures = [];
    const watch = p => p.on("pageerror", e => failures.push(e.message));
    watch(page);
    context.on("page", watch);
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin && route.request().method() === "GET") {
        if (url.pathname === "/") return route.fulfill({ contentType: "text/html", headers: {
          "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data: blob:; connect-src 'none'; base-uri 'none'"
        }, body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>' });
        if (assets.has(url.pathname)) return route.fulfill({ contentType: url.pathname.endsWith(".css") ? "text/css" : "application/javascript", body: Buffer.from(assets.get(url.pathname)) });
      }
      failures.push("Unexpected request: " + url.origin + url.pathname);
      return route.abort("blockedbyclient");
    });
    await use();
    expect(failures).toEqual([]);
  }, { auto: true }]
});
module.exports = { test, expect, origin };
