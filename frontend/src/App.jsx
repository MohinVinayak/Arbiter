"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from "recharts";

// ============================================================================
// 1. API SERVICE LAYER & CONSTANTS
// ============================================================================
// In dev: empty string → Vite proxy forwards /api/* to localhost:8000
// In prod: VITE_API_URL is set to the Railway backend URL
const API_BASE = import.meta.env.VITE_API_URL || "";

const KEYS_STORAGE_KEY = "arbiterApiKeys";

/** Read user's own API keys from localStorage (never leaves the browser at rest). */
function getStoredKeys() {
  try { return JSON.parse(localStorage.getItem(KEYS_STORAGE_KEY) || "{}"); }
  catch { return {}; }
}

/** Build HTTP headers that carry the user's keys to the backend for this request only. */
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

/**
 * Central fetch wrapper — automatically adds:
 *   • API_BASE prefix (production Railway URL)
 *   • Content-Type: application/json
 *   • X-*-Key headers (user's own keys, from localStorage)
 * Keys are sent over HTTPS and NEVER stored server-side.
 */
async function apiFetch(path, init = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...buildKeyHeaders(),
    ...(init.headers || {}),
  };
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

  // Provider-specific prettification
  if (provider === 'google') {
    // gemini-2.5-flash-lite → Gemini 2.5 Flash Lite
    name = name.replace(/^gemini-/, 'Gemini ').replace(/-/g, ' ');
    return name.replace(/\b\w/g, l => l.toUpperCase()).trim();
  }

  name = name.replace(/-/g, ' ');
  // Groq size labels
  name = name.replace(/\b8b\b/gi, '8B').replace(/\b70b\b/gi, '70B');
  // Strip noise
  name = name.replace(/\b(instant|versatile|exp free|latest)\b/gi, s =>
    s === 'latest' ? '' : s
  );
  return name.replace(/\b\w/g, l => l.toUpperCase()).trim();
}

// ============================================================================
// 2. MAGNETIC BUTTON COMPONENT
// ============================================================================
function MagneticButton({ children, className, onClick, style }) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const handleMouse = (e) => {
    const { clientX, clientY } = e;
    const { height, width, left, top } = ref.current.getBoundingClientRect();
    const middleX = clientX - (left + width / 2);
    const middleY = clientY - (top + height / 2);
    setPosition({ x: middleX * 0.15, y: middleY * 0.15 });
  };

  const reset = () => setPosition({ x: 0, y: 0 });

  return (
    <motion.button
      ref={ref} className={className} style={style} onClick={onClick}
      onMouseMove={handleMouse} onMouseLeave={reset}
      animate={{ x: position.x, y: position.y }}
      transition={{ type: "spring", stiffness: 400, damping: 25, mass: 0.5 }}
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

  // --- Suite State Management ---
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

  // --- Editor State ---
  const [editingSuiteId, setEditingSuiteId] = useState(null);
  const [newSuiteName, setNewSuiteName] = useState("");
  const [newSuiteDesc, setNewSuiteDesc] = useState("");
  const [testCases, setTestCases] = useState([{ prompt_template: "", expected_output: "" }]);
  
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evalResults, setEvalResults] = useState(runHistory.length > 0 ? runHistory[0] : null);

  // --- Settings State (BYOK — keys stored in localStorage only, never the server) ---
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
  // Load directly from localStorage on mount
  const [settingsData, setSettingsData] = useState(() => getStoredKeys());
  const [settingsVisible, setSettingsVisible] = useState({});
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsToast, setSettingsToast] = useState(null);
  const [serverKeys, setServerKeys] = useState({});

  // Fetch which providers have server-side fallback keys
  useEffect(() => {
    if (page !== 'settings') return;
    apiFetch('/api/settings')
      .then(data => setServerKeys(data.server_keys || {}))
      .catch(() => {});
  }, [page]);

  const handleSaveSettings = () => {
    // Save to localStorage — nothing is sent to the server
    localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify(settingsData));
    setSettingsSaving(true);
    setSettingsToast('success');
    // Refresh the model list since available providers may have changed
    refreshModels();
    setTimeout(() => { setSettingsSaving(false); setSettingsToast(null); }, 2000);
  };

  // ── High-Performance Single Cursor & Background ──
  const cursorRef = useRef(null);
  const bgGlowRef = useRef(null);
  const mousePos = useRef({ x: -1000, y: -1000 });
  const bgPos = useRef({ x: -1000, y: -1000 });

  useEffect(() => {
    let rafId;
    const renderFrame = () => {
      if (cursorRef.current) { cursorRef.current.style.transform = `translate3d(${mousePos.current.x}px, ${mousePos.current.y}px, 0) translate(-50%, -50%)`; }
      bgPos.current.x += (mousePos.current.x - bgPos.current.x) * 0.12;
      bgPos.current.y += (mousePos.current.y - bgPos.current.y) * 0.12;
      if (bgGlowRef.current) { bgGlowRef.current.style.transform = `translate3d(${bgPos.current.x}px, ${bgPos.current.y}px, 0) translate(-50%, -50%)`; }
      rafId = requestAnimationFrame(renderFrame);
    };
    rafId = requestAnimationFrame(renderFrame);

    const handleMouseMove = (e) => { mousePos.current.x = e.clientX; mousePos.current.y = e.clientY; };
    const handleMouseOver = (e) => {
      if (e.target.closest('.run-eval-btn')) {
        document.body.classList.add('hovering-run-eval'); document.body.classList.remove('hovering-interactive');
      } else if (e.target.closest('button, input, textarea, select, .floating-card, .drag-handle, .model-card')) {
        document.body.classList.add('hovering-interactive'); document.body.classList.remove('hovering-run-eval');
      } else {
        document.body.classList.remove('hovering-interactive'); document.body.classList.remove('hovering-run-eval');
      }
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mouseover', handleMouseOver, { passive: true });

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseover', handleMouseOver);
      cancelAnimationFrame(rafId);
    };
  }, []);

  // --- Suite Operations ---
  const resetSuiteForm = () => {
    setEditingSuiteId(null);
    setNewSuiteName("");
    setNewSuiteDesc("");
    setTestCases([{ prompt_template: "", expected_output: "" }]);
  };

  const handleEditSuite = (suite) => {
    setEditingSuiteId(suite.id);
    setNewSuiteName(suite.name);
    setNewSuiteDesc(suite.description);
    // If the suite has cases saved, load them. Otherwise load one empty case.
    setTestCases(suite.cases && suite.cases.length > 0 ? suite.cases : [{ prompt_template: "", expected_output: "" }]);
    setPage("new-suite");
  };

  const handleDeploySuite = async () => {
    const validCases = testCases.filter(tc => tc.prompt_template.trim() !== "");
    const finalCases = validCases.length > 0 ? validCases : [{ prompt_template: "", expected_output: "" }];
    
    const suiteData = {
      name: newSuiteName || "Untitled Suite",
      description: newSuiteDesc || "No description provided.",
      cases: finalCases,
      test_case_count: finalCases.length
    };

    try {
      const method = editingSuiteId ? 'PUT' : 'POST';
      const path = editingSuiteId ? `/api/suites/${editingSuiteId}` : '/api/suites';
      const savedSuite = await apiFetch(path, { method, body: JSON.stringify(suiteData) });

      if (editingSuiteId) {
        setSuites(suites.map(s => s.id === editingSuiteId ? savedSuite : s));
      } else {
        setSuites([savedSuite, ...suites]);
      }
    } catch (error) {
      console.warn("Backend save failed, falling back to local storage:", error);
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
      <div className="ambient-background">
        <div ref={bgGlowRef} className="cursor-ambient-glow"><div className="glow-orb"></div></div>
        <div className="dot-grid-overlay"></div>
      </div>

      <div className="app-layout">
        <div ref={cursorRef} className="custom-shadow-cursor"></div>



        <nav className="sidebar floating-panel fade-in-up">
          <div className="brand">
            <span className="brand-text">ARBITER</span>
            <span className="brand-sub">LLM Evaluator</span>
          </div>

          <div className="nav-links">
            <button onClick={() => { resetSuiteForm(); setPage("dashboard"); }} className={`nav-btn ${page === "dashboard" ? "active" : ""}`}><span className="nav-icon">◒</span>Dashboard</button>
            <button onClick={() => { resetSuiteForm(); setPage("new-suite"); }} className={`nav-btn ${page === "new-suite" ? "active" : ""}`}><span className="nav-icon">✚</span>Create Suite</button>
            <button onClick={() => setPage("results")} className={`nav-btn ${page === "results" ? "active" : ""}`}><span className="nav-icon">❖</span>Run Results</button>
            <button onClick={() => setPage("settings")} className={`nav-btn ${page === "settings" ? "active" : ""}`}><span className="nav-icon">⚙</span>Settings</button>
          </div>

          <div className="models-section">
            <div className="section-title">ACTIVE MODELS</div>
            <div className="models-stack">
              {isLoadingModels ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px' }}>Loading models...</div>
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
                      {isActive && <div className="active-ring" style={{ borderColor: val.color }}></div>}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* JUDGE SELECTOR (DROP-UP) */}
          <div className="judge-section">
            <div className="section-title">JUDGE MODEL</div>
            {isLoadingModels ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px' }}>Loading...</div>
            ) : (
              <div style={{ position: 'relative', width: '100%' }}>
                <AnimatePresence>
                  {judgeDropdownOpen && (
                    <motion.div 
                      className="judge-dropdown-menu"
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
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
                  <h1 className="hero-title">
                    <div className="mask-text"><span className="slide-up-1">EVALUATION</span></div>
                    <div className="mask-text"><span className="slide-up-2">WORKSPACE</span></div>
                  </h1>
                  <p className="hero-subtitle fade-in-delayed">Select a suite to edit, or run an evaluation.</p>
                </header>

                <div className="bento-grid">
                  <div className="floating-card bento-card empty-add-card stagger-anim" onClick={() => { resetSuiteForm(); setPage("new-suite"); }} style={{ '--delay': '0s' }}>
                    <div className="add-icon">+</div>
                    <h3 className="card-title" style={{marginBottom: 0}}>Build New Suite</h3>
                  </div>

                  {suites.map((suite, idx) => (
                    <div key={suite.id} className="floating-card bento-card stagger-anim interactive-card" style={{ '--delay': `${(idx + 1) * 0.1}s` }} onClick={() => handleEditSuite(suite)}>
                      <div className="card-top flex-between">
                        <span className="bento-badge">Suite 0{suites.length - idx}</span>
                        <span className="edit-hint">Click to edit</span>
                      </div>
                      <h3 className="card-title">{suite.name}</h3>
                      <p className="card-desc">{suite.description}</p>
                      <div className="card-footer">
                        <div className="stat">
                          <span className="stat-val">{suite.test_case_count}</span>
                          <span className="stat-label">Cases</span>
                        </div>
                        <button className="btn-3d small run-eval-btn" onClick={(e) => { e.stopPropagation(); handleRunEval(suite); }}>Run Eval</button>
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
                  <h1 className="hero-title">
                    <div className="mask-text"><span className="slide-up-1">{editingSuiteId ? 'EDIT YOUR' : 'BUILD A'}</span></div>
                    <div className="mask-text"><span className="slide-up-2">SUITE</span></div>
                  </h1>
                  <p className="hero-subtitle fade-in-delayed">Draft your parameters before deploying to the models.</p>
                </header>

                <div className="floating-card form-card mb-6 stagger-anim" style={{ '--delay': '0.1s' }}>
                  <div className="input-group">
                    <label>Suite Name</label>
                    <input className="inset-input" value={newSuiteName} onChange={e => setNewSuiteName(e.target.value)} placeholder="e.g. Sales Onboarding Agent..." />
                  </div>
                  <div className="input-group">
                    <label>Description</label>
                    <input className="inset-input" value={newSuiteDesc} onChange={e => setNewSuiteDesc(e.target.value)} placeholder="What behaviors are we evaluating?" />
                  </div>
                </div>

                <div className="flex-between mb-4 fade-in-delayed">
                  <h2 className="section-title" style={{marginBottom: 0}}>TEST CASES</h2>
                  <button onClick={() => setTestCases([...testCases, { prompt_template: "", expected_output: "" }])} className="btn-secondary">+ Add Card</button>
                </div>

                <div className="cases-stack">
                  {testCases.map((tc, i) => (
                    <div key={i} className="floating-card case-card relative stagger-anim" style={{ '--delay': `${(i * 0.1) + 0.2}s` }}>
                      <div className="drag-handle">⠿</div>
                      <div className="case-badge">Case 0{i + 1}</div>

                      <div className="input-group">
                        <label>Prompt Template</label>
                        <textarea className="inset-input mono" rows={3} value={tc.prompt_template} onChange={e => { const updated = [...testCases]; updated[i].prompt_template = e.target.value; setTestCases(updated); }} placeholder="User: {input} \nSystem: You are an expert..." />
                      </div>
                      <div className="input-group">
                        <label>Expected Output Reference</label>
                        <textarea className="inset-input" rows={2} value={tc.expected_output} onChange={e => { const updated = [...testCases]; updated[i].expected_output = e.target.value; setTestCases(updated); }} placeholder="Reference text for the evaluator..." />
                      </div>
                      {testCases.length > 1 && (<button className="btn-text-danger" onClick={() => setTestCases(testCases.filter((_, index) => index !== i))}>Remove Case</button>)}
                    </div>
                  ))}
                </div>

                <div className="deploy-footer flex-between fade-in-delayed" style={{ marginTop: "32px", paddingBottom: "64px" }}>
                  {/* DELETE BUTTON SHOWS IF WE ARE EDITING */}
                  {editingSuiteId ? (
                    <button className="btn-text-danger" style={{fontSize: '14px', color: '#ff3b30'}} onClick={handleDeleteSuite}>Delete Suite</button>
                  ) : <div></div>}
                  
                  <MagneticButton className="btn-3d large scale-click run-eval-btn" onClick={handleDeploySuite}>
                    {editingSuiteId ? 'Save Updates' : 'Deploy Test Suite'}
                  </MagneticButton>
                </div>
              </motion.div>
            )}

            {/* RESULTS PAGE */}
            {page === "results" && (
              <motion.div key="res" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="w-full max-w-800 mx-auto pb-12">
                <header className="page-header flex-between align-start">
                  <div>
                    <h1 className="hero-title">
                      <div className="mask-text"><span className="slide-up-1">EVALUATION</span></div>
                      <div className="mask-text"><span className="slide-up-2">TELEMETRY</span></div>
                    </h1>
                    <p className="hero-subtitle fade-in-delayed">Model performance and evaluation metrics.</p>
                  </div>
                  
                  {runHistory.length > 0 && !isEvaluating && (
                    <div className="fade-in-delayed" style={{ textAlign: 'right', zIndex: 10 }}>
                      <span className="section-title" style={{ display: 'block', marginBottom: 8, textTransform: 'none' }}>Past Runs</span>
                      <select 
                        className="inset-input mono" 
                        style={{ padding: '8px 16px', fontSize: 13, width: 200, cursor: 'none' }}
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
                    <div className="spin-icon add-icon" style={{ color: 'var(--pop-primary)' }}>❖</div>
                    <h3 className="card-title" style={{ marginBottom: 0 }}>Running Eval</h3>
                    <p style={{ color: 'var(--text-muted)', marginTop: '16px' }}>Pinging {selectedModels.length} models across the suite. This may take a moment.</p>
                  </div>
                )}

                {!isEvaluating && !evalResults && (
                  <div className="floating-card empty-state fade-in">
                    <div className="add-icon">✧</div>
                    <h3 className="card-title" style={{ marginBottom: 0 }}>Awaiting Data</h3>
                    <p style={{ color: 'var(--text-muted)', marginTop: '16px' }}>Head back to the dashboard to run a suite.</p>
                    <button className="btn-secondary" style={{ marginTop: '24px', padding: '12px 24px' }} onClick={() => setPage("dashboard")}>Go to Dashboard</button>
                  </div>
                )}

                {!isEvaluating && evalResults && (
                  <div className="stagger-anim" style={{ '--delay': '0.1s' }}>
                    <div className="bento-badge" style={{ marginBottom: '16px' }}>Target: {evalResults.suiteName}</div>
                    
                    <div className="bento-grid" style={{ marginBottom: '24px' }}>
                      <div className="floating-card bento-card" style={{ gridColumn: '1 / -1' }}>
                        <h3 className="section-title">Aggregate Scores</h3>
                        <ResponsiveContainer width="100%" height={260}>
                          <BarChart data={evalResults.metrics} margin={{ top: 20, right: 0, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.6}/>
                            <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }} axisLine={false} tickLine={false} />
                            <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                            <Tooltip
                              cursor={{ fill: 'var(--tooltip-bg)' }}
                              contentStyle={{
                                borderRadius: '12px',
                                border: '1px solid var(--border)',
                                background: 'var(--bg-surface)',
                                boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
                                color: 'var(--text-main)',
                              }}
                              labelStyle={{ color: 'var(--text-main)', fontWeight: 700, marginBottom: '4px' }}
                              itemStyle={{ color: 'var(--text-muted)' }}
                            />
                            <Bar dataKey="score" radius={[8, 8, 0, 0]} maxBarSize={60}>
                              {evalResults.metrics.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="floating-card stagger-anim" style={{ padding: '24px', overflowX: 'auto', '--delay': '0.2s', marginBottom: '24px' }}>
                      <h3 className="section-title">Performance Breakdown</h3>
                      <table className="canvas-table">
                        <thead>
                          <tr>
                            <th>Model Identifier</th>
                            <th>Eval Score</th>
                            <th>Avg Latency</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {evalResults.metrics.map((m, i) => (
                            <tr key={i}>
                              <td style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ width: 8, height: 8, borderRadius: '50%', background: m.color }}></div>{m.name}
                              </td>
                              <td><span className="score-pill" style={{ color: m.color, background: m.color.replace(')', ', 0.15)').replace('rgb', 'rgba').replace('#', '') }}>{m.score}%</span></td>
                              <td className="mono">{m.latency}ms</td>
                              <td><span style={{ color: m.score >= 80 ? '#10A37F' : m.score >= 70 ? '#F5A623' : '#FF5A26', fontWeight: 700, fontSize: '13px' }}>{m.score >= 80 ? 'Passed' : m.score >= 70 ? 'Review' : 'Failed'}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="floating-card stagger-anim" style={{ padding: '32px', '--delay': '0.3s' }}>
                      <h3 className="section-title">Judge Reasoning & Analysis</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginTop: '16px' }}>
                        {evalResults.metrics.map((m, i) => (
                          <div key={i} style={{ borderBottom: i === evalResults.metrics.length - 1 ? 'none' : '1px dashed var(--border)', paddingBottom: i === evalResults.metrics.length - 1 ? 0 : '24px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                              <div style={{ width: 10, height: 10, borderRadius: '50%', background: m.color }}></div>
                              <strong style={{ fontSize: '15px', color: 'var(--text-main)' }}>{m.name}</strong>
                            </div>
                            <p style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: 1.6, margin: 0 }}>{m.reasoning}</p>
                            
                            {m.outputs && m.outputs.length > 0 && (
                              <details style={{ marginTop: '16px' }}>
                                <summary style={{ cursor: 'pointer', fontSize: '13px', color: 'var(--pop-primary)', fontWeight: 600, outline: 'none' }}>View Raw Inference Outputs</summary>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                                  {m.outputs.map((out, j) => (
                                    <div key={j} style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)', padding: '16px', borderRadius: '8px', overflowX: 'auto' }}>
                                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Test Case 0{j + 1}</div>
                                      <pre style={{ fontSize: '12px', whiteSpace: 'pre-wrap', color: 'var(--text-main)', margin: 0, fontFamily: "'JetBrains Mono', monospace" }}>
                                        {out || "No output generated / null"}
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
                  <h1 className="hero-title">
                    <div className="mask-text"><span className="slide-up-1">API KEY</span></div>
                    <div className="mask-text"><span className="slide-up-2">SETTINGS</span></div>
                  </h1>
                  <p className="hero-subtitle fade-in-delayed">Your keys are saved in <strong>your browser only</strong> — never stored on the server.</p>
                </header>

                {/* Security notice */}
                <div className="floating-card stagger-anim" style={{ '--delay': '0s', padding: '18px 28px', marginBottom: '16px', border: '1px solid rgba(16,163,127,0.25)', background: 'rgba(16,163,127,0.06)' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10A37F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '2px' }}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '13px', color: '#10A37F', marginBottom: '4px' }}>BYOK — Bring Your Own Key</div>
                      <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                        Keys are stored in <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 6px', borderRadius: '4px' }}>localStorage</code> and sent over HTTPS only when you run an eval — they are <strong>never written to any database</strong>.
                        Each user's keys are completely isolated.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="floating-card form-card stagger-anim" style={{ '--delay': '0.1s' }}>
                  <div className="section-title" style={{ marginBottom: '28px' }}>Your API Keys</div>

                  {SETTINGS_FIELDS.map(({ key, label, placeholder, provider }) => {
                    const hasUserKey = !!(settingsData[key] || '').trim();
                    const hasServerKey = serverKeys[key];
                    return (
                      <div className="input-group" key={key}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <label style={{ margin: 0 }}>{label}</label>
                          <div style={{ display: 'flex', gap: '6px', fontSize: '11px', fontWeight: 600 }}>
                            {hasUserKey && (
                              <span style={{ color: '#10A37F', background: 'rgba(16,163,127,0.12)', padding: '2px 8px', borderRadius: '20px' }}>✓ Set locally</span>
                            )}
                            {hasServerKey && (
                              <span style={{ color: 'var(--text-muted)', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '20px' }}>server fallback ✓</span>
                            )}
                            {!hasUserKey && !hasServerKey && (
                              <span style={{ color: '#F5A623', background: 'rgba(245,166,35,0.1)', padding: '2px 8px', borderRadius: '20px' }}>not configured</span>
                            )}
                          </div>
                        </div>
                        <div style={{ position: 'relative' }}>
                          <input
                            id={`settings-${key}`}
                            className="inset-input"
                            type={settingsVisible[key] ? 'text' : 'password'}
                            value={settingsData[key] || ''}
                            onChange={e => setSettingsData(prev => ({ ...prev, [key]: e.target.value }))}
                            placeholder={hasServerKey ? `${placeholder} (server key active — override optional)` : placeholder}
                            style={{ paddingRight: '52px' }}
                            autoComplete="off"
                          />
                          <button
                            className="settings-eye-btn"
                            onClick={() => setSettingsVisible(prev => ({ ...prev, [key]: !prev[key] }))}
                            title={settingsVisible[key] ? 'Hide' : 'Show'}
                          >
                            <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{settingsVisible[key] ? 'Hide' : 'Show'}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  <div className="deploy-footer" style={{ marginTop: '32px', paddingBottom: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      {settingsToast === 'success' && (
                        <motion.span
                          initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                          style={{ color: '#10A37F', fontSize: '13px', fontWeight: 700 }}
                        >✓ Saved to browser — model list refreshed</motion.span>
                      )}
                    </div>
                    <MagneticButton
                      className="btn-3d large scale-click"
                      onClick={handleSaveSettings}
                      style={{ opacity: settingsSaving ? 0.6 : 1 }}
                    >
                      {settingsSaving ? 'Saving…' : 'Save Keys'}
                    </MagneticButton>
                  </div>
                </div>

                <div className="floating-card stagger-anim" style={{ '--delay': '0.2s', padding: '24px 32px' }}>
                  <div className="section-title" style={{ marginBottom: '12px' }}>How it works</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    {[
                      { title: 'Your keys stay yours', desc: 'Stored only in this browser. Clearing localStorage removes them instantly.' },
                      { title: 'Sent per request', desc: 'Attached as encrypted HTTPS headers on every eval — discarded immediately after.' },
                      { title: 'Zero server storage', desc: 'No database, no logs. A server breach cannot expose your API keys.' },
                      { title: 'Server fallbacks', desc: 'Providers marked "server fallback ✓" work even without your own key.' },
                    ].map(({ title, desc }) => (
                      <div key={title} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '16px', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '4px' }}>{title}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>{desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </main>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800&family=JetBrains+Mono:wght@400;500;700&display=swap');

        :root, [data-theme="light"], [data-theme="dark"] {
          --bg-canvas: #000000; 
          --bg-surface: #111111; 
          --border: #222222; 
          --text-main: #EDEDED; 
          --text-muted: #888888;
          --pop-primary: #FFFFFF; 
          --pop-primary-dark: #A3A3A3;
          --shadow-float: 0 12px 32px -8px rgba(0,0,0,0.8);
          --tooltip-bg: rgba(255,255,255,0.05); 
          --panel-bg: rgba(255,255,255,0.05);
          --bg-glow-color: rgba(255, 255, 255, 0.02);
          --inner-glow: inset 0 1px 1px rgba(255,255,255,0.05);
          --input-bg: #000000;
          --shadow-hover: 0 30px 60px -15px rgba(255, 255, 255, 0.1); 
        }

        * { box-sizing: border-box; margin: 0; padding: 0; transition: background-color 0.4s ease, border-color 0.4s ease, color 0.4s ease; }

        body {
          font-family: 'Plus Jakarta Sans', sans-serif; 
          background-color: var(--bg-canvas);
          color: var(--text-main);
          -webkit-font-smoothing: antialiased; 
          overflow-x: hidden;
        }

        .w-full { width: 100%; }
        .max-w-1000 { max-width: 1000px; }
        .max-w-800 { max-width: 800px; }
        .mx-auto { margin-left: auto; margin-right: auto; }

        /* ── ZERO LAG BACKGROUND ── */
        .ambient-background { position: fixed; inset: 0; z-index: -2; overflow: hidden; background-color: var(--bg-canvas); }
        .cursor-ambient-glow { position: fixed; top: 0; left: 0; z-index: -1; pointer-events: none; will-change: transform; }
        .glow-orb {
          width: 50vw; height: 50vw;
          background: radial-gradient(circle, var(--bg-glow-color) 0%, transparent 60%);
          border-radius: 50%; opacity: 0.9; transform: scale(1) translateZ(0);
          transition: opacity 0.5s ease, transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
        }
        body.hovering-interactive .glow-orb, body.hovering-run-eval .glow-orb { opacity: 0; transform: scale(0.6) translateZ(0); }

        .dot-grid-overlay {
          position: fixed; inset: 0; z-index: -1; pointer-events: none;
          background-image: radial-gradient(var(--border) 1px, transparent 1px);
          background-size: 24px 24px; opacity: 0.5;
        }

        /* ── ELEGANT SINGLE CURSOR ── */
        @media (pointer: fine) {
          body { cursor: none; }
          a, button, input, textarea, select, option { cursor: none !important; }
          
          .custom-shadow-cursor {
            position: fixed; top: 0; left: 0; width: 12px; height: 12px;
            background: var(--text-main); opacity: 0.5; border-radius: 50%; 
            pointer-events: none; z-index: 99999;
            will-change: transform, width, height;
            transition: width 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), height 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), background 0.2s ease, opacity 0.2s ease, border-radius 0.2s ease;
          }

          body.hovering-interactive .custom-shadow-cursor {
            width: 32px; height: 32px; background: transparent; border: 1.5px solid var(--text-main); opacity: 0.4;
          }

          body.hovering-run-eval .custom-shadow-cursor {
            width: 40px; height: 40px; background: rgba(255, 255, 255, 0.9); box-shadow: 0 0 20px rgba(255, 255, 255, 0.5); mix-blend-mode: difference; opacity: 1; border: none;
          }
        }
        @media (pointer: coarse) { .custom-shadow-cursor { display: none; } }

        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 10px; }
        
        /* Invisible scroll — scrollable but no visible scrollbar taking up space */
        .scroll-hidden { scrollbar-width: none; -ms-overflow-style: none; }
        .scroll-hidden::-webkit-scrollbar { display: none; }

        .app-layout { display: flex; min-height: 100vh; padding: 24px; gap: 40px; max-width: 1600px; margin: 0 auto; position: relative; }



        .page-animate-reveal { animation: pageReveal 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards; width: 100%; will-change: transform, opacity, filter; }
        @keyframes pageReveal {
          from { opacity: 0; transform: translateY(15px); filter: blur(4px); }
          to { opacity: 1; transform: translateY(0); filter: blur(0); }
        }

        .hero-title { font-size: clamp(36px, 4.5vw, 64px); font-weight: 800; letter-spacing: -0.04em; line-height: 0.9; color: var(--text-main); margin-bottom: 12px; }
        .mask-text { overflow: hidden; display: block; padding-bottom: 4px; }
        .slide-up-1, .slide-up-2 { display: inline-block; animation: slideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; transform: translateY(100%); }
        .slide-up-2 { animation-delay: 0.1s; }
        @keyframes slideUp { to { transform: translateY(0); } }

        .hero-subtitle { font-size: 16px; color: var(--text-muted); margin-bottom: 48px; font-weight: 500; }
        .section-title { font-size: 12px; font-weight: 800; letter-spacing: 0.15em; color: var(--text-muted); margin-bottom: 16px; text-transform: uppercase; }
        .card-title { font-size: 20px; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 8px; color: var(--text-main); }

        .sidebar { width: 300px; min-width: 300px; height: calc(100vh - 48px); position: sticky; top: 24px; display: flex; flex-direction: column; padding: 32px 24px; z-index: 10; overflow-y: auto; overflow-x: hidden; }
        .floating-panel { background: var(--panel-bg); backdrop-filter: blur(24px); border: 1px solid var(--border); border-radius: 28px; box-shadow: var(--shadow-float), var(--inner-glow); }

        .main-canvas { flex: 1; padding-top: 24px; display: flex; justify-content: center; }
        .flex-between { display: flex; justify-content: space-between; align-items: center; }
        .mb-4 { margin-bottom: 16px; } .mb-6 { margin-bottom: 32px; }

        .floating-card { background: var(--panel-bg); backdrop-filter: blur(16px); border-radius: 24px; border: 1px solid var(--border); box-shadow: var(--shadow-float), var(--inner-glow); transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.4s ease, border-color 0.4s ease; }
        .floating-card:hover { transform: translateY(-6px); box-shadow: var(--shadow-hover), var(--inner-glow); border-color: var(--pop-primary); }
        .interactive-card { cursor: pointer; }
        
        .edit-hint { font-size: 12px; font-weight: 600; color: var(--pop-primary); opacity: 0; transition: opacity 0.3s ease; }
        .interactive-card:hover .edit-hint { opacity: 1; }

        .stagger-anim { opacity: 0; transform: translateY(20px); animation: springUp 0.7s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; animation-delay: var(--delay); }
        @keyframes springUp { to { opacity: 1; transform: translateY(0); } }

        .fade-in-delayed { opacity: 0; animation: fadeIn 0.6s ease forwards; animation-delay: 0.3s; }
        .fade-in-up { opacity: 0; animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

        .bento-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px; }
        .bento-card { padding: 32px; display: flex; flex-direction: column; justify-content: space-between; }
        .bento-badge { background: var(--bg-canvas); color: var(--pop-primary); font-size: 12px; font-weight: 800; padding: 6px 12px; border-radius: 8px; display: inline-block; border: 1px solid var(--border); }
        
        .card-desc { color: var(--text-muted); font-size: 15px; line-height: 1.5; margin-bottom: 32px; flex-grow: 1; }
        .card-footer { display: flex; justify-content: space-between; align-items: center; border-top: 1px dashed var(--border); padding-top: 24px; }
        .stat { display: flex; align-items: baseline; gap: 6px; }
        .stat-val { font-size: 24px; font-weight: 800; font-family: 'JetBrains Mono', monospace; }
        .stat-label { font-size: 13px; color: var(--text-muted); font-weight: 600; }

        /* ── CREATIVE "BUILD SUITE" HOVER ── */
        .empty-add-card { 
          position: relative; overflow: hidden; background: transparent; border: 2px dashed var(--border); box-shadow: none;
          align-items: center; justify-content: center; text-align: center; color: var(--text-muted);
          min-height: 220px;
        }
        .empty-add-card::before {
          content: ''; position: absolute; inset: 0; z-index: 0; pointer-events: none; opacity: 0;
          background-image: radial-gradient(var(--pop-primary) 1px, transparent 1px); background-size: 16px 16px;
          transition: opacity 0.5s ease;
        }
        .empty-add-card:hover { 
          border-style: solid; color: var(--text-main); background: var(--panel-bg); 
          transform: translateY(-6px) scale(1.02); box-shadow: var(--shadow-hover); 
        }
        .empty-add-card:hover::before { opacity: 0.1; }
        .empty-add-card * { position: relative; z-index: 1; }
        .add-icon { 
          font-size: 48px; font-weight: 300; margin-bottom: 16px; 
          transition: transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1); will-change: transform; color: var(--pop-primary);
        }
        .empty-add-card:hover .add-icon { transform: rotate(90deg) scale(1.1); }

        .empty-state { padding: 80px 40px; text-align: center; border: 1px dashed var(--border); box-shadow: none; background: transparent; display: flex; flex-direction: column; align-items: center; justify-content: center;}

        /* Buttons */
        .btn-3d { background: var(--pop-primary); color: var(--bg-surface); font-family: inherit; font-weight: 800; border: none; border-radius: 12px; box-shadow: 0 4px 0 var(--pop-primary-dark), 0 8px 16px rgba(0,0,0,0.1); transform: translateY(-2px); transition: transform 0.1s ease, box-shadow 0.1s ease; }
        .btn-3d:active { transform: translateY(2px); box-shadow: 0 0 0 var(--pop-primary-dark), 0 0 0 transparent; }
        .btn-3d.small { padding: 10px 20px; font-size: 13px; }
        .btn-3d.large { padding: 16px 36px; font-size: 15px; border-radius: 16px; box-shadow: 0 6px 0 var(--pop-primary-dark); transform: translateY(-4px); }
        .btn-3d.large:active { transform: translateY(2px); box-shadow: 0 0 0 transparent; }

        .btn-secondary { background: var(--bg-surface); color: var(--text-main); border: 1px solid var(--border); padding: 8px 16px; border-radius: 10px; font-family: inherit; font-weight: 700; font-size: 13px; box-shadow: 0 2px 0 var(--border); transition: all 0.1s ease; }
        .btn-secondary:active { transform: translateY(2px); box-shadow: 0 0 0 transparent; }
        
        .btn-text-danger { background: transparent; border: none; color: #ff3b30; font-family: inherit; font-size: 12px; font-weight: 700; margin-top: 8px; opacity: 0.8; transition: opacity 0.2s ease; cursor: pointer; }
        .btn-text-danger:hover { opacity: 1; text-decoration: underline; }

        /* Navigation Links */
        .brand { display: flex; flex-direction: column; gap: 4px; margin-bottom: 48px; }
        .brand-text { font-size: 30px; font-weight: 900; letter-spacing: 0.18em; color: var(--text-main); text-shadow: none; line-height: 1; }
        .brand-sub { font-size: 11px; font-weight: 800; color: var(--text-muted); letter-spacing: 0.22em; text-transform: uppercase; opacity: 0.7; }
        .nav-links { display: flex; flex-direction: column; gap: 8px; margin-bottom: auto; }
        .nav-btn { background: transparent; border: none; color: var(--text-muted); font-family: inherit; font-weight: 700; font-size: 15px; padding: 14px 16px; border-radius: 12px; display: flex; align-items: center; gap: 16px; transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); cursor: pointer; }
        .nav-btn:hover { background: var(--border); color: var(--text-main); transform: translateX(6px); }
        .nav-btn.active { background: var(--bg-surface); color: var(--pop-primary); transform: translateX(6px); box-shadow: var(--shadow-float); border: 1px solid var(--border); }

        /* Models Stack */
        .models-section { padding-top: 32px; border-top: 1px dashed var(--border); flex-shrink: 1; min-height: 0; display: flex; flex-direction: column; }
        .models-stack { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; max-height: 200px; scrollbar-width: none; -ms-overflow-style: none; }
        .models-stack::-webkit-scrollbar { display: none; }
        .model-card { position: relative; display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 12px; font-family: inherit; font-size: 13px; font-weight: 700; transition: all 0.2s ease; cursor: pointer; }
        .model-card .model-label { color: var(--text-muted); transition: color 0.2s ease; }
        .model-card:hover { background: var(--mbg); border-color: var(--mc); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .model-card:hover .model-label { color: var(--mc); }
        .model-card:hover .model-indicator { background: var(--mc) !important; }
        .model-card.active { background: var(--mbg); border-color: var(--mc); box-shadow: 0 2px 8px rgba(0,0,0,0.05); z-index: 1; }
        .model-card.active .model-label { color: var(--mc); }
        .model-indicator { width: 10px; height: 10px; border-radius: 50%; transition: 0.2s; background: var(--border); }
        .active-ring { position: absolute; inset: -2px; border: 2px solid; border-radius: 14px; opacity: 0.2; pointer-events: none; }

        /* Forms */
        .form-card { padding: 40px; margin-bottom: 32px; }
        .case-card { padding: 32px 32px 32px 48px; margin-bottom: 24px; }
        .drag-handle { position: absolute; left: 16px; top: 32px; color: var(--border); font-size: 20px; transition: color 0.2s ease; }
        .case-card:hover .drag-handle { color: var(--text-muted); }
        .case-badge { font-size: 11px; font-weight: 800; color: var(--pop-primary); margin-bottom: 16px; letter-spacing: 1px; text-transform: uppercase; }
        .input-group { margin-bottom: 24px; }
        .input-group:last-child { margin-bottom: 0; }
        .input-group label { display: block; font-size: 13px; font-weight: 700; margin-bottom: 10px; color: var(--text-main); }
        
        .inset-input { width: 100%; background: var(--input-bg); border: 1px solid var(--border); border-radius: 12px; padding: 16px 20px; color: var(--text-main); font-family: inherit; font-size: 14px; font-weight: 500; outline: none; resize: vertical; box-shadow: inset 0 2px 4px rgba(0,0,0,0.02); transition: all 0.3s ease; }
        .inset-input.mono { font-family: 'JetBrains Mono', monospace; font-size: 13px; }
        .inset-input:focus { background: var(--bg-surface); border-color: var(--pop-primary); box-shadow: 0 0 0 4px rgba(91, 78, 228, 0.1); }
        
        /* Tables */
        .canvas-table { width: 100%; border-collapse: collapse; text-align: left; }
        .canvas-table th { font-size: 12px; font-weight: 800; color: var(--text-muted); padding: 16px; border-bottom: 2px solid var(--border); text-transform: uppercase; letter-spacing: 0.05em; }
        .canvas-table td { padding: 16px; border-bottom: 1px solid var(--border); font-size: 14px; }
        .canvas-table tr:last-child td { border-bottom: none; }
        .score-pill { font-family: 'JetBrains Mono', monospace; font-weight: 700; padding: 6px 12px; border-radius: 8px; font-size: 13px; }
        .mono { font-family: 'JetBrains Mono', monospace; color: var(--text-muted); }

        .spin-icon { display: inline-block; animation: spin 2s cubic-bezier(0.68, -0.55, 0.265, 1.55) infinite; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

        /* Judge Drop-up Section */
        .judge-section { padding-top: 24px; border-top: 1px solid var(--border); margin-top: auto; position: relative; }
        
        .judge-select-btn { width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 12px; color: var(--text-main); font-family: inherit; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        .judge-select-btn:hover { background: var(--input-bg); border-color: var(--pop-primary); transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .chevron-icon { font-size: 10px; color: var(--text-muted); transition: transform 0.3s ease; }
        
        .judge-dropdown-menu { position: absolute; bottom: calc(100% + 12px); left: 0; width: 100%; display: flex; flex-direction: column; gap: 4px; padding: 8px; background: #181818; border: 1px solid #333333; border-radius: 16px; box-shadow: 0 -10px 40px rgba(0,0,0,0.8), inset 0 1px 1px rgba(255,255,255,0.08); z-index: 100; max-height: 280px; overflow-y: auto; transform-origin: bottom center; }
        
        .judge-menu-item { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: transparent; border: none; border-radius: 10px; color: var(--text-muted); font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s ease; text-align: left; width: 100%; }
        .judge-menu-item:hover { background: rgba(255,255,255,0.05); color: var(--text-main); padding-left: 18px; }
        .judge-menu-item.active { background: rgba(255,255,255,0.1); color: var(--text-main); font-weight: 700; }
        .judge-indicator { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; transition: background 0.3s ease; }

        /* Settings Eye Toggle */
        .settings-eye-btn { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); background: transparent; border: none; font-size: 16px; line-height: 1; color: var(--text-muted); transition: opacity 0.2s ease; opacity: 0.6; padding: 4px; }
        .settings-eye-btn:hover { opacity: 1; }

        /* Misc */
        .pb-12 { padding-bottom: 48px; }
        .page-header { margin-bottom: 40px; }
        .align-start { align-items: flex-start; }
      `}</style>
    </>
  );
}