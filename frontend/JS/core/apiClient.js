// ---- talking to the server ----

const API_BASE_URL = ""; // same server that serves the page

// Sends a request to the API and returns the JSON answer.
// Throws an Error with the server's message when the answer is an error (status, data attached).
export async function callApi(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(API_BASE_URL + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Network error (Safari says "Load failed", Firefox "NetworkError..."): the server isn't running
    throw new Error("Can't reach netto's server. If this doesn't go away in a few seconds, check it with: bash scripts/service.sh log");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error((data && data.error) || response.statusText);
    error.status = response.status;
    error.data = data; // the whole answer, e.g. merge_into when a rename hits an existing category
    throw error;
  }
  return data;
}
