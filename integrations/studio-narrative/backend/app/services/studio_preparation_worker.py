"""Durable background worker for Studio 3D Preparation (spec 10 §7).

Atomic job claiming with lease, cancellation checking, and isolated DB session.
"""

import asyncio
from datetime import datetime, timedelta
import logging
import os
from typing import Optional
import uuid
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import AsyncSessionLocal
from app.db.models_studio import StudioPreparationJob
from app.services.studio_preparation_service import PreparationService

logger = logging.getLogger(__name__)

WORKER_ID = f"worker_{os.getpid()}_{uuid.uuid4().hex[:6]}"
LEASE_DURATION_SECONDS = 300


async def claim_next_job(db: AsyncSession) -> Optional[StudioPreparationJob]:
    """Atomically claims the oldest queued job using an expiring lease."""
    now = datetime.utcnow()
    lease_expires = now + timedelta(seconds=LEASE_DURATION_SECONDS)

    stmt = (
        select(StudioPreparationJob)
        .where(
            (StudioPreparationJob.status == "queued")
            | (
                (StudioPreparationJob.status == "running")
                & (StudioPreparationJob.lease_expires_at < now)
            )
        )
        .order_by(StudioPreparationJob.created_at)
        .with_for_update(skip_locked=True)
    )
    res = await db.execute(stmt)
    job = res.scalars().first()
    if not job:
        return None

    job.status = "running"
    job.lease_owner = WORKER_ID
    job.lease_expires_at = lease_expires
    job.updated_at = now
    await db.commit()
    return job


async def run_job_isolated(job_id: str):
    """Executes a single job in an isolated DB session."""
    async with AsyncSessionLocal() as db:
        stmt = select(StudioPreparationJob).where(StudioPreparationJob.id == job_id)
        res = await db.execute(stmt)
        job = res.scalars().first()
        if not job:
            logger.error("Job '%s' not found for execution.", job_id)
            return

        if (job.config or {}).get("pipeline") == "narrative-v2":
            from app.services.studio_narrative_service import NarrativePreparationService
            service = NarrativePreparationService(db, job)
        else:
            service = PreparationService(db, job)
        try:
            await service.run()
        except InterruptedError:
            logger.info("Job '%s' was cancelled.", job_id)
            job.status = "cancelled"
            await db.commit()
        except Exception as e:
            logger.exception("Job '%s' failed with error: %s", job_id, e)
            job.status = "failed"
            if (job.config or {}).get("pipeline") == "narrative-v2":
                await service.event("pipeline_failed", str(e)[:2000])
            await db.commit()
        finally:
            job.lease_owner = None
            job.lease_expires_at = None
            await db.commit()
