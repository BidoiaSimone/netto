/* NODE'S "fs", "os" AND "child_process" IN THE BROWSER: there are none
 * The backend only touches files for the copies it keeps in backend/db/backups and iCloud Drive. In the PWA those
 * calls throw (each caller already catches and reports it) and the user's own JSON backup takes their place.
 */

const notInTheBrowser = (name) => () => { throw new Error(`${name} isn't available in the browser`); };

module.exports = new Proxy({}, {
  get: (target, name) => (name === "existsSync" ? () => false : name === "homedir" ? () => "/" : notInTheBrowser(String(name))),
});
