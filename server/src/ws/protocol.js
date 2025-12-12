export const TYPES = {
  JOIN: "join",
  SEND: "send",
  TYPING: "typing",

  JOINED: "joined",
  HISTORY: "history",
  MESSAGE: "message",
  PRESENCE: "presence",
  ERROR: "error"
};

export function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function sendJson(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}
