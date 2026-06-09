"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from "recharts";

// ============================================================================
// 1. API SERVICE LAYER & CONSTANTS
// ============================================================================
const API_BASE = import.meta.env.VITE_API_URL || "";
const KEYS_STORAGE_KEY = "arbiterApiKeys";

function getStoredKeys() {
  try { return JSON.parse(localStorage.getItem(KEYS_STORAGE_KEY) || "{}"); }
  catch { return {}; }
}

function buildKeyHeaders() {
  const k = getStoredKeys();
  const h = {};
  if (k.gemini_api_key)     h["X-Gemini-Key"]     = k.gemini_api_key;
  if (k.groq_api_key)       h["X-Groq-Key"]        = k.groq_api_key;
  if (k.openai_api_key)     h["X-OpenAI-Key"]      = k.openai_api_key;
  if (k.anthropic_api_key)  h["X-Anthropic-Key"]   = k.anthropic_api_key;
  if (k.openrouter_api_key) h["X-OpenRouter-Key"]  = k.openrouter_api_key;
  if (k.github_token)       h["X-GitHub-Token"]    = k.github_token;
  if (k.deepseek_api_key)   h["X-DeepSeek-Key"]    = k.deepseek_api_key;
  if (k.mistral_api_key)    h["X-Mistral-Key"]      = k.mistral_api_key;
  return h;
}

async function apiFetch(path, init = {}) {
  const headers = { "Content-Type": "application/json", ...buildKeyHeaders(), ...(init.headers || {}) };
  const baseUrl = API_BASE.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(err.detail || `HTTP ${response.status}`);
  }
  return response.json();
}

const DYNAMIC_COLORS = [
  { color: "#E2E8F0", bg: "rgba(226, 232, 240, 0.08)" }, 
  { color: "#94A3B8", bg: "rgba(148, 163, 184, 0.08)" }, 
  { color: "#60A5FA", bg: "rgba(96, 165, 250, 0.08)" }, 
  { color: "#34D399", bg: "rgba(52, 211, 153, 0.08)" }, 
  { color: "#FBBF24", bg: "rgba(251, 191, 36, 0.08)" }, 
  { color: "#F87171", bg: "rgba(248, 113, 113, 0.08)" },  
];

function formatModelLabel(rawId) {
  const parts = rawId.split('/');
  const provider = parts[0];
  let name = parts[parts.length - 1];
  if (provider === 'google') {
    name = name.replace(/^gemini-/, 'Gemini ').replace(/-/g, ' ');
    return name.replace(/\b\w/g, l => l.toUpperCase()).trim();
  }
  name = name.replace(/-/g, ' ');
  name = name.replace(/\b8b\b/gi, '8B').replace(/\b70b\b/gi, '70B');
  name = name.replace(/\b(instant|versatile|exp free|latest)\b/gi, s => s === 'latest' ? '' : s);
  return name.replace(/\b\w/g, l => l.toUpperCase()).trim();
}

// ============================================================================
// 2. MAGNETIC BUTTON COMPONENT (Refined Motion)
// ============================================================================
function MagneticButton({ children, className, onClick, style }) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const handleMouse = (e) => {
    const { clientX, clientY } = e;
    const { height, width, left, top } = ref.current.getBoundingClientRect();
    const middleX = clientX - (left + width / 2);
    const middleY = clientY - (top + height / 2);
    setPosition({ x: middleX * 0.1, y: middleY * 0.1 });
  };

  const reset = () => setPosition({ x: 0, y: 0 });

  return (
    <motion.button
      ref={ref} className={className} style={style} onClick={onClick}
      onMouseMove={handleMouse} onMouseLeave={reset}
      animate={{ x: position.x, y: position.y }}
      transition={{ type: "spring", stiffness: 500, damping: 30, mass: 0.5 }}
    >
      {children}
    </motion.button>
  );
}

// ============================================================================
// 3. MAIN APPLICATION
// ============================================================================
export default function App() {
  const [page, setPage] = useState("dashboard");
  
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  }, []);
  
  const [models, setModels] = useState({});
  const [selectedModels, setSelectedModels] = useState([]);
  const [judgeModel, setJudgeModel] = useState("");
  const [judgeDropdownOpen, setJudgeDropdownOpen] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(true);

  async function fetchRealBackendEval(suiteId, selectedModels, judgeId) {
    try {
      const data = await apiFetch('/api/runs/evaluate', {
        method: 'POST',
        body: JSON.stringify({ suiteId: String(suiteId), models: selectedModels, judgeId })
      });
      return data.metrics;
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  const refreshModels = async () => {
    setIsLoadingModels(true);
    try {
      const data = await apiFetch('/api/models');
      const backendModelList = data.models;
      const generatedModels = {};
      backendModelList.forEach((id, index) => {
        const theme = DYNAMIC_COLORS[index % DYNAMIC_COLORS.length];
        generatedModels[id] = { color: theme.color, bg: theme.bg, label: formatModelLabel(id) };
      });
      setModels(generatedModels);
      if (backendModelList.length >= 2) {
        setSelectedModels([backendModelList[0], backendModelList[1]]);
        setJudgeModel(backendModelList[0]);
      } else if (backendModelList.length > 0) {
        setSelectedModels([backendModelList[0]]);
        setJudgeModel(backendModelList[0]);
      }
    } catch (error) {
      console.error('Models failed to load:', error);
    } finally {
      setIsLoadingModels(false);
    }
  };

  useEffect(() => { refreshModels(); }, []);

  const [suites, setSuites] = useState(() => {
    const saved = localStorage.getItem('evalSuites');
    return saved ? JSON.parse(saved) : [
      { id: "123e4567-e89b-12d3-a456-426614174000", name: "Customer Support Eval", description: "Testing sentiment analysis and tone mapping against angry users.", test_case_count: 1, cases: [{prompt_template: "User is angry.", expected_output: "De-escalate."}] },
      { id: "123e4567-e89b-12d3-a456-426614174001", name: "Code Generation Checks", description: "Verifying React and Python boilerplate generation accuracy.", test_case_count: 1, cases: [{prompt_template: "Write a python flask app", expected_output: "Valid flask boilerplate"}] }
    ];
  });

  const [runHistory, setRunHistory] = useState(() => {
    const saved = localStorage.getItem('evalHistory');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => { localStorage.setItem('evalSuites', JSON.stringify(suites)); }, [suites]);
  useEffect(() => { localStorage.setItem('evalHistory', JSON.stringify(runHistory)); }, [runHistory]);

  const [editingSuiteId, setEditingSuiteId] = useState(null);
  const [newSuiteName, setNewSuiteName] = useState("");
  const [newSuiteDesc, setNewSuiteDesc] = useState("");
  const [testCases, setTestCases] = useState([{ prompt_template: "", expected_output: "" }]);
  
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evalResults, setEvalResults] = useState(runHistory.length > 0 ? runHistory[0] : null);

  const SETTINGS_FIELDS = [
    { key: 'gemini_api_key',     label: 'Gemini API Key',              placeholder: 'AIza...',     provider: 'Google' },
    { key: 'groq_api_key',       label: 'Groq API Key',                placeholder: 'gsk_...',     provider: 'Groq' },
    { key: 'deepseek_api_key',   label: 'DeepSeek API Key',            placeholder: 'sk-...',      provider: 'DeepSeek' },
    { key: 'mistral_api_key',    label: 'Mistral API Key',             placeholder: 'xxx...',      provider: 'Mistral' },
    { key: 'openrouter_api_key', label: 'OpenRouter API Key',          placeholder: 'sk-or-...',   provider: 'OpenRouter' },
    { key: 'openai_api_key',     label: 'OpenAI API Key',              placeholder: 'sk-proj-...', provider: 'OpenAI' },
    { key: 'anthropic_api_key',  label: 'Anthropic API Key',           placeholder: 'sk-ant-...',  provider: 'Anthropic' },
    { key: 'github_token',       label: 'GitHub Token (GPT-4o-mini)',  placeholder: 'ghp_...',     provider: 'GitHub' },
  ];
  
  const [settingsData, setSettingsData] = useState(() => getStoredKeys());
  const [settingsVisible, setSettingsVisible] = useState({});
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsToast, setSettingsToast] = useState(null);
  const [serverKeys, setServerKeys] = useState({});

  useEffect(() => {
    if (page !== 'settings') return;
    apiFetch('/api/settings').then(data => setServerKeys(data.server_keys || {})).catch(() => {});
  }, [page]);

  const handleSaveSettings = () => {
    localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify(settingsData));
    setSettingsSaving(true);
    setSettingsToast('success');
    refreshModels();
    setTimeout(() => { setSettingsSaving(false); setSettingsToast(null); }, 2000);
  };

  const resetSuiteForm = () => {
    setEditingSuiteId(null);
    setNewSuiteName("");
    setNewSuiteDesc("");
    setTestCases([{ prompt_template: "", expected_output: "", checks_json: "" }]);
  };

  const handleEditSuite = (suite) => {
    setEditingSuiteId(suite.id);
    setNewSuiteName(suite.name);
    setNewSuiteDesc(suite.description);
    setTestCases(suite.cases && suite.cases.length > 0 
      ? suite.cases.map(c => ({ ...c, checks_json: c.checks ? JSON.stringify(c.checks, null, 2) : "" }))
      : [{ prompt_template: "", expected_output: "", checks_json: "" }]);
    setPage("new-suite");
  };

  const handleDeploySuite = async () => {
    const validCases = testCases.filter(tc => tc.prompt_template.trim() !== "");
    const finalCases = validCases.length > 0 ? validCases.map(c => {
      let parsedChecks = null;
      if (c.checks_json && c.checks_json.trim()) {
        try { parsedChecks = JSON.parse(c.checks_json); } catch (e) { console.error("Invalid checks JSON"); }
      }
      return { prompt_template: c.prompt_template, expected_output: c.expected_output, checks: parsedChecks };
    }) : [{ prompt_template: "", expected_output: "", checks: null }];
    
    const suiteData = {
      name: newSuiteName || "Untitled Suite",
      description: newSuiteDesc || "No description provided.",
      cases: finalCases,
      test_case_count: finalCases.length
    };

    try {
      let method = editingSuiteId ? 'PUT' : 'POST';
      let path = editingSuiteId ? `/api/suites/${editingSuiteId}` : '/api/suites';
      let savedSuite;
      
      try {
        savedSuite = await apiFetch(path, { method, body: JSON.stringify(suiteData) });
      } catch (initialErr) {
        if (editingSuiteId && String(initialErr).includes("404")) {
          method = 'POST';
          path = '/api/suites';
          savedSuite = await apiFetch(path, { method, body: JSON.stringify(suiteData) });
        } else { throw initialErr; }
      }

      if (editingSuiteId) {
        setSuites(suites.map(s => s.id === editingSuiteId ? savedSuite : s));
      } else {
        setSuites([savedSuite, ...suites]);
      }
    } catch (error) {
      if (editingSuiteId) {
        setSuites(suites.map(s => s.id === editingSuiteId ? { ...s, ...suiteData } : s));
      } else {
        const fallbackId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
        setSuites([{ id: fallbackId, ...suiteData }, ...suites]);
      }
    }
    
    setPage("dashboard");
    resetSuiteForm();
  };

  const handleDeleteSuite = () => {
    if (window.confirm("Are you sure you want to delete this test suite?")) {
      setSuites(suites.filter(s => s.id !== editingSuiteId));
      setPage("dashboard");
      resetSuiteForm();
    }
  };

  const handleRunEval = async (suite) => {
    if (selectedModels.length === 0) return alert("Please select at least one model.");
    if (!judgeModel) return alert("Please select a judge model.");
    
    setPage("results");
    setIsEvaluating(true);

    try {
      const metrics = await fetchRealBackendEval(suite.id, selectedModels, judgeModel);
      const styledMetrics = metrics.map((m) => {
        const modelKey = m.id;
        return {
          name: models[modelKey]?.label || modelKey,
          color: models[modelKey]?.color || "#a1a1aa",
          score: Math.round(m.score || 0),
          latency: m.latency || 0,
          reasoning: m.reasoning || "No reasoning provided.",
          outputs: m.outputs || []
        };
      });
      
      const newResult = { 
        id: Date.now(), 
        suiteName: suite.name, 
        timestamp: new Date().toLocaleString(),
        metrics: styledMetrics 
      };
      
      setEvalResults(newResult);
      setRunHistory([newResult, ...runHistory]);
    } catch (error) {
      alert("Failed to run evaluation. Check your backend console.");
      setPage("dashboard");
    } finally {
      setIsEvaluating(false);
    }
  };

  return (
    <>
      {/* Zero DOM-bloat background. 
        Native CSS gradients handle the lighting without JS main-thread interference.
      */}
      <div className="ambient-background"></div>

      <div className="app-layout">
        <nav className="sidebar floating-card fade-in-up">
          <div className="brand">
            <span className="brand-text">ARBITER</span>
            <span className="brand-sub">Telemetry</span>
          </div>

          <div className="nav-links">
            <button onClick={() => { resetSuiteForm(); setPage("dashboard"); }} className={`nav-btn ${page === "dashboard" ? "active" : ""}`}>Dashboard</button>
            <button onClick={() => { resetSuiteForm(); setPage("new-suite"); }} className={`nav-btn ${page === "new-suite" ? "active" : ""}`}>Architect Suite</button>
            <button onClick={() => setPage("results")} className={`nav-btn ${page === "results" ? "active" : ""}`}>Run Diagnostics</button>
            <button onClick={() => setPage("settings")} className={`nav-btn ${page === "settings" ? "active" : ""}`}>Vault Settings</button>
          </div>

          <div className="models-section">
            <div className="section-title">Compute Nodes</div>
            <div className="models-stack scroll-hidden">
              {isLoadingModels ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px' }}>Initializing...</div>
              ) : (
                Object.entries(models).map(([key, val]) => {
                  const isActive = selectedModels.includes(key);
                  return (
                    <button 
                      key={key} className={`model-card ${isActive ? 'active' : ''}`}
                      style={{ '--mc': val.color, '--mbg': val.bg }}
                      onClick={() => setSelectedModels(prev => isActive ? prev.filter(m => m !== key) : [...prev, key])}
                    >
                      <div className="model-indicator" style={{ background: isActive ? val.color : 'var(--border)' }}></div>
                      <span className="model-label">{val.label}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="judge-section">
            <div className="section-title">Arbiter Node</div>
            {isLoadingModels ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px' }}>Loading...</div>
            ) : (
              <div style={{ position: 'relative', width: '100%' }}>
                <AnimatePresence>
                  {judgeDropdownOpen && (
                    <motion.div 
                      className="judge-dropdown-menu"
                      initial={{ opacity: 0, y: 10, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.98 }}
                      transition={{ duration: 0.15, ease: "easeOut" }}
                    >
                      {Object.entries(models).map(([key, val]) => {
                        const isJudge = judgeModel === key;
                        return (
                          <button
                            key={key}
                            className={`judge-menu-item ${isJudge ? 'active' : ''}`}
                            onClick={() => { setJudgeModel(key); setJudgeDropdownOpen(false); }}
                          >
                            <div className="judge-indicator" style={{ background: isJudge ? val.color : 'var(--border)' }} />
                            <span className="model-label">{val.label}</span>
                          </button>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
                
                <button
                  className="judge-select-btn"
                  onClick={() => setJudgeDropdownOpen(!judgeDropdownOpen)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div className="judge-indicator" style={{ background: models[judgeModel]?.color || 'var(--border)' }} />
                    <span className="model-label">{models[judgeModel]?.label || 'Select Judge'}</span>
                  </div>
                  <span className="chevron-icon" style={{ transform: judgeDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                </button>
              </div>
            )}
          </div>
        </nav>

        <main className="main-canvas">
          <AnimatePresence mode="wait">
            
            {/* DASHBOARD */}
            {page === "dashboard" && (
              <motion.div key="dash" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="w-full max-w-1000 mx-auto">
                <header className="page-header">
                  <h1 className="hero-title">Evaluation Architecture</h1>
                  <p className="hero-subtitle fade-in-delayed">Select a testing matrix or construct a new evaluation suite.</p>
                </header>

                <div className="bento-grid">
                  <div className="floating-card empty-add-card stagger-anim" onClick={() => { resetSuiteForm(); setPage("new-suite"); }} style={{ '--delay': '0s' }}>
                    <div className="add-icon">+</div>
                    <h3 className="card-title" style={{marginBottom: 0}}>Initialize Suite</h3>
                  </div>

                  {suites.map((suite, idx) => (
                    <div key={suite.id} className="floating-card bento-card stagger-anim interactive-card" style={{ '--delay': `${(idx + 1) * 0.1}s` }} onClick={() => handleEditSuite(suite)}>
                      <div className="card-top flex-between">
                        <span className="bento-badge">SUITE_{suites.length - idx}</span>
                        <span className="edit-hint">EDIT</span>
                      </div>
                      <h3 className="card-title">{suite.name}</h3>
                      <p className="card-desc">{suite.description}</p>
                      <div className="card-footer">
                        <div className="stat">
                          <span className="stat-val">{suite.test_case_count}</span>
                          <span className="stat-label">Vectors</span>
                        </div>
                        <button className="mechanical-btn small run-eval-btn" onClick={(e) => { e.stopPropagation(); handleRunEval(suite); }}>Deploy</button>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* SUITE EDITOR */}
            {page === "new-suite" && (
              <motion.div key="new" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="w-full max-w-800 mx-auto pb-12">
                <header className="page-header">
                  <h1 className="hero-title">{editingSuiteId ? 'Modify Parameters' : 'Construct Suite'}</h1>
                  <p className="hero-subtitle fade-in-delayed">Draft deterministic constraints and expected vectors.</p>
                </header>

                <div className="floating-card form-card mb-6 stagger-anim" style={{ '--delay': '0.1s' }}>
                  <div className="input-group">
                    <label>Designation</label>
                    <input className="inset-input" value={newSuiteName} onChange={e => setNewSuiteName(e.target.value)} placeholder="e.g., Syntax Verification Matrix..." />
                  </div>
                  <div className="input-group">
                    <label>Objective Parameters</label>
                    <input className="inset-input" value={newSuiteDesc} onChange={e => setNewSuiteDesc(e.target.value)} placeholder="Define the boundaries of this evaluation..." />
                  </div>
                </div>

                <div className="flex-between mb-4 fade-in-delayed">
                  <h2 className="section-title" style={{marginBottom: 0}}>Inference Vectors</h2>
                  <button onClick={() => setTestCases([...testCases, { prompt_template: "", expected_output: "", checks_json: "" }])} className="btn-secondary">+ Append</button>
                </div>

                <div className="cases-stack">
                  {testCases.map((tc, i) => (
                    <div key={i} className="floating-card case-card relative stagger-anim" style={{ '--delay': `${(i * 0.1) + 0.2}s` }}>
                      <div className="drag-handle">≡</div>
                      <div className="case-badge">VECTOR_0{i + 1}</div>

                      <div className="input-group">
                        <label>Input Template</label>
                        <textarea className="inset-input mono" rows={3} value={tc.prompt_template} onChange={e => { const updated = [...testCases]; updated[i].prompt_template = e.target.value; setTestCases(updated); }} placeholder="User: {input} \nSystem: Initialize..." />
                      </div>
                      <div className="input-group">
                        <label>Expected Output Hash</label>
                        <textarea className="inset-input mono" rows={2} value={tc.expected_output} onChange={e => { const updated = [...testCases]; updated[i].expected_output = e.target.value; setTestCases(updated); }} placeholder="Target response mapping..." />
                      </div>
                      <div className="input-group">
                        <label>Deterministic JSON Checks</label>
                        <textarea className="inset-input mono" rows={2} value={tc.checks_json || ""} onChange={e => { const updated = [...testCases]; updated[i].checks_json = e.target.value; setTestCases(updated); }} placeholder='[{"type": "is_json"}]' />
                      </div>
                      {testCases.length > 1 && (<button className="btn-text-danger" onClick={() => setTestCases(testCases.filter((_, index) => index !== i))}>Terminate Vector</button>)}
                    </div>
                  ))}
                </div>

                <div className="deploy-footer flex-between fade-in-delayed" style={{ marginTop: "32px", paddingBottom: "64px" }}>
                  {editingSuiteId ? (
                    <button className="btn-text-danger" style={{fontSize: '14px', color: '#ff3b30'}} onClick={handleDeleteSuite}>Purge Suite</button>
                  ) : <div></div>}
                  
                  <MagneticButton className="mechanical-btn large" onClick={handleDeploySuite}>
                    {editingSuiteId ? 'Commit Changes' : 'Initialize Compilation'}
                  </MagneticButton>
                </div>
              </motion.div>
            )}

            {/* RESULTS PAGE */}
            {page === "results" && (
              <motion.div key="res" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="w-full max-w-800 mx-auto pb-12">
                <header className="page-header flex-between align-start">
                  <div>
                    <h1 className="hero-title">Telemetry Stream</h1>
                    <p className="hero-subtitle fade-in-delayed">Raw performance data and arbiter diagnostics.</p>
                  </div>
                  
                  {runHistory.length > 0 && !isEvaluating && (
                    <div className="fade-in-delayed" style={{ textAlign: 'right', zIndex: 10 }}>
                      <span className="section-title" style={{ display: 'block', marginBottom: 8, textTransform: 'none' }}>Archive</span>
                      <select 
                        className="inset-input mono" 
                        style={{ padding: '8px 16px', fontSize: 13, width: 200, cursor: 'pointer' }}
                        onChange={(e) => setEvalResults(runHistory.find(r => r.id.toString() === e.target.value))}
                        value={evalResults?.id || ""}
                      >
                        {runHistory.map(run => (
                          <option key={run.id} value={run.id}>{run.suiteName} ({run.timestamp})</option>
                        ))}
                      </select>
                    </div>
                  )}
                </header>

                {isEvaluating && (
                  <div className="floating-card empty-state stagger-anim" style={{ '--delay': '0.1s' }}>
                    <div className="spin-icon add-icon" style={{ color: 'var(--text-main)' }}>⟳</div>
                    <h3 className="card-title" style={{ marginBottom: 0 }}>Executing Diagnostics</h3>
                    <p style={{ color: 'var(--text-muted)', marginTop: '16px' }}>Streaming data from {selectedModels.length} nodes.</p>
                  </div>
                )}

                {!isEvaluating && !evalResults && (
                  <div className="floating-card empty-state fade-in">
                    <h3 className="card-title" style={{ marginBottom: 0 }}>Awaiting Signal</h3>
                    <p style={{ color: 'var(--text-muted)', marginTop: '16px' }}>Return to the dashboard to deploy an evaluation.</p>
                    <button className="btn-secondary" style={{ marginTop: '24px', padding: '12px 24px' }} onClick={() => setPage("dashboard")}>Access Dashboard</button>
                  </div>
                )}

                {!isEvaluating && evalResults && (
                  <div className="stagger-anim" style={{ '--delay': '0.1s' }}>
                    <div className="bento-badge" style={{ marginBottom: '16px' }}>TARGET: {evalResults.suiteName}</div>
                    
                    <div className="bento-grid" style={{ marginBottom: '24px' }}>
                      <div className="floating-card bento-card" style={{ gridColumn: '1 / -1' }}>
                        <h3 className="section-title">Performance Aggregation</h3>
                        <ResponsiveContainer width="100%" height={260}>
                          <BarChart data={evalResults.metrics} margin={{ top: 20, right: 0, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-outer)" opacity={0.6}/>
                            <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} />
                            <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} />
                            <Tooltip
                              cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                              contentStyle={{
                                borderRadius: '4px',
                                border: '1px solid var(--border-outer)',
                                background: 'var(--bg-canvas)',
                                color: 'var(--text-main)',
                                fontFamily: "'JetBrains Mono', monospace"
                              }}
                            />
                            <Bar dataKey="score" radius={[2, 2, 0, 0]} maxBarSize={60}>
                              {evalResults.metrics.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="floating-card stagger-anim" style={{ padding: '24px', overflowX: 'auto', '--delay': '0.2s', marginBottom: '24px' }}>
                      <h3 className="section-title">Node Analytics</h3>
                      <table className="canvas-table mono">
                        <thead>
                          <tr>
                            <th>Identifier</th>
                            <th>Precision</th>
                            <th>Latency</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {evalResults.metrics.map((m, i) => (
                            <tr key={i}>
                              <td style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ width: 6, height: 6, borderRadius: '50%', background: m.color }}></div>{m.name}
                              </td>
                              <td><span className="score-pill" style={{ color: m.color }}>{m.score}%</span></td>
                              <td>{m.latency}ms</td>
                              <td><span style={{ color: m.score >= 80 ? '#10A37F' : m.score >= 70 ? '#F5A623' : '#FF5A26' }}>{m.score >= 80 ? 'PASS' : m.score >= 70 ? 'WARN' : 'FAIL'}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="floating-card stagger-anim" style={{ padding: '32px', '--delay': '0.3s' }}>
                      <h3 className="section-title">Arbiter Heuristics</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginTop: '16px' }}>
                        {evalResults.metrics.map((m, i) => (
                          <div key={i} style={{ borderBottom: i === evalResults.metrics.length - 1 ? 'none' : '1px solid var(--border-outer)', paddingBottom: i === evalResults.metrics.length - 1 ? 0 : '24px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                              <strong className="mono" style={{ fontSize: '13px', color: 'var(--text-main)' }}>[{m.name}]</strong>
                            </div>
                            <p style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: 1.6, margin: 0 }}>{m.reasoning}</p>
                            
                            {m.outputs && m.outputs.length > 0 && (
                              <details style={{ marginTop: '16px' }}>
                                <summary style={{ cursor: 'pointer', fontSize: '12px', color: 'var(--text-main)', outline: 'none', fontFamily: "'JetBrains Mono', monospace" }}>[+] EXPAND RAW BUFFER</summary>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                                  {m.outputs.map((out, j) => (
                                    <div key={j} style={{ background: '#050505', border: '1px solid var(--border-inner)', padding: '16px', borderRadius: '4px', overflowX: 'auto' }}>
                                      <div className="mono" style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>// VECTOR_0{j + 1}_OUT</div>
                                      <pre style={{ fontSize: '12px', whiteSpace: 'pre-wrap', color: 'var(--text-muted)', margin: 0, fontFamily: "'JetBrains Mono', monospace" }}>
                                        {out || "NULL"}
                                      </pre>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                  </div>
                )}
              </motion.div>
            )}

            {/* SETTINGS PAGE */}
            {page === "settings" && (
              <motion.div key="settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="w-full max-w-800 mx-auto pb-12">
                <header className="page-header">
                  <h1 className="hero-title">Vault Configuration</h1>
                  <p className="hero-subtitle fade-in-delayed">Cryptographic keys are stored strictly in local memory.</p>
                </header>

                <div className="floating-card form-card stagger-anim" style={{ '--delay': '0.1s' }}>
                  <div className="section-title" style={{ marginBottom: '28px' }}>Access Tokens</div>

                  {SETTINGS_FIELDS.map(({ key, label, placeholder }) => {
                    const hasUserKey = !!(settingsData[key] || '').trim();
                    const hasServerKey = serverKeys[key];
                    return (
                      <div className="input-group" key={key}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <label className="mono" style={{ margin: 0, fontSize: '12px' }}>{label}</label>
                          <div className="mono" style={{ display: 'flex', gap: '6px', fontSize: '10px' }}>
                            {hasUserKey && (<span style={{ color: '#10A37F' }}>[LOCAL]</span>)}
                            {hasServerKey && (<span style={{ color: 'var(--text-muted)' }}>[FALLBACK]</span>)}
                            {!hasUserKey && !hasServerKey && (<span style={{ color: '#F5A623' }}>[NULL]</span>)}
                          </div>
                        </div>
                        <div style={{ position: 'relative' }}>
                          <input
                            id={`settings-${key}`}
                            className="inset-input mono"
                            type={settingsVisible[key] ? 'text' : 'password'}
                            value={settingsData[key] || ''}
                            onChange={e => setSettingsData(prev => ({ ...prev, [key]: e.target.value }))}
                            placeholder={hasServerKey ? `${placeholder} (OVERRIDE)` : placeholder}
                            style={{ paddingRight: '52px' }}
                            autoComplete="off"
                          />
                          <button
                            className="settings-eye-btn mono"
                            onClick={() => setSettingsVisible(prev => ({ ...prev, [key]: !prev[key] }))}
                          >
                            {settingsVisible[key] ? 'HIDE' : 'SHOW'}
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  <div className="deploy-footer" style={{ marginTop: '32px', paddingBottom: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      {settingsToast === 'success' && (
                        <motion.span className="mono" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} style={{ color: '#10A37F', fontSize: '12px' }}>
                          [COMMITTED]
                        </motion.span>
                      )}
                    </div>
                    <MagneticButton className="mechanical-btn large" onClick={handleSaveSettings} style={{ opacity: settingsSaving ? 0.6 : 1 }}>
                      {settingsSaving ? 'Writing...' : 'Commit Keys'}
                    </MagneticButton>
                  </div>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </main>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700;800&display=swap');

        /* --- HARDWARE THEME VARIABLES --- */
        :root {
          /* Deep matte carbon canvas */
          --bg-canvas: #09090b; 
          /* Translucent thick glass */
          --bg-surface: rgba(15, 15, 18, 0.65); 
          
          /* CNC machined edge lighting */
          --border-outer: rgba(255, 255, 255, 0.08);
          --border-inner: rgba(255, 255, 255, 0.04);
          
          --text-main: #FAFAFA; 
          --text-muted: #888888;
          --pop-primary: #FFFFFF; 
          
          /* Hardware unblurred drop shadows */
          --shadow-hardware: 0 4px 0 #111111;
        }

        /* --- GLOBAL RESETS --- */
        * { 
          box-sizing: border-box; 
          margin: 0; padding: 0;
          /* Strip out global transitions that cause layout thrashing */
        }

        body { 
          font-family: 'Inter', sans-serif; 
          background: var(--bg-canvas); 
          color: var(--text-main); 
          overflow-x: hidden; 
          -webkit-font-smoothing: antialiased;
        }

        /* Custom Scrollbar for dense engineering look */
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        .scroll-hidden { scrollbar-width: none; -ms-overflow-style: none; }
        .scroll-hidden::-webkit-scrollbar { display: none; }

        /* --- LAYOUT --- */
        .app-layout { 
          display: flex; min-height: 100vh; padding: 32px; gap: 32px; max-width: 1600px; margin: 0 auto; position: relative; z-index: 1;
        }

        /* --- BACKGROUND --- */
        /* Eliminates the AI-slop moving orbs and replaces it with a deep, static light leak */
        .ambient-background { 
          position: fixed; inset: 0; z-index: -2; 
          background: radial-gradient(circle at 50% -20%, rgba(255,255,255,0.03) 0%, transparent 60%),
                      var(--bg-canvas);
        }

        /* --- CNC GLASS PANELS --- */
        .floating-card { 
          background: var(--bg-surface); 
          backdrop-filter: blur(40px) saturate(200%); 
          -webkit-backdrop-filter: blur(40px) saturate(200%);
          
          border-radius: 8px; /* Sharp, machined corners */
          border: 1px solid var(--border-outer); 
          
          /* The dual-border trick for physical depth */
          box-shadow: 
            inset 0 1px 1px var(--border-inner), 
            0 20px 40px -10px rgba(0, 0, 0, 0.8); 
            
          padding: 32px;
          transition: transform 0.2s cubic-bezier(0.25, 1, 0.5, 1), border-color 0.2s;
        }
        
        .interactive-card { cursor: pointer; }
        .interactive-card:hover { border-color: rgba(255,255,255,0.15); transform: translateY(-2px); }

        /* --- TYPOGRAPHY --- */
        .hero-title { font-size: 36px; font-weight: 700; letter-spacing: -0.04em; margin-bottom: 8px; color: var(--text-main); }
        .hero-subtitle { font-size: 15px; color: var(--text-muted); margin-bottom: 32px; }
        .section-title { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 800; color: var(--text-muted); letter-spacing: 0.1em; margin-bottom: 16px; text-transform: uppercase; }
        .card-title { font-size: 16px; font-weight: 600; margin-bottom: 8px; margin-top: 12px; }
        .card-desc { color: var(--text-muted); font-size: 14px; line-height: 1.5; margin-bottom: 24px; }
        .mono { font-family: 'JetBrains Mono', monospace; }

        /* --- SIDEBAR --- */
        .sidebar { width: 280px; min-width: 280px; position: sticky; top: 32px; height: calc(100vh - 64px); display: flex; flex-direction: column; }
        .brand { display: flex; flex-direction: column; margin-bottom: 40px; }
        .brand-text { font-family: 'JetBrains Mono', monospace; font-size: 24px; font-weight: 800; letter-spacing: -0.05em; color: var(--text-main); }
        .brand-sub { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase; }
        
        .nav-links { display: flex; flex-direction: column; gap: 4px; margin-bottom: auto; }
        .nav-btn { 
          background: transparent; border: none; color: var(--text-muted); 
          padding: 10px 12px; text-align: left; cursor: pointer; font-size: 13px; font-weight: 600; 
          border-radius: 4px; transition: all 0.15s ease; 
        }
        .nav-btn.active { background: rgba(255,255,255,0.05); color: var(--text-main); }
        .nav-btn:hover:not(.active) { background: rgba(255,255,255,0.02); color: var(--text-main); }

        /* --- HARDWARE BUTTONS --- */
        /* Stripping soft floating shadows for hard, mechanical switch aesthetics */
        .mechanical-btn { 
          background: var(--text-main); color: var(--bg-canvas); 
          font-family: 'JetBrains Mono', monospace; font-weight: 800; font-size: 12px;
          border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; 
          cursor: pointer; text-transform: uppercase;
          
          /* Hard structural shadow */
          box-shadow: 0 4px 0 #1a1a1a;
          transform: translateY(0);
          transition: transform 0.1s cubic-bezier(0.25, 1, 0.5, 1), box-shadow 0.1s cubic-bezier(0.25, 1, 0.5, 1);
        }
        
        .mechanical-btn:active { 
          /* Physically depresses the button */
          transform: translateY(4px); 
          box-shadow: 0 0 0 #1a1a1a; 
        }

        .mechanical-btn.small { padding: 8px 16px; }
        .mechanical-btn.large { padding: 14px 24px; font-size: 13px; }

        .btn-secondary { 
          background: transparent; color: var(--text-muted); 
          font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 11px;
          border: 1px solid var(--border-outer); padding: 8px 16px; border-radius: 4px; 
          cursor: pointer; transition: all 0.15s;
        }
        .btn-secondary:hover { color: var(--text-main); border-color: rgba(255,255,255,0.3); }

        .btn-text-danger { background: transparent; border: none; color: #ff3b30; font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; opacity: 0.7; cursor: pointer; transition: 0.15s; }
        .btn-text-danger:hover { opacity: 1; text-decoration: underline; }

        /* --- INPUTS & FORMS --- */
        .input-group { margin-bottom: 20px; } 
        .input-group label { display: block; margin-bottom: 8px; font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 11px; color: var(--text-muted); text-transform: uppercase; }

        .inset-input { 
          width: 100%; padding: 14px 16px; 
          background: #050505; border: 1px solid var(--border-inner); border-radius: 4px; 
          color: var(--text-main); outline: none; font-family: inherit; font-size: 13px;
          box-shadow: inset 0 2px 4px rgba(0,0,0,0.2); transition: border-color 0.2s;
        }
        .inset-input:focus { border-color: rgba(255,255,255,0.2); }
        .inset-input.mono { font-family: 'JetBrains Mono', monospace; font-size: 12px; }

        /* --- GRID & CARDS --- */
        .bento-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 24px; }
        .bento-card { display: flex; flex-direction: column; justify-content: space-between; padding: 24px; }
        .bento-badge { font-family: 'JetBrains Mono', monospace; color: var(--text-main); font-size: 10px; font-weight: 700; border-bottom: 1px solid var(--border-outer); padding-bottom: 4px; }
        .card-footer { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-outer); padding-top: 20px; }
        
        .stat { display: flex; align-items: baseline; gap: 6px; } 
        .stat-val { font-family: 'JetBrains Mono', monospace; font-size: 20px; font-weight: 800; }
        .stat-label { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--text-muted); }

        .empty-add-card { 
          min-height: 200px; display: flex; flex-direction: column; align-items: center; justify-content: center; 
          background: rgba(255,255,255,0.01); border: 1px dashed var(--border-outer); box-shadow: none; cursor: pointer;
        }
        .empty-add-card:hover { border-style: solid; background: rgba(255,255,255,0.03); }
        .add-icon { font-size: 32px; font-weight: 300; color: var(--text-muted); margin-bottom: 12px; transition: 0.3s; }
        .empty-add-card:hover .add-icon { transform: rotate(90deg); color: var(--text-main); }

        .case-card { padding: 24px 24px 24px 40px; margin-bottom: 16px; }
        .drag-handle { position: absolute; left: 16px; top: 24px; color: var(--border-outer); font-size: 16px; cursor: grab; }
        .case-badge { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 800; color: var(--text-main); margin-bottom: 16px; letter-spacing: 1px; }

        /* --- DATA TABLES --- */
        .canvas-table { width: 100%; border-collapse: collapse; text-align: left; }
        .canvas-table th { color: var(--text-muted); font-size: 11px; padding: 12px 16px; border-bottom: 1px solid var(--border-outer); font-weight: 700; }
        .canvas-table td { padding: 12px 16px; border-bottom: 1px solid var(--border-inner); font-size: 12px; }
        .score-pill { padding: 2px 6px; border-radius: 2px; font-weight: 800; background: rgba(255,255,255,0.05); }

        /* --- MODELS STACK --- */
        .models-section { padding-top: 24px; border-top: 1px solid var(--border-outer); flex-shrink: 1; min-height: 0; display: flex; flex-direction: column; }
        .model-card { 
          display: flex; align-items: center; gap: 8px; padding: 8px 12px; 
          background: transparent; border: 1px solid transparent; width: 100%; text-align: left; 
          cursor: pointer; color: var(--text-muted); font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600;
          border-radius: 4px; transition: 0.15s;
        }
        .model-card:hover { background: rgba(255,255,255,0.02); }
        .model-card.active { background: rgba(255,255,255,0.05); color: var(--text-main); border: 1px solid var(--border-inner); }
        .model-indicator { width: 6px; height: 6px; border-radius: 1px; }

        /* --- ANIMATIONS --- */
        .stagger-anim { opacity: 0; transform: translateY(10px); animation: dropIn 0.5s cubic-bezier(0.25, 1, 0.5, 1) forwards; animation-delay: var(--delay); }
        @keyframes dropIn { to { opacity: 1; transform: translateY(0); } }
        .fade-in-delayed { opacity: 0; animation: fadeIn 0.4s ease forwards; animation-delay: 0.2s; }
        .fade-in-up { opacity: 0; animation: dropIn 0.6s cubic-bezier(0.25, 1, 0.5, 1) forwards; }
        @keyframes fadeIn { to { opacity: 1; } }
        
        .flex-between { display: flex; justify-content: space-between; align-items: center; }
        .w-full { width: 100%; } .max-w-1000 { max-width: 1000px; } .max-w-800 { max-width: 800px; } .mx-auto { margin: 0 auto; }
        .pb-12 { padding-bottom: 48px; } .mb-6 { margin-bottom: 24px; } .mb-4 { margin-bottom: 16px; }
        .page-header { margin-bottom: 40px; } .align-start { align-items: flex-start; }

        .settings-eye-btn { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); background: transparent; border: none; font-size: 10px; font-weight: 700; color: var(--text-muted); cursor: pointer; }
        
        /* Judge Dropdown */
        .judge-section { padding-top: 16px; border-top: 1px solid var(--border-outer); margin-top: auto; position: relative; }
        .judge-select-btn { width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: rgba(0,0,0,0.2); border: 1px solid var(--border-outer); border-radius: 4px; color: var(--text-main); font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; cursor: pointer; }
        .judge-dropdown-menu { position: absolute; bottom: calc(100% + 8px); left: 0; width: 100%; padding: 4px; background: var(--bg-surface); border: 1px solid var(--border-outer); border-radius: 4px; z-index: 100; max-height: 200px; overflow-y: auto; backdrop-filter: blur(20px); }
        .judge-menu-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: transparent; border: none; color: var(--text-muted); font-family: 'JetBrains Mono', monospace; font-size: 11px; cursor: pointer; width: 100%; text-align: left; border-radius: 2px; }
        .judge-menu-item:hover { background: rgba(255,255,255,0.05); color: var(--text-main); }
        .judge-menu-item.active { background: rgba(255,255,255,0.1); color: var(--text-main); }
      `}</style>
    </>
  );
}
