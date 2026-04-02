// Load saved settings
browser.storage.local.get(["geminiApiKey", "vaultName", "topicsFolderPath", "topics"]).then((data) => {
  document.getElementById("gemini-api-key").value = data.geminiApiKey || "";
  document.getElementById("vault-name").value = data.vaultName || "";
  document.getElementById("topics-folder").value = data.topicsFolderPath || "";
  document.getElementById("topics").value = (data.topics || []).join(", ");
});

// Save settings
document.getElementById("save-btn").addEventListener("click", () => {
  const geminiApiKey = document.getElementById("gemini-api-key").value.trim();
  const vaultName = document.getElementById("vault-name").value.trim();
  const topicsFolderPath = document.getElementById("topics-folder").value.trim();
  const topicsRaw = document.getElementById("topics").value;
  const topics = topicsRaw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  browser.storage.local.set({ geminiApiKey, vaultName, topicsFolderPath, topics }).then(() => {
    document.getElementById("status").textContent = "Saved!";
    setTimeout(() => (document.getElementById("status").textContent = ""), 2000);
  });
});

// Scan Topics Folder — uses a directory picker to read .md filenames
document.getElementById("scan-btn").addEventListener("click", () => {
  document.getElementById("folder-picker").click();
});

document.getElementById("folder-picker").addEventListener("change", (e) => {
  const status = document.getElementById("status");
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
