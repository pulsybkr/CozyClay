// Pure catalogue shared by persistence, Studio tools and the browser.
export const CHARACTER_MODELS = Object.freeze([
	Object.freeze({ id: "y-bot-tpose", label: "Y Bot", format: "fbx" }),
	Object.freeze({ id: "x-bot-tpose", label: "X Bot", format: "fbx" }),
	Object.freeze({ id: "sakura-vrm", label: "Sakura", format: "vrm" }),
	Object.freeze({ id: "char-02-vrm", label: "CHAR 02", format: "vrm" }),
]);
export const CHARACTER_MODEL_IDS = Object.freeze(CHARACTER_MODELS.map(model => model.id));
export const GENERATED_VRM_PATTERN = '^vrm-mesh-[0-9a-f]{32}$';
export const generatedVrmAssetId = id => typeof id === 'string' && new RegExp(GENERATED_VRM_PATTERN).test(id) ? id.slice(4) : null;
export const isCharacterModel = id => CHARACTER_MODEL_IDS.includes(id) || Boolean(generatedVrmAssetId(id));
export const characterModel = id => CHARACTER_MODELS.find(model => model.id === id) ?? (generatedVrmAssetId(id) ? {id,label:'Generated avatar',format:'vrm'} : null);
export const isVrmModel = id => characterModel(id)?.format === "vrm";
