const backendInput = document.getElementById("backend-url");
const autoToggle = document.getElementById("auto-translate");
const saveBtn = document.getElementById("save");
const status = document.getElementById("status");

const DEFAULT_BACKEND_URL = "http://188.166.251.233:5003";

loadSettings();

saveBtn.addEventListener("click", () => {
  const backendUrl = backendInput.value.trim() || DEFAULT_BACKEND_URL;
  const autoTranslate = autoToggle.checked;
  chrome.storage.sync.set({ backendUrl, autoTranslate }, () => {
    status.textContent = "Saved.";
    setTimeout(() => {
      status.textContent = "";
    }, 1500);
  });
});

function loadSettings() {
  chrome.storage.sync.get({ backendUrl: DEFAULT_BACKEND_URL, autoTranslate: false }, (stored) => {
    backendInput.value = stored.backendUrl;
    autoToggle.checked = stored.autoTranslate;
  });
}
