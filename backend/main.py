import logging
import math
import os
import re

import anthropic
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from googleapiclient.discovery import build
from pydantic import BaseModel
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import TranscriptsDisabled, NoTranscriptFound

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

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

# Trusted educational channels (channel name substrings, lowercase)
TRUSTED_CHANNELS = {
    "khan academy",
    "mit opencourseware",
    "crash course",
    "ted-ed",
    "ted ed",
    "3blue1brown",
    "veritasium",
    "numberphile",
    "computerphile",
    "professor leonard",
    "organic chemistry tutor",
    "patrickjmt",
    "blackpenredpen",
    "vsauce",
    "kurzgesagt",
    "minutephysics",
    "scishow",
    "harvard university",
    "stanford university",
    "mit",
    "yale courses",
}


def score_video(view_count: int, subscriber_count: int, channel_name: str) -> float:
    """Score a video based on views, subscribers, and channel trustworthiness."""
    trusted_bonus = 1.5 if any(t in channel_name.lower() for t in TRUSTED_CHANNELS) else 1.0
    # Log-scale so one viral video doesn't dominate; weights: subscribers > views
    view_score = math.log10(view_count + 1)
    sub_score = math.log10(subscriber_count + 1) * 2
    return (view_score + sub_score) * trusted_bonus


def parse_iso8601_duration(duration: str) -> int:
    """Convert ISO 8601 duration (e.g. PT4M13S) to total seconds."""
    match = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration)
    if not match:
        return 0
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)
    return hours * 3600 + minutes * 60 + seconds


def enrich_with_stats(youtube, items: list, min_duration_seconds: int = 120) -> list:
    """Attach viewCount, subscriberCount, and duration; drop videos that are too short."""
    if not items:
        return items

    video_ids = [item["id"]["videoId"] for item in items]
    channel_ids = [item["snippet"]["channelId"] for item in items]

    # Fetch video statistics + duration in one call
    videos_resp = (
        youtube.videos()
        .list(part="statistics,contentDetails", id=",".join(video_ids))
        .execute()
    )
    video_data = {v["id"]: v for v in videos_resp.get("items", [])}

    # Fetch channel statistics
    channels_resp = (
        youtube.channels()
        .list(part="statistics", id=",".join(set(channel_ids)))
        .execute()
    )
    channel_stats = {c["id"]: c["statistics"] for c in channels_resp.get("items", [])}

    enriched = []
    for item in items:
        vid_id = item["id"]["videoId"]
        ch_id = item["snippet"]["channelId"]
        vdata = video_data.get(vid_id, {})
        vstats = vdata.get("statistics", {})
        cstats = channel_stats.get(ch_id, {})

        duration_str = vdata.get("contentDetails", {}).get("duration", "PT0S")
        duration_secs = parse_iso8601_duration(duration_str)

        # Drop videos shorter than the minimum duration
        if duration_secs < min_duration_seconds:
            continue

        item["_view_count"] = int(vstats.get("viewCount", 0))
        item["_subscriber_count"] = int(cstats.get("subscriberCount", 0))
        item["_score"] = score_video(
            item["_view_count"],
            item["_subscriber_count"],
            item["snippet"]["channelTitle"],
        )
        enriched.append(item)

    return enriched


def generate_search_query(text: str) -> str:
    """Use Claude to distill highlighted text into a focused YouTube search query."""
    message = claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=32,
        temperature=0,
        messages=[
            {
                "role": "user",
                "content": (
                    "A student highlighted this passage from a textbook:\n"
                    f'"{text}"\n\n'
                    "Write a short YouTube search query (5 words max) that will find an "
                    "educational video explaining the main concept in this passage. "
                    "Return ONLY the search query, nothing else."
                ),
            }
        ],
    )
    return message.content[0].text.strip()


def search_youtube(query: str, max_results: int = 10):
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
            videoDuration="medium",  # 4–20 min; excludes shorts and extremely long lectures
        )
        .execute()
    )
    items = resp.get("items", [])
    items = enrich_with_stats(youtube, items)
    # Sort by composite score descending
    items.sort(key=lambda x: x.get("_score", 0), reverse=True)
    return items


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
        temperature=0,
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


class NotesRequest(BaseModel):
    text: str
    video_id: str


@app.post("/api/notes")
def get_notes(body: NotesRequest):
    transcript = fetch_transcript(body.video_id)

    transcript_section = ""
    if transcript:
        transcript_text = " ".join(e["text"] for e in transcript[:400])
        transcript_section = f"\n\nHere is the transcript of an educational video on this topic:\n{transcript_text}"

    message = claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=512,
        temperature=0,
        messages=[
            {
                "role": "user",
                "content": (
                    f'A student highlighted this passage from their textbook:\n"{body.text}"'
                    f"{transcript_section}\n\n"
                    "Write concise bullet points that summarize the key concepts from the passage "
                    "and fill in any gaps or clarifications using the video transcript where helpful. "
                    "Return ONLY the bullet points, one per line, each starting with '•'. No headers."
                ),
            }
        ],
    )
    raw = message.content[0].text.strip()
    bullets = [line.lstrip("•–-* ").strip() for line in raw.splitlines() if line.strip()]
    return {"bullets": bullets}


@app.get("/")
def health():
    logger.info("Health check hit")
    return {"status": "ok", "service": "SmartCookie"}


class FindVideoRequest(BaseModel):
    text: str


@app.post("/api/find-video")
def find_video(body: FindVideoRequest):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    logger.info(f"find-video request | text: {text[:80]!r}")

    search_query = generate_search_query(text)
    logger.info(f"Generated search query: {search_query!r}")

    items = search_youtube(search_query)
    logger.info(f"YouTube search returned {len(items)} results")
    if not items:
        raise HTTPException(status_code=404, detail="No videos found")

    results = []
    for item in items:
        if len(results) >= 5:
            break
        vid_id = item["id"]["videoId"]
        title = item["snippet"]["title"]
        channel = item["snippet"]["channelTitle"]
        logger.info(f"Processing: {vid_id} | {title!r}")
        transcript = fetch_transcript(vid_id)
        start = 0
        if transcript:
            logger.info(f"Transcript found ({len(transcript)} entries), finding timestamp")
            start = best_timestamp(text, transcript)
            logger.info(f"Best timestamp: {start}s")
        else:
            logger.info(f"No transcript for {vid_id}")
        embed_url = f"https://www.youtube.com/embed/{vid_id}?start={start}&autoplay=1&rel=0"
        results.append({"embed_url": embed_url, "title": title, "channel": channel})

    if not results:
        raise HTTPException(status_code=404, detail="No videos found")

    logger.info(f"Returning {len(results)} videos")
    return {"videos": results}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=5001, log_level="info")
