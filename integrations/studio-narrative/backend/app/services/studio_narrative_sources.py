"""Narration is authoritative; video and old reproduction are references only."""
import hashlib
import json
import math
import mimetypes
import asyncio
import wave
from pathlib import Path
from sqlalchemy import select, desc
from app.db.models import Video, TTSAudio, VideoTranscript
from app.db.models_reproduction import CharacterBible, ReproductionPlan
from app.schemas.studio_story import canonical_hash


def resolve_narrative_audio_path(raw):
    root = Path(__file__).resolve().parents[2]
    text = str(raw or "").strip()
    if not text:
        raise ValueError("Chemin du fichier TTS manquant.")
    if text.startswith("/downloads/"):
        return (root / text.lstrip("/")).resolve()
    path = Path(text)
    return path.resolve() if path.is_absolute() else (root / path).resolve()


async def measure_audio_duration(path):
    if path.suffix.lower() == ".mp3":
        from app.services.studio_audio_duration import measure_mp3_duration
        return await asyncio.to_thread(measure_mp3_duration, path)
    try:
        with wave.open(str(path), "rb") as audio:
            return audio.getnframes() / audio.getframerate()
    except (wave.Error, EOFError):
        pass
    process = await asyncio.create_subprocess_exec("ffprobe", "-v", "error", "-show_entries",
        "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        output, error = await asyncio.wait_for(process.communicate(), timeout=30)
    except BaseException:
        if process.returncode is None:
            process.kill()
        await process.communicate()
        raise
    if process.returncode:
        raise ValueError("Impossible de mesurer le TTS avec ffprobe : " + error.decode("utf-8", "replace")[:300])
    return float(output.decode().strip())


def normalize_segments(raw, duration, fps=24):
    if not raw:
        raise ValueError("Transcription TTS horodatée manquante. Générer puis transcrire la narration.")
    if isinstance(raw, str):
        raw = json.loads(raw)
    if not isinstance(raw, (dict, list)):
        raise ValueError("Format de transcription TTS invalide.")
    items = raw if isinstance(raw, list) else (raw.get("segments") or raw.get("sentences") or [])
    segments = []
    previous_end = 0
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("Segment de transcription TTS invalide.")
        text = str(item.get("text") or item.get("sentence") or "").strip()
        if not text:
            continue
        start, end = float(item["start"]), float(item["end"])
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start:
            raise ValueError("Horodatage TTS invalide : refaire la transcription de cet audio.")
        if start < previous_end - 0.08 or end > duration + 0.15:
            raise ValueError("La transcription ne correspond pas à la durée de l'audio TTS.")
        segments.append({"index": len(segments), "startSeconds": max(0, start),
                         "endSeconds": min(duration, end), "text": text})
        if start >= duration:
            raise ValueError("Un segment TTS commence après la fin de l'audio.")
        previous_end = end
    if not segments:
        raise ValueError("Transcription TTS horodatée manquante. Générer puis transcrire la narration.")
    return segments


async def collect_narrative_sources(db, project_id, selected_tts_id=None):
    video = (await db.execute(select(Video).where(Video.video_id == project_id))).scalars().first()
    if not video:
        raise LookupError("Projet introuvable.")
    audios = (await db.execute(select(TTSAudio).where(TTSAudio.video_id == project_id)
                             .order_by(desc(TTSAudio.created_at)))).scalars().all()
    plan = (await db.execute(select(ReproductionPlan).where(ReproductionPlan.video_id == project_id))).scalars().first()
    plan_data = plan.plan_data if plan and isinstance(plan.plan_data, dict) else {}
    aligned_id = plan.tts_audio_id if plan else None
    chosen_id = selected_tts_id if selected_tts_id is not None else aligned_id
    tts = next((a for a in audios if a.id == chosen_id), None) if chosen_id else next((a for a in audios if a.transcript), None)
    if not tts:
        raise ValueError("Sélectionner un audio TTS transcrit pour commencer le récit 3D.")
    path = resolve_narrative_audio_path(tts.audio_path)
    if not path.is_file():
        raise ValueError("Fichier TTS absent. Régénérer l'audio avant l'analyse 3D.")
    try:
        duration = await measure_audio_duration(path)
    except Exception as exc:
        raise ValueError("Impossible de mesurer le fichier TTS.") from exc
    if not 0 < duration <= 1200:
        raise ValueError("Le Studio accepte actuellement une narration de 20 minutes maximum.")
    segments = normalize_segments(tts.transcript, duration)
    bible = (await db.execute(select(CharacterBible).where(CharacterBible.video_id == project_id))).scalars().first()
    transcripts = (await db.execute(select(VideoTranscript).where(VideoTranscript.video_id == project_id)
                                   .order_by(desc(VideoTranscript.updated_at)))).scalars().all()
    hasher = hashlib.sha256()
    with path.open("rb") as audio_file:
        while chunk := audio_file.read(65536):
            hasher.update(chunk)
    audio_hash = hasher.hexdigest()
    source = {"projectId": project_id, "title": video.title or video.title_fr or project_id,
              "selectedTtsId": tts.id, "audioHash": audio_hash, "audioPath": str(path),
              "audioByteSize": path.stat().st_size, "durationSeconds": duration,
              "audioMimeType": mimetypes.guess_type(str(path))[0] or "application/octet-stream",
              "frameCount": math.ceil(duration * 24), "fps": 24, "segments": segments,
              "narrationText": " ".join(s["text"] for s in segments),
              "visualReferences": {"bible": bible.analysis if bible else {},
                                   "reproduction": plan_data,
                                   "sourceTranscript": transcripts[0].transcript if transcripts else None},
              "policy": "final-tts-authoritative; source-video-reference; simple-functional-sets"}
    source["sourceFingerprint"] = canonical_hash(source)
    source["ttsOptions"] = [{"id": a.id, "voice": a.voice_id, "durationSeconds": a.duration_seconds,
                              "transcribed": bool(a.transcript)} for a in audios]
    return source
