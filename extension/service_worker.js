const DEFAULT_BACKEND_URL = "http://188.166.251.233:5003";
const DEFAULT_CONFIG = {
  translator: {
    translator: "chatmock",
    target_lang: "ENG",
    chatmock_model: "gpt-5.2"
  }
};

const queue = [];
const cache = new Map();
const inFlight = new Set();
let paused = false;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "mitx-translate-image",
    title: "Translate this image",
    contexts: ["image"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "mitx-translate-image" && info.srcUrl && tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      type: "enqueue-image",
      src: info.srcUrl
    });
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-original-translated") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { type: "toggle-all" });
      }
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "enqueue-images") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "No active tab." });
      return;
    }
    enqueueImages(tabId, message.images || []);
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "pause-queue") {
    paused = !paused;
    if (!paused) {
      processQueue();
    }
    sendResponse({ ok: true, paused });
    return;
  }

  if (message.type === "request-queue-state") {
    sendResponse({ ok: true, paused, queueLength: queue.length });
    return;
  }

  sendResponse({ ok: false, error: "Unknown message." });
});

async function getSettings() {
  const stored = await chrome.storage.sync.get({
    backendUrl: DEFAULT_BACKEND_URL,
    autoTranslate: false
  });
  return stored;
}

function enqueueImages(tabId, images) {
  const sorted = [...images].sort((a, b) => a.order - b.order);
  for (const item of sorted) {
    const src = item.src;
    if (!src) {
      continue;
    }

    const cached = cache.get(src);
    if (cached?.status === "success") {
      chrome.tabs.sendMessage(tabId, {
        type: "translation-result",
        src,
        status: "success",
        buffer: cached.buffer,
        mimeType: cached.mimeType
      });
      continue;
    }
    if (cached?.status === "error") {
      chrome.tabs.sendMessage(tabId, {
        type: "translation-result",
        src,
        status: "error",
        error: cached.error
      });
      continue;
    }

    if (!cache.has(src)) {
      cache.set(src, { status: "pending", tabs: new Set([tabId]) });
      queue.push({ src, tabId });
    } else {
      cache.get(src).tabs.add(tabId);
    }
  }

  processQueue();
}

async function processQueue() {
  if (paused || inFlight.size > 0) {
    return;
  }
  const next = queue.shift();
  if (!next) {
    return;
  }

  const { src } = next;
  inFlight.add(src);
  cache.set(src, { ...(cache.get(src) || {}), status: "in_progress" });

  try {
    const { buffer, mimeType } = await fetchImageBytes(src, next.tabId);
    await processImageBytes(src, buffer, mimeType);
  } catch (error) {
    finalizeFailure(src, error?.message || String(error));
  } finally {
    inFlight.delete(src);
    if (!paused) {
      processQueue();
    }
  }
}

async function fetchImageBytes(src, tabId) {
  try {
    const response = await fetch(src, {
      mode: "cors",
      credentials: "omit"
    });
    if (!response.ok || response.type === "opaque") {
      throw new Error("Image fetch blocked by CORS or network.");
    }
    const buffer = await response.arrayBuffer();
    const mimeType = response.headers.get("content-type") || "image/png";
    return { buffer, mimeType };
  } catch (err) {
    return await requestCanvasBytes(src, tabId, err);
  }
}

async function requestCanvasBytes(src, tabId, originalError) {
  if (!tabId) {
    throw originalError;
  }
  const response = await sendMessageToTab(tabId, {
    type: "request-canvas-bytes",
    src
  });
  if (!response || !response.ok) {
    throw new Error(response?.error || originalError?.message || "Unable to access image pixels.");
  }
  return { buffer: response.buffer, mimeType: response.mimeType || "image/png" };
}

async function processImageBytes(src, buffer, mimeType) {
  const settings = await getSettings();
  const formData = new FormData();
  const file = new File([buffer], "image", { type: mimeType });
  formData.append("image", file);
  formData.append("config", JSON.stringify(DEFAULT_CONFIG));

  const response = await fetch(`${settings.backendUrl}/translate/with-form/image`, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    throw new Error(`Backend error: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  let resultBuffer;
  let resultMime = "image/png";

  if (contentType.includes("application/json")) {
    const data = await response.json();
    if (data?.image_base64) {
      resultBuffer = base64ToArrayBuffer(data.image_base64);
      resultMime = data.image_mime || "image/png";
    } else if (data?.image_url) {
      const imgResp = await fetch(data.image_url);
      resultBuffer = await imgResp.arrayBuffer();
      resultMime = imgResp.headers.get("content-type") || "image/png";
    } else {
      throw new Error("Unexpected JSON response from backend.");
    }
  } else {
    resultBuffer = await response.arrayBuffer();
    resultMime = contentType || "image/png";
  }

  cache.set(src, { status: "success", buffer: resultBuffer, mimeType: resultMime });
  notifyTabs(src, {
    type: "translation-result",
    src,
    status: "success",
    buffer: resultBuffer,
    mimeType: resultMime
  });
}

function finalizeFailure(src, errorMessage) {
  cache.set(src, { status: "error", error: errorMessage });
  notifyTabs(src, {
    type: "translation-result",
    src,
    status: "error",
    error: errorMessage
  });
}

function notifyTabs(src, message) {
  const entry = cache.get(src);
  const tabs = entry?.tabs ? Array.from(entry.tabs) : [];
  for (const tabId of tabs) {
    chrome.tabs.sendMessage(tabId, message);
  }
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      resolve(response);
    });
  });
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
