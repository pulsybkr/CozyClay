"""FastAPI router for CozyStory v1 (Studio 3D) export, publication, draft preparation and consultation."""

from datetime import datetime
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional
import uuid
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Response, status
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import desc, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.studio_access import verify_studio_token
from app.db.database import get_db
from app.db.models import Video
from app.db.models_studio import (
    StudioPreparationCandidate,
    StudioPreparationEvent,
    StudioPreparationJob,
    StudioPreparationRequest,
    StudioPreparationStep,
    StudioStoryDraft,
)
from app.schemas.studio_preparation import (
    PreparationApplyRequest,
    PreparationBudget,
    PreparationCreateRequest,
    PreparationDecisionUpdateRequest,
)
from app.services.llm_factory import get_llm_service
from app.schemas.studio_story import (
    SCHEMA_VERSION,
    SOURCE_SECTIONS,
    SectionPage,
    StudioManifest,
    StudioSnapshot,
    SUPPORTED_SCHEMA_VERSIONS,
    canonical_hash,
)
from app.services.studio_source_bundle import build_source_bundle
from app.services.studio_preparation_worker import run_job_isolated
from app.services.studio_story_adapter import adapt_video_to_studio_snapshot
from app.services.studio_story_resources import verify_and_resolve_resource_file
from app.services.studio_story_snapshots import (
    build_manifest_from_snapshot,
    get_published_snapshot,
    paginate_section_items,
    publish_snapshot,
)
from app.services.studio_story_validation import validate_studio_story

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/studio/v1", tags=["Studio 3D"])


class PublicationPayload(BaseModel):
    mode: Literal["structured", "legacy"] = "structured"
    expectedSourceFingerprint: Optional[str] = None
    draftVersion: Optional[str] = None


class SaveDraftPayload(BaseModel):
    draft: Dict[str, Any]
    expectedDraftVersion: Optional[str] = None


@router.get("/capabilities")
async def get_capabilities(
    _token: str = Depends(verify_studio_token),
) -> Dict[str, Any]:
    """Returns supported schema versions and section capabilities."""
    return {
        "schemaVersion": SCHEMA_VERSION,
        "supportedSchemaVersions": SUPPORTED_SCHEMA_VERSIONS,
        "supportedSections": SOURCE_SECTIONS,
        "maxLimit": 100,
    }


@router.get("/projects/{project_id}/manifest", response_model=StudioManifest)
async def get_latest_manifest(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _token: str = Depends(verify_studio_token),
):
    """Retrieves the latest published manifest for a project (strictly read-only)."""
    snapshot_row = await get_published_snapshot(db, project_id, auto_publish_if_missing=False)
    snapshot = StudioSnapshot(**snapshot_row.payload)
    return build_manifest_from_snapshot(snapshot, publication_time=snapshot_row.created_at)


@router.get("/projects/{project_id}/revisions/{revision}/manifest", response_model=StudioManifest)
async def get_revision_manifest(
    project_id: str,
    revision: str,
    db: AsyncSession = Depends(get_db),
    _token: str = Depends(verify_studio_token),
):
    """Retrieves the manifest for an immutable revision (strictly read-only)."""
    snapshot_row = await get_published_snapshot(db, project_id, revision)
    snapshot = StudioSnapshot(**snapshot_row.payload)
    return build_manifest_from_snapshot(snapshot, publication_time=snapshot_row.created_at)


@router.get("/projects/{project_id}/revisions/{revision}/sections/{section}", response_model=SectionPage)
async def get_section_page(
    project_id: str,
    revision: str,
    section: str,
    cursor: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _token: str = Depends(verify_studio_token),
):
    """Retrieves a paginated page of section items for a fixed revision."""
    snapshot_row = await get_published_snapshot(db, project_id, revision)
    snapshot = StudioSnapshot(**snapshot_row.payload)
    return paginate_section_items(
        snapshot=snapshot,
        section=section,
        manifest_hash=snapshot_row.manifest_hash,
        cursor=cursor,
        limit=limit,
    )


@router.get("/projects/{project_id}/revisions/{revision}/snapshot", response_model=StudioSnapshot)
async def get_snapshot(
    project_id: str,
    revision: str,
    db: AsyncSession = Depends(get_db),
    _token: str = Depends(verify_studio_token),
):
    """Retrieves the complete immutable snapshot for a revision (strictly read-only)."""
    snapshot_row = await get_published_snapshot(db, project_id, revision)
    return StudioSnapshot(**snapshot_row.payload)


@router.get("/projects/{project_id}/draft")
async def get_project_draft(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _token: str = Depends(verify_studio_token),
) -> Dict[str, Any]:
    """Retrieves the current editable 3D draft for a reproduction project.
    
    If no draft exists yet, initializes one from legacy project metadata.
    """
    video_stmt = select(Video).where(Video.video_id == project_id)
    video_res = await db.execute(video_stmt)
    if not video_res.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "PROJECT_NOT_FOUND", "message": f"Project '{project_id}' not found.", "projectId": project_id},
        )

    draft_stmt = select(StudioStoryDraft).where(StudioStoryDraft.video_id == project_id)
    draft_res = await db.execute(draft_stmt)
    draft_row = draft_res.scalars().first()

    if not draft_row or not draft_row.draft_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "DRAFT_NOT_FOUND", "message": f"No draft found for project '{project_id}'.", "projectId": project_id},
        )

    return {
        "projectId": project_id,
        "draftVersion": draft_row.draft_version,
        "draft": draft_row.draft_data,
        "updatedAt": (draft_row.updated_at or datetime.utcnow()).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


@router.put("/projects/{project_id}/draft")
async def save_project_draft(
    project_id: str,
    payload: SaveDraftPayload,
    db: AsyncSession = Depends(get_db),
    _token: str = Depends(verify_studio_token),
) -> Dict[str, Any]:
    """Saves and validates an editable 3D draft with optimistic concurrency locking."""
    video_stmt = select(Video).where(Video.video_id == project_id)
    video_res = await db.execute(video_stmt)
    if not video_res.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "PROJECT_NOT_FOUND", "message": f"Project '{project_id}' not found.", "projectId": project_id},
        )

    # 1. Cross-validate 3D structured story data
    draft_candidate = dict(payload.draft)
    draft_candidate["projectId"] = project_id
    valid, errors = validate_studio_story(draft_candidate)
    if not valid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "STORY_NOT_EXECUTABLE",
                "message": "Draft contains invalid 3D story structure or references.",
                "projectId": project_id,
                "errors": errors,
            },
        )

    # 2. Check optimistic concurrency locking
    draft_stmt = select(StudioStoryDraft).where(StudioStoryDraft.video_id == project_id)
    draft_res = await db.execute(draft_stmt)
    draft_row = draft_res.scalars().first()

    if draft_row and payload.expectedDraftVersion:
        if draft_row.draft_version != payload.expectedDraftVersion:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "DRAFT_VERSION_CONFLICT",
                    "message": f"Draft version conflict: expected '{payload.expectedDraftVersion}', found '{draft_row.draft_version}'.",
                    "projectId": project_id,
                    "expectedVersion": payload.expectedDraftVersion,
                    "actualVersion": draft_row.draft_version,
                },
            )

    new_version = f"v_{uuid.uuid4().hex[:8]}"
    now = datetime.utcnow()

    if draft_row:
        draft_row.draft_data = payload.draft
        draft_row.draft_version = new_version
        draft_row.updated_at = now
    else:
        draft_row = StudioStoryDraft(
            video_id=project_id,
            draft_data=payload.draft,
            draft_version=new_version,
            updated_at=now,
        )
        db.add(draft_row)

    await db.commit()
    await db.refresh(draft_row)

    return {
        "projectId": project_id,
        "draftVersion": new_version,
        "draft": payload.draft,
        "updatedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


@router.post("/projects/{project_id}/revisions", status_code=status.HTTP_201_CREATED)
async def create_revision_publication(
    project_id: str,
    payload: PublicationPayload,
    response: Response,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    db: AsyncSession = Depends(get_db),
    token: str = Depends(verify_studio_token),
) -> Dict[str, Any]:
    """Explicitly publishes an immutable snapshot revision with idempotency."""
    if not idempotency_key or not idempotency_key.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "INVALID_IDEMPOTENCY_KEY",
                "message": "Header 'Idempotency-Key' is required.",
                "projectId": project_id,
            },
        )

    result = await publish_snapshot(
        db=db,
        video_id=project_id,
        idempotency_key=idempotency_key.strip(),
        body=payload.model_dump(),
        caller_identity=token[:8] if token else "studio_client",
    )

    if result.get("replayed"):
        response.status_code = status.HTTP_200_OK

    return result


@router.get("/projects/{project_id}/revisions/{revision}/resources/{resource_id}")
async def get_resource_binary(
    project_id: str,
    revision: str,
    resource_id: str,
    db: AsyncSession = Depends(get_db),
    _token: str = Depends(verify_studio_token),
):
    """Downloads a verified binary resource with byte-level integrity checks and ETags."""
    snapshot_row = await get_published_snapshot(db, project_id, revision)
    snapshot = StudioSnapshot(**snapshot_row.payload)

    target_resource = next((r for r in snapshot.resources if r.id == resource_id), None)
    if not target_resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "RESOURCE_NOT_FOUND",
                "message": f"Resource '{resource_id}' not registered in revision '{revision}'.",
                "resourceId": resource_id,
                "revision": revision,
            },
        )

    file_path = verify_and_resolve_resource_file(project_id, revision, target_resource)

    return FileResponse(
        path=str(file_path),
        media_type=target_resource.mimeType,
        headers={
            "ETag": f'"{target_resource.sha256}"',
            "Content-Length": str(target_resource.byteSize),
        },
    )


# ---------------------------------------------------------------------------
# Studio 3D Preparation by AI (spec 10 §5)
# ---------------------------------------------------------------------------

CAPABILITIES_PATH = Path(__file__).resolve().parent.parent / "config" / "studio_capabilities.json"


def _load_capabilities_profile() -> Dict[str, Any]:
    if CAPABILITIES_PATH.is_file():
        return json.loads(CAPABILITIES_PATH.read_text(encoding="utf-8"))
    return {"profileId": "studio-preview-v1", "version": "1.0.0"}


@router.post("/projects/{project_id}/preparations", status_code=status.HTTP_202_ACCEPTED)
async def create_preparation_job(
    project_id: str,
    payload: PreparationCreateRequest,
    background_tasks: BackgroundTasks,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    db: AsyncSession = Depends(get_db),
    _token: str = Depends(verify_studio_token),
):
    """Launches an asynchronous durable 3D preparation job with idempotency and budget controls."""
    if not idempotency_key or len(idempotency_key) > 128:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_IDEMPOTENCY_KEY", "message": "Idempotency-Key must be 1..128 characters."},
        )

    # 1. Verify project exists
    video_stmt = select(Video).where(Video.video_id == project_id)
    video_res = await db.execute(video_stmt)
    if not video_res.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "PROJECT_NOT_FOUND", "message": f"Project '{project_id}' not found.", "projectId": project_id},
        )

    req_payload = payload.model_dump()
    req_hash = canonical_hash(req_payload)
    identity = "studio_user"

    # 2. Idempotency check
    idemp_stmt = select(StudioPreparationRequest).where(
        StudioPreparationRequest.identity == identity,
        StudioPreparationRequest.project_id == project_id,
        StudioPreparationRequest.idempotency_key == idempotency_key,
    )
    idemp_res = await db.execute(idemp_stmt)
    existing_req = idemp_res.scalars().first()
    if existing_req:
        if existing_req.request_hash == req_hash:
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={
                    "preparationId": existing_req.job_id,
                    "status": "queued",
                    "statusUrl": f"/api/studio/v1/projects/{project_id}/preparations/{existing_req.job_id}",
                    "idempotentReplay": True,
                },
            )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "IDEMPOTENCY_CONFLICT", "message": "Same Idempotency-Key submitted with different parameters."},
        )

    # 3. Build SourceBundle
    try:
        bundle = await build_source_bundle(
            db=db,
            video_id=project_id,
            selected_tts_id=payload.selectedTtsId,
            user_instructions=payload.instructions,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "SOURCE_BUNDLE_FAILED", "message": str(e), "projectId": project_id},
        )

    if payload.expectedSourceFingerprint and bundle.sourceFingerprint != payload.expectedSourceFingerprint:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "SOURCE_CHANGED",
                "message": "Source fingerprint has changed since last viewed.",
                "expected": payload.expectedSourceFingerprint,
                "actual": bundle.sourceFingerprint,
            },
        )

    # 4. Capabilities profile & Provider Resolution
    capabilities = _load_capabilities_profile()
    cap_hash = canonical_hash(capabilities)

    # Automatically resolve provider from model prefix if omitted
    provider = payload.provider
    if not provider or not provider.strip():
        try:
            svc = get_llm_service(model=payload.model)
            cls_name = svc.__class__.__name__.lower()
            if "agy" in cls_name:
                provider = "agy"
            elif "openrouter" in cls_name:
                provider = "openrouter"
            elif "agentrouter" in cls_name:
                provider = "agentrouter"
            elif "codex" in cls_name:
                provider = "codex"
            else:
                provider = "ollama"
        except Exception:
            provider = "ollama"

    budget_obj = payload.budget or PreparationBudget()

    job_id = f"prep_{uuid.uuid4().hex[:12]}"
    config_dict = {
        "mode": payload.mode,
        "capabilitiesProfileId": payload.capabilitiesProfileId,
        "capabilities": capabilities,
        "budget": budget_obj.model_dump(),
        "instructions": payload.instructions,
    }

    job = StudioPreparationJob(
        id=job_id,
        project_id=project_id,
        source_bundle=bundle.model_dump(),
        source_fingerprint=bundle.sourceFingerprint,
        base_draft_version=payload.expectedDraftVersion,
        candidate_version=0,
        status="queued",
        stage="extract",
        scope=payload.scope.model_dump(),
        prompt_pack_version="studio3d-v1",
        provider=provider,
        model=payload.model,
        capabilities_hash=cap_hash,
        config=config_dict,
        usage={"calls": 0, "estimatedTokens": 0},
    )
    db.add(job)

    prep_req = StudioPreparationRequest(
        identity=identity,
        project_id=project_id,
        idempotency_key=idempotency_key,
        request_hash=req_hash,
        job_id=job_id,
    )
    db.add(prep_req)
    await db.commit()

    # Enqueue background execution
    background_tasks.add_task(run_job_isolated, job_id)

    return {
        "preparationId": job_id,
        "status": "queued",
        "statusUrl": f"/api/studio/v1/projects/{project_id}/preparations/{job_id}",
    }


@router.get("/projects/{project_id}/preparations/{preparation_id}")
async def get_preparation_status(
    project_id: str,
    preparation_id: str,
    afterEventId: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    _token: str = Depends(verify_studio_token),
):
    """Retrieves preparation job progress, stage, usage, and monotonically paginated events."""
    stmt = select(StudioPreparationJob).where(
        StudioPreparationJob.id == preparation_id,
        StudioPreparationJob.project_id == project_id,
    )
    res = await db.execute(stmt)
    job = res.scalars().first()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "PREPARATION_NOT_FOUND", "message": f"Preparation job '{preparation_id}' not found."},
        )

    # Query events
    ev_stmt = select(StudioPreparationEvent).where(StudioPreparationEvent.job_id == preparation_id)
    if afterEventId is not None:
        ev_stmt = ev_stmt.where(StudioPreparationEvent.event_id > afterEventId)
    ev_stmt = ev_stmt.order_by(StudioPreparationEvent.event_id).limit(50)
    ev_res = await db.execute(ev_stmt)
    events = [
        {
            "eventId": ev.event_id,
            "type": ev.type,
            "message": ev.message,
            "targetId": ev.target_id,
            "createdAt": ev.created_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        for ev in ev_res.scalars().all()
    ]

    return {
        "preparationId": job.id,
        "projectId": job.project_id,
        "provider": job.provider,
        "model": job.model,
        "status": job.status,
        "stage": job.stage,
        "candidateVersion": job.candidate_version,
        "sourceFingerprint": job.source_fingerprint,
        "usage": job.usage,
        "cancelRequested": job.cancel_requested,
        "events": events,
        "createdAt": job.created_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "updatedAt": job.updated_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


@router.get("/projects/{project_id}/preparations/{preparation_id}/result")
async def get_preparation_result(
    project_id: str,
    preparation_id: str,
    db: AsyncSession = Depends(get_db),
    _token: str = Depends(verify_studio_token),
):
    """Retrieves the candidate result (CozyStory snapshot, review, readiness, provenance)."""
    cand_stmt = (
        select(StudioPreparationCandidate)
        .join(StudioPreparationJob, StudioPreparationCandidate.job_id == StudioPreparationJob.id)
        .where(StudioPreparationCandidate.job_id == preparation_id)
        .where(StudioPreparationJob.project_id == project_id)
        .order_by(desc(StudioPreparationCandidate.version))
    )
    cand_res = await db.execute(cand_stmt)
    candidate = cand_res.scalars().first()
    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "RESULT_NOT_READY", "message": "No candidate result produced yet for this job."},
        )

    return {
        "candidateId": candidate.id,
        "jobId": candidate.job_id,
        "candidateVersion": candidate.version,
        "draft": candidate.draft,
        "review": candidate.review,
        "readiness": candidate.readiness,
        "provenance": candidate.provenance,
        "sourceFingerprint": candidate.source_fingerprint,
        "baseDraftVersion": candidate.base_draft_version,
        "createdAt": candidate.created_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


@router.post("/projects/{project_id}/preparations/{preparation_id}/cancel")
async def cancel_preparation_job(
    project_id: str,
    preparation_id: str,
    db: AsyncSession = Depends(get_db),
    _token: str = Depends(verify_studio_token),
):
    """Requests durable cancellation of a running or queued preparation job."""
    stmt = select(StudioPreparationJob).where(
        StudioPreparationJob.id == preparation_id,
        StudioPreparationJob.project_id == project_id,
    )
    res = await db.execute(stmt)
    job = res.scalars().first()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "PREPARATION_NOT_FOUND", "message": f"Preparation job '{preparation_id}' not found."},
        )

    job.cancel_requested = True
    if job.status == "queued":
        job.status = "cancelled"
    await db.commit()
    return {"preparationId": job.id, "status": job.status, "cancelRequested": True}


@router.post("/projects/{project_id}/preparations/{preparation_id}/apply")
async def apply_candidate_to_draft(
    project_id: str,
    preparation_id: str,
    payload: PreparationApplyRequest,
    db: AsyncSession = Depends(get_db),
    _token: str = Depends(verify_studio_token),
):
    """Applies a candidate draft to the project's editable draft without publishing."""
    # 1. Fetch candidate
    cand_stmt = select(StudioPreparationCandidate).join(
        StudioPreparationJob, StudioPreparationCandidate.job_id == StudioPreparationJob.id
    ).where(
        StudioPreparationCandidate.job_id == preparation_id,
        StudioPreparationCandidate.version == payload.expectedCandidateVersion,
        StudioPreparationJob.project_id == project_id,
    )
    cand_res = await db.execute(cand_stmt)
    candidate = cand_res.scalars().first()
    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "CANDIDATE_NOT_FOUND", "message": f"Candidate v{payload.expectedCandidateVersion} not found."},
        )

    readiness = candidate.readiness or {}
    if payload.mode == "production" and not readiness.get("executionReady", False):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "CANDIDATE_NOT_READY",
                "message": "Candidate is not execution-ready for production mode. Resolve blocking decisions first.",
                "blockingDecisions": readiness.get("blockingDecisionIds", []),
            },
        )

    # 2. Check draft lock
    draft_stmt = select(StudioStoryDraft).where(StudioStoryDraft.video_id == project_id)
    draft_res = await db.execute(draft_stmt)
    draft_row = draft_res.scalars().first()

    if candidate.draft.get("schemaVersion") == "cozy-story-v2":
        from app.services.studio_narrative_sources import collect_narrative_sources
        narrative = candidate.draft.get("extensions", {}).get("narrative", {})
        try:
            source = await collect_narrative_sources(db, project_id, narrative.get("selectedTtsId"))
        except (ValueError, LookupError, TypeError) as exc:
            raise HTTPException(409, detail={"code": "SOURCE_CHANGED", "message": str(exc)}) from exc
        if source["sourceFingerprint"] != candidate.source_fingerprint or payload.expectedSourceFingerprint != candidate.source_fingerprint:
            raise HTTPException(409, detail={"code": "SOURCE_CHANGED", "message": "Les sources ont changé. Relancer l'analyse."})
        actual = draft_row.draft_version if draft_row else None
        if payload.expectedDraftVersion != actual or candidate.base_draft_version != actual:
            raise HTTPException(409, detail={"code": "DRAFT_VERSION_CONFLICT", "message": "Le brouillon a été modifié depuis cette analyse."})
        valid, errors = validate_studio_story(candidate.draft)
        if not valid or not readiness.get("directivesReady"):
            raise HTTPException(422, detail={"code": "CANDIDATE_NOT_READY", "message": str(errors)})

    if draft_row and payload.expectedDraftVersion and draft_row.draft_version != payload.expectedDraftVersion:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "DRAFT_VERSION_CONFLICT",
                "message": f"Draft version conflict: expected '{payload.expectedDraftVersion}', found '{draft_row.draft_version}'.",
                "actualVersion": draft_row.draft_version,
            },
        )

    # 3. Apply draft data with monotonic version increment
    candidate_draft = dict(candidate.draft)
    candidate_draft.pop("revision", None)

    if not draft_row:
        new_version = "v1"
        draft_row = StudioStoryDraft(
            video_id=project_id,
            draft_data=candidate_draft,
            draft_version=new_version,
            updated_at=datetime.utcnow(),
        )
        db.add(draft_row)
    else:
        curr_num = 1
        if draft_row.draft_version.startswith("v") and draft_row.draft_version[1:].isdigit():
            curr_num = int(draft_row.draft_version[1:])
        new_version = f"v{curr_num + 1}" if candidate.draft.get("schemaVersion") != "cozy-story-v2" else f"v_{uuid.uuid4().hex[:12]}"
        if candidate.draft.get("schemaVersion") == "cozy-story-v2":
            changed = await db.execute(update(StudioStoryDraft).where(
                StudioStoryDraft.video_id == project_id,
                StudioStoryDraft.draft_version == payload.expectedDraftVersion,
            ).values(draft_data=candidate_draft, draft_version=new_version, updated_at=datetime.utcnow()))
            if changed.rowcount != 1:
                await db.rollback()
                raise HTTPException(409, detail={"code": "DRAFT_VERSION_CONFLICT", "message": "Modification concurrente du brouillon."})
        else:
            draft_row.draft_data = candidate_draft
            draft_row.draft_version = new_version
            draft_row.updated_at = datetime.utcnow()

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, detail={"code": "DRAFT_VERSION_CONFLICT", "message": "Un brouillon a été créé en parallèle."}) from exc
    logger.info("Successfully applied candidate v%d of job '%s' to project '%s' draft %s.", payload.expectedCandidateVersion, preparation_id, project_id, new_version)

    return {
        "projectId": project_id,
        "draftVersion": new_version,
        "status": "applied",
        "mode": payload.mode,
    }
