import mongoose from "mongoose";

const RoomMemberSchema = new mongoose.Schema(
  {
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: "Room", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: { type: String, enum: ["owner", "member"], default: "member" },
    lastClearedAt: { type: Date, default: new Date(0) },
    joinedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

RoomMemberSchema.index({ roomId: 1, userId: 1 }, { unique: true });

export const RoomMember = mongoose.model("RoomMember", RoomMemberSchema);
