import jwt from "jsonwebtoken";

export function signToken(user) {
  const secret = process.env.JWT_SECRET || "dev_secret_change_me";
  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";

  return jwt.sign(
    { sub: String(user._id), name: user.name, email: user.email },
    secret,
    { expiresIn }
  );
}

export function verifyToken(token) {
  const secret = process.env.JWT_SECRET || "dev_secret_change_me";
  return jwt.verify(token, secret);
}
