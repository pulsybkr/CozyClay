from fastapi import FastAPI, Request, Depends, HTTPException, Query, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from contextlib import asynccontextmanager
import uvicorn
import logging
import os
from logging.handlers import TimedRotatingFileHandler
from dotenv import load_dotenv

load_dotenv()

from app.core.logging_config import setup_logging

setup_logging()
logger = logging.getLogger(__name__)

from app.db.database import init_db, get_db
from app.db.models import Channel, Video
from app.api.channels_routes import router as channel_router
from app.api.transcripts_routes import router as transcripts_router
from app.api.translation_routes import router as translation_router
from app.api.optimization_routes import router as optimization_router
from app.api.scenes_routes import router as scenes_router
from app.api.scenes_prompt_routes import router as scenes_prompt_router
from app.api.scenes_image_routes import router as scenes_image_router
from app.api.scenes_export_routes import router as scenes_export_router
from app.api.scenes_video_routes import router as scenes_video_router
from app.api.flow_routes import router as flow_router
from app.api.pipeline_routes import router as pipeline_router
from app.api.reproduction_routes import router as reproduction_router
from app.api.studio_routes import router as studio_router
from app.api.studio_narrative_routes import router as studio_narrative_router
from app.api.logs_routes import router as logs_router
from app.api.video_lab_routes import router as video_lab_router


from app.api.optimization_routes import get_ollama_models
from app.services.logfare_image_service import LogfareImageService
import asyncio

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    os.makedirs("scene/output_images", exist_ok=True)
    try:
        asyncio.create_task(LogfareImageService().get_models_status())
        asyncio.create_task(get_ollama_models())
    except Exception as exc:
        logger.debug("Background pre-warm error: %s", exc)
    yield
    # Shutdown (if needed)

app = FastAPI(title="YouTube Channel Analyzer", lifespan=lifespan)

# CORS is restricted by default. Add explicit comma-separated origins in .env
# when a separate frontend needs to call this local API.
cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ALLOW_ORIGINS",
        "http://127.0.0.1:8005,http://localhost:8005",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files
class NoCacheStaticFiles(StaticFiles):
    """StaticFiles subclass that adds headers to prevent aggressive browser caching of regenerated media."""
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        return response


app.mount("/static", StaticFiles(directory="app/static"), name="static")
app.mount("/downloads", NoCacheStaticFiles(directory="downloads"), name="downloads")
app.mount("/scene-images", NoCacheStaticFiles(directory="scene/output_images"), name="scene-images")

# Templates
templates = Jinja2Templates(directory="templates")

# Custom Filters
def format_number(n):
    if not n: return "0"
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n/1_000:.1f}k"
    return str(n)

templates.env.filters["format_number"] = format_number

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    favicon_path = "app/static/favicon.ico"
    if os.path.exists(favicon_path):
        return FileResponse(favicon_path, media_type="image/x-icon")
    return Response(status_code=204)

# Page Routes (Home, Channel Details, Analyze Page)

@app.get("/")
async def index_page(request: Request, db: AsyncSession = Depends(get_db)):
    # Fetch some channels for home page display
    result = await db.execute(select(Channel).order_by(Channel.analyzed_at.desc()).limit(20))
    channels = result.scalars().all()
    
    # Manual serialization for Jinja tojson filter
    channels_list = []
    for c in channels:
        channels_list.append({
            "id": c.id,
            "name": c.name,
            "subscribers": c.subscribers,
            "thumbnail_url": c.thumbnail_url,
            "analyzed_at": c.analyzed_at.isoformat() if c.analyzed_at else None
        })
    
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"channels": channels_list},
    )

@app.get("/channel/{id}")
async def channel_page(request: Request, id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Channel).where(Channel.id == id))
    channel = result.scalars().first()
    if not channel:
        raise HTTPException(status_code=404, detail="Chaîne introuvable")
    
    # We'll fetch videos on client side via API for better reactivity/loading state
    return templates.TemplateResponse(
        request=request,
        name="channel.html",
        context={"channel": channel},
    )

@app.get("/analyze")
async def analyze_page(request: Request, job: str):
    return templates.TemplateResponse(
        request=request,
        name="analyze.html",
        context={"job_id": job},
    )

# Health check
@app.get("/api/health")
async def health_check():
    return {"status": "ok", "db": "connected"}

# API Routes
app.include_router(channel_router, prefix="/api")
app.include_router(transcripts_router, prefix="/api")
app.include_router(translation_router, prefix="/api")
app.include_router(optimization_router, prefix="/api")
app.include_router(scenes_router, prefix="/api")
app.include_router(scenes_prompt_router, prefix="/api")
app.include_router(scenes_image_router, prefix="/api")
app.include_router(scenes_export_router, prefix="/api")
app.include_router(scenes_video_router, prefix="/api")
app.include_router(flow_router, prefix="/api")
app.include_router(pipeline_router, prefix="/api")
app.include_router(reproduction_router, prefix="/api")
app.include_router(studio_router)
app.include_router(studio_narrative_router)
app.include_router(logs_router, prefix="/api")
app.include_router(video_lab_router, prefix="/api")


@app.get("/video/{video_id}")
async def video_page(request: Request, video_id: str):
    return templates.TemplateResponse(
        request=request,
        name="video.html",
        context={"video_id": video_id},
    )

@app.get("/video/{video_id}/scenes")
async def scenes_page(request: Request, video_id: str):
    return templates.TemplateResponse(
        request=request,
        name="scenes.html",
        context={"video_id": video_id},
    )

@app.get("/video/{video_id}/studio3d")
async def studio_narrative_page(request: Request, video_id: str):
    return templates.TemplateResponse(request=request, name="studio_narrative.html", context={"video_id": video_id})


@app.get("/video/{video_id}/reproduction")
async def reproduction_page(request: Request, video_id: str):
    return templates.TemplateResponse(
        request=request,
        name="reproduction.html",
        context={"video_id": video_id},
    )

@app.get("/video/{video_id}/pipeline")
async def pipeline_page(request: Request, video_id: str):
    return templates.TemplateResponse(
        request=request,
        name="pipeline.html",
        context={"video_id": video_id},
    )

@app.get("/favorites")
async def favorites_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="favorites.html",
    )

@app.get("/projects")
async def projects_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="projects.html",
    )

@app.get("/image-lab")
async def image_lab_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="image_lab.html",
    )

@app.get("/video-lab")
async def video_lab_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="video_lab.html",
    )


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
