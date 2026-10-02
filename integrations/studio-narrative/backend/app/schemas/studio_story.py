"""Pydantic schemas and canonical JSON hashing for CozyStory v1 (Studio 3D)."""

import hashlib
import json
import math
from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, ConfigDict, Field, field_validator

SCHEMA_VERSION = "cozy-story-v1"
SUPPORTED_SCHEMA_VERSIONS = [SCHEMA_VERSION, "cozy-story-v2"]
SOURCE_MODES = ["structured", "legacy", "mixed"]
SOURCE_SECTIONS = ["characters", "sets", "scenes", "shots", "actions", "narration"]


def format_js_number(x: Union[float, int]) -> str:
    """Formats a number strictly identical to ECMAScript ToString / JSON.stringify."""
    if isinstance(x, bool):
        return "true" if x else "false"
    if math.isnan(x) or math.isinf(x):
        raise ValueError(f"Non-finite number cannot be canonicalized: {x}")
    if isinstance(x, int):
        if abs(x) > 9007199254740991:
            raise ValueError(f"Integer {x} exceeds JavaScript MAX_SAFE_INTEGER")
        return str(x)
    if x == 0.0 or x == -0.0:
        return "0"
    sign = "-" if math.copysign(1.0, x) < 0 else ""
    ax = abs(x)
    rep = repr(ax)
    if "e" in rep:
        mantissa, exp_str = rep.split("e")
        exp = int(exp_str)
    else:
        parts = rep.split(".")
        int_part = parts[0]
        frac_part = parts[1] if len(parts) > 1 else ""
        if frac_part == "0":
            frac_part = ""
        digits = int_part + frac_part
        exp = len(int_part) - 1
        mantissa = digits[0] + ("." + digits[1:] if len(digits) > 1 else "")

    mantissa_digits = mantissa.replace(".", "")
    k = exp + 1
    n = len(mantissa_digits)

    # ECMAScript Number.prototype.toString formatting
    if 0 < k <= 21:
        if n <= k:
            s = mantissa_digits + "0" * (k - n)
        else:
            s = mantissa_digits[:k] + "." + mantissa_digits[k:]
    elif -5 <= k <= 0:
        s = "0." + "0" * (-k) + mantissa_digits
    else:
        first = mantissa_digits[0]
        rest = mantissa_digits[1:]
        m_str = first + ("." + rest if rest else "")
        exp_sign = "+" if (k - 1) >= 0 else "-"
        s = f"{m_str}e{exp_sign}{abs(k - 1)}"

    return sign + s


def canonical_json(value: Any) -> str:
    """RFC 8785 / ECMAScript deterministic JSON serialization.
    
    Preserves null, sorts keys by UTF-16 code units, matches JavaScript JSON.stringify.
    """
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return format_js_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value.keys(), key=lambda k: str(k).encode("utf-16-be"))
        return "{" + ",".join(f"{json.dumps(str(k), ensure_ascii=False)}:{canonical_json(value[k])}" for k in keys) + "}"
    if isinstance(value, BaseModel):
        return canonical_json(value.model_dump())
    raise TypeError(f"Object of type {type(value)} is not JSON serializable")


def canonical_hash(value: Any) -> str:
    """Computes deterministic SHA-256 hash in format sha256:<64-hex>."""
    canonical = canonical_json(value)
    hex_digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"sha256:{hex_digest}"


class ProjectSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fps: int = Field(default=24, ge=1, le=120)
    aspect: Literal["9:16", "16:9"] = "9:16"
    durationSeconds: float = Field(gt=0, le=1200)


class AvatarStrategy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    strategy: Literal["generate", "reference", "library", "builtin"] = "builtin"
    referenceResourceId: Optional[str] = None


class Character(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=128)
    appearance: Optional[str] = None
    heightMeters: Optional[float] = Field(default=None, gt=0.2, le=3.0)
    avatar: Optional[AvatarStrategy] = None


class Vec3(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0


Vector3 = Vec3


class StructurePiece(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    shape: str = "box"
    dimensionsMeters: Vec3
    positionMeters: Vec3
    yawDegrees: float = 0.0
    color: Optional[str] = None


class PropAcquisition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    strategy: Literal["library", "generate", "reference", "builtin"] = "library"
    query: Optional[str] = None


class PropSupport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    objectId: str
    placement: str = "top"
    offsetMeters: Optional[Vec3] = None


class Prop(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    name: str
    acquisition: Optional[PropAcquisition] = None
    heightMeters: Optional[float] = None
    dimensionsMeters: Optional[Vec3] = None
    positionMeters: Optional[Vec3] = None
    yawDegrees: float = 0.0
    support: Optional[PropSupport] = None
    supportY: Optional[float] = None
    color: Optional[str] = None


class Lighting(BaseModel):
    model_config = ConfigDict(extra="forbid")
    keyIntensity: float = 1.0
    ambientIntensity: float = 0.5


class SetItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    name: str
    description: Optional[str] = None
    structure: List[StructurePiece] = Field(default_factory=list)
    props: List[Prop] = Field(default_factory=list)
    lighting: Optional[Lighting] = None


class CastPlacement(BaseModel):
    model_config = ConfigDict(extra="forbid")
    characterId: str
    positionMeters: Vec3
    yawDegrees: float = 0.0


class ContinuityState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    entityId: str
    condition: str
    heldBy: Optional[str] = None
    positionMeters: Optional[Vec3] = None


class CameraFraming(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pos: Vec3
    yaw: float
    pitch: float
    fovDeg: float = Field(ge=14, le=90)


class CameraKey(BaseModel):
    model_config = ConfigDict(extra="forbid")
    frame: int = Field(ge=0, le=28799)
    framing: CameraFraming


class SceneCamera(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=120, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
    name: str
    directive: str
    interpolation: Literal["smooth", "linear", "hold"] = "smooth"
    cameraKeys: List[CameraKey] = Field(min_length=1, max_length=64)


class Scene(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    setId: str
    globalStartSeconds: float = Field(ge=0)
    globalEndSeconds: float = Field(gt=0)
    transitionIn: Optional[Dict[str, Any]] = None
    transitionOut: Optional[Dict[str, Any]] = None
    cast: List[CastPlacement] = Field(default_factory=list)
    summary: Optional[str] = None
    timeContext: Optional[str] = None
    cameras: List[SceneCamera] = Field(default_factory=list)
    entryState: List[ContinuityState] = Field(default_factory=list)
    exitState: List[ContinuityState] = Field(default_factory=list)


class CameraMove(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str = "static"
    distanceMeters: Optional[float] = None


class CameraConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    size: str = "medium"
    angle: str = "eye-level"
    move: Optional[CameraMove] = None
    targets: List[str] = Field(default_factory=list)


class ShotLegacy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    imagePrompt: Optional[str] = None
    videoPrompt: Optional[str] = None
    needsAdaptation: bool = False


class Shot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    sceneId: str
    startSeconds: float = Field(ge=0)
    endSeconds: float = Field(gt=0)
    camera: Optional[CameraConfig] = None
    legacy: Optional[ShotLegacy] = None
    cameraId: Optional[str] = None
    cameraOffsetFrame: int = Field(default=0, ge=0)
    directive: Optional[str] = None


class Action(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    kind: Literal["body", "interaction", "expression"] = "body"
    sceneId: str
    characterId: str
    startSeconds: Optional[float] = None
    endSeconds: Optional[float] = None
    description: Optional[str] = None
    trajectory: Optional[List[Dict[str, Any]]] = None
    objectId: Optional[str] = None
    interaction: Optional[Dict[str, Any]] = None
    intent: Optional[str] = None
    binding: Optional[Dict[str, Any]] = None
    keys: Optional[List[Dict[str, Any]]] = None
    eventId: Optional[str] = None
    participantIds: List[str] = Field(default_factory=list)
    effects: List[ContinuityState] = Field(default_factory=list)


class Expression(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    sceneId: str
    characterId: str
    intent: str
    binding: Optional[Dict[str, Any]] = None
    keys: List[Dict[str, Any]] = Field(default_factory=list)


class Narration(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    sceneId: Optional[str] = None
    startSeconds: float = Field(ge=0)
    endSeconds: float = Field(gt=0)
    text: str
    audioResourceId: Optional[str] = None


class ResourceRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    role: Literal["avatar-vrm", "motion-npz", "narration-audio", "reference-image", "mesh"]
    mimeType: str
    byteSize: int = Field(ge=0)
    sha256: str


class SectionSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Literal["characters", "sets", "scenes", "shots", "actions", "narration"]
    count: int = Field(ge=0)
    ids: List[str] = Field(default_factory=list)
    hash: str


class StudioManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schemaVersion: str = SCHEMA_VERSION
    projectId: str
    revision: str
    manifestHash: str
    title: str
    updatedAt: str
    sourceMode: Literal["structured", "legacy", "mixed"] = "structured"
    project: ProjectSpec
    sections: List[SectionSummary] = Field(default_factory=list)
    resources: List[ResourceRef] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class SectionPage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schemaVersion: str = SCHEMA_VERSION
    projectId: str
    revision: str
    manifestHash: str
    section: Literal["characters", "sets", "scenes", "shots", "actions", "narration"]
    sectionHash: str
    items: List[Dict[str, Any]]
    nextCursor: Optional[str] = None
    total: int = Field(ge=0)


class StudioSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schemaVersion: str = SCHEMA_VERSION
    projectId: str
    revision: str
    title: str
    sourceMode: Literal["structured", "legacy", "mixed"] = "structured"
    project: ProjectSpec
    characters: List[Character] = Field(default_factory=list)
    sets: List[SetItem] = Field(default_factory=list)
    scenes: List[Scene] = Field(default_factory=list)
    shots: List[Shot] = Field(default_factory=list)
    actions: List[Action] = Field(default_factory=list)
    expressions: List[Expression] = Field(default_factory=list)
    narration: List[Narration] = Field(default_factory=list)
    resources: List[ResourceRef] = Field(default_factory=list)
    extensions: Dict[str, Any] = Field(default_factory=dict)


def section_items(
    snapshot_or_dict: Union[StudioSnapshot, Dict[str, Any]],
    section: str,
) -> List[Dict[str, Any]]:
    """Extracts the canonical normalized list of items for one of the 6 sections.
    
    Sections are: characters, sets, scenes, shots, actions, narration.
    For 'actions', merges expressions with kind='expression' and ensures unique IDs.
    """
    if section not in SOURCE_SECTIONS:
        raise ValueError(f"Unknown section: '{section}'. Expected one of {SOURCE_SECTIONS}")

    if hasattr(snapshot_or_dict, "model_dump"):
        data = snapshot_or_dict.model_dump()
    elif isinstance(snapshot_or_dict, dict):
        data = snapshot_or_dict
    else:
        raise TypeError(f"Expected StudioSnapshot or dict, got {type(snapshot_or_dict)}")

    if section == "characters":
        return list(data.get("characters") or [])
    elif section == "sets":
        return list(data.get("sets") or [])
    elif section == "scenes":
        return list(data.get("scenes") or [])
    elif section == "shots":
        return list(data.get("shots") or [])
    elif section == "actions":
        actions = [dict(a) for a in (data.get("actions") or [])]
        seen_ids = {a.get("id") for a in actions if a.get("id")}
        raw_expressions = data.get("expressions") or []
        for expr in raw_expressions:
            e_dict = dict(expr)
            e_id = e_dict.get("id")
            if e_id and e_id not in seen_ids:
                seen_ids.add(e_id)
                actions.append(
                    {
                        "id": e_id,
                        "kind": "expression",
                        "sceneId": e_dict.get("sceneId"),
                        "characterId": e_dict.get("characterId"),
                        "intent": e_dict.get("intent"),
                        "binding": e_dict.get("binding"),
                        "keys": e_dict.get("keys", []),
                    }
                )
        return actions
    elif section == "narration":
        return list(data.get("narration") or [])
    return []
