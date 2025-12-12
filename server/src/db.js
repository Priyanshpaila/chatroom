import mongoose from "mongoose";

const DEFAULT_URI = "mongodb://127.0.0.1:27017/terminal_chat";

export async function connectDb(mongoUri) {
  const uri = (mongoUri || process.env.MONGODB_URI || DEFAULT_URI).trim();

  if (!uri) {
    throw new Error(
      "MongoDB URI is missing. Set MONGODB_URI in server/.env or pass it to connectDb()."
    );
  }

  mongoose.set("strictQuery", true);

  // Optional: better logging + stability
  mongoose.connection.on("connected", () => console.log("MongoDB connected"));
  mongoose.connection.on("error", (err) => console.error("MongoDB error:", err));
  mongoose.connection.on("disconnected", () => console.warn("MongoDB disconnected"));

  try {
    await mongoose.connect(uri, {
      // These options are safe on modern mongoose; extra options not required
      serverSelectionTimeoutMS: 8000,
    });
  } catch (err) {
    console.error("Failed to connect MongoDB with URI:", uri);
    throw err;
  }
}
