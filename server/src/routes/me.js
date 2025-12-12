import express from "express";

export const meRouter = express.Router();

meRouter.get("/", (req, res) => {
  return res.json({ user: req.user });
});
