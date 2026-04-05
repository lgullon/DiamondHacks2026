const statusEl = document.getElementById("status");

async function checkBackend() {
  try {
    const resp = await fetch("http://localhost:5001/", { method: "GET" });
    if (resp.ok) {
      statusEl.className = "status ok";
      statusEl.innerHTML = '<div class="dot dot-green"></div><span>Backend running — ready to go!</span>';
    } else {
      throw new Error("non-ok");
    }
  } catch {
    statusEl.className = "status error";
    statusEl.innerHTML =
      '<div class="dot dot-red"></div><span>Backend not found. Run <code>python main.py</code> in <em>backend/</em>.</span>';
  }
}

checkBackend();
