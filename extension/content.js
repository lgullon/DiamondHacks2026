const PANEL_ID = "texttutor-panel";

const LOADING_PHRASES = [
  "Preheating the oven...",
  "Mixing the dough...",
  "Sprinkling in chocolate chips...",
  "Arranging the baking tray...",
  "Savoring the taste...",
];

function randomLoadingPhrase() {
  return LOADING_PHRASES[Math.floor(Math.random() * LOADING_PHRASES.length)];
}
const MIN_CHARS = 20;   // ignore tiny selections
const MAX_CHARS = 1500; // cap request size

const CHIP_FRAMES = [
  "mainChip.png",
  "chipChomp1.png",
  "chipChomp2.png",
  "chipChomp3.png",
  "chipChomp4.png",
];

function createChipAnim() {
  const wrap = document.createElement("div");
  wrap.className = "tt-chip-anim";
  const img = document.createElement("img");
  img.src = chrome.runtime.getURL("mainChip.png");
  img.alt = "Loading...";
  wrap.appendChild(img);

  let frame = 0;
  const interval = setInterval(() => {
    frame = (frame + 1) % CHIP_FRAMES.length;
    img.src = chrome.runtime.getURL(CHIP_FRAMES[frame]);
  }, 300);

  wrap._stopAnim = () => clearInterval(interval);
  return wrap;
}

let debounceTimer = null;
let _lastMouseDownInPanel = false;

// Track whether the user clicked inside our panel so we never close it
// just because the click cleared the page text selection.
document.addEventListener("mousedown", (e) => {
  const panel = document.getElementById(PANEL_ID);
  _lastMouseDownInPanel = !!(panel && panel.contains(e.target));
}, true);

document.addEventListener("selectionchange", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => handleSelection(), 1000);
});

function handleSelection() {
  const selection = window.getSelection();
  if (!selection) return;

  // Never react to selections made inside our panel (e.g. reading bullet points)
  const panel = document.getElementById(PANEL_ID);
  if (panel && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    if (panel.contains(range.commonAncestorContainer)) return;
  }

  const text = selection.toString().trim();
  if (text.length < MIN_CHARS) {
    // Small or empty selection — only close if the user clicked outside the panel
    if (!_lastMouseDownInPanel) removePanel();
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
      <span>${randomLoadingPhrase()}</span>
    </div>
  `;

  const chipAnim = createChipAnim();
  const loading = panel.querySelector(".tt-loading");
  loading.insertBefore(chipAnim, loading.firstChild);

  positionPanel(panel, selectionRect);
  document.body.appendChild(panel);
  panel.querySelector(".tt-close").addEventListener("click", removePanel);
  makeDraggable(panel, panel.querySelector(".tt-header"));
  makeResizable(panel);
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
  const videoCol = panel.querySelector(".tt-video-col");
  const current = videoCol.firstElementChild;
  if (current) current.replaceWith(el);
  else videoCol.appendChild(el);
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
      <button class="tt-quiz-btn">Quiz</button>
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
  body.querySelector(".tt-quiz-btn").addEventListener("click", () => renderQuizView(panel, video, videos, text));
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

  const notesCol = panel.querySelector(".tt-notes-col");

  // Build the inner wrapper (holds all content, animates directionally)
  notesCol.innerHTML = "";
  const inner = document.createElement("div");
  inner.className = "tt-notes-inner";
  notesCol.appendChild(inner);

  // Header
  const colHeader = document.createElement("div");
  colHeader.className = "tt-notes-col-header";
  colHeader.textContent = "Chip's Notes";
  inner.appendChild(colHeader);

  // Loading state
  const loadingDiv = document.createElement("div");
  loadingDiv.className = "tt-notes-loading";
  const chipAnim = createChipAnim();
  const loadingText = document.createElement("span");
  loadingText.textContent = randomLoadingPhrase();
  loadingDiv.appendChild(chipAnim);
  loadingDiv.appendChild(loadingText);
  inner.appendChild(loadingDiv);

  // Slide open: expand panel + notes col together
  const NOTES_WIDTH = 414;
  panel.style.transition = "width 0.3s ease";
  panel.style.width = (panel.offsetWidth + NOTES_WIDTH) + "px";
  notesCol.classList.add("open");

  function closeNotes() {
    notesCol.classList.add("closing");
    notesCol.classList.remove("open");
    panel.style.transition = "width 0.3s ease";
    panel.style.width = Math.max(300, panel.offsetWidth - NOTES_WIDTH) + "px";
    setTimeout(() => {
      notesCol.classList.remove("closing");
      panel.style.transition = "none";
      notesCol.innerHTML = "";
    }, 300);
  }

  chrome.runtime.sendMessage({ type: "GET_NOTES", text, video_id: videoId }, (response) => {
    chipAnim._stopAnim();

    // Clear loading, keep header
    inner.innerHTML = "";
    inner.appendChild(colHeader);

    if (chrome.runtime.lastError || !response || response.error) {
      const err = document.createElement("div");
      err.className = "tt-error";
      err.textContent = "Could not generate notes. Try again.";
      inner.appendChild(err);
    } else {
      const list = document.createElement("ul");
      list.className = "tt-notes-list";
      response.data.bullets.forEach(b => {
        const li = document.createElement("li");
        li.textContent = b;
        list.appendChild(li);
      });
      inner.appendChild(list);
    }

    const footer = document.createElement("div");
    footer.className = "tt-footer";
    const closeBtn = document.createElement("button");
    closeBtn.className = "tt-notes-btn";
    closeBtn.textContent = "Close notes";
    footer.appendChild(closeBtn);
    inner.appendChild(footer);

    closeBtn.addEventListener("click", closeNotes);
  });
}

function renderQuizView(panel, video, videos, text) {
  // Always write an explicit pixel height so the quiz's height:100% chain resolves
  // correctly. When notes are open the panel height is flex-driven (no style.height),
  // which causes height:100% inside the quiz to collapse to 0.
  panel.style.height = Math.max(420, panel.offsetHeight) + "px";

  const vidIdMatch = video.embed_url.match(/embed\/([^?&]+)/);
  const videoId = vidIdMatch ? vidIdMatch[1] : "";

  const view = document.createElement("div");
  view.className = "tt-quiz-view";

  const header = document.createElement("div");
  header.className = "tt-quiz-header";
  header.textContent = "Chip's Quiz";
  view.appendChild(header);

  const loadingDiv = document.createElement("div");
  loadingDiv.className = "tt-loading";
  const chipAnim = createChipAnim();
  const loadingText = document.createElement("span");
  loadingText.textContent = randomLoadingPhrase();
  loadingDiv.appendChild(chipAnim);
  loadingDiv.appendChild(loadingText);
  view.appendChild(loadingDiv);

  swapPanelBody(panel, view);

  chrome.runtime.sendMessage({ type: "GET_QUIZ", text, video_id: videoId }, (response) => {
    chipAnim._stopAnim();
    view.innerHTML = "";
    view.appendChild(header);

    if (chrome.runtime.lastError || !response || response.error) {
      const err = document.createElement("div");
      err.className = "tt-error";
      err.textContent = "Could not generate quiz. Try again.";
      view.appendChild(err);
    } else {
      const questions = response.data.questions || [];
      let score = 0;
      let answered = 0;

      const questionsWrap = document.createElement("div");
      questionsWrap.className = "tt-quiz-questions";

      const scoreEl = document.createElement("div");
      scoreEl.className = "tt-quiz-score";
      scoreEl.textContent = `Score: 0 / ${questions.length}`;

      questions.forEach((q, qi) => {
        const qEl = document.createElement("div");
        qEl.className = "tt-quiz-question";

        const qText = document.createElement("p");
        qText.className = "tt-quiz-q-text";
        qText.textContent = `${qi + 1}. ${q.question}`;
        qEl.appendChild(qText);

        const optsEl = document.createElement("div");
        optsEl.className = "tt-quiz-options";

        q.options.forEach((opt) => {
          const letter = opt.charAt(0);
          const optEl = document.createElement("div");
          optEl.className = "tt-quiz-option";
          optEl.textContent = opt;

          optEl.addEventListener("click", () => {
            if (qEl.dataset.answered) return;
            qEl.dataset.answered = "1";
            answered++;

            if (letter === q.answer) {
              optEl.classList.add("correct");
              score++;
            } else {
              optEl.classList.add("incorrect");
              // highlight the correct one
              optsEl.querySelectorAll(".tt-quiz-option").forEach((o) => {
                if (o.textContent.charAt(0) === q.answer) o.classList.add("correct");
              });
            }
            scoreEl.textContent = `Score: ${score} / ${questions.length}`;
          });

          optsEl.appendChild(optEl);
        });

        qEl.appendChild(optsEl);
        questionsWrap.appendChild(qEl);
      });

      view.appendChild(questionsWrap);
      view.appendChild(scoreEl);
    }

    const footer = document.createElement("div");
    footer.className = "tt-footer";
    const backBtn = document.createElement("button");
    backBtn.className = "tt-back-btn";
    backBtn.textContent = "← Back to video";
    footer.appendChild(backBtn);
    view.appendChild(footer);

    backBtn.addEventListener("click", () => renderSingleView(panel, video, videos, text));
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
    <div class="tt-panel-row">
      <div class="tt-video-col">
        <div class="tt-body"></div>
      </div>
      <div class="tt-notes-col"></div>
    </div>
  `;

  positionPanel(panel, selectionRect);
  document.body.appendChild(panel);
  panel.querySelector(".tt-close").addEventListener("click", removePanel);
  makeDraggable(panel, panel.querySelector(".tt-header"));
  makeResizable(panel);

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
  makeResizable(panel);
}

function makeResizable(panel) {
  const handle = document.createElement("div");
  handle.className = "tt-resize-handle";
  panel.appendChild(handle);

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = panel.offsetWidth;
    const startH = panel.offsetHeight;

    // Disable transitions while dragging so width/height track the mouse exactly
    panel.style.transition = "none";

    function onMouseMove(e) {
      panel.style.width  = Math.max(300, startW + e.clientX - startX) + "px";
      panel.style.height = Math.max(120, startH + e.clientY - startY) + "px";
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup",   onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup",   onMouseUp);
  });
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
