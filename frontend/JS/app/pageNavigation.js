// ---- sidebar navigation (hash routing: #home, #assets, ...) ----
// Every page is a <section data-page="..."> in Home.html; only the one in the URL's #hash is shown.
// netto light (core/edition.js) has fewer pages: one it leaves out (class="full-only") opens Home instead.
// So does a page the phone leaves out (class="desktop-only", core/phoneFeatures.js), while the screen is narrow.

import { isLeftOutOfThisEdition } from "../core/edition.js";
import { isLeftOutOnThisScreen, onScreenSizeChange } from "../core/phoneFeatures.js";

const pageSections = [...document.querySelectorAll("[data-page]")].filter((section) => !isLeftOutOfThisEdition(section));
const DEFAULT_PAGE = "home";

export function showPageFromUrl() {
  const requestedPage = location.hash.slice(1);
  const availableSections = pageSections.filter((section) => !isLeftOutOnThisScreen(section));
  const pageToShow = availableSections.some((section) => section.dataset.page === requestedPage) ? requestedPage : DEFAULT_PAGE;
  pageSections.forEach((section) => { section.hidden = section.dataset.page !== pageToShow; });
  // a page that sits under another one (<section data-under="...">: Recurring under Transactions, Categories under
  // Insights) keeps that page's tab lit in Pocket's tab bar on the phone, where it has no tab of its own
  const parentPage = pageSections.find((section) => section.dataset.page === pageToShow)?.dataset.under;
  document.querySelectorAll("#sidebar a").forEach((link) => {
    link.classList.toggle("active", link.hash === "#" + pageToShow);
    link.classList.toggle("holds-active", link.hash === "#" + parentPage);
  });
  document.querySelectorAll(".page-switch a").forEach((link) => link.classList.toggle("active", link.hash === "#" + pageToShow));
  scrollActiveLinkIntoView();
}

// Pocket on the phone lays the links out in a row (the tab bar) that scrolls sideways when it doesn't fit: bring
// the current page's link into view. A column of links never needs it.
function scrollActiveLinkIntoView() {
  const sidebar = document.getElementById("sidebar");
  // the page's own link, or the one it sits under when its own is hidden (offsetWidth 0)
  const activeLink = [...(sidebar?.querySelectorAll("a.active, a.holds-active") ?? [])].find((link) => link.offsetWidth > 0);
  if (!activeLink || sidebar.scrollWidth <= sidebar.clientWidth) return;
  // the sidebar is positioned (fixed or sticky), so offsetLeft is already measured from its left edge
  sidebar.scrollTo({ left: activeLink.offsetLeft - (sidebar.clientWidth - activeLink.offsetWidth) / 2 });
}

export function initializePageNavigation() {
  window.addEventListener("hashchange", showPageFromUrl);
  onScreenSizeChange(showPageFromUrl);                          // a page the phone leaves out goes back to Home
  window.addEventListener("netto:phone-features", showPageFromUrl);
}
