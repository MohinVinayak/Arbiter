import { useState, useEffect, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const DYNAMIC_COLORS = [
  { color: "#FF5A26", bg: "rgba(255, 90, 38, 0.1)" }, 
  { color: "#10A37F", bg: "rgba(16, 163, 127, 0.1)" }, 
  { color: "#4A6BFF", bg: "rgba(74, 107, 255, 0.1)" }, 
  { color: "#F5A623", bg: "rgba(245, 166, 35, 0.1)" }, 
  { color: "#9B51E0", bg: "rgba(155, 81, 224, 0.1)" }, 
  { color: "#E91E63", bg: "rgba(233, 30, 99, 0.1)" },  
];

function formatModelLabel(rawId) {
  const parts = rawId.split('/');
  let name = parts[parts.length - 1].replace(/-/g, ' ');
  name = name.replace('8b instant', '8B').replace('70b versatile', '70B').replace('exp free', '');
  return name.replace(/\b\w/g, l => l.toUpperCase()).trim();
}

const MOCK_REASONINGS = [
  "Excellent adherence to the prompt. The model captured the requested tone perfectly and provided a highly accurate, structured response.",
  "The response was generally correct but struggled with conciseness. It included unnecessary conversational filler.",
  "Strong performance on the core task. Reasoning was sound, but the formatting was slightly off compared to the reference.",
  "Failed to adopt the required persona. Delivery was too academic for a customer support context.",
  "Outstanding latency and good accuracy. It concisely addressed the prompt's constraints.",
  "The model hallucinated a minor detail in the third paragraph, though the overall structure remained intact."
];

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [isDark, setIsDark] = useState(() => JSON.parse(localStorage.getItem('themeDark')) || false);
  
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem('themeDark', JSON.stringify(isDark));
  }, [isDark]);
  
  const [models, setModels] = useState({});
  const [selectedModels, setSelectedModels] = useState([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);

  useEffect(() => {
    async function fetchBackendModels() {
      try {
        const backendModelList = [
          "groq/llama-3.1-8b-instant", "groq/llama-3.3-70b-versatile",
          "github/gpt-4o-mini", "mistralai/mistral-7b",
          "google/gemini-2.5-flash", "anthropic/claude-3-haiku"
        ];
        const generatedModels = {};
        backendModelList.forEach((id, index) => {
          const theme = DYNAMIC_COLORS[index % DYNAMIC_COLORS.length];
          generatedModels[id] = { color: theme.color, bg: theme.bg, label: formatModelLabel(id) };
        });
        setModels(generatedModels);
        if (backendModelList.length >= 2) setSelectedModels([backendModelList[0], backendModelList[2]]);
      } catch (error) {
        console.error("Failed to load models:", error);
      } finally { setIsLoadingModels(false); }
    }
    fetchBackendModels();
  }, []);

  const [suites, setSuites] = useState(() => {
    const saved = localStorage.getItem('evalSuites');
    return saved ? JSON.parse(saved) : [
      { id: 1, name: "Customer Support Eval", description: "Testing sentiment analysis and tone mapping against angry users.", test_case_count: 24 },
      { id: 2, name: "Code Generation Checks", description: "Verifying React and Python boilerplate generation accuracy.", test_case_count: 8 }
    ];
  });

  const [runHistory, setRunHistory] = useState(() => {
    const saved = localStorage.getItem('evalHistory');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => { localStorage.setItem('evalSuites', JSON.stringify(suites)); }, [suites]);
  useEffect(() => { localStorage.setItem('evalHistory', JSON.stringify(runHistory)); }, [runHistory]);

  const [newSuiteName, setNewSuiteName] = useState("");
  const [newSuiteDesc, setNewSuiteDesc] = useState("");
  const [testCases, setTestCases] = useState([{ prompt_template: "", expected_output: "" }]);
  
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evalResults, setEvalResults] = useState(runHistory.length > 0 ? runHistory[0] : null);

  // ── High-Performance Single Cursor & Background ──
  const cursorRef = useRef(null);
  const bgGlowRef = useRef(null);
  
  const mousePos = useRef({ x: -1000, y: -1000 });
  const bgPos = useRef({ x: -1000, y: -1000 });

  useEffect(() => {
    let rafId;
    
    const renderFrame = () => {
      // GPU-accelerated transforms
      if (cursorRef.current) {
        cursorRef.current.style.transform = `translate3d(${mousePos.current.x}px, ${mousePos.current.y}px, 0) translate(-50%, -50%)`;
      }
      
      // Smooth lerp for background glow
      bgPos.current.x += (mousePos.current.x - bgPos.current.x) * 0.12;
      bgPos.current.y += (mousePos.current.y - bgPos.current.y) * 0.12;
      
      if (bgGlowRef.current) {
        bgGlowRef.current.style.transform = `translate3d(${bgPos.current.x}px, ${bgPos.current.y}px, 0) translate(-50%, -50%)`;
      }
      
      rafId = requestAnimationFrame(renderFrame);
    };
    rafId = requestAnimationFrame(renderFrame);

    const handleMouseMove = (e) => { 
      mousePos.current.x = e.clientX; 
      mousePos.current.y = e.clientY; 
    };
    
    const handleMouseOver = (e) => {
      if (e.target.closest('.run-eval-btn')) {
        document.body.classList.add('hovering-run-eval');
        document.body.classList.remove('hovering-interactive');
      } else if (e.target.closest('button, input, textarea, select, .floating-card, .drag-handle, .model-card')) {
        document.body.classList.add('hovering-interactive');
        document.body.classList.remove('hovering-run-eval');
      } else {
        document.body.classList.remove('hovering-interactive');
        document.body.classList.remove('hovering-run-eval');
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

  const handleRunEval = (suite) => {
    if (selectedModels.length === 0) return alert("Please select at least one model.");
    setPage("results");
    setIsEvaluating(true);

    setTimeout(() => {
      setIsEvaluating(false);
      const generatedResults = selectedModels.map((modelKey, index) => {
        const score = Math.floor(Math.random() * 40) + 60;
        const modelName = models[modelKey]?.label || modelKey;
        return {
          name: modelName,
          color: models[modelKey]?.color || "#a1a1aa",
          score: score,
          latency: Math.floor(Math.random() * 800) + 200,
          reasoning: MOCK_REASONINGS[index % MOCK_REASONINGS.length]
        };
      });
      
      const newResult = { 
        id: Date.now(), 
        suiteName: suite.name, 
        timestamp: new Date().toLocaleString(),
        metrics: generatedResults 
      };
      
      setEvalResults(newResult);
      setRunHistory([newResult, ...runHistory]);
    }, 2500);
  };

  const handleDeploySuite = () => {
    const validCases = testCases.filter(tc => tc.prompt_template.trim() !== "");
    const actualCount = validCases.length > 0 ? validCases.length : 1;

    setSuites([{
      id: Date.now(),
      name: newSuiteName || "Untitled Suite",
      description: newSuiteDesc || "No description provided.",
      test_case_count: actualCount
    }, ...suites]);
    
    setPage("dashboard");
    setNewSuiteName("");
    setNewSuiteDesc("");
    setTestCases([{ prompt_template: "", expected_output: "" }]);
  };

  return (
    <>
      <div className="ambient-background">
        <div ref={bgGlowRef} className="cursor-ambient-glow"><div className="glow-orb"></div></div>
        <div className="dot-grid-overlay"></div>
      </div>

      <div className="app-layout">
        <div ref={cursorRef} className="custom-shadow-cursor"></div>

        <button className="theme-toggle-text" onClick={() => setIsDark(!isDark)} aria-label="Toggle Theme">
          <span className={!isDark ? 'active-theme' : 'inactive-theme'}>LIGHT</span>
          <span className="separator">/</span>
          <span className={isDark ? 'active-theme' : 'inactive-theme'}>DARK</span>
        </button>

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
        </nav>

        <main className="main-canvas">
          <div key={page} className="page-animate-reveal">
            
            {/* DASHBOARD */}
            {page === "dashboard" && (
              <div className="w-full max-w-1000 mx-auto">
                <header className="page-header">
                  <h1 className="hero-title">
                    <div className="mask-text"><span className="slide-up-1">EVALUATION</span></div>
                    <div className="mask-text"><span className="slide-up-2">WORKSPACE</span></div>
                  </h1>
                  <p className="hero-subtitle fade-in-delayed">Manage and execute your evaluation suites.</p>
                </header>

                <div className="bento-grid">
                  {suites.map((suite, idx) => (
                    <div key={suite.id} className="floating-card bento-card stagger-anim" style={{ '--delay': `${idx * 0.1}s` }}>
                      <div className="card-top"><span className="bento-badge">Suite 0{suites.length - idx}</span></div>
                      <h3 className="card-title">{suite.name}</h3>
                      <p className="card-desc">{suite.description}</p>
                      <div className="card-footer">
                        <div className="stat">
                          <span className="stat-val">{suite.test_case_count}</span>
                          <span className="stat-label">Cases</span>
                        </div>
                        <button className="btn-3d small run-eval-btn" onClick={() => handleRunEval(suite)}>Run Eval</button>
                      </div>
                    </div>
                  ))}
                  
                  <div className="floating-card bento-card empty-add-card stagger-anim" onClick={() => setPage("new-suite")} style={{ '--delay': `${suites.length * 0.1}s` }}>
                    <div className="add-icon">+</div>
                    <h3 className="card-title" style={{marginBottom: 0}}>Build New Suite</h3>
                  </div>
                </div>
              </div>
            )}

            {/* NEW SUITE */}
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

                <div style={{ textAlign: "right", marginTop: "32px", paddingBottom: "64px" }} className="fade-in-delayed">
                  <button className="btn-3d large scale-click run-eval-btn" onClick={handleDeploySuite}>Deploy Test Suite</button>
                </div>
              </div>
            )}

            {/* RESULTS PAGE */}
            {page === "results" && (
              <div className="w-full max-w-800 mx-auto">
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
                      <span className="section-title" style={{ display: 'block', marginBottom: 8 }}>Past Runs</span>
                      <select 
                        className="inset-input mono" 
                        style={{ padding: '8px 16px', fontSize: 12, width: 200, cursor: 'none' }}
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
                    <p style={{ color: 'var(--text-muted)', marginTop: '16px' }}>Pinging {selectedModels.length} models across the suite.</p>
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
                  <div className="stagger-anim" style={{ '--delay': '0.1s', paddingBottom: "64px" }}>
                    <div className="bento-badge" style={{ marginBottom: '16px' }}>Target: {evalResults.suiteName}</div>
                    
                    <div className="bento-grid" style={{ marginBottom: '24px' }}>
                      <div className="floating-card bento-card" style={{ gridColumn: '1 / -1' }}>
                        <h3 className="section-title">Aggregate Scores</h3>
                        <ResponsiveContainer width="100%" height={260}>
                          <BarChart data={evalResults.metrics} margin={{ top: 20, right: 0, left: -20, bottom: 0 }}>
                            <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }} axisLine={false} tickLine={false} />
                            <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                            <Tooltip cursor={{ fill: 'var(--tooltip-bg)' }} contentStyle={{ borderRadius: '12px', border: '1px solid var(--border)', background: 'var(--bg-surface)', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }} />
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
                          </div>
                        ))}
                      </div>
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
          --bg-canvas: #f8f9fa; --bg-surface: #ffffff; --border: #e9ecef; --panel-bg: rgba(255, 255, 255, 0.65);
          --pop-primary: #5B4EE4; --pop-primary-dark: #3A30A1;
          --text-main: #121212; --text-muted: #6c757d;
          --shadow-float: 0 20px 40px -12px rgba(0, 0, 0, 0.05); 
          --shadow-hover: 0 30px 60px -15px rgba(91, 78, 228, 0.12); 
          --inner-glow: inset 0 1px 1px rgba(255,255,255,0.8);
          --input-bg: #f8f9fa; --tooltip-bg: rgba(0,0,0,0.03);
          --bg-glow-color: rgba(91, 78, 228, 0.15);
        }

        [data-theme="dark"] {
          --bg-canvas: #0c0c0e; --bg-surface: #141417; --border: rgba(255,255,255,0.08); --panel-bg: rgba(20, 20, 22, 0.65);
          --pop-primary: #818cf8; --pop-primary-dark: #4f46e5;
          --text-main: #f8f9fa; --text-muted: #a1a1aa;
          --shadow-float: 0 20px 40px -12px rgba(0, 0, 0, 0.5); 
          --shadow-hover: 0 30px 60px -15px rgba(129, 140, 248, 0.2); 
          --inner-glow: inset 0 1px 1px rgba(255,255,255,0.05);
          --input-bg: #000000; --tooltip-bg: rgba(255,255,255,0.05);
          --bg-glow-color: rgba(129, 140, 248, 0.15);
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

        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 10px; }

        .app-layout { display: flex; min-height: 100vh; padding: 24px; gap: 40px; max-width: 1600px; margin: 0 auto; position: relative; }

        .theme-toggle-text {
          position: fixed; top: 24px; right: 24px; z-index: 100;
          background: var(--panel-bg); backdrop-filter: blur(20px); border: 1px solid var(--border); border-radius: 30px;
          display: flex; gap: 12px; align-items: center; justify-content: center;
          padding: 10px 20px; font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: 0.1em;
          color: var(--text-muted); box-shadow: var(--shadow-float), var(--inner-glow); transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        .theme-toggle-text:hover { border-color: var(--text-main); transform: translateY(-3px); }
        .theme-toggle-text span { transition: color 0.3s ease, opacity 0.3s ease; }
        .theme-toggle-text .active-theme { color: var(--text-main); opacity: 1; }
        .theme-toggle-text .inactive-theme { color: var(--text-muted); opacity: 0.4; }
        .theme-toggle-text .separator { opacity: 0.2; }

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

        .sidebar { width: 300px; min-width: 300px; height: calc(100vh - 48px); position: sticky; top: 24px; display: flex; flex-direction: column; padding: 32px 24px; z-index: 10; }
        .floating-panel { background: var(--panel-bg); backdrop-filter: blur(24px); border: 1px solid var(--border); border-radius: 28px; box-shadow: var(--shadow-float), var(--inner-glow); }

        .main-canvas { flex: 1; padding-top: 24px; display: flex; justify-content: center; }
        .flex-between { display: flex; justify-content: space-between; align-items: center; }
        .mb-4 { margin-bottom: 16px; } .mb-6 { margin-bottom: 32px; }

        .floating-card { background: var(--panel-bg); backdrop-filter: blur(16px); border-radius: 24px; border: 1px solid var(--border); box-shadow: var(--shadow-float), var(--inner-glow); transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.4s ease, border-color 0.4s ease; }
        .floating-card:hover { transform: translateY(-6px); box-shadow: var(--shadow-hover), var(--inner-glow); border-color: var(--pop-primary); }

        .stagger-anim { opacity: 0; transform: translateY(20px); animation: springUp 0.7s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; animation-delay: var(--delay); }
        @keyframes springUp { to { opacity: 1; transform: translateY(0); } }

        .fade-in-delayed { opacity: 0; animation: fadeIn 0.6s ease forwards; animation-delay: 0.3s; }
        .fade-in-up { opacity: 0; animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }

        .bento-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px; }
        .bento-card { padding: 32px; display: flex; flex-direction: column; }
        .bento-badge { background: var(--bg-canvas); color: var(--pop-primary); font-size: 12px; font-weight: 800; padding: 6px 12px; border-radius: 8px; margin-bottom: 24px; display: inline-block; border: 1px solid var(--border); }
        
        .card-desc { color: var(--text-muted); font-size: 15px; line-height: 1.5; margin-bottom: 32px; flex-grow: 1; }
        .card-footer { display: flex; justify-content: space-between; align-items: center; border-top: 1px dashed var(--border); padding-top: 24px; }
        .stat { display: flex; align-items: baseline; gap: 6px; }
        .stat-val { font-size: 24px; font-weight: 800; font-family: 'JetBrains Mono', monospace; }
        .stat-label { font-size: 13px; color: var(--text-muted); font-weight: 600; }

        /* ── CREATIVE "BUILD SUITE" HOVER ── */
        .empty-add-card { 
          position: relative; overflow: hidden; background: transparent; border: 2px dashed var(--border); box-shadow: none;
          align-items: center; justify-content: center; text-align: center; color: var(--text-muted);
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
        .btn-3d { background: var(--pop-primary); color: #fff; font-family: inherit; font-weight: 800; border: none; border-radius: 12px; box-shadow: 0 4px 0 var(--pop-primary-dark), 0 8px 16px rgba(0,0,0,0.1); transform: translateY(-2px); transition: transform 0.1s ease, box-shadow 0.1s ease; }
        .btn-3d:active { transform: translateY(2px); box-shadow: 0 0 0 var(--pop-primary-dark), 0 0 0 transparent; }
        .btn-3d.small { padding: 10px 20px; font-size: 13px; }
        .btn-3d.large { padding: 16px 36px; font-size: 15px; border-radius: 16px; box-shadow: 0 6px 0 var(--pop-primary-dark); transform: translateY(-4px); }
        .btn-3d.large:active { transform: translateY(2px); box-shadow: 0 0 0 transparent; }

        .btn-secondary { background: var(--bg-surface); color: var(--text-main); border: 1px solid var(--border); padding: 8px 16px; border-radius: 10px; font-family: inherit; font-weight: 700; font-size: 13px; box-shadow: 0 2px 0 var(--border); transition: all 0.1s ease; }
        .btn-secondary:active { transform: translateY(2px); box-shadow: 0 0 0 transparent; }
        .btn-text-danger { background: transparent; border: none; color: #ff3b30; font-family: inherit; font-size: 12px; font-weight: 700; margin-top: 8px; opacity: 0.8; transition: opacity 0.2s ease; }
        .btn-text-danger:hover { opacity: 1; text-decoration: underline; }

        /* Navigation Links */
        .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 48px; }
        .brand-logo { width: 36px; height: 36px; background: var(--pop-primary); border-radius: 12px; display: grid; place-items: center; color: #fff; font-size: 18px; font-weight: bold; }
        .brand-text { font-size: 24px; font-weight: 800; letter-spacing: -0.04em; }
        .nav-links { display: flex; flex-direction: column; gap: 8px; margin-bottom: auto; }
        .nav-btn { background: transparent; border: none; color: var(--text-muted); font-family: inherit; font-weight: 700; font-size: 15px; padding: 14px 16px; border-radius: 12px; display: flex; align-items: center; gap: 16px; transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        .nav-btn:hover { background: var(--border); color: var(--text-main); transform: translateX(6px); }
        .nav-btn.active { background: var(--bg-surface); color: var(--pop-primary); transform: translateX(6px); box-shadow: var(--shadow-float); border: 1px solid var(--border); }

        /* Models Stack */
        .models-section { padding-top: 32px; border-top: 1px dashed var(--border); }
        .models-stack { display: flex; flex-direction: column; gap: 8px; }
        .model-card { position: relative; display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 12px; font-family: inherit; font-size: 13px; font-weight: 700; transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        .model-card .model-label { color: var(--text-muted); transition: color 0.3s ease; }
        .model-card:hover { background: var(--mbg); border-color: var(--mc); transform: translateY(-3px) scale(1.02); box-shadow: 0 8px 20px rgba(0,0,0,0.05); }
        .model-card:hover .model-label { color: var(--mc); }
        .model-card:hover .model-indicator { background: var(--mc) !important; }
        .model-card.active { background: var(--mbg); border-color: var(--mc); box-shadow: 0 4px 12px rgba(0,0,0,0.05); z-index: 1; }
        .model-card.active .model-label { color: var(--mc); }
        .model-indicator { width: 10px; height: 10px; border-radius: 50%; transition: 0.3s; background: var(--border); }
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
      `}</style>
    </>
  );
}