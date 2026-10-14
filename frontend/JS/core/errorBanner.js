// ---- the red line at the top of the page ----

import { elementById } from "./domHelpers.js";

// An empty message hides it
export const showErrorMessage = (message) => { elementById("error").textContent = message; };
