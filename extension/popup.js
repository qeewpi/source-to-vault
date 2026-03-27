let currentUrl = "";
let currentTabId = null;

// Get the active tab's URL on popup open
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

document.getElementById("save-btn").addEventListener("click", async () => {
  const btn = document.getElementById("save-btn");
  const status = document.getElementById("status");

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
