/* BUILDS THE PWA into dist/pwa: npm run pwa:build
 * The same frontend/ the Express server serves, plus netto's backend bundled to run in the browser:
 *   1. copies frontend/ (without its server-side service worker)
 *   2. bundles pwa/browserBackend/apiWorker.js -> JS/apiWorker.js, with backend/ inside and the stand-ins for what
 *      only exists in Node (better-sqlite3, express, yahoo-finance2, fs, path...); SQLite's .wasm goes next to it
 *   3. writes what the server used to answer: edition.js (now also "no server here") and a manifest with relative
 *      paths, so the app works under any folder (GitHub Pages serves it at /netto/)
 *   4. writes the service worker with the list of files to save for offline
 * NETTO_PRICE_PROXY_URL: the Cloudflare Worker for the prices (pwa/priceProxy), e.g. https://netto-prices.<you>.workers.dev/
 */

import { build } from "esbuild";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FRONTEND = join(PROJECT_ROOT, "frontend");
const OUTPUT = join(PROJECT_ROOT, "dist/pwa");
const STAND_INS = join(PROJECT_ROOT, "pwa/browserBackend/standIns");
const PRICE_PROXY_URL = process.env.NETTO_PRICE_PROXY_URL || "";

rmSync(OUTPUT, { recursive: true, force: true });
mkdirSync(OUTPUT, { recursive: true });

// 1. the pages, styles, scripts, images
cpSync(FRONTEND, OUTPUT, {
  recursive: true,
  filter: (source) => !source.endsWith(".DS_Store") && relative(FRONTEND, source) !== "serviceWorker.js",
});

// Absolute paths only work at the root of a site: make them relative to HTML/
const homePage = join(OUTPUT, "HTML/Home.html");
writeFileSync(homePage, readFileSync(homePage, "utf8")
  .replaceAll('href="/Images/', 'href="../Images/')
  .replaceAll('src="/edition.js"', 'src="../edition.js"'));
writeFileSync(join(OUTPUT, "index.html"), '<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=HTML/Home.html"><title>netto</title>\n');

// 2. the backend, as a module worker
await build({
  entryPoints: [join(PROJECT_ROOT, "pwa/browserBackend/apiWorker.js")],
  outfile: join(OUTPUT, "JS/apiWorker.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["safari16.4", "chrome110", "firefox115"],
  minify: true,
  sourcemap: true,
  logLevel: "warning",
  inject: [join(STAND_INS, "nodeGlobals.js")],
  define: { NETTO_PRICE_PROXY_URL: JSON.stringify(PRICE_PROXY_URL) },
  alias: {
    "better-sqlite3": join(PROJECT_ROOT, "pwa/browserBackend/betterSqlite3OverWasm.js"),
    express: join(PROJECT_ROOT, "pwa/browserBackend/expressRouterInTheBrowser.js"),
    "yahoo-finance2": join(PROJECT_ROOT, "pwa/browserBackend/yahooFinanceThroughPriceProxy.js"),
    chalk: join(STAND_INS, "chalk.js"),
    path: join(STAND_INS, "path.js"),
    fs: join(STAND_INS, "fileSystem.js"),
    os: join(STAND_INS, "fileSystem.js"),
    child_process: join(STAND_INS, "fileSystem.js"),
  },
  plugins: [{
    name: "browser-stand-ins", // backend files that only make sense on the Mac: where its folders are, its backups folder
    setup(builder) {
      builder.onResolve({ filter: /\/(projectPaths|backupsFolder)\.js$/ }, (args) => ({ path: join(STAND_INS, args.path.split("/").pop()) }));
    },
  }],
});
cpSync(join(PROJECT_ROOT, "node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm/sqlite3.wasm"), join(OUTPUT, "JS/sqlite3.wasm"));

// 3. what the server used to answer
writeFileSync(join(OUTPUT, "edition.js"), 'document.documentElement.dataset.edition = "full";\ndocument.documentElement.dataset.runtime = "browser";\n');
const manifest = JSON.parse(readFileSync(join(FRONTEND, "Images/icons/site.webmanifest"), "utf8"));
manifest.start_url = "../../HTML/Home.html";
manifest.scope = "../../";
manifest.icons = manifest.icons.map((icon) => ({ ...icon, src: icon.src.replace("/Images/icons/", "") }));
writeFileSync(join(OUTPUT, "Images/icons/site.webmanifest"), JSON.stringify(manifest, null, 2) + "\n");

// 4. the service worker, with every file and a version that changes when any of them does
const listFiles = (directory) => readdirSync(directory).flatMap((name) => {
  const file = join(directory, name);
  return statSync(file).isDirectory() ? listFiles(file) : [file];
});
const appFiles = listFiles(OUTPUT).filter((file) => !file.endsWith(".map")).map((file) => relative(OUTPUT, file).split("\\").join("/")).sort();
const contentHash = createHash("sha256");
for (const file of appFiles) contentHash.update(file).update(readFileSync(join(OUTPUT, file)));
const version = contentHash.digest("hex").slice(0, 12);
writeFileSync(join(OUTPUT, "serviceWorker.js"), readFileSync(join(PROJECT_ROOT, "pwa/serviceWorker.js"), "utf8")
  .replace("__NETTO_VERSION__", version)
  .replace("__NETTO_APP_FILES__", JSON.stringify(["./", ...appFiles])));

console.log(`PWA built in dist/pwa (version ${version}, ${appFiles.length} files)${PRICE_PROXY_URL ? "" : " — no NETTO_PRICE_PROXY_URL: prices won't load"}`);
