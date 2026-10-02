"""Snapshot storage, retrieval, manifest compilation and pagination."""

from datetime import datetime
import json
import logging
from typing import Any, Dict, List, Optional
import uuid
from fastapi import HTTPException, status
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

from app.db.models import Video
from app.db.models_studio import StudioPublicationRequest, StudioStoryDraft, StudioStorySnapshot
from app.schemas.studio_story import (
    SCHEMA_VERSION,
    SOURCE_SECTIONS,
    SectionPage,
    SectionSummary,
    StudioManifest,
    StudioSnapshot,
    canonical_hash,
    canonical_json,
    section_items,
)
from app.services.studio_story_adapter import adapt_video_to_studio_snapshot
from app.services.studio_story_resources import verify_and_resolve_resource_file


def build_manifest_from_snapshot(
    snapshot: StudioSnapshot,
    publication_time: Optional[datetime] = None,
) -> StudioManifest:
    """Builds a verified manifest with SHA-256 hashes per section and total manifestHash."""
    section_summaries: List[SectionSummary] = []
    for sec_name in SOURCE_SECTIONS:
        items = section_items(snapshot, sec_name)
        sec_hash = canonical_hash(items)
        sec_ids = [str(item["id"]) for item in items if isinstance(item, dict) and "id" in item]
        section_summaries.append(
            SectionSummary(
                name=sec_name,
                count=len(items),
                ids=sec_ids,
                hash=sec_hash,
            )
        )

    # Manifest payload to hash: strictly conforms to spec 09 D1
    manifest_core = {
        "schemaVersion": snapshot.schemaVersion,
        "projectId": snapshot.projectId,
        "revision": snapshot.revision,
        "title": snapshot.title,
        "sourceMode": snapshot.sourceMode,
        "project": snapshot.project.model_dump(),
        "sections": [s.model_dump() for s in section_summaries],
        "resources": [r.model_dump() for r in snapshot.resources],
    }
    manifest_hash = canonical_hash(manifest_core)

    if publication_time is not None:
        updated_at = publication_time.strftime("%Y-%m-%dT%H:%M:%SZ")
    else:
        updated_at = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    return StudioManifest(
        schemaVersion=snapshot.schemaVersion,
        projectId=snapshot.projectId,
        revision=snapshot.revision,
        manifestHash=manifest_hash,
        title=snapshot.title,
        updatedAt=updated_at,
        sourceMode=snapshot.sourceMode,
        project=snapshot.project,
        sections=section_summaries,
        resources=snapshot.resources,
        warnings=[],
    )


def paginate_section_items(
    snapshot: StudioSnapshot,
    section: str,
    manifest_hash: str,
    cursor: Optional[str] = None,
    limit: int = 50,
) -> SectionPage:
    """Extracts a paginated page of section items with total count and nextCursor."""
    if section not in SOURCE_SECTIONS:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "SECTION_NOT_FOUND",
                "message": f"Section '{section}' is unknown. Supported: {', '.join(SOURCE_SECTIONS)}",
            },
        )
    if limit < 1 or limit > 100:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "LIMIT_OUT_OF_BOUNDS",
                "message": f"Limit {limit} is out of bounds [1, 100].",
            },
        )

    raw_items = section_items(snapshot, section)
    sec_hash = canonical_hash(raw_items)
    total = len(raw_items)

    offset = 0
    if cursor is not None:
        if not cursor.isdigit() or len(cursor) > 16:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "INVALID_CURSOR",
                    "message": f"Invalid cursor '{cursor}': must be decimal ASCII digits.",
                },
            )
        offset = int(cursor)
        if offset > total:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "INVALID_CURSOR",
                    "message": f"Cursor offset {offset} exceeds total items {total}.",
                },
            )

    page_items = raw_items[offset : offset + limit]

    # Verify maximum page byte size (2 MiB per spec)
    page_bytes = len(canonical_json(page_items).encode("utf-8"))
    if page_bytes > 2 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "PAGE_TOO_LARGE",
                "message": f"Page size {page_bytes} bytes exceeds maximum limit of 2 MiB.",
            },
        )

    next_offset = offset + len(page_items)
    next_cursor = str(next_offset) if next_offset < total else None

    return SectionPage(
        schemaVersion=snapshot.schemaVersion,
        projectId=snapshot.projectId,
        revision=snapshot.revision,
        manifestHash=manifest_hash,
        section=section,
        sectionHash=sec_hash,
        items=page_items,
        nextCursor=next_cursor,
        total=total,
    )


async def get_published_snapshot(
    db: AsyncSession,
    video_id: str,
    revision: Optional[str] = None,
    auto_publish_if_missing: bool = False,
) -> StudioStorySnapshot:
    """Retrieves a published snapshot by revision or the latest.
    
    If revision is omitted and project has not been published yet,
    auto_publish_if_missing=True will seamlessly publish an initial snapshot.
    Raises 404 PROJECT_NOT_FOUND if video doesn't exist.
    Raises 409 PROJECT_NOT_PUBLISHED if project has no published snapshot and auto_publish is False.
    Raises 404 REVISION_NOT_FOUND if requested revision is unknown.
    """
    video_stmt = select(Video).where(Video.video_id == video_id)
    video_res = await db.execute(video_stmt)
    video = video_res.scalars().first()
    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "PROJECT_NOT_FOUND",
                "message": f"Project '{video_id}' not found.",
                "projectId": video_id,
            },
        )

    if revision:
        stmt = select(StudioStorySnapshot).where(
            StudioStorySnapshot.video_id == video_id,
            StudioStorySnapshot.revision == revision,
        )
        res = await db.execute(stmt)
        existing = res.scalars().first()
        if not existing:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "code": "REVISION_NOT_FOUND",
                    "message": f"Revision '{revision}' not found for project '{video_id}'.",
                    "projectId": video_id,
                    "revision": revision,
                },
            )
        return existing

    # Find latest published revision
    latest_stmt = (
        select(StudioStorySnapshot)
        .where(StudioStorySnapshot.video_id == video_id)
        .order_by(desc(StudioStorySnapshot.created_at))
    )
    latest_res = await db.execute(latest_stmt)
    latest = latest_res.scalars().first()
    if not latest:
        if auto_publish_if_missing:
            # Check if a structured draft already exists
            draft_stmt = select(StudioStoryDraft).where(StudioStoryDraft.video_id == video_id)
            draft_res = await db.execute(draft_stmt)
            draft_row = draft_res.scalars().first()
            mode = "structured" if (draft_row and draft_row.draft_data) else "legacy"

            logger.info("Auto-publishing initial snapshot for project '%s' (mode=%s)...", video_id, mode)
            await publish_snapshot(
                db=db,
                video_id=video_id,
                idempotency_key=f"auto_pub_{video_id}",
                body={"mode": mode},
                caller_identity="auto_manifest",
            )
            latest_res = await db.execute(latest_stmt)
            latest = latest_res.scalars().first()
            if latest:
                return latest

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "PROJECT_NOT_PUBLISHED",
                "message": f"Project '{video_id}' has not been published yet.",
                "projectId": video_id,
            },
        )
    return latest


async def publish_snapshot(
    db: AsyncSession,
    video_id: str,
    idempotency_key: str,
    body: Dict[str, Any],
    caller_identity: Optional[str] = None,
) -> Dict[str, Any]:
    """Explicit, atomic publication of a project snapshot into StudioStorySnapshot.
    
    Verifies idempotency via StudioPublicationRequest.
    Checks expected source fingerprint if supplied.
    Returns publication metadata dictionary.
    """
    if not idempotency_key or len(idempotency_key) > 128:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "INVALID_IDEMPOTENCY_KEY",
                "message": "Idempotency-Key header is required and must be between 1 and 128 characters.",
            },
        )

    req_hash = canonical_hash(body)

    # 1. Idempotency replay check
    idemp_stmt = select(StudioPublicationRequest).where(
        StudioPublicationRequest.video_id == video_id,
        StudioPublicationRequest.idempotency_key == idempotency_key,
    )
    idemp_res = await db.execute(idemp_stmt)
    existing_req = idemp_res.scalars().first()
    if existing_req:
        if existing_req.request_hash == req_hash:
            return {
                "projectId": video_id,
                "revision": existing_req.revision,
                "manifestHash": existing_req.manifest_hash,
                "sourceFingerprint": existing_req.source_fingerprint,
                "replayed": True,
            }
        else:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "IDEMPOTENCY_CONFLICT",
                    "message": "Idempotency key reused with different request payload.",
                    "projectId": video_id,
                },
            )

    # 2. Check if project exists
    video_stmt = select(Video).where(Video.video_id == video_id)
    video_res = await db.execute(video_stmt)
    video = video_res.scalars().first()
    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "PROJECT_NOT_FOUND",
                "message": f"Project '{video_id}' not found.",
                "projectId": video_id,
            },
        )

    mode = body.get("mode", "structured")
    expected_fingerprint = body.get("expectedSourceFingerprint")
    expected_draft_version = body.get("draftVersion")

    # 3. If structured mode, verify draft existence and optimistic concurrency lock
    if mode == "structured":
        draft_stmt = select(StudioStoryDraft).where(StudioStoryDraft.video_id == video_id)
        draft_res = await db.execute(draft_stmt)
        draft_row = draft_res.scalars().first()
        if not draft_row or not draft_row.draft_data:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "code": "STORY_NOT_EXECUTABLE",
                    "message": f"No structured draft found for project '{video_id}'. Prepare 3D draft first or publish in legacy mode.",
                    "projectId": video_id,
                },
            )
        if expected_draft_version and draft_row.draft_version != expected_draft_version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "SOURCE_CHANGED",
                    "message": f"Draft version mismatch: expected '{expected_draft_version}', actual '{draft_row.draft_version}'.",
                    "projectId": video_id,
                    "expectedVersion": expected_draft_version,
                    "actualVersion": draft_row.draft_version,
                },
            )

    revision = f"r_{uuid.uuid4().hex[:12]}"

    # 4. Adapt and validate snapshot
    try:
        snapshot, source_fingerprint, tts_id = await adapt_video_to_studio_snapshot(
            db,
            video_id,
            revision=revision,
            mode=mode,
        )
    except Exception as e:
        err_msg = str(e)
        if "STORY_NOT_EXECUTABLE" in err_msg or "validation error" in err_msg.lower():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "code": "STORY_NOT_EXECUTABLE",
                    "message": err_msg,
                    "projectId": video_id,
                },
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "ADAPTATION_FAILED", "message": err_msg, "projectId": video_id},
        )

    # 5. Fingerprint check
    if expected_fingerprint and source_fingerprint != expected_fingerprint:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "SOURCE_CHANGED",
                "message": "Source fingerprint has changed since last viewed.",
                "projectId": video_id,
                "expected": expected_fingerprint,
                "actual": source_fingerprint,
            },
        )

    # 6. Verify all declared binary resources are present and uncorrupted on storage
    if snapshot.schemaVersion == "cozy-story-v2":
        from app.services.studio_narrative_sources import collect_narrative_sources
        from app.services.studio_story_resources import resolve_resource_file
        import shutil
        from pathlib import Path
        narrative = snapshot.extensions.get("narrative", {})
        source = await collect_narrative_sources(db, video_id, narrative.get("selectedTtsId"))
        if source["sourceFingerprint"] != narrative.get("sourceFingerprint"):
            raise HTTPException(409, detail={"code": "SOURCE_CHANGED", "message": "Les sources de la narration ont changé depuis la préparation."})
        tts_id = source["selectedTtsId"]
        for resource in snapshot.resources:
            if resource.id == "NARRATION_AUDIO":
                if resource.sha256.removeprefix("sha256:") != source["audioHash"] or resource.byteSize != source["audioByteSize"]:
                    raise HTTPException(422, detail={"code": "RESOURCE_CORRUPTED", "message": "La ressource narration ne correspond pas au TTS sélectionné."})
                target = resolve_resource_file(video_id, revision, resource)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(Path(source["audioPath"]), target)
    for res_ref in snapshot.resources:
        verify_and_resolve_resource_file(video_id, revision, res_ref, is_publication=True)

    now = datetime.utcnow()
    manifest = build_manifest_from_snapshot(snapshot, publication_time=now)
    payload = snapshot.model_dump()

    # 5. Check size limit
    canon_bytes = len(canonical_json(payload).encode("utf-8"))
    if canon_bytes > 8 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "SNAPSHOT_TOO_LARGE",
                "message": f"Snapshot size {canon_bytes} bytes exceeds maximum limit of 8 MiB.",
                "projectId": video_id,
            },
        )

    new_snapshot = StudioStorySnapshot(
        video_id=video_id,
        revision=revision,
        manifest_hash=manifest.manifestHash,
        content_hash=canonical_hash(payload),
        source_fingerprint=source_fingerprint,
        payload=payload,
        selected_tts_audio_id=tts_id,
        created_at=now,
    )
    db.add(new_snapshot)

    pub_req = StudioPublicationRequest(
        video_id=video_id,
        idempotency_key=idempotency_key,
        caller_identity=caller_identity or "studio_client",
        request_hash=req_hash,
        revision=revision,
        manifest_hash=manifest.manifestHash,
        source_fingerprint=source_fingerprint,
        created_at=now,
    )
    db.add(pub_req)

    try:
        await db.commit()
        await db.refresh(new_snapshot)
    except Exception:
        await db.rollback()
        # Check if race condition succeeded in concurrent task
        idemp_stmt = select(StudioPublicationRequest).where(
            StudioPublicationRequest.video_id == video_id,
            StudioPublicationRequest.idempotency_key == idempotency_key,
        )
        idemp_res = await db.execute(idemp_stmt)
        race_req = idemp_res.scalars().first()
        if race_req and race_req.request_hash == req_hash:
            return {
                "projectId": video_id,
                "revision": race_req.revision,
                "manifestHash": race_req.manifest_hash,
                "sourceFingerprint": race_req.source_fingerprint,
                "replayed": True,
            }
        raise

    return {
        "projectId": video_id,
        "revision": revision,
        "manifestHash": manifest.manifestHash,
        "sourceFingerprint": source_fingerprint,
        "replayed": False,
    }
