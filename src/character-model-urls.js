import sakuraUrl from "../assets/SakuraFinal.vrm?url";
import char02Url from "../assets/CHAR_02.vrm?url";

const vrmUrls = { "sakura-vrm": sakuraUrl, "char-02-vrm": char02Url };
export const characterModelUrl = model => vrmUrls[model] ?? `/models/${model}.fbx`;
