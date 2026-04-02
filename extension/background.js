// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GEMINI_MODEL = "gemini-2.5-flash";

async function getConfig() {
  const data = await browser.storage.local.get(["geminiApiKey", "vaultName", "topics"]);
  return {
    geminiApiKey: data.geminiApiKey || "",
    vaultName: data.vaultName || "",
    topics: data.topics || [],
  };
}

async function updateTopicCache(newTopics) {
  if (!newTopics || newTopics.length === 0) return;
  const data = await browser.storage.local.get(["topics"]);
  const current = new Set(data.topics || []);
  newTopics.forEach((t) => current.add(t));
  await browser.storage.local.set({ topics: Array.from(current) });
}

// ---------------------------------------------------------------------------
// Page Content Extraction
// ---------------------------------------------------------------------------

async function extractPageContent(tabId) {
  try {
    const results = await browser.tabs.executeScript(tabId, {
      code: `({
        title: document.title,
        text: document.body.innerText.substring(0, 8000),
        author: (document.querySelector('meta[name="author"]') || {}).content || ""
      })`
    });
    if (results && results[0]) {
      return results[0];
    }
  } catch (e) {
    console.warn("Could not extract page content", e);
  }
  return { title: "", text: "", author: "" };
}

// ---------------------------------------------------------------------------
// Media Type Detection
// ---------------------------------------------------------------------------

function detectMediaType(url) {
  const host = new URL(url).hostname || "";
  if (["youtube.com", "youtu.be"].some((h) => host.includes(h))) return "Videos";
  if (["udemy.com", "coursera.org", "mooc", "edx.org"].some((h) => host.includes(h))) return "Courses";
  return "Other";
}

// ---------------------------------------------------------------------------
// Gemini API
// ---------------------------------------------------------------------------

async function callGemini(prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 },
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini API error (${resp.status}): ${err}`);
  }

  const data = await resp.json();
  return data.candidates[0].content.parts[0].text.trim();
}

async function matchTopics(title, content, existingTopics, apiKey) {
  if (!existingTopics || existingTopics.length === 0) return [];

  const existingStr = existingTopics.join(", ");
  const prompt = `You are helping organize an Obsidian knowledge vault.

Given this source material, pick the most relevant topics from the EXISTING TOPICS list below. Be conservative — only pick topics that are clearly and closely related.

EXISTING TOPICS: ${existingStr}

SOURCE TITLE: ${title}
SOURCE CONTENT (excerpt): ${content.substring(0, 3000)}

Rules:
- ONLY pick from the EXISTING TOPICS list above. Do NOT suggest any new topics.
- Pick 1-3 topics that are clearly relevant. If none fit, return an empty array.
- Return ONLY a JSON array of topic name strings. No explanation.
- Example: ["spring-boot", "code-optimization"]`;

  try {
    const raw = await callGemini(prompt, apiKey);
    const match = raw.match(/\[.*?\]/s);
    if (match) {
      const topics = JSON.parse(match[0]);
      return topics.filter((t) => typeof t === "string").map((t) => t.trim());
    }
  } catch (e) {
    console.warn("Topic matching failed", e);
  }
  return [];
}

async function generateContext(title, content, url, apiKey) {
  const prompt = `You are a personal knowledge management assistant. Write 1-2 sentences describing what this source covers and why it's useful to save for reference. Write as a helpful assistant, NOT as the user.

Example outputs:
- "This discussion covers why using @Data on JPA entities can break hashCode/equals and cause issues with circular relationships, and what annotations to use instead."
- "A guide on structuring Spring Boot projects by feature rather than by layer, with practical examples of clean architecture."
- "Reddit thread exploring techniques for reducing AI hallucinations, with three specific system prompt instructions from Anthropic's documentation."

SOURCE TITLE: ${title}
SOURCE URL: ${url}
SOURCE CONTENT (excerpt): ${content.substring(0, 3000)}

Return ONLY the 1-2 sentences. No quotes, no labels, no JSON, no formatting.`;

  try {
    const raw = await callGemini(prompt, apiKey);
    return raw.replace(/^["']|["']$/g, "");
  } catch (e) {
    console.warn("Context generation failed", e);
    return "";
  }
}

// ---------------------------------------------------------------------------
// Note Builder
// ---------------------------------------------------------------------------

function sanitizeFilename(name) {
  return name
    .normalize("NFKD")
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildNote(title, author, url, topics, context) {
  const now = new Date();
  const hours = now.getUTCHours();
  const ampm = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  const dateStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")} ${h12}:${mm} ${ampm}`;

  const topicsYaml = topics.map((t) => `  - "[[${t}]]"`).join("\n");

  return `---
time-created: ${dateStr}
tags:
  - source
topics:
${topicsYaml}
status: unprocessed
urls:
  - ${url}
author: "${author}"
---

# ${title}

## Context
<small><i>Why did you come across this? What were you looking for?</i></small>

<!-- ai-generated -->
${context}
## Notes
<small><i>Pull quotes, excerpts, key points. <br>
     Jot your thoughts under any quote when they come naturally, <br>
     no need to reflect on every one.</i></small>

>

---

## Topics to Extract
<small><i>Ideas or concepts worth developing into Full Notes</i></small>

- [ ]
`;
}

// ---------------------------------------------------------------------------
// Toast injection (shown on the active page)
// ---------------------------------------------------------------------------

function showToast(tabId, message, obsidianUri) {
  const code = `
    (function() {
      const old = document.getElementById('obsidian-source-toast');
      if (old) old.remove();

      const toast = document.createElement('div');
      toast.id = 'obsidian-source-toast';
      toast.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;background:#1a1a2e;color:#fff;padding:14px 36px 14px 20px;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;box-shadow:0 8px 32px rgba(0,0,0,0.3);display:flex;flex-direction:column;gap:8px;max-width:360px;animation:slideIn 0.3s ease-out;border-left:4px solid #7c3aed;';

      const style = document.createElement('style');
      style.textContent = '@keyframes slideIn{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes slideOut{from{transform:translateX(0);opacity:1}to{transform:translateX(120%);opacity:0}}';
      document.head.appendChild(style);

      const msg = document.createElement('div');
      msg.textContent = '${message.replace(/'/g, "\\'")}';
      toast.appendChild(msg);

      ${obsidianUri ? `
      const link = document.createElement('a');
      link.href = '${obsidianUri}';
      link.textContent = 'Open in Obsidian';
      link.style.cssText = 'color:#c4b5fd;text-decoration:underline;cursor:pointer;font-size:13px;';
      toast.appendChild(link);
      ` : ''}

      const close = document.createElement('div');
      close.textContent = '\\u00d7';
      close.style.cssText = 'position:absolute;top:8px;right:12px;cursor:pointer;font-size:18px;color:#888;';
      close.onclick = () => { toast.style.animation='slideOut 0.3s ease-in forwards'; setTimeout(()=>toast.remove(),300); };
      toast.appendChild(close);

      document.body.appendChild(toast);
      setTimeout(() => {
        if (document.getElementById('obsidian-source-toast')) {
          toast.style.animation = 'slideOut 0.3s ease-in forwards';
          setTimeout(() => toast.remove(), 300);
        }
      }, 8000);
    })();
  `;
  browser.tabs.executeScript(tabId, { code });
}

// ---------------------------------------------------------------------------
// Core: extract content, call Gemini, build note, open in Obsidian
// ---------------------------------------------------------------------------

async function saveSourceNote(tabId, pageUrl) {
  const config = await getConfig();

  if (!config.geminiApiKey) {
    showToast(tabId, "Set your Gemini API Key in extension settings first.", null);
    return { success: false, error: "No Gemini API Key configured" };
  }

  if (!config.vaultName) {
    showToast(tabId, "Set your Vault Name in extension settings first.", null);
    return { success: false, error: "No Vault Name configured" };
  }

  showToast(tabId, "Saving source note...", null);

  try {
    // 1. Extract page content from the active tab
    const page = await extractPageContent(tabId);
    const title = page.title || "Untitled Source";
    const author = page.author || "";
    const content = page.text || "";

    // 2. Detect media type
    const mediaType = detectMediaType(pageUrl);

    // 3. Call Gemini for topic matching and context (in parallel)
    const [topics, context] = await Promise.all([
      matchTopics(title, content, config.topics, config.geminiApiKey),
      generateContext(title, content, pageUrl, config.geminiApiKey),
    ]);

    // 4. Update topic cache
    if (topics.length > 0) {
      await updateTopicCache(topics);
    }

    // 5. Build note
    const noteContent = buildNote(title, author, pageUrl, topics, context);

    // 6. Build file path + Obsidian URI
    const filename = sanitizeFilename(title);
    const filePath = `002 - Source Material/${mediaType}/${filename}`;

    const noteUri =
      `obsidian://new?vault=${encodeURIComponent(config.vaultName)}` +
      `&file=${encodeURIComponent(filePath)}` +
      `&content=${encodeURIComponent(noteContent)}`;

    // Open URI to create the note
    // First time: open in foreground so the user sees the protocol handler prompt
    const { obsidianApproved } = await browser.storage.local.get("obsidianApproved");
    const isFirstUse = !obsidianApproved;

    const tab = await browser.tabs.create({ url: noteUri, active: isFirstUse });
    if (isFirstUse) {
      await browser.storage.local.set({ obsidianApproved: true });
    }
    setTimeout(() => browser.tabs.remove(tab.id).catch(() => {}), 8000);

    // Build an open URI for the toast link
    const openUri =
      `obsidian://open?vault=${encodeURIComponent(config.vaultName)}` +
      `&file=${encodeURIComponent(filePath)}`;

    showToast(tabId, `Saved: ${title}`, openUri);

    return {
      success: true,
      title,
      author,
      media_type: mediaType,
      topics,
      note_content: noteContent,
      file_path: filePath,
      vault_name: config.vaultName,
    };
  } catch (err) {
    showToast(tabId, `Error: ${err.message}`, null);
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Context menu (right-click)
// ---------------------------------------------------------------------------

browser.contextMenus.create({
  id: "save-source-note",
  title: "Save as Source Note",
  contexts: ["page"],
  icons: { "48": "icon-48.png" },
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "save-source-note") {
    await saveSourceNote(tab.id, tab.url);
  }
});

// Expose saveSourceNote for the popup to use
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "saveSourceNote") {
    saveSourceNote(msg.tabId, msg.url).then(sendResponse);
    return true; // async response
  }
});
