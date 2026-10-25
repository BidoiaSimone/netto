// ---- what this device remembers (localStorage), without ever stopping the page ----
// Safari throws on every use of localStorage when site storage is blocked (Settings > Safari > Block All Cookies,
// and some private or content-blocking modes). One such error while a file loads stops the whole page: no page is
// hidden, no button works. So preferences are read and written through these two: with storage blocked the
// defaults are used and nothing is remembered, but netto works.
// (offlineQueue.js and pendingChanges.js write on their own on purpose: their callers must know a change wasn't kept.)

export function readStored(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeStored(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}
