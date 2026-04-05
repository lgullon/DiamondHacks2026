const PANEL_ID = "texttutor-panel";
const MIN_CHARS = 20;   // ignore tiny selections
const MAX_CHARS = 1500; // cap request size

let debounceTimer = null;

document.addEventListener("mouseup", (e) => {
  // Ignore clicks inside the panel itself
  const panel = document.getElementById(PANEL_ID);
  if (panel && panel.contains(e.target)) return;

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => handleSelection(), 300);
});

function handleSelection() {
  const selection = window.getSelection();
  if (!selection) return;

  const text = selection.toString().trim();
  if (text.length < MIN_CHARS) {
    // Small or empty selection — close any open panel
    removePanel();
    return;
  }

  const clipped = text.slice(0, MAX_CHARS);
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  showLoadingPanel(rect);
  fetchVideo(clipped, rect);
}

// ── Panel helpers ──────────────────────────────────────────────────────────

function removePanel() {
  const existing = document.getElementById(PANEL_ID);
  if (existing) existing.remove();
}

function showLoadingPanel(selectionRect) {
  removePanel();

  const panel = createPanelShell();
  panel.innerHTML = `
    <div class="tt-header">
      <span class="tt-logo"><img src="${chrome.runtime.getURL('mainChip.png')}" alt="Chip" />SmartCookie</span>
      <button class="tt-close" title="Close">✕</button>
    </div>
    <div class="tt-loading">
      <div class="tt-spinner"></div>
      <span>Finding the best explanation…</span>
    </div>
  `;

  positionPanel(panel, selectionRect);
  document.body.appendChild(panel);
  panel.querySelector(".tt-close").addEventListener("click", removePanel);
  makeDraggable(panel, panel.querySelector(".tt-header"));
}

function videoEmbedUrl(video) {
  const noAutoplay = video.embed_url.replace(/[&?]autoplay=1/, "");
  return noAutoplay + (noAutoplay.includes("?") ? "&" : "?") + "autoplay=1";
}

function videoThumbUrl(video) {
  const match = video.embed_url.match(/embed\/([^?&]+)/);
  return match ? `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg` : "";
}

function swapPanelBody(panel, el) {
  panel.querySelector(".tt-body, .tt-video-list, .tt-notes-view").replaceWith(el);
}

function renderSingleView(panel, video, videos, text) {
  const thumb = videoThumbUrl(video);
  const body = document.createElement("div");
  body.className = "tt-body";
  body.innerHTML = `
    <div class="tt-meta">
      <div class="tt-title" title="${escapeAttr(video.title)}">${escapeHtml(video.title)}</div>
      <div class="tt-channel">${escapeHtml(video.channel)}</div>
    </div>
    <div class="tt-thumb-wrap">
      <img src="${escapeAttr(thumb)}" alt="Video thumbnail" />
      <div class="tt-play-btn"></div>
    </div>
    <div class="tt-footer">
      <button class="tt-show-more">Show more videos ▾</button>
      <button class="tt-notes-btn">Notes</button>
    </div>
  `;

  swapPanelBody(panel, body);

  body.querySelector(".tt-thumb-wrap").addEventListener("click", () => {
    const embedWrap = document.createElement("div");
    embedWrap.className = "tt-embed-wrap";
    embedWrap.innerHTML = `
      <iframe
        src="${escapeAttr(videoEmbedUrl(video))}"
        class="tt-iframe"
        allow="autoplay; encrypted-media; picture-in-picture"
        allowfullscreen
        frameborder="0"
      ></iframe>
    `;
    body.querySelector(".tt-thumb-wrap").replaceWith(embedWrap);
  });

  body.querySelector(".tt-show-more").addEventListener("click", () => renderListView(panel, videos, text));
  body.querySelector(".tt-notes-btn").addEventListener("click", () => renderNotesView(panel, video, videos, text));
}

function renderListView(panel, videos, text) {
  const list = document.createElement("div");
  list.className = "tt-video-list";
  list.innerHTML = videos.map((video, i) => `
    <div class="tt-video-option" data-index="${i}">
      <div class="tt-option-thumb">
        <img src="${escapeAttr(videoThumbUrl(video))}" alt="thumbnail" />
        <div class="tt-play-btn"></div>
      </div>
      <div class="tt-option-info">
        <div class="tt-title">${escapeHtml(video.title)}</div>
        <div class="tt-channel">${escapeHtml(video.channel)}</div>
      </div>
    </div>
  `).join("");

  swapPanelBody(panel, list);

  list.querySelectorAll(".tt-video-option").forEach((el) => {
    el.addEventListener("click", () => renderSingleView(panel, videos[parseInt(el.dataset.index)], videos, text));
  });
}

function renderNotesView(panel, video, videos, text) {
  const vidIdMatch = video.embed_url.match(/embed\/([^?&]+)/);
  const videoId = vidIdMatch ? vidIdMatch[1] : "";

  const view = document.createElement("div");
  view.className = "tt-notes-view";
  view.innerHTML = `
    <div class="tt-notes-loading">
      <div class="tt-spinner"></div>
      <span>Generating notes…</span>
    </div>
  `;
  swapPanelBody(panel, view);

  chrome.runtime.sendMessage({ type: "GET_NOTES", text, video_id: videoId }, (response) => {
    if (chrome.runtime.lastError || !response || response.error) {
      view.innerHTML = `<div class="tt-error">Could not generate notes. Try again.</div>
        <div class="tt-footer"><button class="tt-back-btn">← Back</button></div>`;
    } else {
      const bulletsHtml = response.data.bullets
        .map(b => `<li>${escapeHtml(b)}</li>`)
        .join("");
      view.innerHTML = `
        <ul class="tt-notes-list">${bulletsHtml}</ul>
        <div class="tt-footer"><button class="tt-back-btn">← Back to video</button></div>
      `;
    }
    view.querySelector(".tt-back-btn").addEventListener("click", () => renderSingleView(panel, video, videos, text));
  });
}

function showVideoPanel(selectionRect, videos, text) {
  removePanel();

  const panel = createPanelShell();
  panel.innerHTML = `
    <div class="tt-header">
      <span class="tt-logo"><img src="${chrome.runtime.getURL('mainChip.png')}" alt="Chip" />SmartCookie</span>
      <button class="tt-close" title="Close">✕</button>
    </div>
    <div class="tt-body"></div>
  `;

  positionPanel(panel, selectionRect);
  document.body.appendChild(panel);
  panel.querySelector(".tt-close").addEventListener("click", removePanel);
  makeDraggable(panel, panel.querySelector(".tt-header"));

  renderSingleView(panel, videos[0], videos, text);
}

function showErrorPanel(selectionRect, message) {
  removePanel();

  const panel = createPanelShell();
  panel.innerHTML = `
    <div class="tt-header">
      <span class="tt-logo"><img src="${chrome.runtime.getURL('mainChip.png')}" alt="Chip" />SmartCookie</span>
      <button class="tt-close" title="Close">✕</button>
    </div>
    <div class="tt-error">${escapeHtml(message)}</div>
  `;

  positionPanel(panel, selectionRect);
  document.body.appendChild(panel);
  panel.querySelector(".tt-close").addEventListener("click", removePanel);
  makeDraggable(panel, panel.querySelector(".tt-header"));
}

function makeDraggable(panel, handle) {
  let startX, startY, startLeft, startTop;

  handle.style.cursor = "grab";

  handle.addEventListener("mousedown", (e) => {
    if (e.target.classList.contains("tt-close")) return;
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = parseInt(panel.style.left, 10) || 0;
    startTop  = parseInt(panel.style.top,  10) || 0;
    handle.style.cursor = "grabbing";

    function onMouseMove(e) {
      panel.style.left = (startLeft + e.clientX - startX) + "px";
      panel.style.top  = (startTop  + e.clientY - startY) + "px";
    }

    function onMouseUp() {
      handle.style.cursor = "grab";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
}

function createPanelShell() {
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  return panel;
}

function positionPanel(panel, selectionRect) {
  const PANEL_WIDTH = 360;
  const PANEL_OFFSET = 12;

  // Prefer right of selection; fall back to left if near viewport edge
  const viewportWidth = document.documentElement.clientWidth;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  let left = selectionRect.right + scrollX + PANEL_OFFSET;
  if (left + PANEL_WIDTH > viewportWidth + scrollX - 8) {
    left = selectionRect.left + scrollX - PANEL_WIDTH - PANEL_OFFSET;
  }
  // Clamp to viewport
  left = Math.max(scrollX + 8, left);

  const top = selectionRect.top + scrollY;

  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

// ── Network ────────────────────────────────────────────────────────────────

async function fetchVideo(text, selectionRect) {
  chrome.runtime.sendMessage({ type: "FIND_VIDEO", text }, (response) => {
    if (chrome.runtime.lastError || !response) {
      showErrorPanel(selectionRect, "Could not reach SmartCookie backend. Make sure it's running on port 5001.");
      return;
    }
    if (response.error) {
      showErrorPanel(selectionRect, response.error);
      return;
    }
    showVideoPanel(selectionRect, response.data.videos, text);
  });
}

// ── Utils ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
