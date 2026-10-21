/* KEEPING THE MAC AWAKE WHILE NETTO RUNS, so the phone can reach it (over Tailscale) when you're out.
 * macOS's own `caffeinate` does it: -i stops idle sleep (the screen can still turn off), -s stops system sleep
 * while the Mac is on power, -w <pid> ends it by itself as soon as this server process ends (a restart starts a
 * new one). Nothing else changes: no system settings, and closing the lid still puts a MacBook to sleep
 * (unless an external display is connected).
 * Only on macOS; NETTO_KEEP_AWAKE=0 turns it off.
 */

const { spawn } = require("child_process");

function keepMacAwakeWhileRunning() {
  if (process.platform !== "darwin" || process.env.NETTO_KEEP_AWAKE === "0") return;
  try {
    const caffeinate = spawn("/usr/bin/caffeinate", ["-i", "-s", "-w", String(process.pid)], { stdio: "ignore" });
    caffeinate.on("error", (error) => console.error(`Could not keep the Mac awake: ${error.message}`));
    caffeinate.on("spawn", () => console.log("Keeping the Mac awake while netto runs (caffeinate; NETTO_KEEP_AWAKE=0 turns it off)"));
    caffeinate.unref(); // it never keeps the server itself from stopping
  } catch (error) {
    console.error(`Could not keep the Mac awake: ${error.message}`);
  }
}

module.exports = { keepMacAwakeWhileRunning };
