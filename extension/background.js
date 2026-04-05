chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "FIND_VIDEO") return false;

  fetch("http://localhost:5001/api/find-video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message.text }),
  })
    .then(async (resp) => {
      const data = await resp.json();
      if (!resp.ok) {
        sendResponse({ error: data.detail || "Backend error — try again." });
      } else {
        sendResponse({ data });
      }
    })
    .catch(() => {
      sendResponse({ error: "Could not reach TextTutor backend. Make sure it's running on port 5001." });
    });

  return true; // keep the message channel open for async response
});
