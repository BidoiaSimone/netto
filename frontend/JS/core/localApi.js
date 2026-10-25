// ---- the API without a server (the PWA) ----
// In the PWA there's no Express server: netto's backend runs in a Web Worker on this device (pwa/browserBackend/
// apiWorker.js), with the database in the browser's own storage. callApi (core/apiClient.js) sends each request here
// instead of fetch(), and gets back the same { status, body } the server would have answered.

let apiWorker = null;
let nextRequestId = 1;
const waitingRequests = new Map(); // id -> resolve

function startApiWorker() {
  apiWorker = new Worker(new URL("../apiWorker.js", import.meta.url), { type: "module" });
  apiWorker.addEventListener("message", (event) => {
    const { id, ready, storage, error } = event.data;
    if (id === undefined) {
      // the first message: is the database kept on this device, or only in memory until the page closes?
      if (ready === false) console.error("netto's backend didn't start:", error);
      if (storage === "memory") warnThatNothingIsKept();
      return;
    }
    waitingRequests.get(id)?.(event.data);
    waitingRequests.delete(id);
  });
}

// The browser refused netto a place for its database (site storage blocked, a private tab): it works, but in memory
const warnThatNothingIsKept = () => {
  const warning = document.getElementById("storage-warning");
  warning.textContent = "This browser isn't letting netto keep its data: anything you add is lost when netto closes. "
    + "On an iPhone: Settings → Apps → Safari → turn off Block All Cookies, then open netto again (not in a Private tab).";
  warning.hidden = false;
};

// { method, path, body } -> { status, headers, body }, like an HTTP answer
export function callLocalApi(method, path, body) {
  if (!apiWorker) startApiWorker();
  const id = nextRequestId++;
  return new Promise((resolve) => {
    waitingRequests.set(id, resolve);
    apiWorker.postMessage({ id, method, path, body });
  });
}
