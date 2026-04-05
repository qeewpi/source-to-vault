function getParams() {
  return new URLSearchParams(window.location.search);
}

function setBusy(busy) {
  document.getElementById("approve-btn").disabled = busy;
  document.getElementById("skip-btn").disabled = busy;
}

function showError(message) {
  const error = document.getElementById("error");
  error.textContent = message;
  error.style.display = "block";
}

async function sendDecision(reviewId, approved) {
  setBusy(true);

  try {
    await browser.runtime.sendMessage({
      action: "topicReviewResponse",
      reviewId,
      approved,
    });
  } catch (error) {
    showError("Could not send your choice back to the extension.");
  } finally {
    window.close();
  }
}

const params = getParams();
const reviewId = params.get("reviewId") || "";
const topic = params.get("topic") || "Unknown topic";

document.getElementById("topic").textContent = topic;

if (!reviewId) {
  showError("Missing review context. Please try saving the source note again.");
  setBusy(true);
}

document.getElementById("approve-btn").addEventListener("click", () => {
  if (reviewId) sendDecision(reviewId, true);
});

document.getElementById("skip-btn").addEventListener("click", () => {
  if (reviewId) sendDecision(reviewId, false);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    window.close();
  }
  if (event.key === "Enter" && reviewId) {
    sendDecision(reviewId, true);
  }
});
