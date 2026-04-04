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

// --- Translated UI strings ---
const UI = {
  en: {
    listening: "Listening... tap again to stop.",
    thinking: "Got it, thinking...",
    btnStop: "🔴 Stop",
    btnThinking: "⏳ Thinking...",
    btnSpeaking: "🔊 Speaking...",
    btnSpeak: "🎤 Speak",
    fieldOf: (i: number, t: number) => `Field ${i} of ${t}`,
    done: "All done! Please review your answers and submit the form.",
    noFields: "I don't see any form fields on this page.",
    reading: "Reading the form...",
    noBackend: "⚠️ Can't reach the backend. Make sure it's running on port 8000.",
    noTranscribe: "⚠️ Couldn't transcribe. Try again.",
    backendError: "⚠️ Backend error.",
  },
  es: {
    listening: "Escuchando... toca de nuevo para parar.",
    thinking: "Entendido, pensando...",
    btnStop: "🔴 Parar",
    btnThinking: "⏳ Pensando...",
    btnSpeaking: "🔊 Hablando...",
    btnSpeak: "🎤 Hablar",
    fieldOf: (i: number, t: number) => `Campo ${i} de ${t}`,
    done: "¡Listo! Por favor revisa tus respuestas y envía el formulario.",
    noFields: "No veo ningún campo de formulario en esta página.",
    reading: "Leyendo el formulario...",
    noBackend: "⚠️ No puedo conectar al servidor. Asegúrate de que esté en el puerto 8000.",
    noTranscribe: "⚠️ No pude transcribir. Intenta de nuevo.",
    backendError: "⚠️ Error del servidor.",
  },
  zh: {
    listening: "正在聆听……再次点击停止。",
    thinking: "好的，正在思考……",
    btnStop: "🔴 停止",
    btnThinking: "⏳ 思考中……",
    btnSpeaking: "🔊 播放中……",
    btnSpeak: "🎤 说话",
    fieldOf: (i: number, t: number) => `第 ${i} / ${t} 项`,
    done: "全部完成！请检查您的答案并提交表单。",
    noFields: "此页面上没有找到表单字段。",
    reading: "正在读取表单……",
    noBackend: "⚠️ 无法连接到服务器，请确保其在端口 8000 上运行。",
    noTranscribe: "⚠️ 无法转录，请重试。",
    backendError: "⚠️ 服务器错误。",
  },
} as const

type LangCode = keyof typeof UI

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

function fillFieldInDOM(fieldId: string, value: string): boolean {
  const el = document.getElementById(fieldId) as HTMLInputElement | HTMLSelectElement | null
  if (!el) return false

  if (el.tagName === "SELECT") {
    const select = el as HTMLSelectElement
    const lower = value.toLowerCase()
    for (const opt of Array.from(select.options)) {
      if (opt.value.toLowerCase() === lower || opt.text.toLowerCase().includes(lower)) {
        select.value = opt.value
        select.dispatchEvent(new Event("change", { bubbles: true }))
        return true
      }
    }
  } else if ((el as HTMLInputElement).type === "radio") {
    const name = (el as HTMLInputElement).name
    const radios = document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`)
    for (const radio of Array.from(radios)) {
      if (
        radio.value.toLowerCase() === value.toLowerCase() ||
        radio.parentElement?.textContent?.toLowerCase().includes(value.toLowerCase())
      ) {
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
  const [language, setLanguage] = useState<LangCode>("en")

  const questionsRef = useRef<Question[]>([])
  const fieldsRef = useRef<FormField[]>([])
  const currentIndexRef = useRef(0)
  const historyRef = useRef<{ role: string; content: string }[]>([])
  // sessionLang is locked when a session starts — never drifts mid-session
  const sessionLangRef = useRef<LangCode>("en")
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  useEffect(() => {
    const chromeHandler = (msg: any) => {
      if (msg.type === "START_FORMBUDDY") {
        setVisible(true)
        // Read the select element directly — the most reliable source of truth
        const select = document.querySelector(".lang-select") as HTMLSelectElement | null
        const lang = (select?.value as LangCode) || language
        startSession(lang)
      }
    }
    chrome.runtime.onMessage.addListener(chromeHandler)
    return () => chrome.runtime.onMessage.removeListener(chromeHandler)
  }, [language])

  // Every function that talks to the backend receives `lang` as an explicit argument.
  // No ref reads, no closure captures — the value is always exactly what was passed in.

  async function startSession(lang: LangCode) {
    sessionLangRef.current = lang          // lock for this session
    questionsRef.current = []
    fieldsRef.current = []
    currentIndexRef.current = 0
    historyRef.current = []

    const fields = readFormFields()
    if (fields.length === 0) {
      setBubble(UI[lang].noFields)
      return
    }
    fieldsRef.current = fields
    setBubble(UI[lang].reading)
    setState("thinking")

    try {
      const res = await fetch(`${BACKEND}/analyze-form`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields, language: lang })
      })
      const data = await res.json()
      questionsRef.current = data.questions || []
      currentIndexRef.current = 0
      askCurrentQuestion(lang)
    } catch {
      setBubble(UI[lang].noBackend)
      setState("idle")
    }
  }

  function askCurrentQuestion(lang: LangCode) {
    const questions = questionsRef.current
    const idx = currentIndexRef.current
    if (idx >= questions.length) {
      const doneMsg = UI[lang].done
      setBubble(doneMsg)
      speakText(doneMsg, lang)
      return
    }
    historyRef.current = []
    const q = questions[idx]
    const total = questions.length
    setBubble(`${UI[lang].fieldOf(idx + 1, total)}\n${q.simplified}`)
    speakText(q.simplified, lang)
  }

  // Returns a Promise that resolves only after audio finishes — prevents overlap
  function speakText(text: string, lang: LangCode): Promise<void> {
    setState("speaking")
    return new Promise((resolve) => {
      fetch(`${BACKEND}/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language: lang })
      })
        .then((res) => res.blob())
        .then((blob) => {
          const url = URL.createObjectURL(blob)
          const audio = new Audio(url)
          audio.onended = () => { setState("idle"); resolve() }
          audio.onerror  = () => { setState("idle"); resolve() }
          audio.play()
        })
        .catch(() => {
          const utterance = new SpeechSynthesisUtterance(text)
          utterance.lang = lang === "es" ? "es-ES" : lang === "zh" ? "zh-CN" : "en-US"
          utterance.onend  = () => { setState("idle"); resolve() }
          utterance.onerror = () => { setState("idle"); resolve() }
          window.speechSynthesis.speak(utterance)
        })
    })
  }

  async function startRecording() {
    const lang = sessionLangRef.current
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    chunksRef.current = []
    const mr = new MediaRecorder(stream)
    mediaRecorderRef.current = mr
    mr.ondataavailable = (e) => chunksRef.current.push(e.data)
    mr.onstop = async () => {
      stream.getTracks().forEach((trk) => trk.stop())
      const blob = new Blob(chunksRef.current, { type: "audio/webm" })
      await sendAudio(blob, lang)
    }
    mr.start()
    setState("recording")
    setBubble(UI[lang].listening)
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop()
    setState("thinking")
    setBubble(UI[sessionLangRef.current].thinking)
  }

  async function sendAudio(blob: Blob, lang: LangCode) {
    const form = new FormData()
    form.append("audio", blob, "audio.webm")
    try {
      const res = await fetch(`${BACKEND}/voice-input`, { method: "POST", body: form })
      const { transcription } = await res.json()
      await sendChat(transcription, lang)
    } catch {
      setBubble(UI[lang].noTranscribe)
      setState("idle")
    }
  }

  async function sendChat(userMessage: string, lang: LangCode) {
    setState("thinking")
    const questions = questionsRef.current
    const fields = fieldsRef.current
    const idx = currentIndexRef.current
    const currentQuestion = questions[idx]
    const currentField = fields.find((f) => f.id === currentQuestion?.id)

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
          language: lang,
          conversation_history: historyRef.current.slice(0, -1)
        })
      })
      const data = await res.json()

      historyRef.current = [...historyRef.current, { role: "assistant", content: data.reply }]

      if (data.ready_to_fill && data.fill_value && currentQuestion) {
        fillFieldInDOM(currentQuestion.id, data.fill_value)
        setBubble(data.reply)
        await speakText(data.reply, lang)   // wait for audio, then next question
        currentIndexRef.current += 1
        askCurrentQuestion(lang)
      } else {
        setBubble(data.reply)
        speakText(data.reply, lang)
      }
    } catch {
      setBubble(UI[lang].backendError)
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
  const ui = UI[language]

  return (
    <div className="mascot-wrapper">
      {bubble && (
        <div className="bubble">
          {total > 0 && (
            <div className="progress">{ui.fieldOf(Math.min(idx + 1, total), total)}</div>
          )}
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{bubble}</p>
          <button
            className={`mic-btn ${state === "recording" ? "recording" : ""}`}
            disabled={state === "thinking" || state === "speaking"}
            onClick={handleMicClick}>
            {state === "recording"
              ? ui.btnStop
              : state === "thinking"
                ? ui.btnThinking
                : state === "speaking"
                  ? ui.btnSpeaking
                  : ui.btnSpeak}
          </button>
          <select
            className="lang-select"
            value={language}
            onChange={(e) => {
              const newLang = e.target.value as LangCode
              setLanguage(newLang)
              sessionLangRef.current = newLang
              // If a session is already running, restart it in the new language
              if (questionsRef.current.length > 0 || fieldsRef.current.length > 0) {
                startSession(newLang)
              }
            }}>
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="zh">中文</option>
          </select>
        </div>
      )}
      <div
        className="face"
        onClick={() => {
          if (!bubble) startSession(language)
          else setBubble("")
        }}>
        {state === "thinking" ? "🤔" : state === "recording" ? "🎙️" : state === "speaking" ? "🗣️" : "🤖"}
      </div>
    </div>
  )
}

export default Mascot
