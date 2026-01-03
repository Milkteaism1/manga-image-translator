const STYLE_ID = "mitx-style";
const WRAPPER_CLASS = "mitx-wrapper";
const BADGE_CLASS = "mitx-badge";
const SPINNER_CLASS = "mitx-spinner";
const ERROR_CLASS = "mitx-error";

const state = {
  autoTranslate: false,
  observed: new WeakSet(),
  observer: null,
  mutationObserver: null
};

injectStyles();
init();

function injectStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .${WRAPPER_CLASS} {
      position: relative !important;
      display: inline-block !important;
      vertical-align: top !important;
    }
    .${BADGE_CLASS} {
      position: absolute !important;
      top: 4px !important;
      left: 4px !important;
      width: 18px !important;
      height: 18px !important;
      border-radius: 6px !important;
      background: rgba(15, 23, 42, 0.6) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      z-index: 999999 !important;
      pointer-events: none !important;
    }
    .${SPINNER_CLASS} {
      background: url("${chrome.runtime.getURL("assets/spinner.svg")}") center center / 16px 16px no-repeat !important;
    }
    .${ERROR_CLASS} {
      color: #fff !important;
      font-weight: 700 !important;
      font-size: 12px !important;
      background: rgba(220, 38, 38, 0.85) !important;
    }
  `;
  document.head.appendChild(style);
}

function init() {
  chrome.storage.sync.get({ autoTranslate: false }, (stored) => {
    state.autoTranslate = stored.autoTranslate;
    setupObservers();
  });
}

function setupObservers() {
  if (!state.observer) {
    state.observer = new IntersectionObserver(handleIntersections, {
      root: null,
      rootMargin: "0px",
      threshold: 0.01
    });
  }

  if (!state.mutationObserver) {
    state.mutationObserver = new MutationObserver(handleMutations);
    state.mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  observeImages(document.querySelectorAll("img"));
}

function handleMutations(mutations) {
  const images = [];
  for (const mutation of mutations) {
    mutation.addedNodes.forEach((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return;
      }
      if (node.tagName === "IMG") {
        images.push(node);
      } else {
        node.querySelectorAll?.("img").forEach((img) => images.push(img));
      }
    });
  }
  if (images.length) {
    observeImages(images);
  }
}

function observeImages(images) {
  images.forEach((img) => {
    if (state.observed.has(img)) {
      return;
    }
    state.observed.add(img);
    if (state.autoTranslate) {
      state.observer.observe(img);
    }
  });
}

function handleIntersections(entries) {
  if (!state.autoTranslate) {
    return;
  }
  const candidates = [];
  for (const entry of entries) {
    if (entry.isIntersecting) {
      candidates.push(entry.target);
    }
  }
  if (candidates.length) {
    queueImages(candidates);
  }
}

function queueImages(images) {
  const payload = [];
  images.forEach((img) => {
    const src = getOriginalSrc(img);
    if (!src) {
      return;
    }
    if (img.dataset.mitxQueued === "true" || img.dataset.mitxTranslatedSrc) {
      return;
    }
    img.dataset.mitxQueued = "true";
    showSpinner(img);
    const rect = img.getBoundingClientRect();
    payload.push({
      src,
      order: rect.top * 10000 + rect.left
    });
  });

  if (!payload.length) {
    return;
  }

  chrome.runtime.sendMessage({ type: "enqueue-images", images: payload });
}

function getOriginalSrc(img) {
  return img.dataset.mitxOriginalSrc || img.currentSrc || img.src;
}

function showSpinner(img) {
  const badge = ensureBadge(img);
  badge.classList.remove(ERROR_CLASS);
  badge.classList.add(SPINNER_CLASS);
  badge.textContent = "";
  badge.title = "Translating...";
}

function showError(img, message) {
  const badge = ensureBadge(img);
  badge.classList.remove(SPINNER_CLASS);
  badge.classList.add(ERROR_CLASS);
  badge.textContent = "!";
  badge.title = message || "Translation failed";
  img.dataset.mitxQueued = "false";
}

function removeBadge(img) {
  const wrapper = img.closest(`.${WRAPPER_CLASS}`);
  const badge = wrapper?.querySelector(`.${BADGE_CLASS}`);
  if (badge) {
    badge.remove();
  }
  img.dataset.mitxQueued = "false";
}

function ensureBadge(img) {
  const wrapper = ensureWrapper(img);
  let badge = wrapper.querySelector(`.${BADGE_CLASS}`);
  if (!badge) {
    badge = document.createElement("div");
    badge.className = `${BADGE_CLASS} ${SPINNER_CLASS}`;
    wrapper.appendChild(badge);
  }
  return badge;
}

function ensureWrapper(img) {
  const parent = img.parentElement;
  if (parent && parent.classList.contains(WRAPPER_CLASS)) {
    return parent;
  }
  const wrapper = document.createElement("span");
  wrapper.className = WRAPPER_CLASS;
  img.replaceWith(wrapper);
  wrapper.appendChild(img);
  return wrapper;
}

function applyTranslation(src, buffer, mimeType) {
  const blob = new Blob([buffer], { type: mimeType || "image/png" });
  const blobUrl = URL.createObjectURL(blob);
  document.querySelectorAll("img").forEach((img) => {
    const originalSrc = getOriginalSrc(img);
    if (originalSrc !== src) {
      return;
    }
    if (!img.dataset.mitxOriginalSrc) {
      img.dataset.mitxOriginalSrc = originalSrc;
    }
    img.dataset.mitxTranslatedSrc = blobUrl;
    img.dataset.mitxQueued = "false";
    img.src = blobUrl;
    removeBadge(img);
  });
}

function toggleAllImages() {
  document.querySelectorAll("img[data-mitx-translated-src]").forEach((img) => {
    const translated = img.dataset.mitxTranslatedSrc;
    const original = img.dataset.mitxOriginalSrc;
    if (!translated || !original) {
      return;
    }
    img.src = img.src === translated ? original : translated;
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "translate-visible") {
    const visible = Array.from(document.querySelectorAll("img")).filter(isInViewport);
    queueImages(visible);
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "set-auto-translate") {
    state.autoTranslate = Boolean(message.enabled);
    if (state.autoTranslate) {
      observeImages(document.querySelectorAll("img"));
    } else {
      state.observer.disconnect();
    }
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "enqueue-image") {
    const img = findImageBySrc(message.src);
    if (img) {
      queueImages([img]);
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: "Image not found on page." });
    }
    return;
  }

  if (message.type === "toggle-all") {
    toggleAllImages();
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "translation-result") {
    if (message.status === "success") {
      applyTranslation(message.src, message.buffer, message.mimeType);
    } else {
      const img = findImageBySrc(message.src);
      if (img) {
        showError(img, message.error || "Translation failed");
      }
    }
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "request-canvas-bytes") {
    respondWithCanvasBytes(message.src).then(sendResponse);
    return true;
  }

  sendResponse({ ok: false, error: "Unknown message." });
});

function isInViewport(img) {
  const rect = img.getBoundingClientRect();
  return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
}

function findImageBySrc(src) {
  const images = Array.from(document.querySelectorAll("img"));
  return images.find((img) => getOriginalSrc(img) === src);
}

async function respondWithCanvasBytes(src) {
  const img = findImageBySrc(src);
  if (!img) {
    return { ok: false, error: "Image not found for canvas extraction." };
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
      return { ok: false, error: "Canvas export failed." };
    }
    const buffer = await blob.arrayBuffer();
    return { ok: true, buffer, mimeType: "image/png" };
  } catch (error) {
    return { ok: false, error: "Canvas extraction blocked by CORS." };
  }
}
