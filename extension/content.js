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
      <span class="tt-logo">▶ TextTutor</span>
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
}

function showVideoPanel(selectionRect, data) {
  removePanel();

  const panel = createPanelShell();
  panel.innerHTML = `
    <div class="tt-header">
      <span class="tt-logo">▶ TextTutor</span>
      <button class="tt-close" title="Close">✕</button>
    </div>
    <div class="tt-meta">
      <div class="tt-title" title="${escapeAttr(data.title)}">${escapeHtml(data.title)}</div>
      <div class="tt-channel">${escapeHtml(data.channel)}</div>
    </div>
    <div class="tt-embed-wrap">
      <iframe
        src="${escapeAttr(data.embed_url)}"
        class="tt-iframe"
        allow="autoplay; encrypted-media; picture-in-picture"
        allowfullscreen
        frameborder="0"
      ></iframe>
    </div>
  `;

  positionPanel(panel, selectionRect);
  document.body.appendChild(panel);
  panel.querySelector(".tt-close").addEventListener("click", removePanel);
}

function showErrorPanel(selectionRect, message) {
  removePanel();

  const panel = createPanelShell();
  panel.innerHTML = `
    <div class="tt-header">
      <span class="tt-logo">▶ TextTutor</span>
      <button class="tt-close" title="Close">✕</button>
    </div>
    <div class="tt-error">${escapeHtml(message)}</div>
  `;

  positionPanel(panel, selectionRect);
  document.body.appendChild(panel);
  panel.querySelector(".tt-close").addEventListener("click", removePanel);
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
      showErrorPanel(selectionRect, "Could not reach TextTutor backend. Make sure it's running on port 5001.");
      return;
    }
    if (response.error) {
      showErrorPanel(selectionRect, response.error);
      return;
    }
    showVideoPanel(selectionRect, response.data);
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
