/* AUTO-SYNC: makes this checkout an exact, live copy of GitHub, so whatever is pushed from anywhere else
 * (another computer, a Claude session in the cloud) runs here within seconds and can be tried from the phone.
 * Run in the background by launchd (see autosync.sh), not by hand.
 *
 * Every few seconds it fetches every branch and checks out the one pushed to most recently (or the one in
 * NETTO_SYNC_BRANCH, if set), exactly as GitHub has it: force-pushes and branch switches included.
 * Nothing else is needed after that: the server reloads on backend changes (node --watch) and open pages
 * reload on frontend changes (backend/server/appWindow/frontendLiveReload.js), on this Mac and on the phone.
 *
 * GitHub always wins, but nothing done here is thrown away: uncommitted edits are stashed (git stash list)
 * and local commits GitHub doesn't have are kept on an autosync-backup/... branch before the switch.
 *
 * launchd runs a copy of this file kept outside the repo (autosync.sh install puts it there), because
 * the branch being checked out may not contain this file at all. When the repo's version changes,
 * the copy is replaced and launchd restarts it.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PROJECT_DIR = process.env.NETTO_PROJECT_DIR || path.join(__dirname, "..");
const PINNED_BRANCH = process.env.NETTO_SYNC_BRANCH || "";
const CHECK_EVERY_SECONDS = Number(process.env.NETTO_SYNC_SECONDS) || 15;
const SERVER_LABEL = "com.netto.server";
const GIT_TIMEOUT_MILLISECONDS = 60_000;
const NPM_TIMEOUT_MILLISECONDS = 5 * 60_000;
const REPO_COPY_OF_THIS_FILE = path.join(PROJECT_DIR, "scripts", "autosync.js");

// launchd starts programs with an almost empty environment: git and npm need to be findable,
// and git must never stop to ask for a password (it would wait forever with nobody to answer)
const ENVIRONMENT = {
  ...process.env,
  PATH: [path.dirname(process.execPath), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":"),
  GIT_TERMINAL_PROMPT: "0",
};

function run(command, args, timeout = GIT_TIMEOUT_MILLISECONDS) {
  const result = spawnSync(command, args, { cwd: PROJECT_DIR, env: ENVIRONMENT, encoding: "utf8", timeout });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() || String(result.error ?? "") };
}

const git = (...args) => run("git", args);

function log(message) {
  console.log(`${new Date().toLocaleString("sv-SE")} ${message}`);
}

// The same problem is reported once, not every 15 seconds: a new message only when the situation changes
let lastProblem = null;
function reportProblem(problem) {
  if (problem !== lastProblem) log(problem);
  lastProblem = problem;
}

function newestBranchOnGitHub() {
  if (PINNED_BRANCH) return PINNED_BRANCH;
  const branches = git("for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/remotes/origin").output
    .split("\n").filter((name) => name.startsWith("origin/") && name !== "origin/HEAD");
  return branches[0]?.slice("origin/".length);
}

function syncOnce() {
  // Counted before fetching: after a force-push, the replaced commits would otherwise look like local work
  const localOnlyCommits = Number(git("rev-list", "--count", "HEAD", "--not", "--remotes=origin").output) || 0;
  const fetch = git("fetch", "--quiet", "--prune", "origin");
  if (!fetch.ok) return reportProblem(`Can't reach GitHub (offline?): ${fetch.output}`);

  const branch = newestBranchOnGitHub();
  if (!branch) return reportProblem("No branches on GitHub yet.");
  const target = git("rev-parse", `origin/${branch}`).output;
  const currentBranch = git("rev-parse", "--abbrev-ref", "HEAD").output;
  const before = git("rev-parse", "HEAD").output;
  const hasLocalEdits = git("status", "--porcelain").output !== "";
  if (currentBranch === branch && before === target && !hasLocalEdits) return reportProblem(`Up to date with ${branch}.`);
  lastProblem = null;

  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  if (hasLocalEdits) {
    git("stash", "push", "--include-untracked", "--message", `autosync ${stamp}: local edits on ${currentBranch}`);
    log(`Stashed the local edits on ${currentBranch} (get them back with: git stash list / git stash apply).`);
  }
  // Commits made here that GitHub doesn't have would be left behind by the switch: keep them on a branch
  if (localOnlyCommits > 0) {
    git("branch", `autosync-backup/${currentBranch}-${stamp}`, "HEAD");
    log(`Kept ${localOnlyCommits} local commit(s) on autosync-backup/${currentBranch}-${stamp}.`);
  }

  const checkout = git("checkout", "--force", "-B", branch, `origin/${branch}`);
  if (!checkout.ok) return reportProblem(`Couldn't check out ${branch}:\n${checkout.output}`);
  git("branch", "--quiet", "--set-upstream-to", `origin/${branch}`);

  const changedFiles = git("diff", "--name-only", before, "HEAD").output.split("\n").filter(Boolean);
  const branchNote = currentBranch === branch ? branch : `${currentBranch} -> ${branch}`;
  log(`Now on ${branchNote}: ${git("log", "-1", "--format=%h %s").output} (${changedFiles.length} file(s) changed)`);

  // New or updated packages: install them, then restart the server, which loads packages only once at start
  if (changedFiles.some((file) => file === "package.json" || file === "package-lock.json")) {
    const install = run("npm", ["install", "--no-audit", "--no-fund"], NPM_TIMEOUT_MILLISECONDS);
    log(install.ok ? "Installed updated packages." : `npm install failed:\n${install.output}`);
    run("launchctl", ["kickstart", "-k", `gui/${process.getuid()}/${SERVER_LABEL}`]);
    log("Restarted the server.");
  }

  updateRunningCopyIfChanged();
}

// A newer auto-sync in the repo replaces the running copy; launchd then starts the new one
function updateRunningCopyIfChanged() {
  if (__filename === REPO_COPY_OF_THIS_FILE || !fs.existsSync(REPO_COPY_OF_THIS_FILE)) return;
  const newVersion = fs.readFileSync(REPO_COPY_OF_THIS_FILE, "utf8");
  if (newVersion === fs.readFileSync(__filename, "utf8")) return;
  fs.writeFileSync(__filename, newVersion);
  log("Auto-sync itself was updated: restarting it.");
  process.exit(0);
}

log(`Auto-sync started: following ${PINNED_BRANCH || "the newest branch on GitHub"}, checking every ${CHECK_EVERY_SECONDS}s.`);
syncOnce();
setInterval(syncOnce, CHECK_EVERY_SECONDS * 1000);
