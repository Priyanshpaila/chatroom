import express from "express";
import { User } from "../models/User.js";

export const usersRouter = express.Router();

// GET /api/users?search=...
usersRouter.get("/", async (req, res) => {
  const me = req.user?.id;
  const q = String(req.query.search || "").trim();
  const limit = Math.min(20, Number(req.query.limit || 20));

  const base = me ? { _id: { $ne: me } } : {};
  const filter = q
    ? {
        ...base,
        $or: [
          { name: { $regex: q, $options: "i" } },
          { email: { $regex: q, $options: "i" } },
        ],
      }
    : base;

  const users = await User.find(filter).select("_id name email").limit(limit).lean();
  return res.json({
    users: users.map((u) => ({ id: String(u._id), name: u.name, email: u.email })),
  });
});
