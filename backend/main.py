import os

import anthropic
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from googleapiclient.discovery import build
from pydantic import BaseModel
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import TranscriptsDisabled, NoTranscriptFound

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)


def search_youtube(query: str, max_results: int = 5):
    youtube = build("youtube", "v3", developerKey=YOUTUBE_API_KEY)
    resp = (
        youtube.search()
        .list(
            q=query,
            part="snippet",
            type="video",
            maxResults=max_results,
            relevanceLanguage="en",
            safeSearch="strict",
        )
        .execute()
    )
    return resp.get("items", [])


def fetch_transcript(video_id: str):
    try:
        return YouTubeTranscriptApi.get_transcript(video_id)
    except (TranscriptsDisabled, NoTranscriptFound):
        return None
    except Exception:
        return None


def best_timestamp(text: str, transcript: list) -> int:
    entries = transcript[:300]
    transcript_text = "\n".join(
        f"[{int(e['start'])}s] {e['text']}" for e in entries
    )
    message = claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=16,
        messages=[
            {
                "role": "user",
                "content": (
                    f'A student highlighted this passage from their textbook:\n"{text}"\n\n'
                    f"Here is a YouTube video transcript with timestamps:\n{transcript_text}\n\n"
                    "Return ONLY a single integer: the number of seconds where the video best "
                    "starts explaining the concept from the highlighted text. No other text."
                ),
            }
        ],
    )
    try:
        return max(0, int(message.content[0].text.strip()))
    except (ValueError, IndexError):
        return 0


@app.get("/")
def health():
    return {"status": "ok", "service": "TextTutor"}


class FindVideoRequest(BaseModel):
    text: str


@app.post("/api/find-video")
def find_video(body: FindVideoRequest):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    search_query = f"{text} explained educational tutorial"
    items = search_youtube(search_query)
    if not items:
        raise HTTPException(status_code=404, detail="No videos found")

    chosen_id = None
    chosen_title = None
    chosen_channel = None
    transcript = None

    for item in items:
        vid_id = item["id"]["videoId"]
        t = fetch_transcript(vid_id)
        if t:
            chosen_id = vid_id
            chosen_title = item["snippet"]["title"]
            chosen_channel = item["snippet"]["channelTitle"]
            transcript = t
            break

    if chosen_id is None:
        item = items[0]
        chosen_id = item["id"]["videoId"]
        chosen_title = item["snippet"]["title"]
        chosen_channel = item["snippet"]["channelTitle"]

    start = 0
    if transcript:
        start = best_timestamp(text, transcript)

    embed_url = f"https://www.youtube.com/embed/{chosen_id}?start={start}&autoplay=1&rel=0"
    return {"embed_url": embed_url, "title": chosen_title, "channel": chosen_channel}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=5001)
