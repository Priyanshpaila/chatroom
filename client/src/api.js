const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

export function getToken() {
  return localStorage.getItem("chat_token") || "";
}

export function setToken(token) {
  localStorage.setItem("chat_token", token);
}

export function clearToken() {
  localStorage.removeItem("chat_token");
}

async function request(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error || data?.message || "Request failed";
    throw new Error(message);
  }
  return data;
}

export const api = {
  health: () => fetch(`${API_URL}/health`).then((r) => r.json()),
  register: (payload) => request("/api/auth/register", { method: "POST", body: payload, auth: false }),
  login: (payload) => request("/api/auth/login", { method: "POST", body: payload, auth: false }),
  me: () => request("/api/me"),
  users: (search) => request(`/api/users?search=${encodeURIComponent(search || "")}`),
  rooms: () => request("/api/rooms"),
  createRoom: (name) => request("/api/rooms", { method: "POST", body: { name } }),
  dmRoom: (userId) => request("/api/rooms/dm", { method: "POST", body: { userId } }),
  messages: (roomId, { before, limit } = {}) => {
    const qs = new URLSearchParams();
    if (before) qs.set("before", before);
    if (limit) qs.set("limit", String(limit));
    const q = qs.toString();
    return request(`/api/rooms/${roomId}/messages${q ? `?${q}` : ""}`);
  },
  clearRoom: (roomId) => request(`/api/rooms/${roomId}/clear`, { method: "POST" }),
};
