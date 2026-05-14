export async function apiRequest(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(path, {
    credentials: "include",
    headers: isFormData ? (options.headers || {}) : { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (response.status === 204) return null;
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message = payload?.detail || payload?.message || payload || response.statusText;
    throw new Error(Array.isArray(message) ? message.map((m) => m.msg || m).join(", ") : String(message));
  }
  return payload;
}

export async function persistScoreUpload(file) {
  const form = new FormData();
  form.append("file", file);
  return fetch("/scores/upload", {
    method: "POST",
    credentials: "include",
    body: form,
  }).catch(() => null);
}
