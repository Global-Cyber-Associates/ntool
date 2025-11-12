// src/App.jsx
import React, { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import axios from "axios";

import Dashboard from "./components/dashboard/dashboard.jsx";
import Visualizer from "./components/visualizer/visualizer.jsx";
import Devices from "./components/devices/devices.jsx";
import DeviceDetail from "./components/devices/deviceControl.jsx/deviceControl.jsx";
import Logs from "./components/Logs/logs.jsx";
import Issues from "./components/issues/issues.jsx";
import Features from "./components/Features/features.jsx";
import Scan from "./components/scan/scan.jsx";
import TaskManager from "./components/devices/Taskmanager/taskmanager.jsx";
import UsbControl from "./components/usb/usb.jsx";
import InstalledApps from "./components/devices/installedApps/installedapps.jsx";
import Login from "./components/login/login.jsx";
import SetupPage from "./components/setup/SetupPage.jsx";

function App() {
  const [setupComplete, setSetupComplete] = useState(null);
  const [token, setToken] = useState(sessionStorage.getItem("jwt"));

  useEffect(() => {
    const checkSetup = async () => {
      try {
        const res = await axios.get("http://localhost:5000/api/check-setup");
        setSetupComplete(res.data.setupComplete);
      } catch (err) {
        console.error("Error checking setup:", err);
        setSetupComplete(false);
      }
    };
    checkSetup();
  }, []);

  useEffect(() => {
    const handleStorageChange = () => {
      setToken(sessionStorage.getItem("jwt"));
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  if (setupComplete === null)
    return <p style={{ color: "white", textAlign: "center" }}>Loading...</p>;

  if (!setupComplete) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/setup" element={<SetupPage />} />

      {/* Protected routes */}
      {token ? (
        <>
          <Route path="/" element={<Dashboard />} />
          <Route path="/visualizer" element={<Visualizer />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="/devices/:id" element={<DeviceDetail />} />
          <Route path="/tasks/:id" element={<TaskManager />} />
          <Route path="/apps/:id" element={<InstalledApps />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/issues" element={<Issues />} />
          <Route path="/features" element={<Features />} />
          <Route path="/scan" element={<Scan />} />
          <Route path="/usb" element={<UsbControl />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </>
      ) : (
        <Route path="*" element={<Navigate to="/login" replace />} />
      )}
    </Routes>
  );
}

export default App;
