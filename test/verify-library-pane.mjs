#!/usr/bin/env node
/**
 * The 3D library pane's pure surface: which search rows become cards, which
 * cards are blocked and why, and the arguments a download is made with.
 *
 * The React component itself is not mounted here — `library-cards` is the
 * contract between the pane and the command bus, and it is what has to stay
 * honest when the bus answer changes shape.
 */
import assert from "node:assert/strict";

import { libraryBlockedReason, libraryCard, libraryCardMeta, libraryCards, libraryDownloadArgs, libraryStatusLine, DEFAULT_LIBRARY_QUERY, SEARCH_DEBOUNCE_MS } from "../src/asset-library.js";

const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };

const row = (over = {}) => ({
	id: "iMNqRzPwwe", title: "Chair", creator: "Quaternius", license: "CC0 1.0",
	licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", sourceUrl: "https://poly.pizza/m/iMNqRzPwwe",
	attribution: '"Chair" by Quaternius.', thumbnailUrl: "https://static.poly.pizza/thumb.webp",
	downloadUrl: "https://static.poly.pizza/model.glb", triCount: 216, category: "Furniture & Decor",
	tags: ["Chair"], animated: false, heightHint: 0.9, heavy: false, usable: true,
	...over,
});

check("the pane starts on a prop any library has, and debounces a fast typist", () => {
	assert.equal(DEFAULT_LIBRARY_QUERY, "chair");
	assert.ok(SEARCH_DEBOUNCE_MS > 0 && SEARCH_DEBOUNCE_MS < 500, "a search must not fire per keystroke");
});

check("one usable search row becomes one card with what a download needs", () => {
	const card = libraryCard(row());
	assert.equal(card.id, "iMNqRzPwwe");
	assert.equal(card.usable, true);
	assert.equal(card.downloadUrl, "https://static.poly.pizza/model.glb");
	assert.equal(card.heightHint, 0.9);
	assert.equal(card.triCount, 216);
});

check("a row without an id, a title or a file is dropped rather than drawn dead", () => {
	assert.equal(libraryCard({ ...row(), id: "" }), null);
	assert.equal(libraryCard({ ...row(), title: "" }), null);
	assert.equal(libraryCard({ ...row(), downloadUrl: "" }), null);
	assert.equal(libraryCard({ ...row(), downloadUrl: "javascript:alert(1)" }), null);
	assert.equal(libraryCard(null), null);
	assert.equal(libraryCard("a string"), null);
});

check("a licence the studio refuses is kept as a blocked card", () => {
	const cards = libraryCards({ models: [row(), row({ id: "reserved1", title: "Fancy Chair", usable: false, license: "All rights reserved" })] });
	assert.equal(cards.length, 2, "both are shown");
	assert.equal(cards[1].usable, false);
	assert.match(libraryBlockedReason(cards[1]), /this studio cannot ship it/);
	assert.equal(libraryBlockedReason(cards[0]), null, "a usable card has no objection");
	assert.equal(libraryBlockedReason(null), null);
});

check("a missing licence reads as Unknown rather than as permissive", () => {
	assert.equal(libraryCard({ ...row(), license: "" }).license, "Unknown");
	assert.equal(libraryCard({ ...row(), license: undefined }).license, "Unknown");
});

check("a heavy card is usable: the weight is a warning, the licence is the gate", () => {
	const card = libraryCard(row({ triCount: 400_000, heavy: true }));
	assert.equal(card.usable, true);
	assert.equal(card.heavy, true);
	assert.equal(libraryBlockedReason(card), null);
});

check("the card's meta line reads creator, size and kind in that order", () => {
	assert.equal(libraryCardMeta(libraryCard(row())), "Quaternius · 216 tri · Furniture & Decor");
	assert.equal(libraryCardMeta(libraryCard(row({ creator: "", category: "", triCount: null }))), "");
	// An animated model says so: it is dropped in at its bind pose, and that is
	// a surprise worth reading before the click, not after.
	assert.match(libraryCardMeta(libraryCard(row({ animated: true }))), /animated/);
});

check("the download args are copied from the row the user saw", () => {
	const card = libraryCard(row());
	const args = libraryDownloadArgs(card);
	assert.equal(args.id, card.id);
	assert.equal(args.title, "Chair");
	assert.equal(args.license, "CC0 1.0");
	assert.equal(args.downloadUrl, card.downloadUrl, "the URL comes from the row, never from a caller");
	assert.equal(args.attribution, card.attribution);
	assert.equal(args.triCount, 216);
	assert.equal(args.heightHint, 0.9);
	assert.equal("x" in args, false, "no placement was asked for");
});

check("a placement is carried only when it is a real number", () => {
	const args = libraryDownloadArgs(libraryCard(row()), { x: 2, z: -3, rot: 45, y: Number.NaN });
	assert.deepEqual({ x: args.x, z: args.z, rot: args.rot }, { x: 2, z: -3, rot: 45 });
	assert.equal("y" in args, false, "a NaN must not become a coordinate");
});

check("an unknown triangle count is left out, not sent as zero", () => {
	const args = libraryDownloadArgs(libraryCard(row({ triCount: 0 })));
	assert.equal("triCount" in args, false);
	const hinted = libraryDownloadArgs(libraryCard(row({ heightHint: null })));
	assert.equal("heightHint" in hinted, false);
});

check("a malformed search answer yields no cards, never a crash", () => {
	assert.deepEqual(libraryCards(null), []);
	assert.deepEqual(libraryCards({}), []);
	assert.deepEqual(libraryCards({ models: "nope" }), []);
	assert.deepEqual(libraryCards({ models: [null, undefined, 7] }), []);
});

check("the status line explains each state, including a library with no key", () => {
	assert.match(libraryStatusLine({ status: "searching" }), /Searching/);
	assert.match(libraryStatusLine({ status: "idle" }), /Search for a prop/);
	assert.equal(libraryStatusLine({ status: "ready", cards: [], total: 0, reason: "set POLY_PIZZA_API_KEY." }), "set POLY_PIZZA_API_KEY.",
		"the sidecar's own sentence is shown verbatim: it is the actionable part");
	assert.match(libraryStatusLine({ status: "ready", cards: [], total: 0, reason: null }), /No models matched/);
	assert.equal(libraryStatusLine({ status: "ready", cards: [1, 2], total: 262 }), "2 of 262 models");
	assert.match(libraryStatusLine({ status: "error", reason: "network down" }), /network down/);
});

console.log(`library pane: ${checks.length} checks passed`);
