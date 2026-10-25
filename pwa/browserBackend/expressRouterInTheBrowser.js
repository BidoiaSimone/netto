/* EXPRESS, AS FAR AS NETTO'S ROUTES USE IT, WITHOUT A SERVER
 * In the PWA nothing listens on a port: the page sends each API call to apiWorker.js as a message, and this file
 * finds the route that answers it. The build (pwa/build.mjs) swaps `require("express")` for this file, so every
 * backend/server/routes/*.js file runs unchanged.
 *
 * Only what the routes use is here: express.Router() with get / post / put / patch / delete / use, ":name" path
 * parameters, request.params / query / body, and response.status / json / send / set / type / attachment / end.
 * Like Express 5, an async route that throws is answered by the error handler (answerErrorsWithoutLoggingData).
 */

// "/accounts/:id/close" -> /^\/accounts\/([^/]+)\/close\/?$/ and ["id"]
function compilePath(path) {
  const parameterNames = [];
  const pattern = path.replace(/[.+*?^${}()|[\]\\]/g, "\\$&").replace(/:(\w+)/g, (match, name) => {
    parameterNames.push(name);
    return "([^/]+)";
  });
  return { regexp: new RegExp(`^${pattern}/?$`, "i"), parameterNames };
}

function Router() {
  const layers = []; // { method, regexp, parameterNames, handlers } or { router }

  const router = {
    use(...handlers) {
      for (const handler of handlers) layers.push(handler.handle ? { router: handler } : { middleware: handler });
      return router;
    },

    // Tries each layer in order; calls done() when none answered
    handle(request, response, done) {
      let index = 0;
      const next = (error) => {
        if (error) return done(error);
        const layer = layers[index++];
        if (!layer) return done();
        if (layer.router) return layer.router.handle(request, response, next);
        if (layer.middleware) return runHandlers([layer.middleware], request, response, next);
        if (layer.method !== request.method) return next();
        const match = layer.regexp.exec(request.path);
        if (!match) return next();
        request.params = Object.fromEntries(layer.parameterNames.map((name, i) => [name, decodeURIComponent(match[i + 1])]));
        runHandlers(layer.handlers, request, response, next);
      };
      next();
    },
  };

  for (const method of ["get", "post", "put", "patch", "delete"]) {
    router[method] = (path, ...handlers) => {
      layers.push({ method: method.toUpperCase(), ...compilePath(path), handlers });
      return router;
    };
  }
  return router;
}

// One handler after the other, each calling next(); a thrown error or a rejected promise goes to next(error)
function runHandlers(handlers, request, response, next) {
  let index = 0;
  const runNext = (error) => {
    if (error) return next(error);
    const handler = handlers[index++];
    if (!handler) return next();
    try {
      const result = handler(request, response, runNext);
      if (result && typeof result.catch === "function") result.catch(next);
    } catch (thrown) {
      next(thrown);
    }
  };
  runNext();
}

// A response that, once answered, resolves `whenAnswered` with { status, headers, body } (body: parsed JSON or text)
function createResponse() {
  let answer;
  const whenAnswered = new Promise((resolve) => { answer = resolve; });
  const response = {
    statusCode: 200,
    headers: {},
    headersSent: false,
    status(code) { response.statusCode = code; return response; },
    set(nameOrHeaders, value) {
      const headers = typeof nameOrHeaders === "string" ? { [nameOrHeaders]: value } : nameOrHeaders;
      for (const [name, headerValue] of Object.entries(headers)) response.headers[name.toLowerCase()] = String(headerValue);
      return response;
    },
    type(contentType) { return response.set("Content-Type", contentType); },
    attachment(fileName) { return response.set("Content-Disposition", `attachment; filename="${fileName}"`); },
    sendStatus(code) { return response.status(code).send(String(code)); },
    // Through JSON and back, like a real answer: dates become strings, undefined disappears
    json(data) { return finish(data === undefined ? null : JSON.parse(JSON.stringify(data))); },
    send(data) { return typeof data === "object" && data !== null ? response.json(data) : finish(data == null ? "" : String(data)); },
    end() { return finish(null); },
  };
  function finish(body) {
    if (response.headersSent) return response;
    response.headersSent = true;
    answer({ status: response.statusCode, headers: response.headers, body });
    return response;
  }
  return { response, whenAnswered };
}

// Answers one API call: { method, path ("/transactions?month=2026-10"), body } -> { status, headers, body }
function answerRequest(router, errorHandler, { method, path, body }) {
  const url = new URL(path, "http://netto.invalid");
  const query = {};
  for (const [key, value] of url.searchParams) {
    query[key] = key in query ? [].concat(query[key], value) : value; // ?a=1&a=2 -> ["1", "2"], as Express does
  }
  const request = { method: method.toUpperCase(), path: url.pathname, url: path, originalUrl: path, query, params: {}, body, headers: {} };
  const { response, whenAnswered } = createResponse();
  router.handle(request, response, (error) => {
    if (error) return errorHandler(error, request, response, () => {});
    response.status(404).json({ error: `No route for ${request.method} ${request.path}` });
  });
  return whenAnswered;
}

function express() {
  throw new Error("There is no server in the PWA: only express.Router() is available");
}
express.Router = Router;
express.json = () => (request, response, next) => next(); // bodies already arrive as objects

module.exports = express;
module.exports.answerRequest = answerRequest;
