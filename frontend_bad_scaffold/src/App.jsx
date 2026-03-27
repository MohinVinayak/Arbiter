import { useState, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, Cell } from "recharts";

const API = "http://localhost:8000/api";

const COLORS = {
  bg: "#0a0a0f",
  surface: "#12121a",
  border: "#1e1e2e",
  accent: "#7c6aff",
  accent2: "#00d9a3",
  accent3: "#ff6a6a",
  text: "#e2e2f0",
  muted: "#6b6b8a",
};

const models = {
  "gemini-pro": { color: "#4285F4", label: "Gemini Pro" },
  "gpt-3.5-turbo": { color: "#10a37f", label: "GPT-3.5" },
  "gpt-4": { color: "#ab68ff", label: "GPT-4" },
};

// ── API Client ──────────────────────────────────────────────────

async function fetchSuites() {
  const res = await fetch(`${API}/suites/`);
  return res.json();
}

async function createSuite(data) {
  const res = await fetch(`${API}/suites/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

async function startRun(suiteId, selectedModels) {
  const res = await fetch(`${API}/runs/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ suite_id: suiteId, models: selectedModels }),
  });
  return res.json();
}

async function fetchRun(runId) {
  const res = await fetch(`${API}/runs/${runId}`);
  return res.json();
}

// ── Components ──────────────────────────────────────────────────

function ScoreBadge({ score }) {
  if (score == null) return <span style={{ color: COLORS.muted }}>—</span>;
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? COLORS.accent2 : pct >= 50 ? "#f5a623" : COLORS.accent3;
  return (
    <span style={{
      color,
      fontFamily: "monospace",
      fontWeight: 700,
      fontSize: 13,
      background: color + "18",
      padding: "2px 8px",
      borderRadius: 6,
      border: `1px solid ${color}40`,
    }}>
      {pct}%
    </span>
  );
}

function StatusPill({ status }) {
  const map = {
    pending: { color: "#f5a623", label: "Pending" },
    running: { color: COLORS.accent, label: "Running..." },
    completed: { color: COLORS.accent2, label: "Completed" },
    failed: { color: COLORS.accent3, label: "Failed" },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{
      color: s.color,
      background: s.color + "18",
      border: `1px solid ${s.color}40`,
      padding: "2px 10px",
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 600,
    }}>
      {status === "running" && "⟳ "}{s.label}
    </span>
  );
}

function Card({ children, style = {} }) {
  return (
    <div style={{
      background: COLORS.surface,
      border: `1px solid ${COLORS.border}`,
      borderRadius: 12,
      padding: 20,
      ...style,
    }}>
      {children}
    </div>
  );
}

// ── Main App ────────────────────────────────────────────────────

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [suites, setSuites] = useState([]);
  const [activeRun, setActiveRun] = useState(null);
  const [runData, setRunData] = useState(null);
  const [loading, setLoading] = useState(false);

  // New suite form state
  const [newSuiteName, setNewSuiteName] = useState("");
  const [newSuiteDesc, setNewSuiteDesc] = useState("");
  const [testCases, setTestCases] = useState([
    { prompt_template: "", input_variables: {}, expected_output: "", checks: [] },
  ]);
  const [selectedModels, setSelectedModels] = useState(["gemini-pro"]);

  useEffect(() => {
    fetchSuites().then(setSuites).catch(() => {});
  }, []);

  // Poll run status
  useEffect(() => {
    if (!activeRun) return;
    const poll = setInterval(async () => {
      const data = await fetchRun(activeRun);
      setRunData(data);
      if (data.status === "completed" || data.status === "failed") {
        clearInterval(poll);
        setLoading(false);
      }
    }, 2000);
    return () => clearInterval(poll);
  }, [activeRun]);

  async function handleCreateSuite() {
    if (!newSuiteName) return;
    await createSuite({
      name: newSuiteName,
      description: newSuiteDesc,
      test_cases: testCases,
    });
    const updated = await fetchSuites();
    setSuites(updated);
    setPage("dashboard");
    setNewSuiteName("");
    setNewSuiteDesc("");
    setTestCases([{ prompt_template: "", input_variables: {}, expected_output: "", checks: [] }]);
  }

  async function handleRunSuite(suiteId) {
    setLoading(true);
    setRunData(null);
    const run = await startRun(suiteId, selectedModels);
    setActiveRun(run.run_id);
    setPage("results");
  }

  // ── Chart Data ────────────────────────────

  function getChartData() {
    if (!runData?.results) return [];
    const byModel = {};
    for (const r of runData.results) {
      if (!byModel[r.model]) byModel[r.model] = { model: r.model, scores: [], latencies: [] };
      if (r.scores.overall != null) byModel[r.model].scores.push(r.scores.overall);
      if (r.latency_ms != null) byModel[r.model].latencies.push(r.latency_ms);
    }
    return Object.values(byModel).map(m => ({
      name: models[m.model]?.label || m.model,
      "Avg Score": m.scores.length ? Math.round((m.scores.reduce((a, b) => a + b, 0) / m.scores.length) * 100) : 0,
      "Avg Latency (ms)": m.latencies.length ? Math.round(m.latencies.reduce((a, b) => a + b, 0) / m.latencies.length) : 0,
      color: models[m.model]?.color || COLORS.accent,
    }));
  }

  // ── Render ────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, color: COLORS.text, fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Sidebar */}
      <div style={{ display: "flex" }}>
        <div style={{
          width: 220, minHeight: "100vh", background: COLORS.surface,
          borderRight: `1px solid ${COLORS.border}`, padding: "24px 16px",
          display: "flex", flexDirection: "column", gap: 8, position: "fixed",
        }}>
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.text }}>
              <span style={{ color: COLORS.accent }}>Eval</span>Forge
            </div>
            <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 4 }}>AI Quality Platform</div>
          </div>

          {[
            { id: "dashboard", label: "Dashboard", icon: "⬡" },
            { id: "new-suite", label: "New Suite", icon: "+" },
            { id: "results", label: "Results", icon: "◈" },
          ].map(item => (
            <button key={item.id} onClick={() => setPage(item.id)} style={{
              background: page === item.id ? COLORS.accent + "22" : "transparent",
              border: page === item.id ? `1px solid ${COLORS.accent}40` : "1px solid transparent",
              color: page === item.id ? COLORS.accent : COLORS.muted,
              borderRadius: 8, padding: "8px 12px", cursor: "pointer",
              textAlign: "left", fontSize: 14, fontWeight: 500,
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <span>{item.icon}</span>{item.label}
            </button>
          ))}

          {/* Model selector */}
          <div style={{ marginTop: "auto", borderTop: `1px solid ${COLORS.border}`, paddingTop: 16 }}>
            <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 8, fontWeight: 600, letterSpacing: 1 }}>MODELS</div>
            {Object.entries(models).map(([key, val]) => (
              <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: "pointer" }}>
                <input type="checkbox"
                  checked={selectedModels.includes(key)}
                  onChange={e => setSelectedModels(prev =>
                    e.target.checked ? [...prev, key] : prev.filter(m => m !== key)
                  )}
                />
                <span style={{ fontSize: 12, color: val.color }}>{val.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Main Content */}
        <div style={{ marginLeft: 220, flex: 1, padding: 32 }}>

          {/* DASHBOARD */}
          {page === "dashboard" && (
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Test Suites</h1>
              <p style={{ color: COLORS.muted, marginBottom: 24, fontSize: 14 }}>
                Define test cases, run against multiple LLMs, compare results.
              </p>

              {suites.length === 0 && (
                <Card style={{ textAlign: "center", padding: 48 }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🔬</div>
                  <div style={{ color: COLORS.muted, marginBottom: 16 }}>No test suites yet</div>
                  <button onClick={() => setPage("new-suite")} style={{
                    background: COLORS.accent, color: "#fff", border: "none",
                    borderRadius: 8, padding: "10px 20px", cursor: "pointer", fontWeight: 600,
                  }}>
                    Create your first suite
                  </button>
                </Card>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
                {suites.map(suite => (
                  <Card key={suite.id}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{suite.name}</div>
                    <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 16 }}>
                      {suite.description || "No description"}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: COLORS.muted }}>
                        {suite.test_case_count} test case{suite.test_case_count !== 1 ? "s" : ""}
                      </span>
                      <button onClick={() => handleRunSuite(suite.id)} disabled={loading} style={{
                        background: COLORS.accent2 + "22", color: COLORS.accent2,
                        border: `1px solid ${COLORS.accent2}40`, borderRadius: 6,
                        padding: "6px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600,
                      }}>
                        ▶ Run Eval
                      </button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* NEW SUITE */}
          {page === "new-suite" && (
            <div style={{ maxWidth: 700 }}>
              <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>New Test Suite</h1>

              <Card style={{ marginBottom: 16 }}>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, color: COLORS.muted, display: "block", marginBottom: 6 }}>Suite Name *</label>
                  <input value={newSuiteName} onChange={e => setNewSuiteName(e.target.value)}
                    placeholder="e.g. Customer Support Bot v1"
                    style={{
                      width: "100%", background: COLORS.bg, border: `1px solid ${COLORS.border}`,
                      borderRadius: 8, padding: "10px 12px", color: COLORS.text, fontSize: 14,
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 13, color: COLORS.muted, display: "block", marginBottom: 6 }}>Description</label>
                  <input value={newSuiteDesc} onChange={e => setNewSuiteDesc(e.target.value)}
                    placeholder="What does this suite test?"
                    style={{
                      width: "100%", background: COLORS.bg, border: `1px solid ${COLORS.border}`,
                      borderRadius: 8, padding: "10px 12px", color: COLORS.text, fontSize: 14,
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </Card>

              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Test Cases</h2>
              {testCases.map((tc, i) => (
                <Card key={i} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 12, fontWeight: 600 }}>TEST CASE {i + 1}</div>
                  {[
                    { key: "prompt_template", label: "Prompt Template", placeholder: 'e.g. "Summarize this: {input}"' },
                    { key: "expected_output", label: "Expected Output (optional)", placeholder: "Reference answer for scoring..." },
                  ].map(field => (
                    <div key={field.key} style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 12, color: COLORS.muted, display: "block", marginBottom: 4 }}>{field.label}</label>
                      <textarea value={tc[field.key]}
                        onChange={e => {
                          const updated = [...testCases];
                          updated[i][field.key] = e.target.value;
                          setTestCases(updated);
                        }}
                        placeholder={field.placeholder}
                        rows={2}
                        style={{
                          width: "100%", background: COLORS.bg, border: `1px solid ${COLORS.border}`,
                          borderRadius: 8, padding: "8px 12px", color: COLORS.text, fontSize: 13,
                          resize: "vertical", fontFamily: "inherit", boxSizing: "border-box",
                        }}
                      />
                    </div>
                  ))}
                </Card>
              ))}

              <button onClick={() => setTestCases([...testCases, { prompt_template: "", input_variables: {}, expected_output: "", checks: [] }])}
                style={{
                  background: "transparent", border: `1px dashed ${COLORS.border}`,
                  color: COLORS.muted, borderRadius: 8, padding: "8px 16px",
                  cursor: "pointer", width: "100%", marginBottom: 20, fontSize: 13,
                }}>
                + Add Test Case
              </button>

              <button onClick={handleCreateSuite} style={{
                background: COLORS.accent, color: "#fff", border: "none",
                borderRadius: 8, padding: "12px 24px", cursor: "pointer",
                fontWeight: 700, fontSize: 14, width: "100%",
              }}>
                Create Suite
              </button>
            </div>
          )}

          {/* RESULTS */}
          {page === "results" && (
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Eval Results</h1>

              {!runData && loading && (
                <Card style={{ textAlign: "center", padding: 48 }}>
                  <div style={{ fontSize: 32, marginBottom: 12, animation: "spin 1s linear infinite" }}>⟳</div>
                  <div style={{ color: COLORS.muted }}>Running evaluation...</div>
                </Card>
              )}

              {runData && (
                <div>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 24 }}>
                    <StatusPill status={runData.status} />
                    <span style={{ color: COLORS.muted, fontSize: 13 }}>
                      {runData.results?.length || 0} results across {runData.models?.length || 0} model(s)
                    </span>
                  </div>

                  {/* Charts */}
                  {getChartData().length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
                      <Card>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Average Score by Model</div>
                        <ResponsiveContainer width="100%" height={180}>
                          <BarChart data={getChartData()}>
                            <XAxis dataKey="name" tick={{ fill: COLORS.muted, fontSize: 12 }} />
                            <YAxis domain={[0, 100]} tick={{ fill: COLORS.muted, fontSize: 12 }} />
                            <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }} />
                            <Bar dataKey="Avg Score" radius={[4, 4, 0, 0]}>
                              {getChartData().map((entry, i) => <Cell key={i} fill={entry.color} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </Card>
                      <Card>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Avg Latency (ms)</div>
                        <ResponsiveContainer width="100%" height={180}>
                          <BarChart data={getChartData()}>
                            <XAxis dataKey="name" tick={{ fill: COLORS.muted, fontSize: 12 }} />
                            <YAxis tick={{ fill: COLORS.muted, fontSize: 12 }} />
                            <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }} />
                            <Bar dataKey="Avg Latency (ms)" radius={[4, 4, 0, 0]}>
                              {getChartData().map((entry, i) => <Cell key={i} fill={entry.color} opacity={0.7} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </Card>
                    </div>
                  )}

                  {/* Results Table */}
                  <Card>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Detailed Results</div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                          <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                            {["Model", "Output (preview)", "Det.", "Semantic", "Judge", "Overall", "Latency"].map(h => (
                              <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: COLORS.muted, fontWeight: 500, whiteSpace: "nowrap" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {runData.results?.map((r, i) => (
                            <tr key={i} style={{ borderBottom: `1px solid ${COLORS.border}22` }}>
                              <td style={{ padding: "10px 12px" }}>
                                <span style={{ color: models[r.model]?.color || COLORS.accent, fontWeight: 600 }}>
                                  {models[r.model]?.label || r.model}
                                </span>
                              </td>
                              <td style={{ padding: "10px 12px", maxWidth: 200 }}>
                                <span style={{ color: COLORS.muted, fontFamily: "DM Mono, monospace", fontSize: 12 }}>
                                  {r.error ? `❌ ${r.error}` : (r.output?.slice(0, 80) + (r.output?.length > 80 ? "..." : ""))}
                                </span>
                              </td>
                              <td style={{ padding: "10px 12px" }}><ScoreBadge score={r.scores.deterministic} /></td>
                              <td style={{ padding: "10px 12px" }}><ScoreBadge score={r.scores.semantic} /></td>
                              <td style={{ padding: "10px 12px" }}><ScoreBadge score={r.scores.judge} /></td>
                              <td style={{ padding: "10px 12px" }}><ScoreBadge score={r.scores.overall} /></td>
                              <td style={{ padding: "10px 12px", color: COLORS.muted, fontFamily: "monospace" }}>
                                {r.latency_ms ? `${r.latency_ms}ms` : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>

                  {/* Judge Reasoning */}
                  {runData.results?.some(r => r.judge_reasoning) && (
                    <Card style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Judge Reasoning</div>
                      {runData.results?.filter(r => r.judge_reasoning).map((r, i) => (
                        <div key={i} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${COLORS.border}` }}>
                          <span style={{ color: models[r.model]?.color || COLORS.accent, fontWeight: 600, fontSize: 12 }}>
                            {models[r.model]?.label || r.model}
                          </span>
                          <p style={{ color: COLORS.muted, fontSize: 13, margin: "4px 0 0" }}>{r.judge_reasoning}</p>
                        </div>
                      ))}
                    </Card>
                  )}
                </div>
              )}

              {!runData && !loading && (
                <Card style={{ textAlign: "center", padding: 48 }}>
                  <div style={{ color: COLORS.muted }}>No run selected. Go to Dashboard and run a suite.</div>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; }
        input, textarea { outline: none; }
        input:focus, textarea:focus { border-color: ${COLORS.accent} !important; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
