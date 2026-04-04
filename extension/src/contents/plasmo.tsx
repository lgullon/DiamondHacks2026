import type { PlasmoCSConfig } from "plasmo"
import { useEffect, useRef, useState } from "react"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"]
}

// Plasmo injects a shadow DOM — we need to bring in our styles
export const getStyle = () => {
  const style = document.createElement("style")
  // Inline a minimal subset of Tailwind so the shadow DOM gets styles
  style.textContent = `
    * { box-sizing: border-box; }
    .mascot-wrapper {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      font-family: sans-serif;
    }
    .bubble {
      background: white;
      border: 2px solid #7c3aed;
      border-radius: 16px;
      padding: 12px 16px;
      max-width: 280px;
      margin-bottom: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      font-size: 14px;
      line-height: 1.5;
      color: #1f2937;
    }
    .face {
      font-size: 48px;
      cursor: pointer;
      user-select: none;
      text-align: right;
    }
    .mic-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-top: 10px;
      width: 100%;
      padding: 8px;
      background: #7c3aed;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .mic-btn.recording {
      background: #dc2626;
      animation: pulse 1s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
    .lang-select {
      width: 100%;
      margin-top: 8px;
      padding: 4px 8px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 12px;
    }
  `
  return style
}

const BACKEND = "http://localhost:8000"

type State = "idle" | "recording" | "thinking" | "speaking"

function readFormFields() {
  const fields = document.querySelectorAll("input, select, textarea")
  return Array.from(fields)
    .filter((el: Element) => {
      const input = el as HTMLInputElement
      return input.type !== "hidden" && input.type !== "submit"
    })
    .map((el: Element) => {
      const input = el as HTMLInputElement | HTMLSelectElement
      const labelEl = input.id
        ? document.querySelector(`label[for="${input.id}"]`)
        : null
      return {
        id: input.id || input.name || Math.random().toString(36).slice(2),
        type: input.tagName === "SELECT" ? "select" : (input as HTMLInputElement).type || "text",
        label: labelEl?.textContent?.trim() || input.placeholder || input.name || input.id,
        options:
          input.tagName === "SELECT"
            ? Array.from((input as HTMLSelectElement).options).map((o) => o.text)
            : null
      }
    })
    .filter((f) => f.label)
}

function Mascot() {
  const [visible, setVisible] = useState(false)
  const [state, setState] = useState<State>("idle")
  const [bubble, setBubble] = useState("")
  const [language, setLanguage] = useState("en")
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  // Listen for the popup "Start" button message
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "START_FORMBUDDY") {
        setVisible(true)
        startSession()
      }
    }
    window.addEventListener("message", handler)

    // Also listen via chrome runtime messages (from popup)
    const chromeHandler = (msg: any) => {
      if (msg.type === "START_FORMBUDDY") {
        setVisible(true)
        startSession()
      }
    }
    chrome.runtime.onMessage.addListener(chromeHandler)

    return () => {
      window.removeEventListener("message", handler)
      chrome.runtime.onMessage.removeListener(chromeHandler)
    }
  }, [language])

  async function startSession() {
    const fields = readFormFields()
    if (fields.length === 0) {
      setBubble("I don't see any form fields on this page. Navigate to a page with a form!")
      return
    }
    setBubble("Reading the form...")
    setState("thinking")
    try {
      const res = await fetch(`${BACKEND}/analyze-form`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields, language })
      })
      const data = await res.json()
      const first = data.questions?.[0]
      if (first) {
        speak(first.simplified)
      }
    } catch {
      setBubble("⚠️ Can't reach the backend. Make sure it's running on port 8000.")
      setState("idle")
    }
  }

  async function speak(text: string) {
    setBubble(text)
    setState("speaking")
    try {
      const res = await fetch(`${BACKEND}/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language })
      })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => setState("idle")
      audio.play()
    } catch {
      // Fallback to browser TTS
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = language === "es" ? "es-ES" : language === "zh" ? "zh-CN" : "en-US"
      utterance.onend = () => setState("idle")
      window.speechSynthesis.speak(utterance)
    }
  }

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    chunksRef.current = []
    const mr = new MediaRecorder(stream)
    mediaRecorderRef.current = mr
    mr.ondataavailable = (e) => chunksRef.current.push(e.data)
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      const blob = new Blob(chunksRef.current, { type: "audio/webm" })
      await sendAudio(blob)
    }
    mr.start()
    setState("recording")
    setBubble("Listening... tap again to stop.")
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop()
    setState("thinking")
    setBubble("Got it, thinking...")
  }

  async function sendAudio(blob: Blob) {
    const form = new FormData()
    form.append("audio", blob, "audio.webm")
    form.append("language", language)
    try {
      const res = await fetch(`${BACKEND}/voice-input`, { method: "POST", body: form })
      const { transcription } = await res.json()
      setBubble(`You said: "${transcription}"`)
      await sendChat(transcription)
    } catch {
      setBubble("⚠️ Couldn't transcribe. Try again.")
      setState("idle")
    }
  }

  async function sendChat(userMessage: string) {
    setState("thinking")
    try {
      const res = await fetch(`${BACKEND}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field_id: "current", user_message: userMessage, language })
      })
      const data = await res.json()
      if (data.ready_to_fill && data.fill_value) {
        speak(data.reply || "Got it, filling that in now!")
      } else {
        speak(data.reply)
      }
    } catch {
      setBubble("⚠️ Backend error.")
      setState("idle")
    }
  }

  function handleMicClick() {
    if (state === "recording") {
      stopRecording()
    } else if (state === "idle") {
      startRecording()
    }
  }

  if (!visible) return null

  return (
    <div className="mascot-wrapper">
      {bubble && (
        <div className="bubble">
          <p>{bubble}</p>
          <button
            className={`mic-btn ${state === "recording" ? "recording" : ""}`}
            disabled={state === "thinking" || state === "speaking"}
            onClick={handleMicClick}>
            {state === "recording"
              ? "🔴 Stop"
              : state === "thinking"
                ? "⏳ Thinking..."
                : state === "speaking"
                  ? "🔊 Speaking..."
                  : "🎤 Speak"}
          </button>
          <select
            className="lang-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}>
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="zh">中文</option>
          </select>
        </div>
      )}
      <div
        className="face"
        onClick={() => {
          if (!visible) return
          if (!bubble) {
            startSession()
          } else {
            setBubble("")
          }
        }}>
        {state === "thinking" ? "🤔" : state === "recording" ? "🎙️" : state === "speaking" ? "🗣️" : "🤖"}
      </div>
    </div>
  )
}

export default Mascot
