import { useState } from "react";
import ChatPanel from "./components/ChatPanel";
import AnalysisPanel from "./components/AnalysisPanel";
import TerminalPanel from "./components/TerminalPanel";
import FilesPanel from "./components/FilesPanel";
import "./App.css";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

export default function App() {
  const [activeTab, setActiveTab] = useState("chat");
  const [messages, setMessages] = useState([{
    role: "assistant",
    content: "👋 Hey! I'm **RepoAI** — powered by Groq (free).\n\nWhat I can do:\n- `analyze owner/repo` — scan a GitHub repo\n- **Terminal tab** — run CLI commands in your Codespace\n- **Files tab** — read, write, or AI-edit files in your Codespace\n\nHow can I help?",
  }]);
  const [analysisResults, setAnalysisResults] = useState([]);
  const [summary, setSummary] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(null);

  const parseRepo = (text) => {
    const m = text.match(/analyze\s+([\w.\-]+\/[\w.\-]+)/i);
    return m ? m[1] : null;
  };

  const sendChat = async (userText) => {
    const newMessages = [...messages, { role: "user", content: userText }];
    setMessages(newMessages);

    const repo = parseRepo(userText);
    if (repo) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `🔍 Starting analysis of **${repo}**... switching to Results tab.`,
      }]);
      setActiveTab("results");
      runAnalysis(repo);
      return;
    }

    try {
      const resp = await fetch(`${BACKEND_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });
      const data = await resp.json();
      setMessages(prev => [...prev, {
        role: "assistant",
        content: data.reply || `❌ ${data.error}`,
      }]);
    } catch (e) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `❌ Cannot reach backend at \`${BACKEND_URL}\`. Is your Codespace running?`,
      }]);
    }
  };

  const runAnalysis = async (repo, options = {}) => {
    setIsAnalyzing(true);
    setAnalysisResults([]);
    setSummary(null);
    setAnalyzeProgress({ current: 0, total: 0, file: "" });

    try {
      const resp = await fetch(`${BACKEND_URL}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, branch: options.branch || "main", max_files: options.maxFiles || 20, summary: true }),
      });

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            handleSSE(event, repo);
          } catch {}
        }
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: `❌ Analysis failed: ${e.message}` }]);
    } finally {
      setIsAnalyzing(false);
      setAnalyzeProgress(null);
    }
  };

  const handleSSE = (event, repo) => {
    switch (event.type) {
      case "progress":
        setAnalyzeProgress({ current: event.current, total: event.total, file: event.file });
        break;
      case "file_result":
        setAnalysisResults(prev => [...prev, { path: event.file, analysis: event.analysis }]);
        break;
      case "summary":
        setSummary(event.summary);
        setMessages(prev => [...prev, {
          role: "assistant",
          content: `✅ Done analyzing **${repo}**!\n\n${event.summary}`,
        }]);
        setActiveTab("chat");
        break;
      case "done":
        if (!summary) {
          setMessages(prev => [...prev, {
            role: "assistant",
            content: `✅ Analyzed **${event.total_analyzed} files** from **${repo}**. Check Results tab.`,
          }]);
          setActiveTab("chat");
        }
        break;
      case "error":
        setMessages(prev => [...prev, { role: "assistant", content: `⚠️ ${event.message}` }]);
        break;
    }
  };

  const TABS = [
    { id: "chat",    label: "💬 Chat" },
    { id: "results", label: "📂 Results", badge: analysisResults.length || null },
    { id: "terminal",label: "💻 Terminal" },
    { id: "files",   label: "📁 Files" },
  ];

  return (
    <div className="app">
      <header className="header">
        <div className="header-logo">RepoAI</div>
        <div className="header-tag">free · groq · llama3</div>
        {isAnalyzing && <div className="header-analyzing">⚡ Analyzing...</div>}
        <nav className="header-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`tab-btn ${activeTab === t.id ? "active" : ""}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
              {t.badge ? <span className="tab-badge">{t.badge}</span> : null}
            </button>
          ))}
        </nav>
      </header>

      <main className="main">
        {activeTab === "chat"     && <ChatPanel messages={messages} onSend={sendChat} isAnalyzing={isAnalyzing} />}
        {activeTab === "results"  && <AnalysisPanel results={analysisResults} summary={summary} progress={analyzeProgress} isAnalyzing={isAnalyzing} />}
        {activeTab === "terminal" && <TerminalPanel backendUrl={BACKEND_URL} />}
        {activeTab === "files"    && <FilesPanel backendUrl={BACKEND_URL} />}
      </main>
    </div>
  );
}
