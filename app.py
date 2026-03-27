"""
Obsidian Source Note Creator - Remote API
==========================================
Deployable to Render/Railway. Handles URL fetching, Gemini calls,
and topic matching. Returns note content for the extension to create
via Obsidian URI.

Requires env var: GEMINI_API_KEY
"""

import os
import json
import re
import unicodedata
from datetime import datetime, timezone
from urllib.parse import urlparse, quote

from flask import Flask, request, jsonify
from flask_cors import CORS
import requests as http_requests
from bs4 import BeautifulSoup

app = Flask(__name__)
CORS(app)

# ---------------------------------------------------------------------------
# Gemini Config
# ---------------------------------------------------------------------------
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-2.5-flash"


def gemini_url():
    return f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"


# ---------------------------------------------------------------------------
# URL Content Fetchers
# ---------------------------------------------------------------------------

def detect_media_type(url: str) -> str:
    host = urlparse(url).hostname or ""
    if any(h in host for h in ["youtube.com", "youtu.be"]):
        return "Videos"
    if any(h in host for h in ["udemy.com", "coursera.org", "mooc", "edx.org"]):
        return "Courses"
    return "Other"


def fetch_youtube(url: str) -> dict:
    try:
        import yt_dlp
        opts = {"quiet": True, "skip_download": True, "no_warnings": True}
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            return {
                "title": info.get("title", ""),
                "author": info.get("uploader", info.get("channel", "")),
                "content": info.get("description", ""),
            }
    except Exception:
        return fetch_generic(url)


def fetch_reddit(url: str) -> dict:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        # Try JSON API first
        json_url = url.rstrip("/") + ".json"
        resp = http_requests.get(json_url, headers=headers, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        post_data = data[0]["data"]["children"][0]["data"]
        title = post_data.get("title", "")
        author = post_data.get("author", "")
        selftext = post_data.get("selftext", "")

        comments = []
        if len(data) > 1:
            for child in data[1]["data"]["children"][:5]:
                if child["kind"] == "t1":
                    body = child["data"].get("body", "")
                    if body:
                        comments.append(body)

        content = selftext
        if comments:
            content += "\n\n---\n\nTop Comments:\n\n"
            content += "\n\n".join(comments)

        return {
            "title": title,
            "author": f"u/{author}" if author else "",
            "content": content,
        }
    except Exception:
        # Fallback: scrape old.reddit.com HTML
        try:
            old_url = url.replace("www.reddit.com", "old.reddit.com").replace("reddit.com", "old.reddit.com")
            resp = http_requests.get(old_url, headers=headers, timeout=15)
            resp.raise_for_status()
            return _parse_html(resp.text, url)
        except Exception:
            return fetch_generic(url)


def _parse_html(html: str, url: str) -> dict:
    """Parse Reddit HTML as a last resort."""
    soup = BeautifulSoup(html, "html.parser")

    title = ""
    if soup.title:
        title = soup.title.get_text(strip=True)
    og_title = soup.find("meta", property="og:title")
    if og_title and og_title.get("content"):
        title = og_title["content"]

    author = ""
    author_tag = soup.find("meta", attrs={"name": "author"})
    if author_tag and author_tag.get("content"):
        author = author_tag["content"]

    # Try to get main content
    article = soup.find("div", class_="expando") or soup.find("article") or soup.find("main") or soup.body
    if article:
        for tag in article.find_all(["nav", "footer", "aside", "script", "style", "header"]):
            tag.decompose()
        text = article.get_text(separator="\n", strip=True)
    else:
        text = soup.get_text(separator="\n", strip=True)

    return {"title": title, "author": author, "content": text[:8000]}



def fetch_generic(url: str) -> dict:
    headers = {"User-Agent": "ObsidianSourceNoteCreator/1.0"}
    resp = http_requests.get(url, headers=headers, timeout=15)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")

    title = ""
    if soup.title:
        title = soup.title.get_text(strip=True)
    og_title = soup.find("meta", property="og:title")
    if og_title and og_title.get("content"):
        title = og_title["content"]

    author = ""
    author_meta = soup.find("meta", attrs={"name": "author"})
    if author_meta and author_meta.get("content"):
        author = author_meta["content"]

    article = soup.find("article") or soup.find("main") or soup.body
    if article:
        for tag in article.find_all(["nav", "footer", "aside", "script", "style", "header"]):
            tag.decompose()
        text = article.get_text(separator="\n", strip=True)
    else:
        text = soup.get_text(separator="\n", strip=True)

    return {"title": title, "author": author, "content": text[:8000]}


def fetch_url(url: str) -> dict:
    host = urlparse(url).hostname or ""
    if any(h in host for h in ["youtube.com", "youtu.be"]):
        return fetch_youtube(url)
    elif "reddit.com" in host:
        return fetch_reddit(url)
    else:
        return fetch_generic(url)


# ---------------------------------------------------------------------------
# Gemini Calls
# ---------------------------------------------------------------------------

def call_gemini(prompt: str) -> str:
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not set.")
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.3},
    }
    resp = http_requests.post(gemini_url(), json=payload, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    return data["candidates"][0]["content"]["parts"][0]["text"].strip()


def match_topics(title: str, content: str, existing_topics: list[str]) -> list[str]:
    if not existing_topics:
        return []

    existing_str = ", ".join(existing_topics)

    prompt = f"""You are helping organize an Obsidian knowledge vault.

Given this source material, pick the most relevant topics from the EXISTING TOPICS list below. Be conservative — only pick topics that are clearly and closely related.

EXISTING TOPICS: {existing_str}

SOURCE TITLE: {title}
SOURCE CONTENT (excerpt): {content[:3000]}

Rules:
- ONLY pick from the EXISTING TOPICS list above. Do NOT suggest any new topics.
- Pick 1-3 topics that are clearly relevant. If none fit, return an empty array.
- Return ONLY a JSON array of topic name strings. No explanation.
- Example: ["spring-boot", "code-optimization"]"""

    raw = call_gemini(prompt)
    match = re.search(r"\[.*?\]", raw, re.DOTALL)
    if match:
        topics = json.loads(match.group())
        return [str(t).strip() for t in topics if isinstance(t, str)]
    return []


def generate_context(title: str, content: str, url: str) -> str:
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
        return raw.strip().strip('"').strip("'")
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# Note Builder (deterministic template)
# ---------------------------------------------------------------------------

def sanitize_filename(name: str) -> str:
    name = unicodedata.normalize("NFKD", name)
    name = re.sub(r'[<>:"/\\|?*]', "", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name


def build_note(title: str, author: str, url: str, topics: list[str], context: str) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %I:%M %p")
    topics_yaml = "\n".join(f'  - "[[{t}]]"' for t in topics)

    return f"""---
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


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/create", methods=["POST"])
def create():
    try:
        body = request.get_json()
        url = body.get("url", "").strip()
        page_title = body.get("title", "")
        page_text = body.get("text", "")
        media_type = body.get("media_type") or None
        existing_topics = body.get("existing_topics", [])
        vault_name = body.get("vault_name", "Ashley in Wonderland")

        if not url:
            return jsonify({"error": "Missing 'url' field"}), 400

        # 1. Fetch data
        domain = urlparse(url).hostname or ""
        is_youtube = any(h in domain for h in ["youtube.com", "youtu.be"])

        data = {}
        if is_youtube:
            # YouTube is best handled by server-side yt-dlp
            data = fetch_youtube(url)
        elif page_text:
            # For Reddit, Medium, etc: use the exact text the user sees in their browser!
            # Bypasses all cloud IP blocks, paywalls, and captchas.
            data = {
                "title": page_title,
                "author": "",
                "content": page_text[:8000]
            }
        else:
            # Fallback to server-side fetching if extension didn't send text
            data = fetch_url(url)

        title = data.get("title") or "Untitled Source"
        author = data.get("author", "")
        content = data.get("content", "")

        # 2. Detect media type
        if not media_type:
            media_type = detect_media_type(url)

        # 3. Match topics
        topics = match_topics(title, content, existing_topics)
        new_topics = [t for t in topics if t not in existing_topics]

        # 4. Generate context
        context = generate_context(title, content, url)

        # 5. Build note content
        note_content = build_note(title, author, url, topics, context)

        # 6. Build file path + obsidian URI
        filename = sanitize_filename(title)
        file_path = f"002 - Source Material/{media_type}/{filename}"
        obsidian_uri = f"obsidian://new?vault={quote(vault_name)}&file={quote(file_path)}&content={quote(note_content)}"

        return jsonify({
            "success": True,
            "title": title,
            "author": author,
            "media_type": media_type,
            "topics": topics,
            "new_topics": new_topics,
            "note_content": note_content,
            "file_path": file_path,
            "obsidian_uri": obsidian_uri,
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)
