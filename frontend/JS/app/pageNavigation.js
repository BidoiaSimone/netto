// ---- sidebar navigation (hash routing: #home, #assets, ...) ----
// Every page is a <section data-page="..."> in Home.html; only the one in the URL's #hash is shown.

const pageSections = [...document.querySelectorAll("[data-page]")];
const DEFAULT_PAGE = "home";

export function showPageFromUrl() {
  const requestedPage = location.hash.slice(1);
  const pageToShow = pageSections.some((section) => section.dataset.page === requestedPage) ? requestedPage : DEFAULT_PAGE;
  pageSections.forEach((section) => { section.hidden = section.dataset.page !== pageToShow; });
  document.querySelectorAll("#sidebar a").forEach((link) => link.classList.toggle("active", link.hash === "#" + pageToShow));
}

export function initializePageNavigation() {
  window.addEventListener("hashchange", showPageFromUrl);
}
