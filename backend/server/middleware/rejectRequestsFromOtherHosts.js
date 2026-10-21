/* REFUSE REQUESTS WHOSE Host HEADER ISN'T THIS MACHINE (or its Tailscale name)
 * Binding the server to 127.0.0.1 stops other devices; this stops a malicious web page from reaching
 * the API through a fake domain that points to 127.0.0.1 (a "DNS rebinding" attack).
 *
 * The phone: Tailscale ("tailscale serve --bg 3000" on the Mac) gives the Mac an HTTPS address like
 * https://macbook.tail1234.ts.net that only your own devices can open, and passes those requests on to
 * 127.0.0.1:3000. They arrive with that name as their Host, so names ending in .ts.net are let through too.
 * That's safe: a .ts.net name only exists inside your tailnet and is handed out by Tailscale, so no web page
 * can point one at your computer. The server itself still listens on 127.0.0.1 only.
 */

const TAILSCALE_HOST_PATTERN = /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net(:\d+)?$/i;

function createRejectRequestsFromOtherHosts(serverPort) {
  const allowedHostHeaders = new Set([`localhost:${serverPort}`, `127.0.0.1:${serverPort}`]);
  return function rejectRequestsFromOtherHosts(request, response, next) {
    const host = request.headers.host ?? "";
    if (allowedHostHeaders.has(host) || TAILSCALE_HOST_PATTERN.test(host)) return next();
    response.status(403).send("Forbidden");
  };
}

module.exports = { createRejectRequestsFromOtherHosts, TAILSCALE_HOST_PATTERN };
