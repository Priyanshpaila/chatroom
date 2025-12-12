import mongoose from "mongoose";

const DEFAULT_URI = "mongodb://192.168.13.84/terminal_chat";

export async function connectDb(mongoUri) {
  const uri = (mongoUri || process.env.MONGODB_URI || DEFAULT_URI).trim();

  if (!uri) {
    throw new Error(
      "MongoDB URI is missing. Set MONGODB_URI in server/.env or pass it to connectDb()."
    );
  }

  mongoose.set("strictQuery", true);

  mongoose.connection.on("connected", () => console.log("MongoDB connected"));
  mongoose.connection.on("error", (err) => console.error("MongoDB error:", err));
  mongoose.connection.on("disconnected", () => console.warn("MongoDB disconnected"));

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
}
