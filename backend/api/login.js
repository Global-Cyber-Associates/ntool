// backend/api/login.js
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import User from "../models/User.js";

dotenv.config();
const router = express.Router();
const CONFIG_PATH = path.resolve("./config.json");
const JWT_SECRET = process.env.JWT_SECRET || "temporary_secret_key";

// ✅ Middleware to check setup completion
router.use((req, res, next) => {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (!config.mongo_uri) {
      return res.status(400).json({ success: false, message: "Setup not complete" });
    }
    next();
  } catch (err) {
    console.error("❌ Config read error:", err);
    res.status(500).json({ success: false, message: "Failed to read configuration" });
  }
});

// ✅ POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: "Username and password required" });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: "2h" });

    console.log(`✅ ${username} logged in successfully.`);
    res.json({ success: true, token });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;
