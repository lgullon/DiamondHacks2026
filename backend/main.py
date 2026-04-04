from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import anthropic
import openai
import io
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="FormBuddy Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Tighten this for production
    allow_methods=["*"],
    allow_headers=["*"],
)

anthropic_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
openai_client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# ---------- Request/Response Models ----------

class FormField(BaseModel):
    id: str
    type: str
    label: Optional[str] = None
    options: Optional[list[str]] = None

class AnalyzeFormRequest(BaseModel):
    fields: list[FormField]
    language: str = "en"  # "en", "es", "zh"

class SimplifiedQuestion(BaseModel):
    id: str
    simplified: str

class AnalyzeFormResponse(BaseModel):
    questions: list[SimplifiedQuestion]

class ChatRequest(BaseModel):
    field_id: str
    field_label: Optional[str] = None
    field_type: Optional[str] = None
    field_options: Optional[list[str]] = None
    user_message: str
    language: str = "en"
    conversation_history: list[dict] = []

class ChatResponse(BaseModel):
    reply: str
    ready_to_fill: bool
    fill_value: Optional[str] = None

class FillFieldRequest(BaseModel):
    field_id: str
    value: str
    url: Optional[str] = None

class SpeakRequest(BaseModel):
    text: str
    language: str = "en"

# ---------- Language Helpers ----------

LANGUAGE_NAMES = {
    "en": "English",
    "es": "Spanish",
    "zh": "Mandarin Chinese",
}

# ---------- Routes ----------

@app.get("/")
def health_check():
    return {"status": "ok", "service": "FormBuddy Backend"}


@app.post("/analyze-form", response_model=AnalyzeFormResponse)
async def analyze_form(req: AnalyzeFormRequest):
    """
    Receives form fields and returns simplified, translated questions for each field.
    """
    lang_name = LANGUAGE_NAMES.get(req.language, "English")

    fields_description = "\n".join(
        f"- id: {f.id}, label: {f.label or f.id}, type: {f.type}"
        + (f", options: {f.options}" if f.options else "")
        for f in req.fields
    )

    prompt = f"""You are a helpful assistant for a medical form.
For each form field below, write a simplified, friendly question in {lang_name}.
CRITICAL: Every single word of every "simplified" value MUST be in {lang_name} only. Never use English or any other language unless {lang_name} is English.
Be concise and clear. If the field has options, mention them briefly.

Fields:
{fields_description}

Respond ONLY with a JSON array like:
[
  {{"id": "<field_id>", "simplified": "<simplified question written entirely in {lang_name}>"}},
  ...
]"""

    message = anthropic_client.messages.create(
        model="claude-opus-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )

    import json
    raw = message.content[0].text.strip()
    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    questions_data = json.loads(raw.strip())
    questions = [SimplifiedQuestion(**q) for q in questions_data]
    return AnalyzeFormResponse(questions=questions)


@app.post("/voice-input")
async def voice_input(audio: UploadFile = File(...)):
    """
    Receives an audio file and returns the transcribed text using OpenAI Whisper.
    """
    audio_bytes = await audio.read()
    audio_file = io.BytesIO(audio_bytes)
    audio_file.name = audio.filename or "audio.webm"

    transcription = openai_client.audio.transcriptions.create(
        model="whisper-1",
        file=audio_file,
    )
    return {"transcription": transcription.text}


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """
    Takes a user message in the context of a form field and returns:
    - A reply to speak/show the user
    - Whether the user has provided a final answer (ready_to_fill)
    - The value to fill into the form field (fill_value)
    """
    lang_name = LANGUAGE_NAMES.get(req.language, "English")

    options_hint = ""
    if req.field_options:
        options_hint = f"\nThe field has these options: {req.field_options}. When the user answers, fill_value must be one of these options."

    system_prompt = f"""You are FormBuddy, a kind and patient assistant helping someone fill out a form.
You are helping with the field: "{req.field_label or req.field_id}" (type: {req.field_type or "text"}).{options_hint}

CRITICAL LANGUAGE RULE: The "reply" field MUST be written entirely in {lang_name}. Every single word. Never mix in English or any other language unless {lang_name} is English. The user only understands {lang_name}.

Your job:
1. If the user's message is a clear answer to the field, set ready_to_fill=true and provide fill_value in plain English (suitable for the form).
2. If the user is asking a follow-up question or seems confused, answer helpfully and set ready_to_fill=false.
3. Keep replies short and friendly.
4. fill_value is always in English regardless of language (it goes into the form).

Always respond in this exact JSON format:
{{"reply": "<your response written entirely in {lang_name}>", "ready_to_fill": true/false, "fill_value": "<english value or null>"}}"""

    messages = req.conversation_history + [{"role": "user", "content": req.user_message}]

    message = anthropic_client.messages.create(
        model="claude-opus-4-6",
        max_tokens=512,
        system=system_prompt,
        messages=messages,
    )

    import json
    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    data = json.loads(raw.strip())
    return ChatResponse(**data)


@app.post("/fill-field")
async def fill_field(req: FillFieldRequest):
    """
    Uses Browser Use to fill a specific form field on the page.
    """
    try:
        from browser_use import Agent
        from langchain_anthropic import ChatAnthropic

        llm = ChatAnthropic(
            model="claude-opus-4-6",
            anthropic_api_key=os.getenv("ANTHROPIC_API_KEY"),
        )

        task = f"Fill the HTML form field with id '{req.field_id}' with the value '{req.value}'."
        if req.url:
            task = f"On the page at {req.url}, " + task

        agent = Agent(task=task, llm=llm)
        await agent.run()
        return {"success": True, "field_id": req.field_id, "value": req.value}
    except ImportError:
        raise HTTPException(status_code=500, detail="browser-use is not installed")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/speak")
async def speak(req: SpeakRequest):
    """
    Converts text to speech using OpenAI TTS and streams audio back.
    Uses 'nova' voice — clear and friendly for multilingual use.
    """
    response = openai_client.audio.speech.create(
        model="tts-1",
        voice="nova",  # options: alloy, echo, fable, onyx, nova, shimmer
        input=req.text,
        response_format="mp3",
    )

    audio_bytes = response.content

    return StreamingResponse(io.BytesIO(audio_bytes), media_type="audio/mpeg")
