import { useState } from "react";

export default function FilesPanel({ backendUrl }) {
  const [view, setView]           = useState("browser"); // "browser" | "editor" | "ai-write"
  const [treePath, setTreePath]   = useState("/workspaces");
  const [treeLines, setTreeLines] = useState([]);
  const [treeLoading, setTreeLoading] = useState(false);

  const [editorPath, setEditorPath]       = useState("");
  const [editorContent, setEditorContent] = useState("");
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorMsg, setEditorMsg]         = useState(null);

  const [aiPath, setAiPath]               = useState("");
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiPreview, setAiPreview]         = useState(null);
  const [aiOriginal, setAiOriginal]       = useState(null);
  const [aiLoading, setAiLoading]         = useState(false);
  const [aiMsg, setAiMsg]                 = useState(null);

  // ── Tree browser ──────────────────────────

  const loadTree = async () => {
    setTreeLoading(true);
    setTreeLines([]);
    try {
      const resp = await fetch(`${backendUrl}/fs/tree`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: treePath, depth: 3 }),
      });
      const data = await resp.json();
      if (data.error) { setTreeLines([`❌ ${data.error}`]); return; }
      setTreeLines(data.tree);
    } catch (e) {
      setTreeLines([`❌ Network error: ${e.message}`]);
    } finally {
      setTreeLoading(false);
    }
  };

  const handleTreeClick = (line) => {
    // If it looks like a file (has extension), open in editor
    if (/\.\w+$/.test(line)) {
      setEditorPath(line);
      setView("editor");
      loadFile(line);
    } else {
      setTreePath(line);
    }
  };

  // ── File editor ───────────────────────────

  const loadFile = async (path) => {
    setEditorLoading(true);
    setEditorMsg(null);
    try {
      const resp = await fetch(`${backendUrl}/file/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = await resp.json();
      if (data.error) { setEditorMsg({ type: "err", text: data.error }); return; }
      setEditorContent(data.content);
    } catch (e) {
      setEditorMsg({ type: "err", text: e.message });
    } finally {
      setEditorLoading(false);
    }
  };

  const saveFile = async () => {
    setEditorLoading(true);
    setEditorMsg(null);
    try {
      const resp = await fetch(`${backendUrl}/file/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: editorPath, content: editorContent }),
      });
      const data = await resp.json();
      if (data.error) { setEditorMsg({ type: "err", text: data.error }); return; }
      setEditorMsg({ type: "ok", text: `✅ Saved to ${editorPath}` });
    } catch (e) {
      setEditorMsg({ type: "err", text: e.message });
    } finally {
      setEditorLoading(false);
    }
  };

  const deleteFile = async () => {
    if (!confirm(`Delete ${editorPath}?`)) return;
    setEditorLoading(true);
    try {
      const resp = await fetch(`${backendUrl}/file/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: editorPath }),
      });
      const data = await resp.json();
      if (data.error) { setEditorMsg({ type: "err", text: data.error }); return; }
      setEditorMsg({ type: "ok", text: `🗑️ Deleted ${editorPath}` });
      setEditorContent("");
      setEditorPath("");
    } catch (e) {
      setEditorMsg({ type: "err", text: e.message });
    } finally {
      setEditorLoading(false);
    }
  };

  // ── AI writer ─────────────────────────────

  const generateAI = async () => {
    if (!aiPath || !aiInstruction) return;
    setAiLoading(true);
    setAiPreview(null);
    setAiOriginal(null);
    setAiMsg(null);
    try {
      const resp = await fetch(`${backendUrl}/file/ai-write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: aiPath, instruction: aiInstruction, apply: false }),
      });
      const data = await resp.json();
      if (data.error) { setAiMsg({ type: "err", text: data.error }); return; }
      setAiPreview(data.content);
      setAiOriginal(data.original);
    } catch (e) {
      setAiMsg({ type: "err", text: e.message });
    } finally {
      setAiLoading(false);
    }
  };

  const applyAI = async () => {
    setAiLoading(true);
    try {
      const resp = await fetch(`${backendUrl}/file/ai-write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: aiPath, instruction: aiInstruction, apply: true }),
      });
      const data = await resp.json();
      if (data.error) { setAiMsg({ type: "err", text: data.error }); return; }
      setAiMsg({ type: "ok", text: `✅ File saved to ${aiPath}` });
      setAiPreview(null);
    } catch (e) {
      setAiMsg({ type: "err", text: e.message });
    } finally {
      setAiLoading(false);
    }
  };

  // ── Render ────────────────────────────────

  return (
    <div className="files-panel">
      <div className="files-tabs">
        <button className={`ftab ${view === "browser"  ? "active" : ""}`} onClick={() => setView("browser")}>🗂️ Browse</button>
        <button className={`ftab ${view === "editor"   ? "active" : ""}`} onClick={() => setView("editor")}>✏️ Edit File</button>
        <button className={`ftab ${view === "ai-write" ? "active" : ""}`} onClick={() => setView("ai-write")}>🤖 AI Write</button>
      </div>

      {/* ── Browser ── */}
      {view === "browser" && (
        <div className="files-section">
          <div className="files-row">
            <input className="files-input" value={treePath} onChange={e => setTreePath(e.target.value)} placeholder="/workspaces/myrepo" />
            <button className="files-btn" onClick={loadTree} disabled={treeLoading}>
              {treeLoading ? "..." : "Browse"}
            </button>
          </div>
          <div className="tree-output">
            {treeLines.length === 0 && <div className="files-hint">Enter a path and click Browse to see your Codespace files.</div>}
            {treeLines.map((line, i) => {
              const isFile = /\.\w+$/.test(line);
              const depth  = (line.match(/\//g) || []).length;
              return (
                <div
                  key={i}
                  className={`tree-line ${isFile ? "tree-file" : "tree-dir"}`}
                  style={{ paddingLeft: `${depth * 10}px` }}
                  onClick={() => isFile && handleTreeClick(line)}
                >
                  {isFile ? "📄" : "📁"} {line.split("/").pop()}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Editor ── */}
      {view === "editor" && (
        <div className="files-section">
          <div className="files-row">
            <input
              className="files-input"
              value={editorPath}
              onChange={e => setEditorPath(e.target.value)}
              placeholder="/workspaces/myrepo/server.py"
            />
            <button className="files-btn" onClick={() => loadFile(editorPath)} disabled={editorLoading}>Load</button>
          </div>
          {editorMsg && <div className={`files-msg ${editorMsg.type}`}>{editorMsg.text}</div>}
          <textarea
            className="files-editor"
            value={editorContent}
            onChange={e => setEditorContent(e.target.value)}
            placeholder="File content will appear here..."
            spellCheck={false}
          />
          <div className="files-actions">
            <button className="files-btn accent" onClick={saveFile} disabled={editorLoading || !editorPath}>
              💾 Save to Codespace
            </button>
            <button className="files-btn danger" onClick={deleteFile} disabled={editorLoading || !editorPath}>
              🗑️ Delete
            </button>
            <button className="files-btn" onClick={() => { setAiPath(editorPath); setView("ai-write"); }}>
              🤖 AI Edit this file
            </button>
          </div>
        </div>
      )}

      {/* ── AI Write ── */}
      {view === "ai-write" && (
        <div className="files-section">
          <div className="files-field">
            <label className="files-label">File path (will be created if it doesn't exist)</label>
            <input
              className="files-input"
              value={aiPath}
              onChange={e => setAiPath(e.target.value)}
              placeholder="/workspaces/myrepo/utils.py"
            />
          </div>
          <div className="files-field">
            <label className="files-label">What should the AI do?</label>
            <textarea
              className="files-textarea"
              value={aiInstruction}
              onChange={e => setAiInstruction(e.target.value)}
              placeholder="e.g. 'Add a function that validates email addresses' or 'Create a Flask route for user login'"
              rows={3}
            />
          </div>
          <button className="files-btn accent" onClick={generateAI} disabled={aiLoading || !aiPath || !aiInstruction}>
            {aiLoading ? "⏳ Generating..." : "🤖 Generate Preview"}
          </button>

          {aiMsg && <div className={`files-msg ${aiMsg.type}`}>{aiMsg.text}</div>}

          {aiPreview && (
            <div className="ai-preview">
              <div className="ai-preview-header">
                <span>📄 Preview — {aiPath}</span>
                <div className="ai-preview-actions">
                  <button className="files-btn accent" onClick={applyAI} disabled={aiLoading}>
                    ✅ Apply & Save
                  </button>
                  <button className="files-btn" onClick={() => setAiPreview(null)}>
                    ❌ Discard
                  </button>
                </div>
              </div>
              <pre className="ai-preview-code">{aiPreview}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
