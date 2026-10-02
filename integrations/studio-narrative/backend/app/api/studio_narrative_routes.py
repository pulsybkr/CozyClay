"""Dedicated narrative planning API; immutable publication remains in Studio v1 API."""
import uuid
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Header
from sqlalchemy import select, desc
from sqlalchemy.exc import IntegrityError
from app.core.studio_access import verify_studio_token
from app.db.database import get_db
from app.db.models import Video, TTSAudio
from app.db.models_studio import StudioPreparationJob, StudioPreparationRequest, StudioStoryDraft
from app.schemas.studio_narrative import NarrativeRequest
from app.schemas.studio_story import canonical_hash
from app.services.llm_factory import default_llm_model
from app.services.studio_narrative_sources import collect_narrative_sources
from app.services.studio_preparation_worker import run_job_isolated

router = APIRouter(prefix="/api/studio/v2", tags=["Récit 3D"])


@router.get("/projects/{project_id}/sources")
async def narrative_sources(project_id: str, selectedTtsId: int | None = None,
                            db=Depends(get_db), _token=Depends(verify_studio_token)):
    video = (await db.execute(select(Video).where(Video.video_id == project_id))).scalars().first()
    if not video:
        raise HTTPException(404, detail={"code": "PROJECT_NOT_FOUND", "message": "Projet introuvable."})
    audios = (await db.execute(select(TTSAudio).where(TTSAudio.video_id == project_id).order_by(desc(TTSAudio.created_at)))).scalars().all()
    draft = (await db.execute(select(StudioStoryDraft).where(StudioStoryDraft.video_id == project_id))).scalars().first()
    meta = {"title": video.title or project_id, "defaultModel": default_llm_model(),
            "draftVersion": draft.draft_version if draft else None,
            "ttsOptions": [{"id": a.id, "voice": a.voice_id, "durationSeconds": a.duration_seconds, "transcribed": bool(a.transcript)} for a in audios],
            "limits": {"durationSeconds": 1200, "scenes": 32, "characters": 32, "sets": 32, "shots": 256}}
    try:
        source = await collect_narrative_sources(db, project_id, selectedTtsId)
        # Local filesystem paths are private implementation details.
        source.pop("audioPath", None)
        return {**meta, **source, "canAnalyse": True}
    except (ValueError, TypeError, KeyError, OSError) as exc:
        return {**meta, "canAnalyse": False, "message": str(exc)}


@router.get("/projects/{project_id}/analyses")
async def narrative_history(project_id: str, db=Depends(get_db), _token=Depends(verify_studio_token)):
    jobs = (await db.execute(select(StudioPreparationJob).where(StudioPreparationJob.project_id == project_id)
                            .order_by(desc(StudioPreparationJob.created_at)).limit(100))).scalars().all()
    return {"analyses": [{"id": j.id, "status": j.status, "stage": j.stage, "model": j.model,
                          "selectedTtsId": j.source_bundle.get("selectedTtsId"),
                          "instructions": j.config.get("instructions", ""), "candidateVersion": j.candidate_version,
                          "createdAt": j.created_at.isoformat()} for j in jobs if j.config.get("pipeline") == "narrative-v2"]}


@router.post("/projects/{project_id}/analyses", status_code=202)
async def create_narrative_analysis(project_id: str, payload: NarrativeRequest, background_tasks: BackgroundTasks,
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=1, max_length=128),
    db=Depends(get_db), _token=Depends(verify_studio_token)):
    identity = "studio_narrative"
    request_hash = canonical_hash(payload.model_dump())
    existing = (await db.execute(select(StudioPreparationRequest).where(
        StudioPreparationRequest.project_id == project_id, StudioPreparationRequest.identity == identity,
        StudioPreparationRequest.idempotency_key == idempotency_key))).scalars().first()
    if existing:
        if existing.request_hash != request_hash:
            raise HTTPException(409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "Clé déjà utilisée pour une autre analyse."})
        return {"preparationId": existing.job_id, "replayed": True}
    try:
        source = await collect_narrative_sources(db, project_id, payload.selectedTtsId)
    except LookupError as exc:
        raise HTTPException(404, detail={"code": "PROJECT_NOT_FOUND", "message": str(exc)}) from exc
    except (ValueError, TypeError, KeyError, OSError) as exc:
        raise HTTPException(422, detail={"code": "NARRATION_NOT_READY", "message": str(exc)}) from exc
    if source["sourceFingerprint"] != payload.expectedSourceFingerprint:
        raise HTTPException(409, detail={"code": "SOURCE_CHANGED", "message": "La narration ou les références ont changé. Actualiser les sources."})
    draft = (await db.execute(select(StudioStoryDraft).where(StudioStoryDraft.video_id == project_id))).scalars().first()
    actual_version = draft.draft_version if draft else None
    if payload.expectedDraftVersion != actual_version:
        raise HTTPException(409, detail={"code": "DRAFT_VERSION_CONFLICT", "message": "Le brouillon a changé. Actualiser la page."})
    if payload.parentJobId:
        parent = (await db.execute(select(StudioPreparationJob).where(StudioPreparationJob.id == payload.parentJobId,
                                                                    StudioPreparationJob.project_id == project_id))).scalars().first()
        if not parent or parent.config.get("pipeline") != "narrative-v2":
            raise HTTPException(404, detail={"code": "ANALYSIS_NOT_FOUND", "message": "Analyse parente introuvable."})
        if parent.source_fingerprint != source["sourceFingerprint"]:
            raise HTTPException(409, detail={"code": "SOURCE_CHANGED", "message": "Les checkpoints appartiennent à une autre source. Lancer une analyse complète."})
    elif payload.fromSceneId:
        raise HTTPException(422, detail={"code": "PARENT_REQUIRED", "message": "Une réanalyse ciblée exige une analyse parente."})
    job_id = "story_" + uuid.uuid4().hex[:12]
    job = StudioPreparationJob(id=job_id, project_id=project_id, parent_job_id=payload.parentJobId,
        source_bundle=source, source_fingerprint=source["sourceFingerprint"], base_draft_version=actual_version,
        candidate_version=0, status="queued", stage="outline", scope={"fromSceneId": payload.fromSceneId},
        prompt_pack_version="narrative-v2", provider=payload.provider or "", model=payload.model or default_llm_model(),
        capabilities_hash=canonical_hash({"schema": "cozy-story-v2", "motion": "directives-only"}),
        config={"pipeline": "narrative-v2", "instructions": payload.instructions, "fromSceneId": payload.fromSceneId,
                "maxCalls": payload.maxCalls, "maxOutputTokens": payload.maxOutputTokens}, usage={"calls": 0, "estimatedTokens": 0})
    db.add(job)
    db.add(StudioPreparationRequest(identity=identity, project_id=project_id, idempotency_key=idempotency_key,
                                   request_hash=request_hash, job_id=job_id))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = (await db.execute(select(StudioPreparationRequest).where(
            StudioPreparationRequest.project_id == project_id, StudioPreparationRequest.identity == identity,
            StudioPreparationRequest.idempotency_key == idempotency_key))).scalars().first()
        if not existing or existing.request_hash != request_hash:
            raise HTTPException(409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "Lancement concurrent incompatible."})
        return {"preparationId": existing.job_id, "replayed": True}
    background_tasks.add_task(run_job_isolated, job_id)
    return {"preparationId": job_id, "sourceFingerprint": source["sourceFingerprint"]}
