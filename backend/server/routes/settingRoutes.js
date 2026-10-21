/* SETTINGS STORED WITH THE DATA (app_settings, migration 15)
 *   GET /settings    { values: { key: value }, definitions: { key: { default, minimum, maximum, description } } }
 *   PUT /settings    { key: value, ... }: every value valid, or nothing saved
 */

const express = require("express");
const { APP_SETTING_DEFINITIONS } = require("../../config/appSettings.js");
const { readAllSettings, saveSettings } = require("../services/appSettings.js");

const router = express.Router();

router.get("/settings", function listSettings(request, response) {
  response.json({ values: readAllSettings(), definitions: APP_SETTING_DEFINITIONS });
});

router.put("/settings", function changeSettings(request, response) {
  const { error, settings } = saveSettings(request.body);
  if (error) return response.status(400).json({ error });
  response.json({ values: settings });
});

module.exports = router;
