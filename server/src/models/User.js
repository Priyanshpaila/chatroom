import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 64 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 128 },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true }
);

UserSchema.index({ email: 1 }, { unique: true });

export const User = mongoose.model("User", UserSchema);
