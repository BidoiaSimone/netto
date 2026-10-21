// ---- full netto or netto light ----
// The server says which with GET /edition.js, loaded by Home.html before anything is drawn: it sets
// <html data-edition="light"> for `npm run light` (backend/config/edition.js).
//
// Most of the light edition is CSS (35-light-edition.css): parts of Home.html marked class="full-only" are
// hidden, parts marked class="light-only" are shown. This file is for the few things the JS has to decide:
// which pages exist, which data to load, which columns to draw.

export const isLightEdition = document.documentElement.dataset.edition === "light";

// A part of the page that the light edition leaves out (class="full-only", on it or on a parent)
export const isLeftOutOfThisEdition = (element) => isLightEdition && Boolean(element.closest(".full-only"));
