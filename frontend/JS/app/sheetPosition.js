// ---- the phone's sheets stay on screen while the keyboard is up ----
// On the iPhone the keyboard doesn't make the page shorter: it covers its bottom, and Safari slides what you see
// (the "visual viewport") over the page to keep the field you type in visible. A dialog is position: fixed, which is
// relative to the whole page, not to what you see: so when "+" opens the transaction sheet and the amount field takes
// the focus, Safari slides the view to the field, and the sheet, which Pocket anchors to the bottom of the page,
// ends up partly or far above the top of the screen (worse while its rise animation is still moving it).
//
// Here the visible part of the page is measured (window.visualViewport) and written into two CSS variables,
//   --visible-top     how far the visible part is slid down the page, in px
//   --visible-height  how tall it is (the screen minus the keyboard)
// and <html> gets .keyboard-open while the keyboard takes a good part of the screen. 37-ui-pocket.css then places
// an open sheet at the top of the visible part, no taller than it (scrolling inside when needed).
// Browsers without visualViewport (none netto runs on today) simply keep the sheet where it was.

const KEYBOARD_SHARE_OF_SCREEN = 0.15; // less than this missing at the bottom: a toolbar, not the keyboard

function measureVisibleArea() {
  const visibleArea = window.visualViewport;
  const root = document.documentElement;
  root.style.setProperty("--visible-top", `${Math.max(0, visibleArea.offsetTop)}px`);
  root.style.setProperty("--visible-height", `${visibleArea.height}px`);
  // zoomed in with two fingers, the visible part is smaller too: that isn't the keyboard
  const isZoomed = visibleArea.scale > 1.05;
  root.classList.toggle("keyboard-open", !isZoomed && visibleArea.height < window.innerHeight * (1 - KEYBOARD_SHARE_OF_SCREEN));
}

export function initializeSheetPosition() {
  if (!window.visualViewport) return;
  window.visualViewport.addEventListener("resize", measureVisibleArea);
  window.visualViewport.addEventListener("scroll", measureVisibleArea);
  measureVisibleArea();
}

// For openDialog(): measure once more as a sheet opens (the keyboard may already be up from another field)
export const measureVisibleAreaNow = () => { if (window.visualViewport) measureVisibleArea(); };
