/* HTTP ERRORS
 * Code deep inside a request (validation, holdings rebuild...) can throw an error that already
 * knows which HTTP status it should become, instead of every caller having to translate it.
 */

// An Error carrying the HTTP status to answer with (e.g. 400 for "you sent something invalid")
function createHttpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Answers with the error's own status, or 500 (server fault) when it has none
function sendErrorResponse(response, error) {
  response.status(error.status ?? 500).json({ error: error.message });
}

// "" / null / undefined -> null, anything else -> a number (NaN if it isn't one).
// Used for optional ids sent by the frontend (account, category).
const parseOptionalId = (value) => (value === undefined || value === null || value === "" ? null : Number(value));

module.exports = { createHttpError, sendErrorResponse, parseOptionalId };
