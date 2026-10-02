"""Validation service for CozyStory v1 (Studio 3D) snapshots and drafts.

Conforms strictly to CozyClay source-contract.js rules and specs 09 Lot D4.
"""

import math
import re
from typing import Any, Dict, List, Optional, Set, Tuple

ID_REGEX = re.compile(r"^[A-Za-z0-9_-]{1,128}$")

SOURCE_LIMITS = {
    "maxDurationSeconds": 1200,
    "maxCharacters": 32,
    "maxSets": 32,
    "maxScenes": 32,
    "maxShots": 256,
}

ALLOWED_ROOT_FIELDS = {
    "schemaVersion", "projectId", "revision", "title", "sourceMode",
    "project", "characters", "sets", "scenes", "shots", "actions",
    "expressions", "narration", "resources", "extensions",
}
ALLOWED_PROJECT_FIELDS = {"fps", "aspect", "durationSeconds"}
ALLOWED_CHAR_FIELDS = {"id", "name", "appearance", "heightMeters", "avatar"}
ALLOWED_AVATAR_FIELDS = {"strategy", "referenceResourceId"}
ALLOWED_SET_FIELDS = {"id", "name", "description", "structure", "props", "lighting"}
ALLOWED_STRUCTURE_FIELDS = {"id", "shape", "dimensionsMeters", "positionMeters", "yawDegrees", "color"}
ALLOWED_PROP_FIELDS = {"id", "name", "acquisition", "heightMeters", "dimensionsMeters", "positionMeters", "yawDegrees", "support", "supportY", "color"}
ALLOWED_PROP_ACQUISITION_FIELDS = {"strategy", "query"}
ALLOWED_PROP_SUPPORT_FIELDS = {"objectId", "placement", "offsetMeters"}
ALLOWED_LIGHTING_FIELDS = {"keyIntensity", "ambientIntensity"}
ALLOWED_SCENE_FIELDS = {"id", "setId", "globalStartSeconds", "globalEndSeconds", "transitionIn", "transitionOut", "cast", "summary", "timeContext", "cameras", "entryState", "exitState"}
ALLOWED_CAST_FIELDS = {"characterId", "positionMeters", "yawDegrees"}
ALLOWED_SHOT_FIELDS = {"id", "sceneId", "startSeconds", "endSeconds", "camera", "legacy", "cameraId", "cameraOffsetFrame", "directive"}
ALLOWED_CAMERA_FIELDS = {"size", "angle", "move", "targets"}
ALLOWED_CAMERA_MOVE_FIELDS = {"kind", "distanceMeters"}
ALLOWED_SHOT_LEGACY_FIELDS = {"imagePrompt", "videoPrompt", "needsAdaptation"}
ALLOWED_ACTION_FIELDS = {"id", "kind", "sceneId", "characterId", "startSeconds", "endSeconds", "description", "trajectory", "objectId", "interaction", "intent", "binding", "keys", "eventId", "participantIds", "effects"}
ALLOWED_EXPR_FIELDS = {"id", "sceneId", "characterId", "intent", "binding", "keys"}
ALLOWED_NARRATION_FIELDS = {"id", "sceneId", "startSeconds", "endSeconds", "text", "audioResourceId"}
ALLOWED_RESOURCE_FIELDS = {"id", "role", "mimeType", "byteSize", "sha256"}
ALLOWED_VEC3_FIELDS = {"x", "y", "z"}


def is_valid_id(val: Any) -> bool:
    return isinstance(val, str) and bool(ID_REGEX.match(val))


def is_finite_number(val: Any) -> bool:
    return isinstance(val, (int, float)) and not isinstance(val, bool) and math.isfinite(val)


def validate_studio_story(data: Dict[str, Any], *, partial: bool = False) -> Tuple[bool, List[Dict[str, Any]]]:
    """Validates a studio story snapshot or draft dictionary.
    
    Returns (is_valid, list_of_errors) where each error is:
    {"path": "/json/pointer", "code": "ERROR_CODE", "message": "Human message"}
    """
    errors: List[Dict[str, Any]] = []

    def push_err(path: str, code: str, msg: str, **kwargs):
        err = {"path": path, "code": code, "message": msg}
        err.update(kwargs)
        errors.append(err)

    def check_unknown_fields(obj: Any, path: str, allowed: Set[str]):
        if isinstance(obj, dict):
            for k in obj.keys():
                if k not in allowed:
                    push_err(f"{path}/{k}", "UNKNOWN_FIELD", f"Unknown field '{k}' is forbidden. Use 'extensions' for custom metadata.")

    if not isinstance(data, dict):
        return False, [{"path": "/", "code": "INVALID_ROOT", "message": "Root must be an object."}]

    # Root fields check
    check_unknown_fields(data, "", ALLOWED_ROOT_FIELDS)
    if data.get("schemaVersion", "cozy-story-v1") not in ("cozy-story-v1", "cozy-story-v2"):
        push_err("/schemaVersion", "UNSUPPORTED_SCHEMA", "Unsupported story version")

    # 1. Project spec
    proj = data.get("project")
    duration = 0.0
    if not isinstance(proj, dict):
        push_err("/project", "MISSING_FIELD", "project configuration is required")
    else:
        check_unknown_fields(proj, "/project", ALLOWED_PROJECT_FIELDS)
        duration = float(proj.get("durationSeconds", 0.0))
        if not is_finite_number(duration) or duration <= 0 or duration > SOURCE_LIMITS["maxDurationSeconds"]:
            push_err(
                "/project/durationSeconds",
                "OUT_OF_BOUNDS",
                f"durationSeconds must be in (0, {SOURCE_LIMITS['maxDurationSeconds']}]",
            )
        aspect = proj.get("aspect", "9:16")
        if aspect not in ("9:16", "16:9"):
            push_err("/project/aspect", "INVALID_VARIANT", "aspect must be 9:16 or 16:9")

    # 2. Characters
    characters = data.get("characters") or []
    char_ids: Set[str] = set()
    if not isinstance(characters, list):
        push_err("/characters", "INVALID_VALUE", "characters must be a list")
    else:
        if len(characters) > SOURCE_LIMITS["maxCharacters"]:
            push_err("/characters", "LIMIT_EXCEEDED", f"Character count exceeds {SOURCE_LIMITS['maxCharacters']}")
        for idx, char in enumerate(characters):
            p = f"/characters/{idx}"
            if isinstance(char, dict):
                check_unknown_fields(char, p, ALLOWED_CHAR_FIELDS)
                c_id = char.get("id")
                if not is_valid_id(c_id):
                    push_err(f"{p}/id", "INVALID_ID", f"Invalid character ID '{c_id}'")
                elif c_id in char_ids:
                    push_err(f"{p}/id", "DUPLICATE_ID", f"Duplicate character ID: {c_id}")
                else:
                    char_ids.add(c_id)

                if not char.get("name") or not str(char.get("name")).strip():
                    push_err(f"{p}/name", "MISSING_FIELD", "Character name is required")
                
                height = char.get("heightMeters")
                if height is not None and (not is_finite_number(height) or height <= 0.2 or height > 3.0):
                    push_err(f"{p}/heightMeters", "OUT_OF_BOUNDS", "heightMeters must be in (0.2, 3.0]")

                if "avatar" in char and isinstance(char["avatar"], dict):
                    check_unknown_fields(char["avatar"], f"{p}/avatar", ALLOWED_AVATAR_FIELDS)

    # 3. Sets, Structures & Props
    sets = data.get("sets") or []
    set_ids: Set[str] = set()
    props_by_set: Dict[str, Set[str]] = {}

    if not isinstance(sets, list):
        push_err("/sets", "INVALID_VALUE", "sets must be a list")
    else:
        if len(sets) > SOURCE_LIMITS["maxSets"]:
            push_err("/sets", "LIMIT_EXCEEDED", f"Set count exceeds {SOURCE_LIMITS['maxSets']}")
        for idx, s in enumerate(sets):
            p = f"/sets/{idx}"
            if not isinstance(s, dict):
                continue
            check_unknown_fields(s, p, ALLOWED_SET_FIELDS)
            s_id = s.get("id")
            if not is_valid_id(s_id):
                push_err(f"{p}/id", "INVALID_ID", f"Invalid set ID '{s_id}'")
            elif s_id in set_ids:
                push_err(f"{p}/id", "DUPLICATE_ID", f"Duplicate set ID: {s_id}")
            else:
                set_ids.add(s_id)

            # Structure pieces validation
            structure = s.get("structure") or []
            if isinstance(structure, list):
                for st_idx, piece in enumerate(structure):
                    sp = f"{p}/structure/{st_idx}"
                    if isinstance(piece, dict):
                        check_unknown_fields(piece, sp, ALLOWED_STRUCTURE_FIELDS)
                        piece_id = piece.get("id")
                        if not is_valid_id(piece_id):
                            push_err(f"{sp}/id", "INVALID_ID", f"Invalid structure piece ID '{piece_id}'")
                        dim = piece.get("dimensionsMeters")
                        if not isinstance(dim, dict):
                            push_err(f"{sp}/dimensionsMeters", "MISSING_FIELD", "Structure piece dimensionsMeters is required")
                        else:
                            check_unknown_fields(dim, f"{sp}/dimensionsMeters", ALLOWED_VEC3_FIELDS)
                            for axis in ("x", "y", "z"):
                                val = dim.get(axis)
                                if not is_finite_number(val) or val <= 0:
                                    push_err(f"{sp}/dimensionsMeters/{axis}", "OUT_OF_BOUNDS", f"Structure piece dimension {axis} must be > 0")

            props_in_set: Set[str] = set()
            props = s.get("props") or []
            if isinstance(props, list):
                for p_idx, prop in enumerate(props):
                    pp = f"{p}/props/{p_idx}"
                    if isinstance(prop, dict):
                        check_unknown_fields(prop, pp, ALLOWED_PROP_FIELDS)
                        prop_id = prop.get("id")
                        if not is_valid_id(prop_id):
                            push_err(f"{pp}/id", "INVALID_ID", f"Invalid prop ID '{prop_id}'")
                        elif prop_id in props_in_set:
                            push_err(f"{pp}/id", "DUPLICATE_ID", f"Duplicate prop ID: {prop_id}")
                        else:
                            props_in_set.add(prop_id)

                        p_h = prop.get("heightMeters")
                        if p_h is not None and (not is_finite_number(p_h) or p_h <= 0):
                            push_err(f"{pp}/heightMeters", "OUT_OF_BOUNDS", "prop heightMeters must be positive")

                        p_dim = prop.get("dimensionsMeters")
                        if p_dim and isinstance(p_dim, dict):
                            check_unknown_fields(p_dim, f"{pp}/dimensionsMeters", ALLOWED_VEC3_FIELDS)
                            for axis in ("x", "y", "z"):
                                val = p_dim.get(axis, 0.0)
                                if not is_finite_number(val) or val <= 0:
                                    push_err(f"{pp}/dimensionsMeters/{axis}", "OUT_OF_BOUNDS", f"prop dimension {axis} must be > 0")

                        acq = prop.get("acquisition")
                        if acq and isinstance(acq, dict):
                            check_unknown_fields(acq, f"{pp}/acquisition", ALLOWED_PROP_ACQUISITION_FIELDS)
                            if acq.get("strategy") == "library" and not acq.get("query"):
                                push_err(f"{pp}/acquisition/query", "MISSING_FIELD", "Prop acquisition query required for library strategy")

                        supp = prop.get("support")
                        if supp and isinstance(supp, dict):
                            check_unknown_fields(supp, f"{pp}/support", ALLOWED_PROP_SUPPORT_FIELDS)

            props_by_set[s_id] = props_in_set

    # 4. Scenes
    scenes = data.get("scenes") or []
    scene_ids: Set[str] = set()
    scene_set_map: Dict[str, str] = {}
    scene_durations: Dict[str, float] = {}
    last_scene_end = 0.0

    if not isinstance(scenes, list):
        push_err("/scenes", "INVALID_VALUE", "scenes must be a list")
    else:
        if len(scenes) > SOURCE_LIMITS["maxScenes"]:
            push_err("/scenes", "LIMIT_EXCEEDED", f"Scene count exceeds {SOURCE_LIMITS['maxScenes']}")
        for idx, sc in enumerate(scenes):
            p = f"/scenes/{idx}"
            if not isinstance(sc, dict):
                continue
            check_unknown_fields(sc, p, ALLOWED_SCENE_FIELDS)
            sc_id = sc.get("id")
            if not is_valid_id(sc_id):
                push_err(f"{p}/id", "INVALID_ID", f"Invalid scene ID '{sc_id}'")
            elif sc_id in scene_ids:
                push_err(f"{p}/id", "DUPLICATE_ID", f"Duplicate scene ID: {sc_id}")
            else:
                scene_ids.add(sc_id)

            sc_set_id = sc.get("setId")
            if sc_set_id not in set_ids:
                push_err(f"{p}/setId", "SOURCE_REFERENCE_MISSING", f"Scene references unknown setId: {sc_set_id}")
            else:
                scene_set_map[sc_id] = sc_set_id

            s_start = sc.get("globalStartSeconds", 0.0)
            s_end = sc.get("globalEndSeconds", 0.0)
            if not is_finite_number(s_start) or s_start < 0:
                push_err(f"{p}/globalStartSeconds", "INVALID_TIME", "globalStartSeconds must be >= 0")
            if not is_finite_number(s_end) or s_end <= s_start:
                push_err(f"{p}/globalEndSeconds", "INVALID_TIME", "globalEndSeconds must be > globalStartSeconds")
            else:
                scene_durations[sc_id] = s_end - s_start

            if s_start < last_scene_end:
                push_err(f"{p}/globalStartSeconds", "TIME_OVERLAP", f"Scene overlaps previous scene ending at {last_scene_end}")
            if duration > 0 and s_end > duration:
                push_err(f"{p}/globalEndSeconds", "OUT_OF_BOUNDS", f"Scene end {s_end}s exceeds project duration {duration}s")
            last_scene_end = max(last_scene_end, s_end)

            cast = sc.get("cast") or []
            if isinstance(cast, list):
                for c_idx, c_item in enumerate(cast):
                    cp = f"{p}/cast/{c_idx}"
                    if isinstance(c_item, dict):
                        check_unknown_fields(c_item, cp, ALLOWED_CAST_FIELDS)
                        char_ref = c_item.get("characterId")
                        if char_ref not in char_ids:
                            push_err(f"{cp}/characterId", "SOURCE_REFERENCE_MISSING", f"Cast references unknown character: {char_ref}")

    # 5. Shots (timings are local to scene duration)
    shots = data.get("shots") or []
    shot_ids: Set[str] = set()
    shots_by_scene: Dict[str, List[Dict[str, Any]]] = {}

    if not isinstance(shots, list):
        push_err("/shots", "INVALID_VALUE", "shots must be a list")
    else:
        if len(shots) > SOURCE_LIMITS["maxShots"]:
            push_err("/shots", "LIMIT_EXCEEDED", f"Shot count exceeds {SOURCE_LIMITS['maxShots']}")
        for idx, sh in enumerate(shots):
            p = f"/shots/{idx}"
            if not isinstance(sh, dict):
                continue
            check_unknown_fields(sh, p, ALLOWED_SHOT_FIELDS)
            sh_id = sh.get("id")
            if not is_valid_id(sh_id):
                push_err(f"{p}/id", "INVALID_ID", f"Invalid shot ID '{sh_id}'")
            elif sh_id in shot_ids:
                push_err(f"{p}/id", "DUPLICATE_ID", f"Duplicate shot ID: {sh_id}")
            else:
                shot_ids.add(sh_id)

            sc_id = sh.get("sceneId")
            if sc_id not in scene_ids:
                push_err(f"{p}/sceneId", "SOURCE_REFERENCE_MISSING", f"Shot references unknown scene: {sc_id}")

            start = sh.get("startSeconds", 0.0)
            end = sh.get("endSeconds", 0.0)
            if not is_finite_number(start) or start < 0:
                push_err(f"{p}/startSeconds", "INVALID_TIME", "startSeconds must be >= 0")
            if not is_finite_number(end) or end <= start:
                push_err(f"{p}/endSeconds", "INVALID_TIME", "endSeconds must be > startSeconds")

            # Check shot does not exceed scene duration
            if sc_id in scene_durations:
                max_sc_dur = scene_durations[sc_id]
                if is_finite_number(end) and end > max_sc_dur + 1e-6:
                    push_err(
                        f"{p}/endSeconds",
                        "OUT_OF_BOUNDS",
                        f"Shot end {end}s exceeds scene duration {max_sc_dur}s in scene {sc_id}",
                    )

            cam = sh.get("camera")
            if cam and isinstance(cam, dict):
                check_unknown_fields(cam, f"{p}/camera", ALLOWED_CAMERA_FIELDS)
                targets = cam.get("targets") or []
                s_set_id = scene_set_map.get(sc_id)
                available_props = props_by_set.get(s_set_id) if s_set_id else set()
                for t_idx, tgt in enumerate(targets):
                    if tgt not in char_ids and tgt not in available_props:
                        push_err(
                            f"{p}/camera/targets/{t_idx}",
                            "SOURCE_REFERENCE_MISSING",
                            f"Target '{tgt}' not found in characters or scene set props",
                            targetId=tgt,
                        )

            if "legacy" in sh and isinstance(sh["legacy"], dict):
                check_unknown_fields(sh["legacy"], f"{p}/legacy", ALLOWED_SHOT_LEGACY_FIELDS)

            if sc_id:
                shots_by_scene.setdefault(sc_id, []).append(sh)

        for s_id, s_shots in shots_by_scene.items():
            s_shots_sorted = sorted(s_shots, key=lambda x: x.get("startSeconds", 0.0))
            cursor = 0.0
            for sh in s_shots_sorted:
                st = float(sh.get("startSeconds", 0.0))
                if abs(st - cursor) > 1e-3:
                    push_err(
                        f"/shots/{sh.get('id')}/startSeconds",
                        "SHOT_GAP_OR_OVERLAP",
                        f"Shot {sh.get('id')} starts at {st}s, expected contiguous cut at {cursor}s in scene {s_id}",
                    )
                cursor = float(sh.get("endSeconds", st))

    # 6. Actions & Expressions (timings local to scene duration)
    actions = data.get("actions") or []
    action_ids: Set[str] = set()

    if not isinstance(actions, list):
        push_err("/actions", "INVALID_VALUE", "actions must be a list")
    else:
        for idx, act in enumerate(actions):
            p = f"/actions/{idx}"
            if not isinstance(act, dict):
                continue
            check_unknown_fields(act, p, ALLOWED_ACTION_FIELDS)
            act_id = act.get("id")
            if not is_valid_id(act_id):
                push_err(f"{p}/id", "INVALID_ID", f"Invalid action ID '{act_id}'")
            elif act_id in action_ids:
                push_err(f"{p}/id", "DUPLICATE_ID", f"Duplicate action ID: {act_id}")
            else:
                action_ids.add(act_id)

            sc_id = act.get("sceneId")
            if sc_id and sc_id not in scene_ids:
                push_err(f"{p}/sceneId", "SOURCE_REFERENCE_MISSING", f"Action references unknown scene: {sc_id}")

            c_id = act.get("characterId")
            if c_id and c_id not in char_ids:
                push_err(f"{p}/characterId", "SOURCE_REFERENCE_MISSING", f"Action references unknown character: {c_id}")

            # Timing checks
            a_start = act.get("startSeconds")
            a_end = act.get("endSeconds")
            if a_start is not None and (not is_finite_number(a_start) or a_start < 0):
                push_err(f"{p}/startSeconds", "INVALID_TIME", "startSeconds must be >= 0")
            if a_end is not None:
                if not is_finite_number(a_end) or a_end <= (a_start or 0.0):
                    push_err(f"{p}/endSeconds", "INVALID_TIME", "endSeconds must be > startSeconds")
                if sc_id in scene_durations and a_end > scene_durations[sc_id] + 1e-6:
                    push_err(
                        f"{p}/endSeconds",
                        "OUT_OF_BOUNDS",
                        f"Action end {a_end}s exceeds scene duration {scene_durations[sc_id]}s in scene {sc_id}",
                    )

            if act.get("kind") == "interaction":
                obj_id = act.get("objectId")
                if obj_id:
                    s_set_id = scene_set_map.get(sc_id)
                    available_props = props_by_set.get(s_set_id) if s_set_id else set()
                    if obj_id not in available_props:
                        push_err(
                            f"{p}/objectId",
                            "SOURCE_REFERENCE_MISSING",
                            f"Interaction references unknown prop: {obj_id} in set {s_set_id}",
                        )

    # 7. Expressions
    expressions = data.get("expressions") or []
    if isinstance(expressions, list):
        for idx, expr in enumerate(expressions):
            p = f"/expressions/{idx}"
            if not isinstance(expr, dict):
                continue
            check_unknown_fields(expr, p, ALLOWED_EXPR_FIELDS)
            e_id = expr.get("id")
            if not is_valid_id(e_id):
                push_err(f"{p}/id", "INVALID_ID", f"Invalid expression ID '{e_id}'")
            elif e_id in action_ids:
                push_err(f"{p}/id", "DUPLICATE_ID", f"Duplicate expression/action ID: {e_id}")
            else:
                action_ids.add(e_id)

            sc_id = expr.get("sceneId")
            if sc_id and sc_id not in scene_ids:
                push_err(f"{p}/sceneId", "SOURCE_REFERENCE_MISSING", f"Expression references unknown scene: {sc_id}")

            c_id = expr.get("characterId")
            if c_id and c_id not in char_ids:
                push_err(f"{p}/characterId", "SOURCE_REFERENCE_MISSING", f"Expression references unknown character: {c_id}")

    # 8. Narration
    narration = data.get("narration") or []
    if isinstance(narration, list):
        for idx, narr in enumerate(narration):
            p = f"/narration/{idx}"
            if isinstance(narr, dict):
                check_unknown_fields(narr, p, ALLOWED_NARRATION_FIELDS)

    # 9. Resources
    resources = data.get("resources") or []
    resource_ids: Set[str] = set()
    if isinstance(resources, list):
        for idx, res in enumerate(resources):
            p = f"/resources/{idx}"
            if not isinstance(res, dict):
                continue
            check_unknown_fields(res, p, ALLOWED_RESOURCE_FIELDS)
            r_id = res.get("id")
            if not is_valid_id(r_id):
                push_err(f"{p}/id", "INVALID_ID", f"Invalid resource ID '{r_id}'")
            elif r_id in resource_ids:
                push_err(f"{p}/id", "DUPLICATE_ID", f"Duplicate resource ID: {r_id}")
            else:
                resource_ids.add(r_id)

    if data.get("schemaVersion") == "cozy-story-v2" and not errors:
        from app.schemas.studio_story import StudioSnapshot
        try:
            typed = StudioSnapshot.model_validate({"projectId": "validation", "revision": "validation", "title": "validation", **data})
            ledger = {}
            if typed.project.fps != 24:
                push_err("/project/fps", "INVALID_FPS", "Narrative v2 uses the canonical Studio clock of 24 fps")
            timeline_cursor = 0
            for scene in typed.scenes:
                if abs(scene.globalStartSeconds - timeline_cursor) > 1e-6:
                    push_err(f"/scenes/{scene.id}", "SCENE_GAP", "Scenes must cover the timeline without gaps")
                timeline_cursor = scene.globalEndSeconds
                cast_ids = {c.characterId for c in scene.cast}
                if len(cast_ids) != len(scene.cast):
                    push_err(f"/scenes/{scene.id}/cast", "DUPLICATE_ID", "Character is duplicated in cast")
                objects = props_by_set.get(scene.setId, set())
                entities = cast_ids | objects
                cameras = {c.id: c for c in scene.cameras}
                if len(cameras) != len(scene.cameras) or not cameras or len(cameras) > 32:
                    push_err(f"/scenes/{scene.id}/cameras", "INVALID_CAMERAS", "Provide 1–32 unique cameras")
                for camera in scene.cameras:
                    frames = [k.frame for k in camera.cameraKeys]
                    if not is_valid_id(camera.id) or frames != sorted(set(frames)) or frames[0] != 0:
                        push_err(f"/scenes/{scene.id}/cameras/{camera.id}", "INVALID_KEYS", "Unique sorted camera keys must begin at frame 0")
                local_shots = sorted((s for s in typed.shots if s.sceneId == scene.id), key=lambda s: s.startSeconds)
                if not local_shots or abs(local_shots[-1].endSeconds - scene_durations[scene.id]) > 1e-6:
                    push_err(f"/scenes/{scene.id}", "INCOMPLETE_SHOTS", "Shots must cover the entire scene")
                for shot in local_shots:
                    camera = cameras.get(shot.cameraId)
                    if not camera:
                        push_err(f"/shots/{shot.id}/cameraId", "SOURCE_REFERENCE_MISSING", "Unknown scene camera")
                    elif shot.cameraOffsetFrame + round((shot.endSeconds - shot.startSeconds) * typed.project.fps) - 1 > camera.cameraKeys[-1].frame:
                        push_err(f"/shots/{shot.id}/cameraOffsetFrame", "INVALID_KEYS", "Camera track does not cover this shot")
                entries = {s.entityId: s for s in scene.entryState}
                exits = {s.entityId: s for s in scene.exitState}
                if set(entries) != entities or set(exits) != entities or len(entries) != len(scene.entryState) or len(exits) != len(scene.exitState):
                    push_err(f"/scenes/{scene.id}", "INCOMPLETE_STATE", "One entry/exit state for every present character and prop")
                for state in scene.entryState + scene.exitState:
                    if not state.condition.strip():
                        push_err(f"/scenes/{scene.id}/{state.entityId}", "INVALID_STATE", "Entity condition cannot be empty")
                    if state.heldBy is not None and state.heldBy not in cast_ids:
                        push_err(f"/scenes/{scene.id}/{state.entityId}", "INVALID_HOLDER", "Object holder must be present")
                for entity, state in entries.items():
                    previous = ledger.get(entity)
                    if previous and (previous.condition != state.condition or previous.heldBy != state.heldBy):
                        push_err(f"/scenes/{scene.id}/entryState", "CONTINUITY_BREAK", f"Unexplained state change for {entity}")
                current = dict(entries)
                body_ranges = {}
                local_actions = [a for a in typed.actions if a.sceneId == scene.id]
                for action in sorted(local_actions, key=lambda a: a.endSeconds or 0):
                    if action.characterId not in cast_ids or not set(action.participantIds).issubset(cast_ids):
                        push_err(f"/actions/{action.id}", "INVALID_PARTICIPANTS", "Participants must belong to scene cast")
                    if any(not action.eventId or not any(p.characterId == partner and p.eventId == action.eventId for p in local_actions) for partner in action.participantIds):
                        push_err(f"/actions/{action.id}", "INCOMPLETE_INTERACTION", "Each partner needs an action with the same event ID")
                    if action.startSeconds is None or action.endSeconds is None or not action.description:
                        push_err(f"/actions/{action.id}", "INCOMPLETE_DIRECTIVE", "Action directive and timing required")
                    elif action.kind == "body":
                        for other in body_ranges.get(action.characterId, []):
                            if max(other.startSeconds, action.startSeconds) < min(other.endSeconds, action.endSeconds):
                                push_err(f"/actions/{action.id}", "CONFLICTING_ACTIONS", "Two body actions overlap for the same actor")
                        body_ranges.setdefault(action.characterId, []).append(action)
                    if action.kind == "interaction" and action.startSeconds is not None and action.endSeconds is not None:
                        interaction = action.interaction or {}
                        contact, release = interaction.get("contactSeconds"), interaction.get("releaseSeconds")
                        if not action.objectId or not action.eventId or not is_finite_number(contact) or not action.startSeconds <= contact < action.endSeconds:
                            push_err(f"/actions/{action.id}", "INVALID_INTERACTION", "Object interaction requires event ID, object and contact time")
                        elif release is not None and (not is_finite_number(release) or not contact <= release <= action.endSeconds):
                            push_err(f"/actions/{action.id}", "INVALID_INTERACTION", "Release must follow contact within the action")
                    for effect in action.effects:
                        if not effect.condition.strip():
                            push_err(f"/actions/{action.id}/effects", "INVALID_EFFECT", "Effect condition cannot be empty")
                        if effect.entityId not in entities or (effect.heldBy is not None and effect.heldBy not in cast_ids):
                            push_err(f"/actions/{action.id}/effects", "INVALID_EFFECT", "Effect must reference present entities")
                        current[effect.entityId] = effect
                    previous_time = -1
                    for point in action.trajectory or []:
                        time = point.get("timeSeconds")
                        position = point.get("positionMeters")
                        if (not is_finite_number(time) or time <= previous_time or action.startSeconds is None or action.endSeconds is None
                            or not action.startSeconds <= time <= action.endSeconds or not isinstance(position, dict)
                            or not all(is_finite_number(position.get(axis)) for axis in ("x", "y", "z"))):
                            push_err(f"/actions/{action.id}/trajectory", "INVALID_TRAJECTORY", "Trajectory requires increasing local times and metric positions within the action")
                        if is_finite_number(time):
                            previous_time = time
                for entity, state in current.items():
                    final = exits.get(entity)
                    if final and (state.condition != final.condition or state.heldBy != final.heldBy):
                        push_err(f"/scenes/{scene.id}/exitState", "UNEXPLAINED_STATE", f"Actions do not explain exit state of {entity}")
                ledger.update(exits)
            if not partial and abs(timeline_cursor - typed.project.durationSeconds) > 1e-6:
                push_err("/scenes", "INCOMPLETE_TIMELINE", "Scenes must cover the entire narration timeline")
            resources_by_id = {r.id: r for r in typed.resources}
            for narration in typed.narration:
                if narration.endSeconds > typed.project.durationSeconds or narration.endSeconds <= narration.startSeconds:
                    push_err(f"/narration/{narration.id}", "INVALID_TIME", "Narration exceeds the project timeline")
                if narration.sceneId is not None and narration.sceneId not in scene_ids:
                    push_err(f"/narration/{narration.id}", "SOURCE_REFERENCE_MISSING", "Narration references unknown scene")
                if narration.audioResourceId is not None and (narration.audioResourceId not in resources_by_id or resources_by_id[narration.audioResourceId].role != "narration-audio"):
                    push_err(f"/narration/{narration.id}", "SOURCE_REFERENCE_MISSING", "Narration references unknown audio resource")
        except (ValueError, TypeError, KeyError) as exc:
            push_err("/", "INVALID_V2", str(exc))
    return len(errors) == 0, errors
