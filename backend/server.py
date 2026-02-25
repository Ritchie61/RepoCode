"""
RepoCode Backend Server — Groq Edition (100% Free)
--------------------------------------------------
Flask API using Groq's free tier (Llama 3) instead of Anthropic.

Setup:
    pip install flask flask-cors groq requests python-dotenv

Run in Codespace:
    python server.py

Environment variables (.env file):
    GROQ_API_KEY=gsk_your-groq-key        ← free at console.groq.com
    GITHUB_TOKEN=ghp_your-github-token    ← free, optional but recommended
    PORT=8000
    WORKSPACE=/workspaces                 ← root folder Codespace can access
"""

import os
import time
import subprocess
import shlex
from pathlib import Path
from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from groq import Groq
import requests
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
PORT         = int(os.getenv("PORT", 8000))
WORKSPACE    = os.getenv("WORKSPACE", "/workspaces")

# Groq free model — fast and capable
GROQ_MODEL = "llama3-70b-8192"

GITHUB_API = "https://api.github.com"

DEFAULT_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx",
    ".java", ".go", ".rb", ".cpp", ".c",
    ".cs", ".php", ".rs", ".swift", ".kt",
    ".yaml", ".yml", ".json", ".toml", ".md"
}

DEFAULT_EXCLUDE_DIRS = {
    "node_modules", ".git", "__pycache__",
    "dist", "build", ".next", "venv", ".venv",
    "vendor", "target", "out", "coverage"
}

BLOCKED_COMMANDS = [
    "rm -rf /", "rm -rf ~", "mkfs", ":(){:|:&};:"
]


# ─────────────────────────────────────────────
# Groq helpers
# ─────────────────────────────────────────────

def groq_chat(messages, system=None, max_tokens=1024):
    client = Groq(api_key=GROQ_API_KEY)
    all_messages = []
    if system:
        all_messages.append({"role": "system", "content": system})
    all_messages.extend(messages)
    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=all_messages,
        max_tokens=max_tokens,
    )
    return response.choices[0].message.content


def groq_to_cli(user_prompt, cwd):
    system = f"""You are a Linux shell expert inside a GitHub Codespace.
Current directory: {cwd}
The user will describe what they want in plain English.
Reply with ONLY the raw shell command — no explanation, no markdown, no backticks.
If the request is dangerous or unclear, reply with: ERROR: <reason>"""
    return groq_chat([{"role": "user", "content": user_prompt}], system=system, max_tokens=256)


def groq_write_file(instruction, existing_content=None, file_path=None):
    context = ""
    if existing_content:
        context = f"\nExisting content:\n```\n{existing_content[:8000]}\n```\n"
    system = """You are an expert software engineer.
Reply with ONLY the raw file content — no explanation, no markdown fences, no commentary.
Output exactly what should be written to disk."""
    prompt = f"File: {file_path}\n{context}\nInstruction: {instruction}"
    return groq_chat([{"role": "user", "content": prompt}], system=system, max_tokens=4096)


def groq_analyze_file(repo, file_path, content):
    system = """You are RepoAI, an expert code reviewer. Be concise. Use these sections:
**Purpose** — what this file does
**Key components** — important functions/classes
**Code quality** — issues or strengths
**Suggestions** — specific improvements"""
    truncated = content[:12000]
    prompt = f"Repo: `{repo}`\nFile: `{file_path}`\n\n```\n{truncated}\n```"
    return groq_chat([{"role": "user", "content": prompt}], system=system, max_tokens=1024)


def groq_summary(repo, analyses):
    combined = "\n\n".join(f"### {a['path']}\n{a['analysis']}" for a in analyses)
    system = "You are RepoAI. Summarize a codebase analysis clearly and concisely."
    prompt = f"""Analyzed {len(analyses)} files from `{repo}`.

{combined[:30000]}

Provide:
1. **Overall architecture** — what does this project do?
2. **Tech stack** — languages, frameworks, tools
3. **Strengths** — what the codebase does well
4. **Key issues** — most important problems
5. **Top 5 recommendations** — prioritized action items"""
    return groq_chat([{"role": "user", "content": prompt}], system=system, max_tokens=2048)


# ─────────────────────────────────────────────
# GitHub helpers
# ─────────────────────────────────────────────

def gh_headers():
    h = {"Accept": "application/vnd.github+json"}
    if GITHUB_TOKEN:
        h["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return h


def get_repo_tree(owner, repo, branch="main"):
    resp = requests.get(
        f"{GITHUB_API}/repos/{owner}/{repo}/branches/{branch}",
        headers=gh_headers(), timeout=10
    )
    resp.raise_for_status()
    sha = resp.json()["commit"]["commit"]["tree"]["sha"]
    resp = requests.get(
        f"{GITHUB_API}/repos/{owner}/{repo}/git/trees/{sha}?recursive=1",
        headers=gh_headers(), timeout=10
    )
    resp.raise_for_status()
    return [i for i in resp.json().get("tree", []) if i["type"] == "blob"]


def fetch_raw_file(owner, repo, path, branch="main"):
    url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"
    try:
        resp = requests.get(url, headers=gh_headers(), timeout=15)
        resp.raise_for_status()
        return resp.text
    except Exception:
        return None


def filter_files(tree, extensions=None, exclude_dirs=None, max_files=None):
    extensions   = extensions   or DEFAULT_EXTENSIONS
    exclude_dirs = exclude_dirs or DEFAULT_EXCLUDE_DIRS
    filtered = []
    for item in tree:
        path  = item["path"]
        parts = Path(path).parts
        if any(p in exclude_dirs for p in parts[:-1]):
            continue
        if Path(path).suffix.lower() in extensions:
            filtered.append(path)
    if max_files:
        filtered = filtered[:max_files]
    return filtered


# ─────────────────────────────────────────────
# Shell helpers
# ─────────────────────────────────────────────

def is_safe(cmd):
    low = cmd.lower().strip()
    for blocked in BLOCKED_COMMANDS:
        if blocked in low:
            return False, f"Blocked: `{blocked}`"
    return True, None


def run_shell(cmd, cwd=None):
    safe, reason = is_safe(cmd)
    if not safe:
        return "", reason, 1
    cwd = cwd or WORKSPACE
    try:
        result = subprocess.run(
            cmd, shell=True, cwd=cwd,
            capture_output=True, text=True, timeout=30
        )
        return result.stdout, result.stderr, result.returncode
    except subprocess.TimeoutExpired:
        return "", "Timed out after 30s", 1
    except Exception as e:
        return "", str(e), 1


# ─────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "groq":   "✅ Set" if GROQ_API_KEY else "❌ Missing",
        "github": "✅ Set" if GITHUB_TOKEN else "⚠️ Not set",
        "workspace": WORKSPACE,
        "model": GROQ_MODEL,
    })


@app.route("/chat", methods=["POST"])
def chat():
    data     = request.json
    messages = data.get("messages", [])
    if not messages:
        return jsonify({"error": "No messages provided"}), 400
    if not GROQ_API_KEY:
        return jsonify({"error": "GROQ_API_KEY not set"}), 500
    try:
        system = """You are RepoAI, a helpful assistant for GitHub repos and software development.
Help developers understand codebases, write code, run commands, and manage files.
Be concise and technical. When a user wants to analyze a repo type: analyze owner/repo"""
        reply = groq_chat(messages, system=system)
        return jsonify({"reply": reply})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/analyze", methods=["POST"])
def analyze():
    data         = request.json
    repo         = data.get("repo", "").strip()
    branch       = data.get("branch", "main")
    max_files    = data.get("max_files", 20)
    extensions   = set(data.get("extensions", [])) or DEFAULT_EXTENSIONS
    want_summary = data.get("summary", True)

    if not repo or "/" not in repo:
        return jsonify({"error": "Use owner/repo format"}), 400
    if not GROQ_API_KEY:
        return jsonify({"error": "GROQ_API_KEY not set"}), 500

    owner, repo_name = repo.split("/", 1)

    def generate():
        import json

        def send(t, p):
            return f"data: {json.dumps({'type': t, **p})}\n\n"

        try:
            yield send("status", {"message": f"🔍 Scanning {repo} ({branch})..."})
            try:
                tree = get_repo_tree(owner, repo_name, branch)
            except requests.HTTPError as e:
                yield send("error", {"message": f"GitHub error: {e}"}); return

            files = filter_files(tree, extensions, DEFAULT_EXCLUDE_DIRS, max_files)
            yield send("status", {"message": f"📁 {len(files)} files to analyze"})
            if not files:
                yield send("error", {"message": "No matching files found."}); return

            analyses = []
            for i, fp in enumerate(files, 1):
                yield send("progress", {"current": i, "total": len(files), "file": fp})
                content = fetch_raw_file(owner, repo_name, fp, branch)
                if not content:
                    yield send("file_skip", {"file": fp, "reason": "Could not fetch"}); continue
                if len(content) > 100_000:
                    yield send("file_skip", {"file": fp, "reason": "Too large"}); continue
                try:
                    analysis = groq_analyze_file(repo, fp, content)
                    analyses.append({"path": fp, "analysis": analysis})
                    yield send("file_result", {"file": fp, "analysis": analysis})
                except Exception as e:
                    yield send("file_skip", {"file": fp, "reason": str(e)})
                time.sleep(0.3)

            if want_summary and analyses:
                yield send("status", {"message": "📊 Generating summary..."})
                try:
                    summary = groq_summary(repo, analyses)
                    yield send("summary", {"summary": summary})
                except Exception as e:
                    yield send("error", {"message": f"Summary error: {e}"})

            yield send("done", {"total_analyzed": len(analyses)})
        except Exception as e:
            yield send("error", {"message": str(e)})

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


# ── Terminal ──────────────────────────────────

@app.route("/terminal/run", methods=["POST"])
def terminal_run():
    """Run a raw shell command in the Codespace."""
    data    = request.json
    command = data.get("command", "").strip()
    cwd     = data.get("cwd", WORKSPACE)
    if not command:
        return jsonify({"error": "No command provided"}), 400
    stdout, stderr, code = run_shell(command, cwd)
    return jsonify({"stdout": stdout, "stderr": stderr, "returncode": code, "command": command, "cwd": cwd})


@app.route("/terminal/ai", methods=["POST"])
def terminal_ai():
    """Convert plain English to a shell command via Groq, optionally run it."""
    data    = request.json
    prompt  = data.get("prompt", "").strip()
    cwd     = data.get("cwd", WORKSPACE)
    dry_run = data.get("dry_run", True)   # default: preview first, don't auto-run
    if not prompt:
        return jsonify({"error": "No prompt provided"}), 400
    if not GROQ_API_KEY:
        return jsonify({"error": "GROQ_API_KEY not set"}), 500
    try:
        command = groq_to_cli(prompt, cwd)
        if command.startswith("ERROR:"):
            return jsonify({"error": command}), 400
        if dry_run:
            return jsonify({"command": command, "dry_run": True, "cwd": cwd})
        stdout, stderr, code = run_shell(command, cwd)
        return jsonify({"command": command, "stdout": stdout, "stderr": stderr, "returncode": code, "cwd": cwd})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── File System ───────────────────────────────

@app.route("/fs/tree", methods=["POST"])
def fs_tree():
    """Return directory tree of a Codespace path."""
    data  = request.json
    path  = data.get("path", WORKSPACE)
    depth = int(data.get("depth", 2))
    stdout, stderr, code = run_shell(f"find {shlex.quote(path)} -maxdepth {depth} | sort", path)
    if code != 0:
        return jsonify({"error": stderr}), 400
    lines = [l for l in stdout.splitlines() if l.strip()]
    return jsonify({"tree": lines, "path": path})


@app.route("/file/read", methods=["POST"])
def file_read():
    """Read a file from the Codespace."""
    path = request.json.get("path", "").strip()
    if not path:
        return jsonify({"error": "No path provided"}), 400
    try:
        content = Path(path).read_text(encoding="utf-8", errors="replace")
        return jsonify({"content": content, "path": path, "size": len(content)})
    except FileNotFoundError:
        return jsonify({"error": f"Not found: {path}"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/file/write", methods=["POST"])
def file_write():
    """Write content to a file (creates directories as needed)."""
    data    = request.json
    path    = data.get("path", "").strip()
    content = data.get("content", "")
    if not path:
        return jsonify({"error": "No path provided"}), 400
    try:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        return jsonify({"success": True, "path": path, "size": len(content)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/file/delete", methods=["POST"])
def file_delete():
    """Delete a file — only allowed inside /workspaces for safety."""
    path = request.json.get("path", "").strip()
    if not path:
        return jsonify({"error": "No path provided"}), 400
    if not path.startswith("/workspaces"):
        return jsonify({"error": "Can only delete files inside /workspaces"}), 403
    try:
        Path(path).unlink()
        return jsonify({"success": True, "path": path})
    except FileNotFoundError:
        return jsonify({"error": "File not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/file/ai-write", methods=["POST"])
def file_ai_write():
    """Ask Groq to write or edit a file from a plain English instruction."""
    data        = request.json
    path        = data.get("path", "").strip()
    instruction = data.get("instruction", "").strip()
    apply       = data.get("apply", False)  # False = preview only, True = save immediately

    if not path or not instruction:
        return jsonify({"error": "Both path and instruction required"}), 400
    if not GROQ_API_KEY:
        return jsonify({"error": "GROQ_API_KEY not set"}), 500

    existing = None
    try:
        existing = Path(path).read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        pass

    try:
        new_content = groq_write_file(instruction, existing, path)
        if apply:
            p = Path(path)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(new_content, encoding="utf-8")
            return jsonify({"success": True, "path": path, "content": new_content, "applied": True})
        return jsonify({"success": True, "path": path, "content": new_content, "applied": False, "original": existing})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/repo/info", methods=["POST"])
def repo_info():
    repo = request.json.get("repo", "").strip()
    if not repo or "/" not in repo:
        return jsonify({"error": "Invalid repo format"}), 400
    owner, repo_name = repo.split("/", 1)
    try:
        resp = requests.get(f"{GITHUB_API}/repos/{owner}/{repo_name}", headers=gh_headers(), timeout=10)
        resp.raise_for_status()
        d = resp.json()
        return jsonify({
            "name": d.get("full_name"), "description": d.get("description"),
            "language": d.get("language"), "stars": d.get("stargazers_count"),
            "forks": d.get("forks_count"), "default_branch": d.get("default_branch"),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    print(f"🚀 RepoAI (Groq) starting on port {PORT}")
    print(f"   Groq key:  {'✅ Set' if GROQ_API_KEY else '❌ Missing — get free key at console.groq.com'}")
    print(f"   GitHub:    {'✅ Set' if GITHUB_TOKEN else '⚠️  Not set'}")
    print(f"   Workspace: {WORKSPACE}")
    app.run(host="0.0.0.0", port=PORT, debug=False)
