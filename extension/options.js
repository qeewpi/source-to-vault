// Load saved settings
browser.storage.local.get(["apiUrl", "vaultName", "topics"]).then((data) => {
  document.getElementById("api-url").value = data.apiUrl || "";
  document.getElementById("vault-name").value = data.vaultName || "Ashley in Wonderland";
  document.getElementById("topics").value = (data.topics || []).join(", ");
});

// Save settings
document.getElementById("save-btn").addEventListener("click", () => {
  const apiUrl = document.getElementById("api-url").value.trim().replace(/\/+$/, "");
  const vaultName = document.getElementById("vault-name").value.trim();
  const topicsRaw = document.getElementById("topics").value;
  const topics = topicsRaw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  browser.storage.local.set({ apiUrl, vaultName, topics }).then(() => {
    document.getElementById("status").textContent = "Saved!";
    setTimeout(() => (document.getElementById("status").textContent = ""), 2000);
  });
});

// Sync topics — fetches from the API's /topics endpoint if available,
// otherwise this is a manual-only field
document.getElementById("sync-btn").addEventListener("click", async () => {
  const status = document.getElementById("status");
  const data = await browser.storage.local.get(["apiUrl"]);
  if (!data.apiUrl) {
    status.textContent = "Set API URL first.";
    return;
  }
  try {
    status.textContent = "Syncing...";
    const resp = await fetch(`${data.apiUrl}/topics`);
    const json = await resp.json();
    if (json.topics) {
      document.getElementById("topics").value = json.topics.join(", ");
      status.textContent = `Synced ${json.topics.length} topics.`;
    }
  } catch (err) {
    status.textContent = "Sync not available — edit topics manually.";
  }
});
