/* REFUSE REQUESTS WHOSE Host HEADER ISN'T THIS MACHINE
 * Binding the server to 127.0.0.1 stops other devices; this stops a malicious web page from reaching
 * the API through a fake domain that points to 127.0.0.1 (a "DNS rebinding" attack).
 */

function createRejectRequestsFromOtherHosts(serverPort) {
  const allowedHostHeaders = new Set([`localhost:${serverPort}`, `127.0.0.1:${serverPort}`]);
  return function rejectRequestsFromOtherHosts(request, response, next) {
    if (allowedHostHeaders.has(request.headers.host)) return next();
    response.status(403).send("Forbidden");
  };
}

module.exports = { createRejectRequestsFromOtherHosts };
