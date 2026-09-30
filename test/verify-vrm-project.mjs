import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCharacterEntry, duplicateScene, readSceneDocument, serializeSceneDocument } from "../src/scenes.js";
import { readProjectDocument } from "../src/project.js";
import { CHARACTER_MODEL_IDS } from "../src/character-models.js";
import { elementByPath } from "../src/studio-elements.js";

for (const model of ["sakura-vrm", "char-02-vrm", "y-bot-tpose", "x-bot-tpose"]) {
	assert.equal(createCharacterEntry({ model }).model, model);
	assert.ok(CHARACTER_MODEL_IDS.includes(model));
	assert.ok(elementByPath("character.model").enum.includes(model), "Agent and persistence must accept the same models");
}
assert.equal(createCharacterEntry({ model: "unknown-model" }).model, "y-bot-tpose", "Legacy fallback stays valid");
const project = readProjectDocument(readFileSync(new URL("../public/scenes/vrm-dialogue.cclayproject", import.meta.url), "utf8"));
assert.equal(project.ok, true);
const document = project.project.scenesDocument;
assert.deepEqual(document.scenes[0].stage.characters.map(row => row.model), ["sakura-vrm", "char-02-vrm"]);
const reopened = readSceneDocument(serializeSceneDocument(document));
assert.equal(reopened.status, "valid");
assert.deepEqual(reopened.document.scenes[0].stage.characters, document.scenes[0].stage.characters);
const copies = duplicateScene(document.scenes, 0);
copies[1].stage.characters[0].x = 2;
assert.notEqual(copies[0].stage.characters[0].x, copies[1].stage.characters[0].x);
assert.equal(copies[1].stage.characters[0].model, "sakura-vrm");
console.log("PASS VRM catalogue, agent fields, project reopen and independent scene duplication");
