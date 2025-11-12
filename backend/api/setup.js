import express from "express";
import fs from "fs";
import path from "path";
import bcrypt from "bcrypt";
import User from "../models/User.js";
import { connectMongo } from "../db.js";
// import { reloadServer } from "../server.js";  // ✅ add this import

const router = express.Router();
const CONFIG_PATH = path.resolve("./config.json");

router.post("/", async (req, res) => {
  const { mongoURI, username, password, confirmPassword } = req.body;

  if (!mongoURI || !username || !password || !confirmPassword)
    return res.status(400).json({ success: false, message: "All fields are required." });

  if (password !== confirmPassword)
    return res.status(400).json({ success: false, message: "Passwords do not match." });

  try {
    // ✅ Connect to MongoDB
    await connectMongo(mongoURI);

    // ✅ Create admin user if not exists
    const existingUser = await User.findOne({ username });
    if (!existingUser) {
      const hashed = await bcrypt.hash(password, 10);
      await User.create({ username, password: hashed });
    }

    // ✅ Save config file
    const config = { mongo_uri: mongoURI, socket_port: 5000 };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");

    console.log("✅ Setup completed and config saved.");

    // ✅ Reload the socket + DB connection live (no restart needed)
    // await reloadServer();

    res.json({ success: true, message: "Setup complete." });
    
  } catch (err) {
    console.error("❌ Setup error:", err);
    res.status(500).json({ success: false, message: "Setup failed: " + err.message });
  }
});

export default router;
