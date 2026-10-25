/* NETTO'S BACKEND IN THE BROWSER: the Web Worker the PWA's page sends its API calls to
 * Instead of `fetch("/transactions")` to the Express server, the page posts { id, method, path, body } here
 * (frontend/JS/core/localApi.js) and gets back { id, status, headers, body }. The routes, services, validation and
 * migrations are backend/ itself, bundled by pwa/build.mjs with these stand-ins:
 *   better-sqlite3 -> betterSqlite3OverWasm.js   (SQLite compiled to WebAssembly, the file kept in OPFS)
 *   express        -> expressRouterInTheBrowser.js
 *   yahoo-finance2 -> yahooFinanceThroughPriceProxy.js (the Cloudflare Worker)
 *   fs, path, os, chalk, config/projectPaths.js -> standIns/
 *
 * Where the data lives: money.db in this site's Origin Private File System, through SQLite's "opfs-sahpool"
 * storage, which only works in a worker like this one. A browser without it gets a database in memory and the
 * page is told (storage: "memory"): everything works, but nothing survives a reload.
 */

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { useSqliteWasm } from "./betterSqlite3OverWasm.js";

const DATABASE_FILE = "/money.db";

async function openDatabaseStorage() {
  const sqlite3 = await sqlite3InitModule();
  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "netto" });
    useSqliteWasm(sqlite3, (fileName) => new pool.OpfsSAHPoolDb(fileName));
    return "opfs";
  } catch (error) {
    console.warn("No persistent storage for the database, using memory:", error);
    useSqliteWasm(sqlite3, () => new sqlite3.oo1.DB(":memory:"));
    return "memory";
  }
}

// Loaded only once SQLite is ready: requiring the routes opens the database and runs the migrations
async function startBackend() {
  const storage = await openDatabaseStorage();
  const { answerRequest } = require("express");
  const apiRouter = require("../../backend/server/routes/apiRouter.js");
  const { answerErrorsWithoutLoggingData } = require("../../backend/server/middleware/answerErrorsWithoutLoggingData.js");
  const { startRecurringTransactionPoster } = require("../../backend/server/services/recurringTransactionPoster.js");
  startRecurringTransactionPoster(); // adds the recurring transactions that are due, now and every new day
  return { storage, answer: (request) => answerRequest(apiRouter, answerErrorsWithoutLoggingData, request) };
}

const backendReady = startBackend();
backendReady.then(({ storage }) => postMessage({ ready: true, storage }), (error) => postMessage({ ready: false, error: error.message }));

self.addEventListener("message", async (event) => {
  const { id, method, path, body } = event.data;
  try {
    const backend = await backendReady;
    postMessage({ id, ...(await backend.answer({ method, path, body })) });
  } catch (error) {
    postMessage({ id, status: 500, headers: {}, body: { error: error.message } });
  }
});
