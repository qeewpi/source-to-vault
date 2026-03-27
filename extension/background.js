// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getConfig() {
  const data = await browser.storage.local.get(["apiUrl", "vaultName", "topics"]);
  return {
    apiUrl: (data.apiUrl || "").replace(/\/+$/, ""),
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

function createTopicFiles(vaultName, newTopics) {
  // Fire obsidian://new for each new topic to create empty files in 003 - Topics/
  for (const topic of newTopics) {
    const uri =
      `obsidian://new?vault=${encodeURIComponent(vaultName)}` +
      `&file=${encodeURIComponent("003 - Topics/" + topic)}` +
      `&content=${encodeURIComponent("")}` +
      `&silent=true`;
    browser.tabs.create({ url: uri, active: false }).then((tab) => {
      // Close the tab after a delay — gives time for the protocol handler prompt
      setTimeout(() => browser.tabs.remove(tab.id).catch(() => {}), 8000);
    });
  }
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
// Core: call remote API, create note + topic files via Obsidian URI
// ---------------------------------------------------------------------------

async function saveSourceNote(tabId, pageUrl) {
  const config = await getConfig();

  if (!config.apiUrl) {
    showToast(tabId, "Set your API URL in extension settings first.", null);
    return { success: false, error: "No API URL configured" };
  }

  showToast(tabId, "Saving source note...", null);

  let pageTitle = "";
  let pageText = "";
  try {
    const results = await browser.tabs.executeScript(tabId, {
      code: `({ title: document.title, text: document.body.innerText })`
    });
    if (results && results[0]) {
      pageTitle = results[0].title;
      pageText = results[0].text;
    }
  } catch (e) {
    console.warn("Could not extract page text", e);
  }

  try {
    const resp = await fetch(`${config.apiUrl}/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: pageUrl,
        title: pageTitle,
        text: pageText,
        vault_name: config.vaultName,
        existing_topics: config.topics,
      }),
    });

    const data = await resp.json();

    if (data.success) {
      // Update topic cache with matched topics
      if (data.topics && data.topics.length > 0) {
        await updateTopicCache(data.topics);
      }

      // Create the actual note via Obsidian URI
      const noteUri =
        `obsidian://new?vault=${encodeURIComponent(config.vaultName)}` +
        `&file=${encodeURIComponent(data.file_path)}` +
        `&content=${encodeURIComponent(data.note_content)}`;

      // Open URI to create the note
      browser.tabs.create({ url: noteUri, active: false }).then((tab) => {
        setTimeout(() => browser.tabs.remove(tab.id).catch(() => {}), 8000);
      });

      // Build an open URI (without content) for the toast link
      const openUri =
        `obsidian://open?vault=${encodeURIComponent(config.vaultName)}` +
        `&file=${encodeURIComponent(data.file_path)}`;

      showToast(tabId, `Saved: ${data.title}`, openUri);
      return data;
    } else {
      throw new Error(data.error || "Unknown error");
    }
  } catch (err) {
    let message = err.message;
    if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
      message = "Cannot reach API. Check your API URL in settings.";
    }
    showToast(tabId, `Error: ${message}`, null);
    return { success: false, error: message };
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
