/* READING AND SAVING THE SETTINGS STORED IN THE DATABASE (app_settings, migration 15)
 * Which settings exist, with their defaults and ranges: config/appSettings.js.
 */

const db = require("../../db/databaseConnection.js");
const { buildSettingsWithDefaults, validateSettingValue } = require("../../config/appSettings.js");

const selectAllSettingRows = db.prepare(`SELECT key, value FROM app_settings`);
const upsertSetting = db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`);

// { key: value } for every setting (stored, or its default)
const readAllSettings = () => buildSettingsWithDefaults(selectAllSettingRows.all());
const readSetting = (key) => readAllSettings()[key];

// { key: value, ... }: all valid, or nothing saved. Returns { error } or { settings } (all of them, after saving).
function saveSettings(changedValues) {
  const entries = Object.entries(changedValues ?? {});
  if (!entries.length) return { error: "no settings sent" };
  const validatedEntries = [];
  for (const [key, value] of entries) {
    const { error, value: validValue } = validateSettingValue(key, value);
    if (error) return { error };
    validatedEntries.push([key, validValue]);
  }
  db.transaction(() => { for (const [key, value] of validatedEntries) upsertSetting.run(key, JSON.stringify(value)); })();
  return { settings: readAllSettings() };
}

module.exports = { readAllSettings, readSetting, saveSettings };
