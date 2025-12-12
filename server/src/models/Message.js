import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, index: true },
    sender: { type: String, required: true },
    text: { type: String, required: true }
  },
  { timestamps: true }
);

export const Message = mongoose.model("Message", MessageSchema);
