/* WHO MAY TALK TO THE SERVER (middleware/rejectRequestsFromOtherHosts.js)
 * This computer by name or address, and the Mac's own Tailscale name (the phone, through "tailscale serve");
 * any other Host is refused, so a web page can't reach the API through a domain pointed at 127.0.0.1.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createRejectRequestsFromOtherHosts } = require("../backend/server/middleware/rejectRequestsFromOtherHosts.js");

const check = createRejectRequestsFromOtherHosts(3000);
function isAllowed(host) {
  let allowed = false;
  const response = { status: () => ({ send: () => {} }) };
  check({ headers: { host } }, response, () => { allowed = true; });
  return allowed;
}

test("this computer and its Tailscale name get in, anything else is refused", () => {
  for (const host of ["localhost:3000", "127.0.0.1:3000", "macbook-air.tail1234.ts.net", "macbook-air.tail1234.ts.net:443"]) {
    assert.ok(isAllowed(host), host);
  }
  for (const host of ["evil.example.com", "localhost:4000", "192.168.1.20:3000", "ts.net", "evil.ts.net.example.com", "a.b.c.ts.net", undefined]) {
    assert.ok(!isAllowed(host), String(host));
  }
});
