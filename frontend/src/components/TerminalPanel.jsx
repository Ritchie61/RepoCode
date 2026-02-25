import { useState, useRef, useEffect } from "react";

const QUICK_CMDS = [
  "ls -la", "pwd", "git status", "git log --oneline -10",
  "cat package.json", "pip list", "python --version", "node --version",
];

export default function TerminalPanel({ backendUrl }) {
  const [history, setHistory]     = useState([{ type: "info", text: "RepoAI Terminal — connected to your Codespace\nType a command or describe what you want in plain English.\n" }]);
  const [input, setInput]         = useState("");
  const [cwd, setCwd]             = useState("/workspaces");
  const [mode, setMode]           = useState("ai");   // "ai" | "raw"
  const [pending, setPending]     = useState(null);   // AI-suggested command waiting for approval
  const [loading, setLoading]     = useState(false);
  const bottomRef                 = useRef(null);
  const inputRef                  = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history]);

  const addLine = (type, text) => setHistory(h => [...h, { type, text }]);

  const runCommand = async (cmd) => {
    addLine("cmd", `$ ${cmd}`);
    setLoading(true);
    try {
      const resp = await fetch(`${backendUrl}/terminal/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd, cwd }),
      });
      const data = await resp.json();
      if (data.error) { addLine("err", data.error); return; }
      if (data.stdout) addLine("out", data.stdout.trimEnd());
      if (data.stderr) addLine("err", data.stderr.trimEnd());

      // Update cwd if user ran cd
      if (cmd.startsWith("cd ")) {
        const newDir = cmd.slice(3).trim();
        const resolveResp = await fetch(`${backendUrl}/terminal/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: "pwd", cwd: newDir.startsWith("/") ? newDir : `${cwd}/${newDir}` }),
        });
        const resolveData = await resolveResp.json();
        if (resolveData.stdout) setCwd(resolveData.stdout.trim());
      }
    } catch (e) {
      addLine("err", `Network error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const askAI = async (prompt) => {
    addLine("ai-prompt", `🤖 ${prompt}`);
    setLoading(true);
    try {
      const resp = await fetch(`${backendUrl}/terminal/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, cwd, dry_run: true }),
      });
      const data = await resp.json();
      if (data.error) { addLine("err", data.error); return; }
      setPending(data.command);
      addLine("ai-suggest", `Suggested: ${data.command}`);
    } catch (e) {
      addLine("err", `Network error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const approvePending = async () => {
    const cmd = pending;
    setPending(null);
    await runCommand(cmd);
  };

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setPending(null);
    if (mode === "raw") {
      runCommand(text);
    } else {
      // AI mode: detect if it looks like a raw command already
      const looksRaw = /^(ls|cd|git|cat|pwd|mkdir|pip|npm|python|node|echo|grep|find|rm|cp|mv)\b/.test(text);
      if (looksRaw) runCommand(text);
      else askAI(text);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter") { e.preventDefault(); handleSubmit(); }
  };

  return (
    <div className="terminal-panel">
      <div className="terminal-toolbar">
        <span className="terminal-cwd">📂 {cwd}</span>
        <div className="mode-toggle">
          <button className={`mode-btn ${mode === "ai" ? "active" : ""}`} onClick={() => setMode("ai")}>🤖 AI</button>
          <button className={`mode-btn ${mode === "raw" ? "active" : ""}`} onClick={() => setMode("raw")}>⌨️ Raw</button>
        </div>
      </div>

      <div className="terminal-output" onClick={() => inputRef.current?.focus()}>
        {history.map((line, i) => (
          <div key={i} className={`terminal-line tl-${line.type}`}>
            {line.text}
          </div>
        ))}
        {loading && <div className="terminal-line tl-info">⏳ Running...</div>}
        {pending && (
          <div className="terminal-approve">
            <span>Run this command?</span>
            <button className="approve-btn yes" onClick={approvePending}>✅ Run</button>
            <button className="approve-btn no" onClick={() => setPending(null)}>❌ Cancel</button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="terminal-quick">
        {QUICK_CMDS.map(q => (
          <button key={q} className="quick-cmd-btn" onClick={() => { setMode("raw"); setInput(q); inputRef.current?.focus(); }}>
            {q}
          </button>
        ))}
      </div>

      <div className="terminal-input-row">
        <span className="terminal-prompt">
          {mode === "ai" ? "🤖" : "$"}
        </span>
        <input
          ref={inputRef}
          className="terminal-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={mode === "ai" ? "Describe what you want..." : "Enter shell command..."}
          disabled={loading}
          autoComplete="off"
          spellCheck={false}
        />
        <button className="terminal-run-btn" onClick={handleSubmit} disabled={loading || !input.trim()}>
          Run
        </button>
      </div>
    </div>
  );
}
