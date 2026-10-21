// ---- settings stored with the data (GET / PUT /settings, migration 15) ----
// Preferences that travel in the JSON backup, like the drift threshold of the target allocation or the
// reconciliation reminders. Theme, colour and "hide amounts" stay in the browser (settings/ folder).

import { callApi } from "./apiClient.js";
import { appState } from "./appState.js";

export async function loadAppSettings() {
  const { values, definitions } = await callApi("/settings");
  appState.settings = values;
  appState.settingDefinitions = definitions;
}

// Saves one setting; the server checks its range. Returns every setting after saving.
export async function saveAppSetting(key, value) {
  const { values } = await callApi("/settings", { method: "PUT", body: { [key]: value } });
  appState.settings = values;
  return values;
}

// A number input bound to a setting: shows its value, saves on change (Enter or leaving the field), and
// puts the old value back with the server's message when it's out of range.
export function bindNumberInputToSetting(input, key, { onSaved, showError, toDisplay = (value) => value, fromDisplay = (value) => value } = {}) {
  const definition = appState.settingDefinitions[key];
  if (definition) {
    input.min = toDisplay(definition.minimum);
    input.max = toDisplay(definition.maximum);
    input.title = definition.description;
  }
  if (document.activeElement !== input) input.value = toDisplay(appState.settings[key]);
  if (input.dataset.boundSetting) return; // listeners only once; the value above is refreshed every time
  input.dataset.boundSetting = key;
  input.addEventListener("change", async () => {
    try {
      await saveAppSetting(key, fromDisplay(Number(input.value)));
      onSaved?.();
    } catch (error) {
      input.value = toDisplay(appState.settings[key]);
      showError?.(error.message);
    }
  });
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") input.blur(); });
}
