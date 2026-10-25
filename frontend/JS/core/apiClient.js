// ---- talking to the server ----

import { noteAnswerFromServer, isServerReachable } from "./connectionState.js";
import { keepChangeForLater } from "./pendingChanges.js";
import { runsWithoutServer } from "./edition.js";
import { callLocalApi } from "./localApi.js";

const API_BASE_URL = ""; // same server that serves the page

// Sends a request to the API and returns the JSON answer.
// Throws an Error with the server's message when the answer is an error (status, data attached).
// When the server can't be reached at all, the error has isServerUnreachable = true (and no status): the
// caller can then keep the change for later, like the transaction dialog does (core/offlineQueue.js).
// timeoutMilliseconds: give up after that long without an answer (also isServerUnreachable).
//
// Edits and deletions (PUT, DELETE) are kept on this device when the server can't be reached, and sent when it's back
// (core/pendingChanges.js): the answer is then { kept: true, change_id } instead of the server's.
// keepIfUnreachable: false for the sending itself (and anything that must not wait).
const KEEPABLE_METHODS = ["PUT", "DELETE"];
const CHANGE_TIMEOUT_MILLISECONDS = 8000; // a sleeping Mac doesn't refuse, it just never answers

export async function callApi(path, { method = "GET", body, timeoutMilliseconds, keepIfUnreachable = true } = {}) {
  if (runsWithoutServer) return callApiOnThisDevice(path, method, body);
  const canKeep = keepIfUnreachable && KEEPABLE_METHODS.includes(method);
  if (canKeep && !isServerReachable()) return { kept: true, change_id: keepChangeForLater(method, path, body) };
  if (canKeep && !timeoutMilliseconds) timeoutMilliseconds = CHANGE_TIMEOUT_MILLISECONDS;
  let response;
  try {
    response = await fetch(API_BASE_URL + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: timeoutMilliseconds ? AbortSignal.timeout(timeoutMilliseconds) : undefined,
    });
  } catch {
    // Network error (Safari says "Load failed", Firefox "NetworkError..."), or the timeout: the server isn't reachable
    noteAnswerFromServer({ reachable: false });
    if (canKeep) return { kept: true, change_id: keepChangeForLater(method, path, body) };
    throw Object.assign(new Error("Can't reach netto's server. If this doesn't go away in a few seconds, check it with: bash scripts/service.sh log"),
      { isServerUnreachable: true });
  }
  // A copy saved by the service worker (serviceWorker.js) instead of a fresh answer: the server is asleep
  const savedAt = response.headers.get("X-Netto-Saved-At");
  const isUnreachable = response.headers.get("X-Netto-Unreachable") === "1";
  noteAnswerFromServer({ reachable: !savedAt && !isUnreachable, savedAt });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error((data && data.error) || response.statusText);
    error.status = response.status;
    error.data = data; // the whole answer, e.g. merge_into when a rename hits an existing category
    if (isUnreachable) error.isServerUnreachable = true;
    throw error;
  }
  return data;
}

// The PWA: the backend is on this device (core/localApi.js), so it's always reachable and nothing is kept for later
async function callApiOnThisDevice(path, method, body) {
  const answer = await callLocalApi(method, path, body);
  if (answer.status >= 400) {
    const error = new Error((answer.body && answer.body.error) || `Error ${answer.status}`);
    error.status = answer.status;
    error.data = answer.body;
    throw error;
  }
  return answer.body;
}
