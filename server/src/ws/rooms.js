import { sendJson, TYPES } from "./protocol.js";

const roomSockets = new Map(); // roomId -> Set(ws)

export function joinRoomSocket(ws, roomId) {
  leaveRoomSocket(ws);

  ws._roomId = roomId;
  if (!roomSockets.has(roomId)) roomSockets.set(roomId, new Set());
  roomSockets.get(roomId).add(ws);
  broadcastPresence(roomId);
}

export function leaveRoomSocket(ws) {
  const roomId = ws._roomId;
  if (!roomId) return;

  const set = roomSockets.get(roomId);
  if (set) {
    set.delete(ws);
    if (set.size === 0) roomSockets.delete(roomId);
  }
  ws._roomId = null;

  broadcastPresence(roomId);
}

export function broadcastToRoom(roomId, payload, { excludeWs } = {}) {
  const set = roomSockets.get(roomId);
  if (!set) return;

  for (const client of set) {
    if (excludeWs && client === excludeWs) continue;
    sendJson(client, payload);
  }
}

export function broadcastPresence(roomId) {
  const set = roomSockets.get(roomId);
  const online = set
    ? Array.from(set)
        .filter((w) => w._user)
        .map((w) => ({ id: w._user.id, name: w._user.name }))
    : [];

  broadcastToRoom(roomId, { type: TYPES.PRESENCE, roomId, online });
}
