/* NODE'S GLOBALS, AS FAR AS THE BACKEND TOUCHES THEM
 * Injected at the top of the worker bundle (pwa/build.mjs). There is no process or environment in a browser:
 * process.env is empty, so the backend takes its defaults (the full edition, money.db).
 * Node's timers have .unref() ("don't keep the process alive for this"); a browser's are plain numbers, so the
 * ones made here carry an unref() that does nothing and still work with clearTimeout / clearInterval.
 */

export const process = { env: {}, platform: "browser", argv: [], cwd: () => "/", nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)) };

const withUnref = (browserTimer) => (...args) => {
  const id = browserTimer(...args);
  return { unref() { return this; }, ref() { return this; }, [Symbol.toPrimitive]: () => id };
};
globalThis.setTimeout = withUnref(globalThis.setTimeout.bind(globalThis));
globalThis.setInterval = withUnref(globalThis.setInterval.bind(globalThis));
