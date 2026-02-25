# RepoCode
AI assisted coding app
# RepoCode 🔬 — 100% Free Edition

Your personal AI-powered GitHub developer tool. Analyze repos, run terminal commands, and write files — all from your phone. Uses **Groq's free tier** (Llama 3) instead of paid APIs.

## What's free
| Service | Free tier |
|---------|-----------|
| Groq AI | ✅ Free tier, very fast |
| GitHub API | ✅ Free, 5,000 req/hr with token |
| GitHub Codespaces | ✅ 60 hrs/month on free plan |
| Vercel hosting | ✅ Free tier |

---

## 4 Tabs in the App

**💬 Chat** — Talk to the AI, type `analyze owner/repo` to trigger analysis

**📂 Results** — Live progress + expandable file-by-file analysis + overall summary

**💻 Terminal** — Run shell commands in your Codespace, two modes:
- 🤖 AI mode: type plain English → AI converts to command → you approve → runs
- ⌨️ Raw mode: type shell commands directly

**📁 Files** — Three sub-tabs:
- 🗂️ Browse: explore your Codespace directory tree, click files to open them
- ✏️ Edit File: read, edit, save, or delete files directly
- 🤖 AI Write: describe what you want → AI writes the code → preview → approve → saved

---

## Architecture

```
Your Phone
    ↓
React App (Vercel — free)
    ↓
Flask Backend (GitHub Codespace — free 60hrs/mo)
    ├── Groq API (free) ← AI for chat, analysis, CLI, file writing
    └── GitHub API (free) ← repo scanning
```

---

## Setup

### Step 1 — Get your free Groq API key
1. Go to **console.groq.com** and sign up (free, no credit card)
2. Go to API Keys → Create API Key → copy it (looks like `gsk_...`)

### Step 2 — Backend in Codespace

```bash
mkdir repoai-backend && cd repoai-backend
# paste server.py and requirements.txt here
pip install -r requirements.txt
cp .env.example .env   # then fill in your keys
python server.py
```

In the Ports tab → right-click port 8000 → **Port Visibility → Public** → copy the URL.

### Step 3 — Frontend on Vercel

Push the `frontend/` folder to a GitHub repo, import to Vercel, then add:
- **VITE_BACKEND_URL** = your Codespace URL from Step 2

Open your Vercel URL on your phone 📱

Full detailed instructions are in the README inside each folder.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Cannot reach backend" | Wake Codespace, check port 8000 is Public |
| "GROQ_API_KEY not set" | Check your `.env` file |
| GitHub 404 | Check repo is `owner/repo` format |
| File save fails | Path must start with `/workspaces` |

