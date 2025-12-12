import express from "express";
import bcrypt from "bcryptjs";
import { User } from "../models/User.js";
import { signToken } from "../auth/jwt.js";

export const authRouter = express.Router();

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

authRouter.post("/register", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");

  if (!name || name.length < 2) return res.status(400).json({ error: "Name is required (min 2 chars)" });
  if (!email || !email.includes("@")) return res.status(400).json({ error: "Valid email is required" });
  if (!password || password.length < 6) return res.status(400).json({ error: "Password min 6 chars" });

  const exists = await User.findOne({ email }).lean();
  if (exists) return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ name, email, passwordHash });

  const token = signToken(user);
  return res.json({ token, user: { id: String(user._id), name: user.name, email: user.email } });
});

authRouter.post("/login", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");

  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  const user = await User.findOne({ email });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const token = signToken(user);
  return res.json({ token, user: { id: String(user._id), name: user.name, email: user.email } });
});
