let currentUrl = "";
let currentTabId = null;

// Tab Switching Logic
document.querySelectorAll('.tab-btn').forEach(button => {
  button.addEventListener('click', () => {
    // Remove active class from all tabs and contents
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    // Add active class to clicked tab and its content
    button.classList.add('active');
    const tabId = button.getAttribute('data-tab');
    document.getElementById(tabId).classList.add('active');
  });
});

// Load settings into the settings tab
browser.storage.local.get(["geminiApiKey", "vaultName", "topicsFolderPath", "topics"]).then((data) => {
  document.getElementById("gemini-api-key").value = data.geminiApiKey || "";
  document.getElementById("vault-name").value = data.vaultName || "";
  document.getElementById("topics-folder").value = data.topicsFolderPath || "";
  document.getElementById("topics").value = (data.topics || []).join(", ");
});

// Get the active tab's URL on popup open for the Save Note tab
browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
  if (tabs[0]) {
    currentUrl = tabs[0].url;
    currentTabId = tabs[0].id;
    document.getElementById("url-display").textContent = currentUrl;

    const host = new URL(currentUrl).hostname;
    const select = document.getElementById("media-type");
    if (host.includes("youtube.com") || host.includes("youtu.be")) {
      select.value = "Videos";
    } else if (host.includes("udemy.com") || host.includes("coursera.org")) {
      select.value = "Courses";
    }
  }
});

// Save Note Logic
document.getElementById("save-note-btn").addEventListener("click", async () => {
  const btn = document.getElementById("save-note-btn");
  const status = document.getElementById("save-status");

  btn.disabled = true;
  btn.textContent = "Saving...";
  status.className = "status loading";
  status.textContent = "Creating source note...";

  // Delegate to background script which handles the full flow
  const result = await browser.runtime.sendMessage({
    action: "saveSourceNote",
    url: currentUrl,
    tabId: currentTabId,
  });

  if (result && result.success) {
    const openUri =
      `obsidian://open?vault=${encodeURIComponent(result.vault_name || "Ashley in Wonderland")}` +
      `&file=${encodeURIComponent(result.file_path)}`;
    status.className = "status success";
    status.innerHTML = `Saved! <a href="${openUri}" style="color:#7c3aed;text-decoration:underline;cursor:pointer;">Open in Obsidian</a>`;
    btn.textContent = "Done!";
  } else {
    status.className = "status error";
    status.textContent = result ? result.error : "Something went wrong.";
    btn.disabled = false;
    btn.textContent = "Retry";
  }
});

// Save Settings Logic
document.getElementById("save-settings-btn").addEventListener("click", () => {
  const geminiApiKey = document.getElementById("gemini-api-key").value.trim();
  const vaultName = document.getElementById("vault-name").value.trim();
  const topicsFolderPath = document.getElementById("topics-folder").value.trim();
  const topicsRaw = document.getElementById("topics").value;
  const topics = topicsRaw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  browser.storage.local.set({ geminiApiKey, vaultName, topicsFolderPath, topics }).then(() => {
    document.getElementById("settings-status").textContent = "Saved!";
    setTimeout(() => (document.getElementById("settings-status").textContent = ""), 2000);
  });
});

// Scan Topics Logic
document.getElementById("scan-btn").addEventListener("click", () => {
  document.getElementById("folder-picker").click();
});

document.getElementById("folder-picker").addEventListener("change", (e) => {
  const status = document.getElementById("settings-status");
  const files = Array.from(e.target.files);

  if (files.length === 0) {
    status.textContent = "No folder selected.";
    return;
  }

  // Extract .md filenames (without extension) from the selected folder
  const topics = files
    .filter((f) => f.name.endsWith(".md"))
    .map((f) => f.name.replace(/\.md$/, ""))
    .sort();

  if (topics.length === 0) {
    status.textContent = "No .md files found in that folder.";
    return;
  }

  document.getElementById("topics").value = topics.join(", ");
  status.textContent = `Found ${topics.length} topics. Click Save to apply.`;
});
