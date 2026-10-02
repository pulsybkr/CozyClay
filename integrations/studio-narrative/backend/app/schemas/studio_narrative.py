"""Validated planning outputs. Timing and IDs belong to the server, not the model."""
from typing import List, Literal
from pydantic import BaseModel, ConfigDict, Field
from app.schemas.studio_story import Character, SetItem, Scene, Shot, Action


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OutlineScene(StrictModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    setId: str
    characterIds: List[str]
    segmentStart: int = Field(ge=0)
    segmentEnd: int = Field(gt=0)
    summary: str
    timeContext: str


class StoryOutline(StrictModel):
    synopsis: str
    editorialChoices: List[str]
    characters: List[Character] = Field(min_length=1, max_length=32)
    sets: List[SetItem] = Field(min_length=1, max_length=32)
    scenes: List[OutlineScene] = Field(min_length=1, max_length=32)


class ScenePlan(StrictModel):
    scene: Scene
    shots: List[Shot] = Field(min_length=1, max_length=64)
    actions: List[Action]


class NarrativeRequest(StrictModel):
    selectedTtsId: int | None = None
    model: str | None = Field(default=None, max_length=128)
    provider: Literal["agy", "antigravity", "openrouter", "agentrouter", "codex", "ollama"] | None = None
    instructions: str = Field(default="", max_length=4000)
    expectedSourceFingerprint: str
    expectedDraftVersion: str | None = None
    parentJobId: str | None = None
    fromSceneId: str | None = None
    maxCalls: int = Field(default=100, ge=3, le=300)
    maxOutputTokens: int = Field(default=200000, ge=1000, le=600000)
