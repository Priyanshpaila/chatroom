import mongoose from "mongoose";

const RoomSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["group", "dm"], required: true },
    name: { type: String, trim: true, maxlength: 80 },
    // for dm rooms: store two userIds (sorted) to enforce uniqueness
    dmPair: { type: [mongoose.Schema.Types.ObjectId], default: undefined },
  },
  { timestamps: true }
);

// unique DM pair if present
RoomSchema.index({ type: 1, dmPair: 1 }, { unique: true, partialFilterExpression: { type: "dm" } });

export const Room = mongoose.model("Room", RoomSchema);
