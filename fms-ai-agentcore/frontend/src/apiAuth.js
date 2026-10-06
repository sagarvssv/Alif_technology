// Adds the x-api-key header to every request sent to OUR API.
// Requests to anything else (e.g. S3 presigned upload URLs) are untouched.
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "https://c0feinpvm5.execute-api.eu-central-1.amazonaws.com/prod";
const API_KEY = import.meta.env.VITE_API_KEY || "";

if (API_KEY && typeof window !== "undefined" && !window.__alifApiKeyInstalled) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (!url.startsWith(API_BASE_URL)) return originalFetch(input, init);
    const headers = new Headers(init.headers || (typeof input !== "string" ? input.headers : undefined));
    if (!headers.has("x-api-key")) headers.set("x-api-key", API_KEY);
    return originalFetch(input, { ...init, headers });
  };
  window.__alifApiKeyInstalled = true;
}
