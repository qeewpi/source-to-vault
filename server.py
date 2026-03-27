"""
Obsidian Source Note Creator - Local HTTP Server
=================================================
Receives URLs from the Firefox extension, fetches content,
matches/creates topics, and generates source notes in the vault.

Usage:
    python server.py

Requires:
    - GEMINI_API_KEY environment variable
    - pip install requests beautifulsoup4 google-generativeai yt-dlp
"""

import os
import sys
import json
import re
import unicodedata
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse, quote

import requests
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# Load .env file (so you can just run `python server.py` without sourcing)
# ---------------------------------------------------------------------------
_env_path = Path(__file__).parent / ".env"
if _env_path.exists():
    with open(_env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                # Handle both "KEY=VAL" and "export KEY=VAL"
                line = line.removeprefix("export ").strip()
                key, _, val = line.partition("=")
                if key and val:
                    os.environ.setdefault(key.strip(), val.strip())

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Path to your Obsidian vault — adjust if needed
VAULT_PATH = Path(os.environ.get(
    "OBSIDIAN_VAULT_PATH",
    str(Path.home() / "Obsidian" / "Ashley in Wonderland")
))

VAULT_NAME = VAULT_PATH.name  # e.g. "Ashley in Wonderland"
SOURCE_DIR = VAULT_PATH / "002 - Source Material"
TOPICS_DIR = VAULT_PATH / "003 - Topics"
SERVER_PORT = int(os.environ.get("SOURCE_NOTE_PORT", "52525"))

# Gemini
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"


# ---------------------------------------------------------------------------
# URL Content Fetchers
# ---------------------------------------------------------------------------

def detect_media_type(url: str) -> str:
    """Determine the subfolder from the URL. Returns one of:
    Videos, Books, Courses, Other."""
    host = urlparse(url).hostname or ""
    path = urlparse(url).path.lower()

    if any(h in host for h in ["youtube.com", "youtu.be"]):
        return "Videos"
    if any(h in host for h in ["udemy.com", "coursera.org", "mooc", "edx.org"]):
        return "Courses"
    # Everything else (Reddit, articles, blog posts, etc.)
    return "Other"


def fetch_youtube(url: str) -> dict:
    """Fetch YouTube video metadata using yt-dlp (no download)."""
    try:
        import yt_dlp
        opts = {"quiet": True, "skip_download": True, "no_warnings": True}
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            return {
                "title": info.get("title", ""),
                "author": info.get("uploader", info.get("channel", "")),
                "content": info.get("description", ""),
                "url": url,
            }
    except Exception as e:
        print(f"[yt-dlp fallback] {e}")
        return fetch_generic(url)


def fetch_reddit(url: str) -> dict:
    """Fetch a Reddit post via its .json endpoint."""
    try:
        json_url = url.rstrip("/") + ".json"
        headers = {"User-Agent": "ObsidianSourceNoteCreator/1.0"}
        resp = requests.get(json_url, headers=headers, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        post_data = data[0]["data"]["children"][0]["data"]
        title = post_data.get("title", "")
        author = post_data.get("author", "")
        selftext = post_data.get("selftext", "")

        # Grab top-level comments
        comments = []
        if len(data) > 1:
            for child in data[1]["data"]["children"][:5]:
                if child["kind"] == "t1":
                    body = child["data"].get("body", "")
                    if body:
                        comments.append(body)

        content = selftext
        if comments:
            content += "\n\n---\n\n**Top Comments:**\n\n"
            content += "\n\n".join(f"> {c}" for c in comments)

        return {
            "title": title,
            "author": f"u/{author}" if author else "",
            "content": content,
            "url": url,
        }
    except Exception as e:
        print(f"[reddit fallback] {e}")
        return fetch_generic(url)


def fetch_generic(url: str) -> dict:
    """Scrape a generic webpage for its title and main text content."""
    headers = {"User-Agent": "ObsidianSourceNoteCreator/1.0"}
    resp = requests.get(url, headers=headers, timeout=15)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")

    # Title
    title = ""
    if soup.title:
        title = soup.title.get_text(strip=True)
    og_title = soup.find("meta", property="og:title")
    if og_title and og_title.get("content"):
        title = og_title["content"]

    # Author
    author = ""
    author_meta = soup.find("meta", attrs={"name": "author"})
    if author_meta and author_meta.get("content"):
        author = author_meta["content"]

    # Main content — try <article>, fall back to <body>
    article = soup.find("article")
    if not article:
        article = soup.find("main") or soup.body

    # Strip nav, footer, sidebar, script, style
    if article:
        for tag in article.find_all(["nav", "footer", "aside", "script", "style", "header"]):
            tag.decompose()
        text = article.get_text(separator="\n", strip=True)
    else:
        text = soup.get_text(separator="\n", strip=True)

    # Trim to a reasonable length for the LLM
    text = text[:8000]

    return {
        "title": title,
        "author": author,
        "content": text,
        "url": url,
    }


def fetch_url(url: str) -> dict:
    """Route to the appropriate fetcher based on URL."""
    host = urlparse(url).hostname or ""

    if any(h in host for h in ["youtube.com", "youtu.be"]):
        return fetch_youtube(url)
    elif "reddit.com" in host:
        return fetch_reddit(url)
    else:
        return fetch_generic(url)


# ---------------------------------------------------------------------------
# Topic Matching via Gemini
# ---------------------------------------------------------------------------

def get_existing_topics() -> list[str]:
    """Read all topic filenames from 003 - Topics/."""
    if not TOPICS_DIR.exists():
        return []
    return [f.stem for f in TOPICS_DIR.glob("*.md")]


def call_gemini(prompt: str) -> str:
    """Call the Gemini API with a text prompt. Returns the response text."""
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not set.")

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.3},
    }
    resp = requests.post(GEMINI_URL, json=payload, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    return data["candidates"][0]["content"]["parts"][0]["text"].strip()


def match_topics(title: str, content: str) -> list[str]:
    """Use Gemini to match existing topics or suggest new ones."""
    existing = get_existing_topics()
    existing_str = ", ".join(existing) if existing else "(none yet)"

    prompt = f"""You are helping organize an Obsidian knowledge vault.

Given this source material, pick the most relevant topics. Be conservative — only pick topics that are clearly and closely related.

EXISTING TOPICS: {existing_str}

SOURCE TITLE: {title}
SOURCE CONTENT (excerpt): {content[:3000]}

Rules:
- Return at least 1 topic, more only if truly necessary (max 3).
- PREFER existing topics when there's a close match.
- Only suggest a NEW topic if nothing existing fits closely.
- New topic names should be lowercase kebab-case (e.g. "react-hooks", "game-sense").
- Return ONLY a JSON array of topic name strings. No explanation.
- Example: ["spring-boot", "code-optimization"]"""

    raw = call_gemini(prompt)
    # Extract the JSON array from the response
    match = re.search(r"\[.*?\]", raw, re.DOTALL)
    if match:
        topics = json.loads(match.group())
        return [str(t).strip() for t in topics if isinstance(t, str)]
    return []


def ensure_topic_files(topics: list[str]) -> None:
    """Create empty .md files in 003 - Topics/ for any new topics."""
    TOPICS_DIR.mkdir(parents=True, exist_ok=True)
    existing = {f.stem for f in TOPICS_DIR.glob("*.md")}
    for topic in topics:
        if topic not in existing:
            (TOPICS_DIR / f"{topic}.md").touch()
            print(f"[topics] Created new topic: {topic}")


# ---------------------------------------------------------------------------
# Context Generation via Gemini (only semantic task left for the LLM)
# ---------------------------------------------------------------------------

def generate_context(title: str, content: str, url: str) -> str:
    """Use Gemini ONLY to draft a brief context blurb. Everything else is deterministic."""
    prompt = f"""You are a personal knowledge management assistant. Write 1-2 sentences describing what this source covers and why it's useful to save for reference. Write as a helpful assistant, NOT as the user.

Example outputs:
- "This discussion covers why using @Data on JPA entities can break hashCode/equals and cause issues with circular relationships, and what annotations to use instead."
- "A guide on structuring Spring Boot projects by feature rather than by layer, with practical examples of clean architecture."
- "Reddit thread exploring techniques for reducing AI hallucinations, with three specific system prompt instructions from Anthropic's documentation."

SOURCE TITLE: {title}
SOURCE URL: {url}
SOURCE CONTENT (excerpt): {content[:3000]}

Return ONLY the 1-2 sentences. No quotes, no labels, no JSON, no formatting."""

    try:
        raw = call_gemini(prompt)
        # Strip any accidental quotes or labels
        raw = raw.strip().strip('"').strip("'")
        return raw
    except Exception as e:
        print(f"[context] Gemini failed: {e}")
        return ""


# ---------------------------------------------------------------------------
# Note File Creation
# ---------------------------------------------------------------------------

def sanitize_filename(name: str) -> str:
    """Remove or replace characters that aren't safe for filenames."""
    # Normalize unicode
    name = unicodedata.normalize("NFKD", name)
    # Remove characters that are problematic in filenames
    name = re.sub(r'[<>:"/\\|?*]', "", name)
    # Collapse whitespace
    name = re.sub(r"\s+", " ", name).strip()
    return name


def create_source_note(url: str, media_type: str | None = None) -> dict:
    """Full pipeline: fetch → match topics → generate content → write file."""

    # 1. Fetch
    print(f"[fetch] Fetching {url} ...")
    data = fetch_url(url)
    title = data["title"]
    author = data["author"]
    content = data["content"]

    if not title:
        title = "Untitled Source"

    # 2. Detect media type
    if not media_type:
        media_type = detect_media_type(url)

    # 3. Match topics
    print("[topics] Matching topics ...")
    topics = match_topics(title, content)
    ensure_topic_files(topics)

    # 4. Generate context (only Gemini call for content)
    print("[context] Generating context ...")
    context = generate_context(title, content, url)

    # 5. Build the note (deterministic template)
    now = datetime.now().strftime("%Y-%m-%d %I:%M %p")
    topics_yaml = "\n".join(f'  - "[[{t}]]"' for t in topics)

    note = f"""---
time-created: {now}
tags:
  - source
topics:
{topics_yaml}
status: unprocessed
urls:
  - {url}
author: "{author}"
---

# {title}

## ## Context
<small><i>Why did you come across this? What were you looking for?</i></small>

<!-- ai-generated -->
{context}
## Notes
<small><i>Pull quotes, excerpts, key points. <br>
     Jot your thoughts under any quote when they come naturally, <br>
     no need to reflect on every one.</i></small>

>

---

## Topics to Extract
<small><i>Ideas or concepts worth developing into Full Notes</i></small>

- [ ]
"""

    # 6. Write the file
    target_dir = SOURCE_DIR / media_type
    target_dir.mkdir(parents=True, exist_ok=True)

    filename = sanitize_filename(title) + ".md"
    filepath = target_dir / filename

    # Avoid overwriting
    if filepath.exists():
        base = sanitize_filename(title)
        i = 2
        while filepath.exists():
            filename = f"{base} ({i}).md"
            filepath = target_dir / filename
            i += 1

    filepath.write_text(note, encoding="utf-8")
    print(f"[done] Created: {filepath.relative_to(VAULT_PATH)}")

    # Build obsidian:// URI to open the note directly
    relative_path = str(filepath.relative_to(VAULT_PATH)).replace("\\", "/")
    # Remove .md extension — Obsidian doesn't need it
    if relative_path.endswith(".md"):
        relative_path = relative_path[:-3]
    obsidian_uri = f"obsidian://open?vault={quote(VAULT_NAME)}&file={quote(relative_path)}"

    return {
        "success": True,
        "title": title,
        "path": str(filepath.relative_to(VAULT_PATH)),
        "obsidian_uri": obsidian_uri,
        "topics": topics,
        "media_type": media_type,
    }


# ---------------------------------------------------------------------------
# HTTP Server
# ---------------------------------------------------------------------------

class RequestHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self._cors_headers()
        self.end_headers()

    def do_POST(self):
        if self.path == "/create":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length))
                url = body.get("url", "").strip()
                media_type = body.get("media_type")  # optional override

                if not url:
                    self._respond(400, {"error": "Missing 'url' field"})
                    return

                result = create_source_note(url, media_type)
                self._respond(200, result)

            except Exception as e:
                print(f"[error] {e}")
                self._respond(500, {"error": str(e)})
        else:
            self._respond(404, {"error": "Not found"})

    def do_GET(self):
        if self.path == "/health":
            self._respond(200, {"status": "ok"})
        else:
            self._respond(404, {"error": "Not found"})

    def _respond(self, code: int, data: dict):
        self.send_response(code)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, fmt, *args):
        print(f"[server] {fmt % args}")


def main():
    if not GEMINI_API_KEY:
        print("ERROR: Set the GEMINI_API_KEY environment variable.")
        print("  export GEMINI_API_KEY=your-key-here")
        sys.exit(1)

    print(f"Obsidian Source Note Creator")
    print(f"  Vault:  {VAULT_PATH}")
    print(f"  Port:   {SERVER_PORT}")
    print(f"  Gemini: {GEMINI_MODEL}")
    print()

    server = HTTPServer(("127.0.0.1", SERVER_PORT), RequestHandler)
    print(f"Listening on http://127.0.0.1:{SERVER_PORT}")
    print("Press Ctrl+C to stop.\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
