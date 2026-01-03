const translateVisibleBtn = document.getElementById("translate-visible");
const autoTranslateToggle = document.getElementById("auto-translate");
const pauseQueueBtn = document.getElementById("pause-queue");
const toggleOriginalBtn = document.getElementById("toggle-original");

init();

function init() {
  chrome.storage.sync.get({ autoTranslate: false }, (stored) => {
    autoTranslateToggle.checked = stored.autoTranslate;
  });
}

translateVisibleBtn.addEventListener("click", () => {
  sendToActiveTab({ type: "translate-visible" });
});

autoTranslateToggle.addEventListener("change", (event) => {
  const enabled = event.target.checked;
  chrome.storage.sync.set({ autoTranslate: enabled });
  sendToActiveTab({ type: "set-auto-translate", enabled });
});

pauseQueueBtn.addEventListener("click", async () => {
  chrome.runtime.sendMessage({ type: "pause-queue" }, (response) => {
    if (response?.paused) {
      pauseQueueBtn.textContent = "Resume";
    } else {
      pauseQueueBtn.textContent = "Stop / Pause";
    }
  });
});

toggleOriginalBtn.addEventListener("click", () => {
  sendToActiveTab({ type: "toggle-all" });
});

function sendToActiveTab(message) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (!tabId) {
      return;
    }
    chrome.tabs.sendMessage(tabId, message);
  });
}
