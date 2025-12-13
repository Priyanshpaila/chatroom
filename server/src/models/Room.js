import mongoose from "mongoose";

const RoomSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["group", "dm"], required: true },

    // group room fields
    name: { type: String, trim: true, maxlength: 80 },
    visibility: {
      type: String,
      enum: ["public", "private"],
      default: function () {
        return this.type === "group" ? "public" : "private";
      },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // for private group rooms
    // NOTE: never return this value in APIs
    passHash: { type: String, select: false },

    // dm rooms: store two userIds (sorted) to enforce uniqueness
    dmPair: { type: [mongoose.Schema.Types.ObjectId], default: undefined },
  },
  { timestamps: true }
);

// unique DM pair if present
RoomSchema.index(
  { type: 1, dmPair: 1 },
  { unique: true, partialFilterExpression: { type: "dm" } }
);

export const Room = mongoose.model("Room", RoomSchema);
