import { verifyToken } from "./jwt.js";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) return res.status(401).json({ error: "Missing Bearer token" });

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, name: payload.name, email: payload.email };
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}
