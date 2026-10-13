/* DECLARATION AND INSTANTIATION OF EXPRESS APP */

const express = require("express");
const path = require("path");

const PORT = process.env.PORT || 3000;
// Only this computer can connect. Without a host, Node listens on every network
// interface, so anyone on the same Wi-Fi could open http://<your-ip>:3000.
const HOST = "127.0.0.1";
const FRONTEND_DIR = path.join(__dirname, "../../frontend");

const app = express();
app.use(express.json({ limit: "50mb" })); // large enough to import a full backup
app.set("json spaces", 2);

// Refuse requests whose Host header isn't this machine. Binding to 127.0.0.1 stops other
// devices; this stops a malicious web page from reaching the API through a fake domain
// that points to 127.0.0.1 (a "DNS rebinding" attack).
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
app.use((req, res, next) => {
  if (ALLOWED_HOSTS.has(req.headers.host)) return next();
  res.status(403).send("Forbidden");
});

// ---- app window tracking ----
// Every open page keeps a connection to /session (see the end of home.js).
// When started by the launcher (AUTO_EXIT=1), the server stops itself once no page
// has been open for a few seconds, so closing the Firefox window closes the app.
// `npm run dev` doesn't set AUTO_EXIT, so during development nothing changes.
const sessions = new Set();
let exitTimer = null;

function scheduleExit(ms) {
  if (process.env.AUTO_EXIT !== "1") return;
  clearTimeout(exitTimer);
  exitTimer = setTimeout(() => {
    if (sessions.size === 0) {
      console.log("No app window open: shutting down");
      process.exit(0);
    }
  }, ms);
}

app.get("/session", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  res.write(": open\n\n");
  sessions.add(res);
  clearTimeout(exitTimer);
  const keepAlive = setInterval(() => res.write(": ping\n\n"), 20000);
  req.on("close", () => {
    clearInterval(keepAlive);
    sessions.delete(res);
    if (sessions.size === 0) scheduleExit(10000); // 10 s: a page reload reconnects well within that
  });
});
scheduleExit(60000); // if no window ever opens (e.g. the browser failed to start), stop after a minute

app.use(require("./routes/routes.js"));  // API routes
app.use(express.static(FRONTEND_DIR));   // pages, css, js, images
app.get("/", (req, res) => res.redirect("/HTML/Home.html"));

app.listen(PORT, HOST, function (err) {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening on http://localhost:${PORT}`);
});

module.exports = app;
