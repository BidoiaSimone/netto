/* NODE'S "path", ENOUGH FOR THE FILE NAMES THE BACKEND BUILDS (nothing is written to disk in the browser) */

const join = (...parts) => parts.filter(Boolean).join("/").replace(/\/+/g, "/");
const basename = (file, extension) => {
  const name = String(file).split("/").pop();
  return extension && name.endsWith(extension) ? name.slice(0, -extension.length) : name;
};
const dirname = (file) => String(file).split("/").slice(0, -1).join("/") || "/";
const extname = (file) => (/\.[^./]*$/.exec(basename(file)) || [""])[0];

module.exports = { join, resolve: join, basename, dirname, extname, sep: "/" };
