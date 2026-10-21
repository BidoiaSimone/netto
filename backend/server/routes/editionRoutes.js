/* GET /edition.js: tells the page whether this is the full netto or netto light (config/edition.js).
 * A script, not JSON: Home.html loads it with a plain <script> in its <head>, so <html data-edition="light">
 * is set before anything is drawn and the light pages never flash the full ones first.
 * "no-cache" like the other files (app.js): the browser asks again each time, so switching edition is seen at once.
 */

const express = require("express");
const { NETTO_EDITION, createEditionScript } = require("../../config/edition.js");

const router = express.Router();

router.get("/edition.js", (request, response) => {
  response.set("Cache-Control", "no-cache").type("application/javascript").send(createEditionScript(NETTO_EDITION));
});

module.exports = router;
