// Additional v2 invariants. Scene times are global; shot/action times are local.
const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const number = value => typeof value === "number" && Number.isFinite(value);
const vector = value => value && [value.x, value.y, value.z].every(number);

export function validateNarrativeSnapshot(snapshot) {
 const errors = [], ledger = new Map(), fps = snapshot.project.fps || 24;
 const error = (path, code, message) => errors.push({ path, code, message });
 if (fps !== 24) error('/project/fps', 'INVALID_FPS', 'Narrative v2 uses the canonical Studio clock of 24 fps.');
 let cursor = 0;
 for (const scene of snapshot.scenes || []) {
  const path = `/scenes/${scene.id}`, duration = scene.globalEndSeconds - scene.globalStartSeconds;
  if (Math.abs(scene.globalStartSeconds - cursor) > 1e-6) error(path, "SCENE_GAP", "Narrative scenes must cover the timeline without gaps.");
  cursor = scene.globalEndSeconds;
  const cast = new Set((scene.cast || []).map(c => c.characterId));
  if (cast.size !== (scene.cast || []).length) error(path + '/cast', 'DUPLICATE_ID', 'A character can appear only once in the cast.');
  const props = snapshot.sets.find(s => s.id === scene.setId)?.props || [];
  const entities = new Set([...cast, ...props.map(p => p.id)]);
  const cameras = new Map();
  if (!Array.isArray(scene.cameras) || !scene.cameras.length || scene.cameras.length > 32) {
   error(path + "/cameras", "INVALID_CAMERAS", "Provide 1–32 named cameras for the scene.");
  }
  for (const camera of Array.isArray(scene.cameras) ? scene.cameras : []) {
   const cp = path + "/cameras/" + camera.id;
   if (!validId(camera.id) || cameras.has(camera.id)) error(cp, "INVALID_ID", "Camera ID must be safe and unique in its scene.");
   cameras.set(camera.id, camera);
   if (!["smooth", "linear", "hold"].includes(camera.interpolation || "smooth")) error(cp, "INVALID_INTERPOLATION", "Unknown camera interpolation.");
   const keys = camera.cameraKeys;
   if (!Array.isArray(keys) || !keys.length || keys.length > 64 || keys[0].frame !== 0) {
    error(cp, "INVALID_KEYS", "Camera keys must begin at frame 0 and contain 1–64 keys.");
    continue;
   }
   let last = -1;
   for (const key of keys) {
    if (!Number.isInteger(key.frame) || key.frame <= last || key.frame > 28799) error(cp, "INVALID_KEYS", "Key frames must be unique, increasing, and within Studio limits.");
    last = key.frame;
    const f = key.framing;
    if (!f || !vector(f.pos) || !number(f.yaw) || !number(f.pitch) || !number(f.fovDeg) || f.fovDeg < 14 || f.fovDeg > 90) error(cp, "INVALID_FRAMING", "Camera framing must contain metric position, radian angles and valid FOV.");
   }
  }
  const shots = (snapshot.shots || []).filter(s => s.sceneId === scene.id).sort((a, b) => a.startSeconds - b.startSeconds);
  if (!shots.length || Math.abs(shots.at(-1).endSeconds - duration) > 1e-6) error(path, "INCOMPLETE_SHOTS", "Shots must cover the entire scene.");
  for (const shot of shots) {
   const camera = cameras.get(shot.cameraId), offset = shot.cameraOffsetFrame ?? 0;
   if (!camera) error(`/shots/${shot.id}/cameraId`, "SOURCE_REFERENCE_MISSING", "Unknown scene camera.");
   if (!Number.isInteger(offset) || offset < 0) error(`/shots/${shot.id}/cameraOffsetFrame`, "INVALID_TIME", "Camera offset must be a positive integer or zero.");
   if (camera?.cameraKeys?.length && offset + Math.round((shot.endSeconds - shot.startSeconds) * fps) - 1 > camera.cameraKeys.at(-1).frame) error(`/shots/${shot.id}`, "INVALID_KEYS", "Camera track does not cover the shot.");
   if (shot.endSeconds > duration + 1e-6) error(`/shots/${shot.id}`, "OUT_OF_BOUNDS", "Shot exceeds scene duration.");
  }
  const readStates = (states, name) => {
   const map = new Map();
   if (!Array.isArray(states)) { error(path + "/" + name, "INCOMPLETE_STATE", "Entity states are required."); return map; }
   for (const state of states) {
    if (!state || !entities.has(state.entityId) || map.has(state.entityId) || typeof state.condition !== "string" || !state.condition.trim() || (state.heldBy != null && !cast.has(state.heldBy)) || (state.positionMeters != null && !vector(state.positionMeters))) error(path + "/" + name, "INVALID_STATE", "Entity state or holder is invalid.");
    if (state) map.set(state.entityId, state);
   }
   if (map.size !== entities.size) error(path + "/" + name, "INCOMPLETE_STATE", "One state is required for every character and prop.");
   return map;
  };
  const entry = readStates(scene.entryState, "entryState"), exit = readStates(scene.exitState, "exitState");
  for (const [id, state] of entry) {
   const previous = ledger.get(id);
   if (previous && (previous.condition !== state.condition || (previous.heldBy ?? null) !== (state.heldBy ?? null))) error(path + "/entryState", "CONTINUITY_BREAK", `Unexplained change of state for ${id}.`);
  }
  const current = new Map(entry);
  const localActions = (snapshot.actions || []).filter(a => a.sceneId === scene.id);
  for (const action of [...localActions].sort((a, b) => a.endSeconds - b.endSeconds)) {
   const ap = `/actions/${action.id}`;
   if (!cast.has(action.characterId) || !Array.isArray(action.participantIds ?? []) || (action.participantIds || []).some(id => !cast.has(id))) error(ap, "INVALID_PARTICIPANTS", "All participants must be in the scene cast.");
   if (!number(action.startSeconds) || !number(action.endSeconds) || action.startSeconds < 0 || action.endSeconds <= action.startSeconds || action.endSeconds > duration + 1e-6 || typeof action.description !== "string" || !action.description.trim()) error(ap, "INCOMPLETE_DIRECTIVE", "Provide an action directive and valid local timing.");
   if (action.eventId != null && !validId(action.eventId)) error(ap, "INVALID_EVENT", "Invalid interaction event ID.");
   if ((Array.isArray(action.participantIds) ? action.participantIds : []).some(id => !action.eventId || !localActions.some(partner => partner.characterId === id && partner.eventId === action.eventId))) error(ap, 'INCOMPLETE_INTERACTION', 'Each partner needs a coordinated action with the same event ID.');
   if (action.kind === 'interaction') {
    const contact = action.interaction?.contactSeconds, release = action.interaction?.releaseSeconds;
    if (!action.objectId || !action.eventId || !number(contact) || contact < action.startSeconds || contact >= action.endSeconds || (release != null && (!number(release) || release < contact || release > action.endSeconds))) error(ap, 'INVALID_INTERACTION', 'Object interaction requires an event ID and valid contact/release timing.');
   }
   if (action.trajectory != null) {
    let previousTime = -1;
    if (!Array.isArray(action.trajectory)) error(ap, 'INVALID_TRAJECTORY', 'Trajectory must be an array.');
    else for (const point of action.trajectory) {
     if (!point || !number(point.timeSeconds) || point.timeSeconds <= previousTime || point.timeSeconds < action.startSeconds || point.timeSeconds > action.endSeconds || !vector(point.positionMeters)) error(ap, 'INVALID_TRAJECTORY', 'Trajectory points need increasing local times and metric positions within the action.');
     previousTime = point?.timeSeconds;
    }
   }
   if (!Array.isArray(action.effects ?? [])) { error(ap, "INVALID_EFFECT", "Effects must be an array."); continue; }
   for (const effect of action.effects || []) {
    if (!effect || !entities.has(effect.entityId) || typeof effect.condition !== "string" || !effect.condition.trim() || (effect.heldBy != null && !cast.has(effect.heldBy))) error(ap, "INVALID_EFFECT", "Effect must reference a present entity and holder.");
    if (effect) current.set(effect.entityId, effect);
   }
  }
  for (const [id, state] of current) {
   const final = exit.get(id);
   if (final && (state.condition !== final.condition || (state.heldBy ?? null) !== (final.heldBy ?? null))) error(path + "/exitState", "UNEXPLAINED_STATE", `Actions do not explain the final state of ${id}.`);
  }
  for (const [id, state] of exit) ledger.set(id, state);
 }
 if (Math.abs(cursor - snapshot.project.durationSeconds) > 1e-6) error("/scenes", "INCOMPLETE_TIMELINE", "Scenes must cover the entire narration timeline.");
 return errors;
}
