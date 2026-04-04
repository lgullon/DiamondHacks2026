import type { PlasmoCSConfig } from "plasmo"
import { useEffect, useRef, useState } from "react"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"]
}

export const getStyle = () => {
  const style = document.createElement("style")
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
    .progress {
      font-size: 11px;
      color: #7c3aed;
      font-weight: 600;
      margin-bottom: 6px;
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
    .mic-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
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
    .face {
      font-size: 48px;
      cursor: pointer;
      user-select: none;
      text-align: right;
    }
  `
  return style
}

const BACKEND = "http://localhost:8000"

type State = "idle" | "recording" | "thinking" | "speaking"

interface FormField {
  id: string
  type: string
  label: string | null
  options: string[] | null
}

interface Question {
  id: string
  simplified: string
}

function readFormFields(): FormField[] {
  const fields = document.querySelectorAll("input, select, textarea")
  return Array.from(fields)
    .filter((el) => {
      const input = el as HTMLInputElement
      return input.type !== "hidden" && input.type !== "submit" && input.type !== "button"
    })
    .map((el) => {
      const input = el as HTMLInputElement | HTMLSelectElement
      const labelEl = input.id
        ? document.querySelector(`label[for="${input.id}"]`)
        : null
      return {
        id: input.id || input.name || Math.random().toString(36).slice(2),
        type: input.tagName === "SELECT" ? "select" : (input as HTMLInputElement).type || "text",
        label: labelEl?.textContent?.trim() || input.getAttribute("placeholder") || input.name || input.id,
        options:
          input.tagName === "SELECT"
            ? Array.from((input as HTMLSelectElement).options)
                .filter((o) => o.value)
                .map((o) => o.text)
            : null
      }
    })
    .filter((f) => f.label)
}

// Fill a field directly in the DOM
function fillFieldInDOM(fieldId: string, value: string): boolean {
  const el = document.getElementById(fieldId) as HTMLInputElement | HTMLSelectElement | null
  if (!el) return false

  if (el.tagName === "SELECT") {
    // Match by value or text (case-insensitive)
    const select = el as HTMLSelectElement
    const lower = value.toLowerCase()
    for (const opt of Array.from(select.options)) {
      if (opt.value.toLowerCase() === lower || opt.text.toLowerCase().includes(lower)) {
        select.value = opt.value
        select.dispatchEvent(new Event("change", { bubbles: true }))
        return true
      }
    }
  } else if (el.getAttribute("type") === "radio") {
    // Radio: find the radio in the group matching the value
    const radios = document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${(el as HTMLInputElement).name}"]`)
    for (const radio of Array.from(radios)) {
      if (radio.value.toLowerCase() === value.toLowerCase() || radio.parentElement?.textContent?.toLowerCase().includes(value.toLowerCase())) {
        radio.checked = true
        radio.dispatchEvent(new Event("change", { bubbles: true }))
        return true
      }
    }
  } else {
    (el as HTMLInputElement).value = value
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  }
  return false
}

function Mascot() {
  const [visible, setVisible] = useState(false)
  const [state, setState] = useState<State>("idle")
  const [bubble, setBubble] = useState("")
  const [language, setLanguage] = useState("en")

  // Session state
  const questionsRef = useRef<Question[]>([])
  const fieldsRef = useRef<FormField[]>([])
  const currentIndexRef = useRef(0)
  const historyRef = useRef<{ role: string; content: string }[]>([])

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  useEffect(() => {
    const chromeHandler = (msg: any) => {
      if (msg.type === "START_FORMBUDDY") {
        setVisible(true)
        startSession()
      }
    }
    chrome.runtime.onMessage.addListener(chromeHandler)
    return () => chrome.runtime.onMessage.removeListener(chromeHandler)
  }, [language])

  async function startSession() {
    // Reset session
    questionsRef.current = []
    fieldsRef.current = []
    currentIndexRef.current = 0
    historyRef.current = []

    const fields = readFormFields()
    if (fields.length === 0) {
      setBubble("I don't see any form fields on this page.")
      return
    }
    fieldsRef.current = fields
    setBubble("Reading the form...")
    setState("thinking")

    try {
      const res = await fetch(`${BACKEND}/analyze-form`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields, language })
      })
      const data = await res.json()
      questionsRef.current = data.questions || []
      currentIndexRef.current = 0
      askCurrentQuestion()
    } catch {
      setBubble("⚠️ Can't reach the backend. Make sure it's running on port 8000.")
      setState("idle")
    }
  }

  function askCurrentQuestion() {
    const questions = questionsRef.current
    const idx = currentIndexRef.current
    if (idx >= questions.length) {
      speak("All done! Please review your answers and submit the form.")
      return
    }
    historyRef.current = [] // fresh conversation history per field
    const q = questions[idx]
    const total = questions.length
    setBubble(`(${idx + 1}/${total}) ${q.simplified}`)
    speakText(q.simplified)
  }

  async function speakText(text: string) {
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
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = language === "es" ? "es-ES" : language === "zh" ? "zh-CN" : "en-US"
      utterance.onend = () => setState("idle")
      window.speechSynthesis.speak(utterance)
    }
  }

  function speak(text: string) {
    setBubble(text)
    speakText(text)
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
    try {
      const res = await fetch(`${BACKEND}/voice-input`, { method: "POST", body: form })
      const { transcription } = await res.json()
      await sendChat(transcription)
    } catch {
      setBubble("⚠️ Couldn't transcribe. Try again.")
      setState("idle")
    }
  }

  async function sendChat(userMessage: string) {
    setState("thinking")
    const questions = questionsRef.current
    const fields = fieldsRef.current
    const idx = currentIndexRef.current
    const currentQuestion = questions[idx]
    const currentField = fields.find((f) => f.id === currentQuestion?.id)

    // Add user message to history
    historyRef.current = [...historyRef.current, { role: "user", content: userMessage }]

    try {
      const res = await fetch(`${BACKEND}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field_id: currentQuestion?.id || "unknown",
          field_label: currentField?.label,
          field_type: currentField?.type,
          field_options: currentField?.options,
          user_message: userMessage,
          language,
          conversation_history: historyRef.current.slice(0, -1) // all but the last (just added)
        })
      })
      const data = await res.json()

      // Add assistant reply to history
      historyRef.current = [...historyRef.current, { role: "assistant", content: data.reply }]

      if (data.ready_to_fill && data.fill_value && currentQuestion) {
        // Fill the field directly in the DOM
        fillFieldInDOM(currentQuestion.id, data.fill_value)
        speak(data.reply || "Got it, filled that in!")
        // Move to next question after a short pause
        setTimeout(() => {
          currentIndexRef.current += 1
          askCurrentQuestion()
        }, 2000)
      } else {
        speak(data.reply)
      }
    } catch {
      setBubble("⚠️ Backend error.")
      setState("idle")
    }
  }

  function handleMicClick() {
    if (state === "recording") stopRecording()
    else if (state === "idle") startRecording()
  }

  if (!visible) return null

  const idx = currentIndexRef.current
  const total = questionsRef.current.length

  return (
    <div className="mascot-wrapper">
      {bubble && (
        <div className="bubble">
          {total > 0 && (
            <div className="progress">
              Field {Math.min(idx + 1, total)} of {total}
            </div>
          )}
          <p style={{ margin: 0 }}>{bubble}</p>
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
          if (!bubble) startSession()
          else setBubble("")
        }}>
        {state === "thinking" ? "🤔" : state === "recording" ? "🎙️" : state === "speaking" ? "🗣️" : "🤖"}
      </div>
    </div>
  )
}

export default Mascot
