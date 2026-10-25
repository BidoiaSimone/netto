/* ERRORS NO ROUTE ANSWERED: reply with the status, keep the request's data out of the server log
 * Without this, Express prints every error's message and stack to the log. For a body that isn't valid JSON
 * the message quotes the body itself ('"Rent 1200" is not valid JSON'), so amounts and descriptions would end up
 * in /tmp/netto.log or ~/Library/Logs/netto.log. Request errors (4xx) are answered and not logged at all;
 * server errors (5xx) log only their stack's lines below the message, which point at the code, not at the data.
 */

// Express knows an error handler by its 4 parameters, so `next` stays even though it isn't used
function answerErrorsWithoutLoggingData(error, request, response, next) {
  const status = Number(error.status || error.statusCode) || 500;
  if (status >= 500) {
    const whereItHappened = String(error.stack || "").split("\n").filter((line) => line.trim().startsWith("at ")).join("\n");
    console.error(`${error.name || "Error"} on ${request.method} ${request.path}\n${whereItHappened}`);
  }
  if (response.headersSent) return response.end(); // Express's own handler would log the message
  response.status(status).json({ error: status >= 500 ? "Internal server error" : "Invalid request" });
}

module.exports = { answerErrorsWithoutLoggingData };
