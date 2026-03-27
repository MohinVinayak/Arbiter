import { useState, useEffect, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const API = "http://localhost:8000/api";

const DYNAMIC_COLORS = [
  { color: "#FF5A26", bg: "rgba(255, 90, 38, 0.1)" },
  { color: "#10A37F", bg: "rgba(16, 163, 127, 0.1)" },
  { color: "#4A6BFF", bg: "rgba(74, 107, 255, 0.1)" },
  { color: "#F5A623", bg: "rgba(245, 166, 35, 0.1)" },
  { color: "#9B51E0", bg: "rgba(155, 81, 224, 0.1)" },
  { color: "#E91E63", bg: "rgba(233, 30, 99, 0.1)" },
];

const BACKEND_MODELS = [
  "gemini-2.0-flash",
  "groq/llama-3.3-70b-versatile",
  "groq/llama-3.1-8b-instant",
  "github/gpt-4o-mini",
];

function formatModelLabel(rawId) {
  const map = {
    "gemini-2.0-flash":                   "Gemini 2.0 Flash",
    "groq/llama-3.3-70b-versatile":       "Llama 3.3 70B (Groq)",
    "groq/llama-3.1-8b-instant":          "Llama 3.1 8B (Groq)",
    "github/gpt-4o-mini":                 "GPT-4o Mini",
  };
  return map[rawId] || rawId.split("/").pop().replace(/-/g, " ");
}

function scoreColor(score) {
  if (score == null) return "#a1a1aa";
  if (score >= 0.8) return "#10A37F";
  if (score >= 0.5) return "#F5A623";
  return "#FF5A26";
}

// ── API helpers ───────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, opts);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [isDark, setIsDark] = useState(() => JSON.parse(localStorage.getItem('themeDark')) || false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem('themeDark', JSON.stringify(isDark));
  }, [isDark]);

  // ── Models (fixed list, no fake fetch) ───────────────────
  const [models, setModels] = useState({});
  const [selectedModels, setSelectedModels] = useState([]);
  const [judgeModel, setJudgeModel] = useState(BACKEND_MODELS[0]);
  const [isJudgeDropdownOpen, setIsJudgeDropdownOpen] = useState(false);

  useEffect(() => {
    const generated = {};
    BACKEND_MODELS.forEach((id, i) => {
      const theme = DYNAMIC_COLORS[i % DYNAMIC_COLORS.length];
      generated[id] = { color: theme.color, bg: theme.bg, label: formatModelLabel(id) };
    });
    setModels(generated);
    setSelectedModels([BACKEND_MODELS[0]]); // Gemini by default
  }, []);

  // ── Suites — loaded from real backend ────────────────────
  const [suites, setSuites] = useState([]);
  const [suitesLoading, setSuitesLoading] = useState(true);
  const [suitesError, setSuitesError] = useState(null);
  const [deletingSuiteId, setDeletingSuiteId] = useState(null);

  async function loadSuites() {
    try {
      setSuitesLoading(true);
      const data = await apiFetch("/suites/");
      setSuites(Array.isArray(data) ? data : []);
      setSuitesError(null);
    } catch (e) {
      setSuitesError("Could not connect to backend. Make sure uvicorn is running on port 8000.");
    } finally {
      setSuitesLoading(false);
    }
  }

  useEffect(() => { loadSuites(); }, []);

  async function handleDeleteSuite(suite) {
    const ok = window.confirm(`Delete suite "${suite.name}"? This cannot be undone.`);
    if (!ok) return;

    setDeletingSuiteId(suite.id);
    try {
      await apiFetch(`/suites/${suite.id}`, { method: "DELETE" });
      await loadSuites();
    } catch (e) {
      alert("Failed to delete suite. Please try again.");
    } finally {
      setDeletingSuiteId(null);
    }
  }

  // ── New suite form ────────────────────────────────────────
  const [newSuiteName, setNewSuiteName] = useState("");
  const [newSuiteDesc, setNewSuiteDesc] = useState("");
  const [testCases, setTestCases] = useState([{ prompt_template: "", expected_output: "" }]);
  const [isDeploying, setIsDeploying] = useState(false);

  async function handleDeploySuite() {
    const validCases = testCases.filter(tc => tc.prompt_template.trim() !== "");
    if (!newSuiteName.trim() || validCases.length === 0) {
      alert("Please add a suite name and at least one prompt.");
      return;
    }
    setIsDeploying(true);
    try {
      await apiFetch("/suites/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newSuiteName,
          description: newSuiteDesc,
          test_cases: validCases,
        }),
      });
      await loadSuites();
      setPage("dashboard");
      setNewSuiteName("");
      setNewSuiteDesc("");
      setTestCases([{ prompt_template: "", expected_output: "" }]);
    } catch (e) {
      alert("Failed to create suite. Check that backend is running.");
    } finally {
      setIsDeploying(false);
    }
  }

  // ── Run eval — real backend ───────────────────────────────
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [activeRunId, setActiveRunId] = useState(null);
  const [runError, setRunError] = useState(null);
  
  const [runsHistory, setRunsHistory] = useState([]);
  const [expandedRunId, setExpandedRunId] = useState(null);
  const [expandedRunDetails, setExpandedRunDetails] = useState({});

  async function loadRunsHistory() {
    try {
      const data = await apiFetch("/runs/");
      setRunsHistory(data || []);
    } catch(e) { console.error(e); }
  }

  useEffect(() => {
    if (page === "results") {
      loadRunsHistory();
    }
  }, [page]);

  async function handleExpandRun(runId) {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(runId);
    if (!expandedRunDetails[runId]) {
      try {
        const data = await apiFetch(`/runs/${runId}`);
        setExpandedRunDetails(prev => ({ ...prev, [runId]: transformRunData(data) }));
      } catch (e) {
        console.error("Fetch run details failed", e);
      }
    }
  }

  async function handleRunEval(suite) {
    if (selectedModels.length === 0) {
      alert("Please select at least one model.");
      return;
    }
    setPage("results");
    setIsEvaluating(true);
    setRunError(null);

    try {
      const run = await apiFetch("/runs/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suite_id: suite.id, models: selectedModels, judge_model: judgeModel }),
      });
      setActiveRunId(run.run_id);
    } catch (e) {
      setIsEvaluating(false);
      setRunError("Failed to start run. Check backend.");
    }
  }

  // ── Poll run status ───────────────────────────────────────
  useEffect(() => {
    if (!activeRunId) return;
    const poll = setInterval(async () => {
      try {
        const data = await apiFetch(`/runs/${activeRunId}`);
        if (data.status === "completed" || data.status === "failed") {
          clearInterval(poll);
          setIsEvaluating(false);
          setExpandedRunDetails(prev => ({ ...prev, [activeRunId]: transformRunData(data) }));
          setExpandedRunId(activeRunId);
          setActiveRunId(null);
          loadRunsHistory();
        }
      } catch (e) {
        clearInterval(poll);
        setIsEvaluating(false);
        setRunError("Lost connection while polling results.");
      }
    }, 2500);
    return () => clearInterval(poll);
  }, [activeRunId]);

  // ── Transform backend run data into UI shape ──────────────
  function transformRunData(run) {
    if (!run?.results?.length) return null;

    // Group by model
    const byModel = {};
    for (const r of run.results) {
      if (!byModel[r.model]) byModel[r.model] = { results: [] };
      byModel[r.model].results.push(r);
    }

    const metrics = Object.entries(byModel).map(([modelKey, d]) => {
      const validScores = d.results.filter(r => r.scores?.overall != null).map(r => r.scores.overall);
      const avgScore = validScores.length ? validScores.reduce((a, b) => a + b, 0) / validScores.length : null;
      const validLat = d.results.filter(r => r.latency_ms).map(r => r.latency_ms);
      const avgLat = validLat.length ? Math.round(validLat.reduce((a, b) => a + b, 0) / validLat.length) : null;

      // Get judge reasoning from first result that has one
      const reasoning = d.results.find(r =>
        r.judge_reasoning &&
        !r.judge_reasoning.startsWith("No output") &&
        !r.judge_reasoning.startsWith("Judge failed") &&
        !r.judge_reasoning.startsWith("Could not")
      )?.judge_reasoning || null;

      const meta = models[modelKey] || { color: "#a1a1aa", label: modelKey };
      const sc = scoreColor(avgScore);

      return {
        name: meta.label,
        color: meta.color,
        scoreRaw: avgScore,
        score: avgScore != null ? Math.round(avgScore * 100) : null,
        scoreColor: sc,
        latency: avgLat,
        reasoning,
        hasError: d.results.every(r => r.error),
        errorMsg: d.results[0]?.error,
        // Per-test breakdown
        breakdown: d.results.map(r => ({
          det: r.scores?.deterministic,
          sem: r.scores?.semantic,
          judge: r.scores?.judge,
          overall: r.scores?.overall,
          output: r.output,
          error: r.error,
        })),
      };
    });

    return {
      id: run.id,
      suiteName: "Latest Run",
      status: run.status,
      metrics,
    };
  }

  // ── Cursor & background (unchanged from your version) ────
  const cursorRef = useRef(null);
  const bgGlowRef = useRef(null);
  const mousePos = useRef({ x: -1000, y: -1000 });
  const bgPos = useRef({ x: -1000, y: -1000 });

  useEffect(() => {
    let rafId;
    const renderFrame = () => {
      if (cursorRef.current) cursorRef.current.style.transform = `translate3d(${mousePos.current.x}px, ${mousePos.current.y}px, 0) translate(-50%, -50%)`;
      bgPos.current.x += (mousePos.current.x - bgPos.current.x) * 0.15;
      bgPos.current.y += (mousePos.current.y - bgPos.current.y) * 0.15;
      if (bgGlowRef.current) bgGlowRef.current.style.transform = `translate3d(${bgPos.current.x}px, ${bgPos.current.y}px, 0) translate(-50%, -50%)`;
      rafId = requestAnimationFrame(renderFrame);
    };
    rafId = requestAnimationFrame(renderFrame);
    const handleMouseMove = (e) => { mousePos.current.x = e.clientX; mousePos.current.y = e.clientY; };
    const handleMouseOver = (e) => {
      if (e.target.closest('.run-eval-btn')) { document.body.classList.add('hovering-run-eval'); document.body.classList.remove('hovering-interactive'); }
      else if (e.target.closest('button, input, textarea, .floating-card, .drag-handle, .theme-toggle-text, .model-card')) { document.body.classList.add('hovering-interactive'); document.body.classList.remove('hovering-run-eval'); }
      else { document.body.classList.remove('hovering-interactive'); document.body.classList.remove('hovering-run-eval'); }
    };
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mouseover', handleMouseOver, { passive: true });
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseover', handleMouseOver); cancelAnimationFrame(rafId); };
  }, []);

  return (
    <>
      <div className="ambient-background">
        <div className="ambient-base-spin"></div>
        <div ref={bgGlowRef} className="cursor-ambient-glow"><div className="glow-orb"></div></div>
      </div>
      <div className="dot-grid-overlay"></div>

      <div className="app-layout">
        <div ref={cursorRef} className="custom-shadow-cursor"></div>

        <button className="theme-toggle-text" onClick={() => setIsDark(!isDark)}>
          <span className={!isDark ? 'active-theme' : 'inactive-theme'}>LIGHT</span>
          <span className="separator">/</span>
          <span className={isDark ? 'active-theme' : 'inactive-theme'}>DARK</span>
        </button>

        {/* Sidebar */}
        <nav className="sidebar floating-panel fade-in-up">
          <div className="brand">
            <div className="brand-logo">✦</div>
            <span className="brand-text">EvalForge</span>
          </div>

          <div className="nav-links">
            {[
              { id: "dashboard", label: "Dashboard", icon: "◒" },
              { id: "new-suite", label: "Create Suite", icon: "✚" },
              { id: "results", label: "Run Results", icon: "❖" },
            ].map(item => (
              <button key={item.id} onClick={() => setPage(item.id)} className={`nav-btn ${page === item.id ? "active" : ""}`}>
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>

          <div className="models-section">
            <div className="section-title">ACTIVE MODELS</div>
            <div className="models-stack">
              {Object.entries(models).map(([key, val]) => {
                const isActive = selectedModels.includes(key);
                return (
                  <button key={key} className={`model-card ${isActive ? 'active' : ''}`}
                    style={{ '--mc': val.color, '--mbg': val.bg }}
                    onClick={() => setSelectedModels(prev => isActive ? prev.filter(m => m !== key) : [...prev, key])}
                  >
                    <div className="model-indicator" style={{ background: isActive ? val.color : 'var(--border)' }}></div>
                    <span className="model-label">{val.label}</span>
                    {isActive && <div className="active-ring" style={{ borderColor: val.color }}></div>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="models-section" style={{ marginTop: 24, paddingTop: 24, borderTop: '1px dashed var(--border)' }}>
            <div className="section-title">JUDGE MODEL</div>
            <div style={{ position: 'relative' }}>
              <button 
                className="model-card active" 
                style={{ width: '100%', justifyContent: 'space-between', padding: '10px 14px', '--mc': models[judgeModel]?.color, '--mbg': models[judgeModel]?.bg }}
                onClick={() => setIsJudgeDropdownOpen(!isJudgeDropdownOpen)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="model-indicator" style={{ background: models[judgeModel]?.color }}></div>
                  <span className="model-label" style={{ color: models[judgeModel]?.color, flex: 1, textAlign: 'left' }}>{models[judgeModel]?.label}</span>
                </div>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>▼</span>
              </button>

              {isJudgeDropdownOpen && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setIsJudgeDropdownOpen(false)}></div>
                  <div className="fade-in-up" style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, right: 0, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 8, display: 'flex', flexDirection: 'column', gap: 4, zIndex: 50, boxShadow: 'var(--shadow-float)' }}>
                    {Object.entries(models).map(([key, val]) => (
                      <button 
                        key={key} 
                        className={`model-card ${judgeModel === key ? 'active' : ''}`}
                        style={{ padding: '8px 12px', border: 'none', background: judgeModel === key ? val.bg : 'transparent', '--mc': val.color, '--mbg': val.bg }}
                        onClick={() => { setJudgeModel(key); setIsJudgeDropdownOpen(false); }}
                      >
                        <div className="model-indicator" style={{ background: judgeModel === key ? val.color : 'var(--border)', width: 8, height: 8 }}></div>
                        <span className="model-label" style={{ color: judgeModel === key ? val.color : 'var(--text-muted)', flex: 1, textAlign: 'left' }}>{val.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </nav>

        <main className="main-canvas">
          <div key={page} className="page-animate-reveal">

            {/* ── DASHBOARD ── */}
            {page === "dashboard" && (
              <div className="w-full max-w-1000 mx-auto">
                <header className="page-header">
                  <div className="flex-between dashboard-header-row" style={{ alignItems: "flex-start", gap: 16 }}>
                    <div>
                      <h1 className="hero-title">
                        <div className="mask-text"><span className="slide-up-1">EVALUATION</span></div>
                        <div className="mask-text"><span className="slide-up-2">WORKSPACE</span></div>
                      </h1>
                      <p className="hero-subtitle fade-in-delayed">Manage and execute your evaluation suites.</p>
                    </div>
                    <button
                      className="floating-card empty-add-card header-add-cta stagger-anim"
                      style={{ "--delay": "0.15s" }}
                      onClick={() => setPage("new-suite")}
                    >
                      <div className="add-icon">+</div>
                      <h3 className="card-title" style={{ marginBottom: 0 }}>Build New Suite</h3>
                    </button>
                  </div>
                </header>

                {/* Backend error */}
                {suitesError && (
                  <div style={{ background: 'rgba(255,90,38,0.1)', border: '1px solid rgba(255,90,38,0.3)', borderRadius: 16, padding: '16px 24px', marginBottom: 24, color: '#FF5A26', fontSize: 14, fontWeight: 600 }}>
                    ⚠ {suitesError}
                  </div>
                )}

                {suitesLoading ? (
                  <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-muted)' }}>Loading suites…</div>
                ) : (
                  <div className="bento-grid">
                    {suites.map((suite, idx) => (
                      <div key={suite.id} className="floating-card bento-card stagger-anim" style={{ '--delay': `${idx * 0.1}s` }}>
                        <div className="card-top"><span className="bento-badge">Suite {String(suites.length - idx).padStart(2, '0')}</span></div>
                        <h3 className="card-title">{suite.name}</h3>
                        <p className="card-desc">{suite.description || "No description provided."}</p>
                        <div className="card-footer">
                          <div className="stat">
                            <span className="stat-val">{suite.test_case_count}</span>
                            <span className="stat-label">Cases</span>
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button className="btn-secondary" onClick={() => handleDeleteSuite(suite)} disabled={deletingSuiteId === suite.id}>
                              {deletingSuiteId === suite.id ? "Deleting..." : "Delete"}
                            </button>
                            <button className="btn-3d small run-eval-btn" onClick={() => handleRunEval(suite)}>Run Eval</button>
                          </div>
                        </div>
                      </div>
                    ))}

                  </div>
                )}
              </div>
            )}

            {/* ── NEW SUITE ── */}
            {page === "new-suite" && (
              <div className="w-full max-w-800 mx-auto">
                <header className="page-header">
                  <h1 className="hero-title">
                    <div className="mask-text"><span className="slide-up-1">BUILD A</span></div>
                    <div className="mask-text"><span className="slide-up-2">SUITE</span></div>
                  </h1>
                  <p className="hero-subtitle fade-in-delayed">Draft your parameters before deploying to the models.</p>
                </header>

                <div className="floating-card form-card mb-6 stagger-anim" style={{ '--delay': '0.1s' }}>
                  <div className="input-group">
                    <label>Suite Name *</label>
                    <input className="inset-input" value={newSuiteName} onChange={e => setNewSuiteName(e.target.value)} placeholder="e.g. Sales Onboarding Agent..." />
                  </div>
                  <div className="input-group">
                    <label>Description</label>
                    <input className="inset-input" value={newSuiteDesc} onChange={e => setNewSuiteDesc(e.target.value)} placeholder="What behaviors are we evaluating?" />
                  </div>
                </div>

                <div className="flex-between mb-4 fade-in-delayed">
                  <h2 className="section-title" style={{ marginBottom: 0 }}>TEST CASES</h2>
                  <button onClick={() => setTestCases([...testCases, { prompt_template: "", expected_output: "" }])} className="btn-secondary">+ Add Card</button>
                </div>

                <div className="cases-stack">
                  {testCases.map((tc, i) => (
                    <div key={i} className="floating-card case-card relative stagger-anim" style={{ '--delay': `${(i * 0.1) + 0.2}s` }}>
                      <div className="drag-handle">⠿</div>
                      <div className="case-badge">Case {String(i + 1).padStart(2, '0')}</div>
                      <div className="input-group">
                        <label>Prompt Template</label>
                        <textarea className="inset-input mono" rows={3} value={tc.prompt_template}
                          onChange={e => { const u = [...testCases]; u[i].prompt_template = e.target.value; setTestCases(u); }}
                          placeholder={"What is the capital of France?\nor\nSummarize this in one sentence: {input}"} />
                      </div>
                      <div className="input-group">
                        <label>Expected Output Reference (optional)</label>
                        <textarea className="inset-input" rows={2} value={tc.expected_output}
                          onChange={e => { const u = [...testCases]; u[i].expected_output = e.target.value; setTestCases(u); }}
                          placeholder="Reference answer — used for semantic scoring" />
                      </div>
                      {testCases.length > 1 && (
                        <button className="btn-text-danger" onClick={() => setTestCases(testCases.filter((_, j) => j !== i))}>Remove Case</button>
                      )}
                    </div>
                  ))}
                </div>

                <div style={{ textAlign: "right", marginTop: "32px" }} className="fade-in-delayed">
                  <button className="btn-3d large scale-click run-eval-btn" onClick={handleDeploySuite} disabled={isDeploying}>
                    {isDeploying ? "Deploying…" : "Deploy Test Suite"}
                  </button>
                </div>
              </div>
            )}

            {/* ── RESULTS ── */}
            {page === "results" && (
              <div className="w-full max-w-800 mx-auto">
                <header className="page-header">
                  <div>
                    <h1 className="hero-title">
                      <div className="mask-text"><span className="slide-up-1">EVALUATION</span></div>
                      <div className="mask-text"><span className="slide-up-2">TELEMETRY</span></div>
                    </h1>
                    <p className="hero-subtitle fade-in-delayed">Live model performance and evaluation metrics.</p>
                  </div>
                </header>

                {/* Run error */}
                {runError && (
                  <div style={{ background: 'rgba(255,90,38,0.1)', border: '1px solid rgba(255,90,38,0.3)', borderRadius: 16, padding: '16px 24px', marginBottom: 24, color: '#FF5A26', fontSize: 14, fontWeight: 600 }}>
                    ⚠ {runError}
                  </div>
                )}

                {isEvaluating && (
                  <div className="floating-card empty-state stagger-anim" style={{ '--delay': '0.1s' }}>
                    <div className="spin-icon add-icon" style={{ color: 'var(--pop-primary)' }}>❖</div>
                    <h3 className="card-title" style={{ marginBottom: 0 }}>Running Eval</h3>
                    <p style={{ color: 'var(--text-muted)', marginTop: '16px' }}>
                      Pinging {selectedModels.length} model{selectedModels.length > 1 ? 's' : ''} — this takes 10–30 seconds.
                    </p>
                  </div>
                )}

                {!isEvaluating && runsHistory.length === 0 && !runError && (
                  <div className="floating-card empty-state fade-in">
                    <div className="add-icon">✧</div>
                    <h3 className="card-title" style={{ marginBottom: 0 }}>Awaiting Data</h3>
                    <p style={{ color: 'var(--text-muted)', marginTop: '16px' }}>Head back to the dashboard to run a suite.</p>
                    <button className="btn-secondary" style={{ marginTop: '24px', padding: '12px 24px' }} onClick={() => setPage("dashboard")}>Go to Dashboard</button>
                  </div>
                )}

                {!isEvaluating && runsHistory.length > 0 && (
                  <div className="stagger-anim" style={{ '--delay': '0.1s' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      {runsHistory.map(runMeta => {
                        const isExpanded = expandedRunId === runMeta.id;
                        const details = expandedRunDetails[runMeta.id];
                        const dateStr = new Date(runMeta.created_at).toLocaleString();
                        
                        return (
                          <div key={runMeta.id} className="floating-card" style={{ padding: '24px', transition: 'all 0.3s ease' }}>
                            <div 
                              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} 
                              onClick={() => handleExpandRun(runMeta.id)}
                            >
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pop-primary)', marginBottom: 6 }}>{dateStr}</div>
                                <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{runMeta.suite_name}</h3>
                              </div>
                              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                                <span style={{ fontSize: 13, fontWeight: 800, padding: '6px 12px', borderRadius: 8, background: runMeta.status === 'completed' ? 'rgba(16,163,127,0.1)' : 'rgba(255,90,38,0.1)', color: runMeta.status === 'completed' ? '#10A37F' : '#FF5A26' }}>
                                  {runMeta.status.toUpperCase()}
                                </span>
                                <span style={{ fontSize: 18, color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s ease' }}>▼</span>
                              </div>
                            </div>

                            {isExpanded && (
                              <div style={{ marginTop: 24, paddingTop: 24, borderTop: '1px dashed var(--border)' }}>
                                {!details ? (
                                  <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0' }}>Loading details...</div>
                                ) : (
                                  <div className="fade-in-up">
                                    <RunDetails evalResults={details} />
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800&family=JetBrains+Mono:wght@400;500;700&display=swap');

        :root, [data-theme="light"] {
          --bg-canvas: #F8F6F0;
          --bg-surface: #FFFFFF;
          --border: #E2DFD7;
          --panel-bg: rgba(255, 255, 255, 0.75);
          --pop-primary: #5F4AFF;
          --pop-primary-dark: #3A2BB0;
          --text-main: #141312;
          --text-muted: #6B6862;
          --shadow-float: 0 24px 48px -12px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.8);
          --shadow-hover: 0 32px 64px -12px rgba(95, 74, 255, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.8);
          --shadow-inset: inset 0 2px 4px rgba(0, 0, 0, 0.02);
          --input-bg: rgba(0, 0, 0, 0.02);
          --tooltip-bg: rgba(0, 0, 0, 0.03);
          --bg-glow-color: rgba(95, 74, 255, 0.2);
          --orb-1: radial-gradient(circle at 50% 50%, rgba(95, 74, 255, 0.08), transparent 60%);
          --orb-2: radial-gradient(circle at 50% 50%, rgba(255, 90, 38, 0.08), transparent 60%);
        }

        [data-theme="dark"] {
          --bg-canvas: #060609;
          --bg-surface: #121215;
          --border: #2A2A2F;
          --panel-bg: rgba(18, 18, 21, 0.8);
          --pop-primary: #9A86FF;
          --pop-primary-dark: #5F4AFF;
          --text-main: #FEFEFE;
          --text-muted: #A1A1AA;
          --shadow-float: 0 24px 48px -12px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05);
          --shadow-hover: 0 32px 64px -12px rgba(154, 134, 255, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.05);
          --shadow-inset: inset 0 2px 4px rgba(0, 0, 0, 0.4);
          --input-bg: rgba(255, 255, 255, 0.03);
          --tooltip-bg: rgba(255, 255, 255, 0.05);
          --bg-glow-color: rgba(154, 134, 255, 0.2);
          --orb-1: radial-gradient(circle at 50% 50%, rgba(154, 134, 255, 0.12), transparent 60%);
          --orb-2: radial-gradient(circle at 50% 50%, rgba(255, 90, 38, 0.12), transparent 60%);
        }

        * { box-sizing: border-box; margin: 0; padding: 0; transition: background-color 0.5s ease, border-color 0.5s ease, color 0.5s ease; }
        body { font-family: 'Plus Jakarta Sans', sans-serif; background-color: var(--bg-canvas); color: var(--text-main); -webkit-font-smoothing: antialiased; overflow-x: hidden; }

        .w-full { width: 100%; } .max-w-1000 { max-width: 1000px; } .max-w-800 { max-width: 800px; } .mx-auto { margin-left: auto; margin-right: auto; }

        .ambient-background { position: fixed; inset: 0; z-index: -2; overflow: hidden; background-color: var(--bg-canvas); }
        .ambient-base-spin { position: absolute; inset: 0; transform: translateZ(0); }
        .ambient-base-spin::before, .ambient-base-spin::after { content: ''; position: absolute; width: 150vw; height: 150vw; top: -25vw; left: -25vw; background: var(--orb-1); animation: spin 30s linear infinite; transform-origin: center center; will-change: transform; }
        .ambient-base-spin::after { background: var(--orb-2); animation-direction: reverse; animation-duration: 40s; left: auto; right: -25vw; }
        @keyframes spin { 100% { transform: rotate(360deg); } }

        .cursor-ambient-glow { position: fixed; top: 0; left: 0; z-index: -1; pointer-events: none; will-change: transform; }
        .glow-orb { width: 65vw; height: 65vw; background: radial-gradient(circle, var(--bg-glow-color) 0%, transparent 60%); border-radius: 50%; opacity: 0.9; transform: scale(1) translateZ(0); transition: opacity 0.5s ease, transform 0.6s cubic-bezier(0.16, 1, 0.3, 1); }
        body.hovering-interactive .glow-orb, body.hovering-run-eval .glow-orb { opacity: 0; transform: scale(0.6) translateZ(0); }

        .dot-grid-overlay { position: fixed; inset: 0; z-index: -1; pointer-events: none; background-image: radial-gradient(var(--border) 1.5px, transparent 1.5px); background-size: 24px 24px; opacity: 0.6; }

        @media (pointer: fine) {
          body { cursor: none; }
          a, button, input, textarea, select { cursor: none !important; }
          .custom-shadow-cursor { position: fixed; top: 0; left: 0; width: 14px; height: 14px; background: var(--text-main); opacity: 0.4; border-radius: 50%; pointer-events: none; z-index: 99999; box-shadow: 0 0 12px 4px rgba(129, 140, 248, 0.1); will-change: transform; transition: width 0.2s ease, height 0.2s ease, background 0.2s ease, opacity 0.2s ease; }
          body.hovering-interactive .custom-shadow-cursor { width: 24px; height: 24px; background: var(--bg-surface); border: 2px solid var(--text-muted); opacity: 0.8; }
          body.hovering-run-eval .custom-shadow-cursor { width: 24px; height: 24px; background: rgba(255, 255, 255, 0.9); box-shadow: 0 0 20px 10px rgba(255, 255, 255, 0.5); mix-blend-mode: overlay; opacity: 1; border: none; }
        }
        @media (pointer: coarse) { .custom-shadow-cursor { display: none; } }

        ::-webkit-scrollbar { width: 8px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 10px; }

        .app-layout { display: flex; min-height: 100vh; padding: 32px; gap: 48px; max-width: 1600px; margin: 0 auto; position: relative; }

        .theme-toggle-text { position: fixed; top: 32px; right: 32px; z-index: 100; background: var(--panel-bg); backdrop-filter: blur(20px); border: 1px solid var(--border); border-radius: 30px; display: flex; gap: 12px; align-items: center; padding: 10px 20px; font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: var(--text-muted); cursor: pointer; box-shadow: var(--shadow-float); transition: all 0.3s ease; }
        .theme-toggle-text:hover { border-color: var(--text-main); transform: translateY(-2px); }
        .theme-toggle-text .active-theme { color: var(--text-main); opacity: 1; } .theme-toggle-text .inactive-theme { opacity: 0.4; } .theme-toggle-text .separator { opacity: 0.2; }

        .page-animate-reveal { animation: pageReveal 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards; width: 100%; }
        @keyframes pageReveal { from { opacity: 0; transform: translateY(10px); filter: blur(3px); } to { opacity: 1; transform: translateY(0); filter: blur(0); } }

        .hero-title { font-size: clamp(32px, 4vw, 56px); font-weight: 800; letter-spacing: -0.03em; line-height: 0.9; margin-bottom: 12px; }
        .mask-text { overflow: hidden; display: block; padding-bottom: 4px; }
        .slide-up-1, .slide-up-2 { display: inline-block; animation: slideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; transform: translateY(100%); }
        .slide-up-2 { animation-delay: 0.1s; }
        @keyframes slideUp { to { transform: translateY(0); } }

        .hero-subtitle { font-size: 16px; color: var(--text-muted); margin-bottom: 48px; font-weight: 500; }
        .section-title { font-size: 13px; font-weight: 800; letter-spacing: 0.15em; color: var(--text-muted); margin-bottom: 16px; text-transform: uppercase; }
        .card-title { font-size: 20px; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 8px; }

        .sidebar { width: 300px; min-width: 300px; height: calc(100vh - 64px); position: sticky; top: 32px; display: flex; flex-direction: column; padding: 32px 24px; z-index: 10; }
        .floating-panel { background: var(--panel-bg); backdrop-filter: blur(20px); border: 1px solid var(--border); border-radius: 32px; box-shadow: var(--shadow-float); }
        .main-canvas { flex: 1; padding-top: 16px; padding-bottom: 64px; display: flex; justify-content: center; }
        .flex-between { display: flex; justify-content: space-between; align-items: center; }
        .mb-4 { margin-bottom: 16px; } .mb-6 { margin-bottom: 32px; } .relative { position: relative; }

        .floating-card { background: var(--bg-surface); border-radius: 24px; border: 1px solid var(--border); box-shadow: var(--shadow-float); transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.3s ease; }
        .floating-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-hover); }

        .stagger-anim { opacity: 0; transform: translateY(20px); animation: springUp 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; animation-delay: var(--delay, 0s); }
        @keyframes springUp { to { opacity: 1; transform: translateY(0); } }
        .fade-in-delayed { opacity: 0; animation: fadeIn 0.6s ease forwards; animation-delay: 0.3s; }
        .fade-in-up { opacity: 0; animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

        .bento-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px; }
        .bento-card { padding: 32px; display: flex; flex-direction: column; }
        .bento-badge { background: var(--bg-canvas); color: var(--pop-primary); font-size: 12px; font-weight: 800; padding: 6px 12px; border-radius: 8px; margin-bottom: 24px; display: inline-block; border: 1px solid var(--border); }
        .card-desc { color: var(--text-muted); font-size: 15px; line-height: 1.5; margin-bottom: 32px; flex-grow: 1; }
        .card-footer { display: flex; justify-content: space-between; align-items: center; border-top: 1px dashed var(--border); padding-top: 24px; }
        .stat { display: flex; align-items: baseline; gap: 6px; }
        .stat-val { font-size: 24px; font-weight: 800; font-family: 'JetBrains Mono', monospace; }
        .stat-label { font-size: 13px; color: var(--text-muted); font-weight: 600; }

        .empty-add-card { position: relative; overflow: hidden; background: transparent; border: 2px dashed var(--border); display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: var(--text-muted); cursor: pointer; }
        .empty-add-card::before { content: ''; position: absolute; inset: 0; z-index: 0; pointer-events: none; opacity: 0; background-image: radial-gradient(var(--pop-primary) 1px, transparent 1px); background-size: 16px 16px; transition: opacity 0.5s ease; }
        .empty-add-card:hover { border-color: var(--pop-primary); border-style: solid; color: var(--pop-primary); background: var(--bg-surface); transform: translateY(-6px) scale(1.02); }
        .empty-add-card:hover::before { opacity: 0.1; }
        .empty-add-card * { position: relative; z-index: 1; }
        .add-icon { font-size: 48px; font-weight: 300; margin-bottom: 16px; transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .empty-add-card:hover .add-icon { transform: rotate(90deg) scale(1.2); }
        .header-add-cta { padding: 14px 20px; min-width: 220px; min-height: 120px; }
        .header-add-cta .add-icon { font-size: 30px; margin-bottom: 8px; }
        .header-add-cta .card-title { font-size: 18px; }
        .dashboard-header-row { padding-right: 190px; }
        .empty-state { padding: 80px 40px; text-align: center; border: 1px dashed var(--border); box-shadow: none; background: transparent; display: flex; flex-direction: column; align-items: center; justify-content: center; }

        .btn-3d { background: var(--pop-primary); color: #fff; font-family: inherit; font-weight: 800; border: none; border-radius: 12px; cursor: pointer; box-shadow: 0 4px 0 var(--pop-primary-dark), 0 8px 16px rgba(0,0,0,0.2); transform: translateY(-2px); transition: transform 0.1s ease, box-shadow 0.1s ease, opacity 0.2s; }
        .btn-3d:active { transform: translateY(2px); box-shadow: none; }
        .btn-3d:disabled { opacity: 0.5; }
        .btn-3d.small { padding: 10px 20px; font-size: 14px; }
        .btn-3d.large { padding: 16px 36px; font-size: 16px; border-radius: 16px; box-shadow: 0 6px 0 var(--pop-primary-dark); transform: translateY(-4px); }
        .btn-3d.large:active { transform: translateY(2px); box-shadow: none; }

        .btn-secondary { background: var(--bg-surface); color: var(--text-main); border: 1px solid var(--border); padding: 8px 16px; border-radius: 10px; font-family: inherit; font-weight: 700; font-size: 13px; box-shadow: 0 2px 0 var(--border); transition: all 0.1s ease; cursor: pointer; }
        .btn-secondary:active { transform: translateY(2px); box-shadow: none; }
        .btn-text-danger { background: transparent; border: none; color: #ff3b30; font-family: inherit; font-size: 12px; font-weight: 700; margin-top: 8px; cursor: pointer; }
        .btn-text-danger:hover { text-decoration: underline; }

        .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 48px; }
        .brand-logo { width: 36px; height: 36px; background: var(--pop-primary); border-radius: 12px; display: grid; place-items: center; color: #fff; font-size: 18px; }
        .brand-text { font-size: 24px; font-weight: 800; letter-spacing: -0.04em; }
        .nav-links { display: flex; flex-direction: column; gap: 8px; margin-bottom: auto; }
        .nav-btn { background: transparent; border: none; color: var(--text-muted); font-family: inherit; font-weight: 700; font-size: 15px; padding: 14px 16px; border-radius: 12px; display: flex; align-items: center; gap: 16px; transition: all 0.3s ease; cursor: pointer; }
        .nav-btn:hover { background: var(--border); color: var(--text-main); transform: translateX(4px); }
        .nav-btn.active { background: var(--bg-surface); color: var(--pop-primary); transform: translateX(4px); box-shadow: var(--shadow-float); border: 1px solid var(--border); }

        .models-section { padding-top: 32px; border-top: 1px dashed var(--border); }
        .models-stack { display: flex; flex-direction: column; gap: 8px; }
        .model-card { position: relative; display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 12px; font-family: inherit; font-size: 13px; font-weight: 700; transition: all 0.3s ease; cursor: pointer; }
        .model-card .model-label { color: var(--text-muted); transition: color 0.3s ease; }
        .model-card:hover { background: var(--mbg); border-color: var(--mc); transform: translateY(-2px); }
        .model-card:hover .model-label { color: var(--mc); }
        .model-card:hover .model-indicator { background: var(--mc) !important; }
        .model-card.active { background: var(--mbg); border-color: var(--mc); }
        .model-card.active .model-label { color: var(--mc); }
        .model-indicator { width: 10px; height: 10px; border-radius: 50%; transition: 0.3s; }
        .active-ring { position: absolute; inset: -2px; border: 2px solid; border-radius: 14px; opacity: 0.2; pointer-events: none; }

        .form-card { padding: 40px; margin-bottom: 32px; }
        .case-card { padding: 32px 32px 32px 48px; margin-bottom: 24px; }
        .drag-handle { position: absolute; left: 16px; top: 32px; color: var(--border); font-size: 20px; cursor: grab; }
        .case-badge { font-size: 11px; font-weight: 800; color: var(--pop-primary); margin-bottom: 16px; letter-spacing: 1px; text-transform: uppercase; }
        .cases-stack { display: flex; flex-direction: column; }
        .input-group { margin-bottom: 24px; } .input-group:last-child { margin-bottom: 0; }
        .input-group label { display: block; font-size: 13px; font-weight: 700; margin-bottom: 10px; }
        .inset-input { width: 100%; background: var(--input-bg); border: 1px solid var(--border); box-shadow: var(--shadow-inset); border-radius: 12px; padding: 16px 20px; color: var(--text-main); font-family: inherit; font-size: 15px; font-weight: 500; outline: none; resize: vertical; }
        .inset-input.mono { font-family: 'JetBrains Mono', monospace; font-size: 14px; }
        .inset-input:focus { background: var(--bg-surface); border-color: var(--pop-primary); }

        .canvas-table { width: 100%; border-collapse: collapse; text-align: left; }
        .canvas-table th { font-size: 13px; font-weight: 800; color: var(--text-muted); padding: 16px; border-bottom: 2px solid var(--border); }
        .canvas-table td { padding: 16px; border-bottom: 1px solid var(--border); font-size: 14px; vertical-align: middle; }
        .canvas-table tr:last-child td { border-bottom: none; }
        .mono { font-family: 'JetBrains Mono', monospace; color: var(--text-muted); }
        .score-pill { font-family: 'JetBrains Mono', monospace; font-weight: 700; padding: 6px 12px; border-radius: 8px; font-size: 13px; }

        .spin-icon { display: inline-block; animation: spinAnim 2s cubic-bezier(0.68, -0.55, 0.265, 1.55) infinite; }
        @keyframes spinAnim { 100% { transform: rotate(360deg); } }
        .page-header { margin-bottom: 48px; }
        .align-start { align-items: flex-start; }

        @media (max-width: 1100px) {
          .dashboard-header-row { padding-right: 0; flex-direction: column; align-items: flex-start !important; }
          .header-add-cta { width: 100%; max-width: 320px; min-height: 100px; }
        }
      `}</style>
    </>
  );
}

function RunDetails({ evalResults }) {
  if (!evalResults?.metrics) return null;
  return (
    <div>
      {/* Chart */}
      <div className="bento-grid" style={{ marginBottom: '24px' }}>
        <div className="floating-card bento-card" style={{ gridColumn: '1 / -1', padding: '24px' }}>
          <h3 className="section-title">Aggregate Scores</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={evalResults.metrics.filter(m => !m.hasError)} margin={{ top: 20, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'var(--tooltip-bg)' }} contentStyle={{ borderRadius: '12px', border: '1px solid var(--border)', background: 'var(--bg-surface)' }} formatter={(v) => [`${v}%`, 'Score']} />
              <Bar dataKey="score" radius={[6, 6, 0, 0]} maxBarSize={60}>
                {evalResults.metrics.filter(m => !m.hasError).map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Table */}
      <div className="floating-card" style={{ padding: '24px', overflowX: 'auto', marginBottom: '24px' }}>
        <h3 className="section-title">Performance Breakdown</h3>
        <table className="canvas-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Avg Score</th>
              <th>Avg Latency</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {evalResults.metrics.map((m, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: m.color, flexShrink: 0 }}></div>
                  {m.name}
                </td>
                <td>
                  {m.hasError
                    ? <span style={{ color: '#FF5A26', fontSize: 12 }}>Error</span>
                    : <span className="score-pill" style={{ color: m.scoreColor, background: m.scoreColor + '22', padding: '4px 10px', borderRadius: 8, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 13 }}>
                        {m.score != null ? `${m.score}%` : '—'}
                      </span>
                  }
                </td>
                <td className="mono">{m.latency ? `${m.latency}ms` : '—'}</td>
                <td>
                  {m.hasError
                    ? <span style={{ color: '#FF5A26', fontWeight: 700, fontSize: 13 }}>Failed</span>
                    : <span style={{ color: m.score >= 75 ? '#10A37F' : m.score >= 50 ? '#F5A623' : '#FF5A26', fontWeight: 700, fontSize: 13 }}>
                        {m.score >= 75 ? 'Passed' : m.score >= 50 ? 'Review' : 'Failed'}
                      </span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Judge reasoning */}
      {evalResults.metrics.some(m => m.reasoning) && (
        <div className="floating-card" style={{ padding: '24px' }}>
          <h3 className="section-title">Judge Reasoning & Analysis</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '16px' }}>
            {evalResults.metrics.filter(m => m.reasoning).map((m, i, arr) => (
              <div key={i} style={{ borderBottom: i === arr.length - 1 ? 'none' : '1px dashed var(--border)', paddingBottom: i === arr.length - 1 ? 0 : '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: m.color }}></div>
                  <strong style={{ fontSize: '15px' }}>{m.name}</strong>
                  {m.score != null && <span style={{ color: m.scoreColor, fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 700, marginLeft: 'auto' }}>{m.score}%</span>}
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: 1.6, margin: 0 }}>{m.reasoning}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Show errors if any */}
      {evalResults.metrics.some(m => m.hasError) && (
        <div style={{ background: 'rgba(255,90,38,0.07)', border: '1px solid rgba(255,90,38,0.2)', borderRadius: 16, padding: '20px 24px', marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#FF5A26', marginBottom: 12, letterSpacing: 1 }}>MODEL ERRORS</div>
          {evalResults.metrics.filter(m => m.hasError).map((m, i) => (
            <div key={i} style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
              <strong style={{ color: m.color }}>{m.name}:</strong> {m.errorMsg?.slice(0, 120)}…
            </div>
          ))}
        </div>
      )}
    </div>
  );
}