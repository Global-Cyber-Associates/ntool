import React, { useEffect, useState } from "react";
import "./dashboard.css";
import Sidebar from "../navigation/sidenav.jsx";

const Dashboard = () => {
  const [visualizerData, setVisualizerData] = useState([]);
  const [systemInfo, setSystemInfo] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Helper: robust date parser for various API shapes
  const parseDate = (v) => {
    if (!v) return null;
    // If v is an object like { $date: "ISO..." } or { "$date": { "$numberLong": "..." } }
    if (typeof v === "object") {
      if (v.$date) return new Date(v.$date);
      if (v["$date"]) return new Date(v["$date"]);
      if (v.$numberLong) return new Date(Number(v.$numberLong));
      if (v["$numberLong"]) return new Date(Number(v["$numberLong"]));
    }
    // fallback: string or number
    return new Date(v);
  };

  // Helper: extract IP addresses from a system document (handles old and new shapes)
  const getAgentIPs = (sys) => {
    if (!sys) return [];
    const data = sys.data || sys; // support both nested and flat shapes

    // wlan_info may be an array of objects with address field
    const wlanArray = Array.isArray(data.wlan_info)
      ? data.wlan_info.map((w) => w.address).filter(Boolean)
      : [];

    // possible alternative fields
    const ipCandidates = [
      data.ip,
      data.address,
      // agent-level nested ip possibilities
      data.wlan_ip?.[0]?.address,
      // any single address found in wlan_info
      ...(wlanArray || []),
    ].filter(Boolean);

    // Return unique IPs
    return Array.from(new Set(ipCandidates));
  };

  useEffect(() => {
    let mounted = true;

    const fetchData = async () => {
      try {
        setLoading(true);
        const [vizRes, sysRes] = await Promise.all([
          fetch("http://localhost:5000/api/visualizer-data"),
          fetch("http://localhost:5000/api/system"),
        ]);

        if (!vizRes.ok || !sysRes.ok) {
          throw new Error("Failed to fetch data from API");
        }

        const [vizRaw, sysRaw] = await Promise.all([vizRes.json(), sysRes.json()]);

        // Defensive: normalize visualizer createdAt and ensure array
        const vizData = Array.isArray(vizRaw) ? vizRaw : [];
        // Group visualizer by latest per IP (handling createdAt.$date etc)
        const latestVisualizer = Object.values(
          vizData.reduce((acc, d) => {
            const ip = d.ip;
            if (!ip) return acc;
            const existing = acc[ip];
            const newDate = parseDate(d.createdAt || d.created_at || d.timestamp);
            const existingDate = existing && parseDate(existing.createdAt || existing.created_at || existing.timestamp);
            if (!existing || (newDate && existingDate && newDate > existingDate) || (newDate && !existingDate)) {
              acc[ip] = d;
            }
            return acc;
          }, {})
        );

        const systemArr = Array.isArray(sysRaw) ? sysRaw : [];

        if (!mounted) return;
        setVisualizerData(latestVisualizer);
        setSystemInfo(systemArr);
        setLastUpdated(new Date());
      } catch (err) {
        console.error("Error fetching dashboard data:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 60000); // refresh every 60s
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Build flattened agent IP list from systemInfo
  const agentIPs = Array.from(new Set(systemInfo.flatMap((s) => getAgentIPs(s))));

  // Active agent devices — visualizer entries that are agents and match a system IP
  const activeAgents = visualizerData.filter((d) => !d.noAgent && agentIPs.includes(d.ip));

  // Inactive agents — system docs which have at least one IP but none show up in visualizer
  // NOTE: if a system doc has no IP candidates, we exclude it from inactive to avoid false positives
  const inactiveAgents = systemInfo.filter((sys) => {
    const ips = getAgentIPs(sys);
    if (ips.length === 0) return false; // no ip -> don't mark inactive (avoid false positives)
    return !ips.some((ip) => visualizerData.some((v) => v.ip === ip));
  });

  // Unmanaged devices — devices found by visualizer that are flagged noAgent
  const unmanagedDevices = visualizerData.filter((d) => d.noAgent === true);

  // Helper to find system doc from an IP
  const findSystemByIp = (ip) => systemInfo.find((s) => getAgentIPs(s).includes(ip));

  return (
    <div className="dashboard">
      <Sidebar />
      <div className="dashboard-container">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1 className="dashboard-title">Network & Device Overview</h1>
          <div style={{ fontSize: "0.9rem", color: "#666" }}>
            {lastUpdated ? `Last update: ${new Date(lastUpdated).toLocaleString()}` : "Not updated yet"}
          </div>
        </div>

        {loading ? (
          <p>Loading data...</p>
        ) : (
          <>
            {/* KPI Summary */}
            <div className="stats-grid">
              <div className="stat-card green">
                <h2>Active Agent Devices</h2>
                <p>{activeAgents.length}</p>
              </div>
              <div className="stat-card red">
                <h2>Inactive Agent Devices</h2>
                <p>{inactiveAgents.length}</p>
              </div>
              <div className="stat-card orange">
                <h2>Unmanaged Devices</h2>
                <p>{unmanagedDevices.length}</p>
              </div>
            </div>

           {/* Active Agent Table */}
<div className="table-container">
  <h2>Active Agent Devices</h2>
  <table className="activity-table">
    <thead>
      <tr>
        <th>Agent ID</th>
        <th>Hostname</th>
        <th>IP</th>
        <th>CPU Cores</th>
        <th>RAM Usage</th>
        <th>OS</th>
      </tr>
    </thead>
    <tbody>
      {activeAgents.map((d) => {
        const sys = findSystemByIp(d.ip);
        const sdata = sys?.data || sys || {};
        return (
          <tr key={d.ip}>
            {/* ✅ use top-level sys.agentId only */}
            <td>{sys?.agentId || "-"}</td>
            <td>{sdata.hostname || "-"}</td>
            <td>{d.ip}</td>
            <td>{sdata.cpu?.logical_cores ?? sdata.cpu?.physical_cores ?? "-"}</td>
            <td>
              {typeof sdata.memory?.ram_percent === "number"
                ? `${sdata.memory.ram_percent}%`
                : "-"}
            </td>
            <td>
              {(sdata.os_type || "-") + " " + (sdata.os_release || "")}
            </td>
          </tr>
        );
      })}
    </tbody>
  </table>
</div>


            {/* Inactive Agent Table */}
            <div className="table-container">
              <h2>Inactive Agent Devices</h2>
              <table className="activity-table">
                <thead>
                  <tr>
                    <th>Hostname</th>
                    <th>Last Known IP</th>
                    <th>OS</th>
                    <th>Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {inactiveAgents.map((sys) => {
                    const sdata = sys.data || sys || {};
                    const ips = getAgentIPs(sys);
                    const lastSeenDate = parseDate(sys.data?.timestamp || sys.timestamp || sys.collected_at || sys.updatedAt);
                    return (
                      <tr key={sys._id?.$oid || sys._id || sdata.machine_id || ips.join(",")}>
                        <td>{sdata.hostname || sdata.agent_id || "-"}</td>
                        <td>{ips.join(", ") || "-"}</td>
                        <td>{(sdata.os_type || sdata.data?.os_type || "-") + " " + (sdata.os_release || sdata.data?.os_release || "")}</td>
                        <td>{lastSeenDate ? lastSeenDate.toLocaleString() : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Unmanaged Devices Table */}
            <div className="table-container">
              <h2>Unmanaged (No Agent) Devices</h2>
              <table className="activity-table">
                <thead>
                  <tr>
                    <th>IP</th>
                    <th>MAC</th>
                    <th>Detected At</th>
                  </tr>
                </thead>
                <tbody>
                  {unmanagedDevices.map((d) => {
                    const created = parseDate(d.createdAt || d.created_at || d.timestamp);
                    return (
                      <tr key={d._id?.$oid || d._id || d.ip}>
                        <td>{d.ip}</td>
                        <td>{d.mac || "-"}</td>
                        <td>{created ? created.toLocaleString() : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
