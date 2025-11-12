import React, { useState } from "react";
import axios from "axios";
import { Eye, EyeOff } from "lucide-react";
import "./setup.css";

const SetupPage = () => {
  const [form, setForm] = useState({
    mongoURI: "",
    username: "",
    password: "",
    confirmPassword: "",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (form.password !== form.confirmPassword) {
      setMessage("❌ Passwords do not match");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const res = await axios.post("http://localhost:5000/api/setup", form);
      if (res.data.success) {
        setMessage("✅ Setup completed successfully! Redirecting...");
        setTimeout(() => (window.location.href = "/login"), 2000);
      } else {
        setMessage("❌ Setup failed. Try again.");
      }
    } catch (err) {
      setMessage("❌ Could not connect to server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="setup-container">
      <div className="setup-box">
        <h2 className="setup-title">🚀 Initial Setup</h2>
        <p className="setup-subtitle">
          Enter your MongoDB URI and create your first admin account.
        </p>

        <form onSubmit={handleSubmit} className="setup-form">
          <div className="form-group">
            <label>MongoDB URI</label>
            <input
              type="text"
              name="mongoURI"
              value={form.mongoURI}
              onChange={handleChange}
              required
            />
          </div>

          <p className="setup-subtitle">Create Admin Account</p>

          <div className="form-group">
            <label>Admin Username</label>
            <input
              type="text"
              name="username"
              value={form.username}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group password-group">
            <label>Password</label>
            <input
              type={showPassword ? "text" : "password"}
              name="password"
              value={form.password}
              onChange={handleChange}
              required
            />
            <button
              type="button"
              className="view-pass-btn"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <div className="form-group">
            <label>Confirm Password</label>
            <input
              type={showPassword ? "text" : "password"}
              name="confirmPassword"
              value={form.confirmPassword}
              onChange={handleChange}
              required
            />
          </div>

          <button className="setup-btn" type="submit" disabled={loading}>
            {loading ? "Setting up..." : "Complete Setup"}
          </button>
        </form>

        {message && (
          <p
            className={`setup-message ${
              message.startsWith("✅")
                ? "success"
                : message.startsWith("❌")
                ? "error"
                : ""
            }`}
          >
            {message}
          </p>
        )}
      </div>
    </div>
  );
};

export default SetupPage;
