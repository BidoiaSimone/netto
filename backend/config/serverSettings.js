/* SERVER SETTINGS
 * Values that change how the server runs, read once from the environment.
 */

const SERVER_PORT = Number(process.env.PORT) || 3000;

// Only this computer can connect. Without a host, Node listens on every network
// interface, so anyone on the same Wi-Fi could open http://<your-ip>:3000.
const SERVER_HOST = "127.0.0.1";

// Set by the launcher (scripts/launch.sh): the server stops itself once no app window is open.
// `npm run dev` doesn't set it, so during development the server keeps running.
const SHOULD_EXIT_WHEN_NO_WINDOW_IS_OPEN = process.env.AUTO_EXIT === "1";

// Large enough to import a full JSON backup
const MAXIMUM_REQUEST_BODY_SIZE = "50mb";

module.exports = { SERVER_PORT, SERVER_HOST, SHOULD_EXIT_WHEN_NO_WINDOW_IS_OPEN, MAXIMUM_REQUEST_BODY_SIZE };
