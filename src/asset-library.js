/**
 * The 3D library pane's pure half: what a search row means, and what a download
 * is made of. No React, no bus, no network — the same separation the rest of
 * the studio keeps between a panel's markup and its rules.
 *
 * The one rule this file exists to hold is the licence gate's DISPLAY half: a
 * model the studio may not ship is still shown, marked, and refused — never
 * dropped silently. A card that simply vanishes reads as "the library does not
 * have it", and the user then cannot tell a licence refusal from a bad search.
 * The enforced half lives in `commands/library.js`, which refuses the download
 * whether or not anyone looked at a card first.
 */

/** What the search box starts on: a prop every set needs and any library has. */
export const DEFAULT_LIBRARY_QUERY = "chair";

/** Measured: keeps a fast typist to about one request per word. */
export const SEARCH_DEBOUNCE_MS = 120;

/**
 * How many results the pane asks for.
 *
 * Not a taste decision: every search answer is cloned into the command
 * receipt, and the bus refuses a receipt past 8 KiB ("use a detail cursor").
 * Measured on the live library, eight rows is about 5 KiB, twelve is about
 * 8.1 KiB — one row of headroom over the limit. Eight keeps a comfortable
 * margin while still filling the grid.
 */
export const DEFAULT_LIBRARY_LIMIT = 8;

/**
 * One search row as a card the pane can draw, or null when it cannot act on it.
 *
 * `usable` is the licence gate. It is deliberately the ONLY thing that disables
 * a card: a heavy model is worth a warning, but a 90k-triangle couch the
 * director wants is their call, while a licence the studio may not ship is not.
 */
export function libraryCard(row) {
	if (!row || typeof row !== "object" || Array.isArray(row)) return null;
	if (typeof row.id !== "string" || !row.id) return null;
	if (typeof row.title !== "string" || !row.title) return null;
	if (typeof row.downloadUrl !== "string" || !/^https?:\/\//.test(row.downloadUrl)) return null;
	const text = (value, fallback = "") => (typeof value === "string" && value ? value : fallback);
	return {
		id: row.id,
		title: row.title,
		creator: text(row.creator),
		license: text(row.license, "Unknown"),
		licenseUrl: text(row.licenseUrl),
		sourceUrl: text(row.sourceUrl),
		attribution: text(row.attribution),
		thumbnailUrl: text(row.thumbnailUrl),
		downloadUrl: row.downloadUrl,
		triCount: Number.isFinite(row.triCount) && row.triCount > 0 ? row.triCount : null,
		category: text(row.category),
		animated: row.animated === true,
		heightHint: Number.isFinite(row.heightHint) && row.heightHint > 0 ? row.heightHint : null,
		heavy: row.heavy === true,
		usable: row.usable === true,
	};
}

/** The cards of one search answer, unusable ones kept and marked. */
export function libraryCards(payload) {
	const rows = Array.isArray(payload?.models) ? payload.models : [];
	return rows.map(libraryCard).filter(Boolean);
}

/**
 * Why a card cannot be used, in one sentence for the card itself. Returning
 * null means there is no objection.
 */
export function libraryBlockedReason(card, isKo = false) {
	if (!card || card.usable) return null;
	return isKo
		? `\uB77C\uC774\uC120\uC2A4 ${card.license} \u2014 \uC774 \uC2A4\uD29C\uB514\uC624\uB294 \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4`
		: `Licence ${card.license} — this studio cannot ship it`;
}

/**
 * The arguments a download is made with, taken straight from the search row.
 *
 * Building them here rather than at the call site is what keeps a download
 * honest: every field the licence track needs is copied from the row the user
 * actually saw, so a card can never be downloaded as a different model, and a
 * `downloadUrl` a caller invented has no path into this function.
 */
export function libraryDownloadArgs(card, placement = {}) {
	const args = {
		id: card.id, title: card.title, license: card.license, downloadUrl: card.downloadUrl,
		sourceUrl: card.sourceUrl, creator: card.creator, attribution: card.attribution,
	};
	if (card.triCount !== null) args.triCount = card.triCount;
	if (card.heightHint !== null) args.heightHint = card.heightHint;
	for (const axis of ["x", "y", "z", "rot"]) {
		const value = Number(placement[axis]);
		if (Number.isFinite(value)) args[axis] = value;
	}
	return args;
}

/** A human line for one card: creator, size and kind, in that order. */
export function libraryCardMeta(card, isKo = false) {
	const parts = [];
	if (card?.creator) parts.push(card.creator);
	if (card?.triCount !== null && card?.triCount !== undefined) parts.push(`${card.triCount.toLocaleString("en-US")} tri`);
	if (card?.category) parts.push(card.category);
	if (card?.animated) parts.push(isKo ? "\uC560\uB2C8\uBA54\uC774\uC158" : "animated");
	return parts.join(" · ");
}

/**
 * One line for the list's own status area. `reason` is the sidecar's sentence
 * when the library has no key configured — the only actionable thing a
 * signed-out user can read, so it is shown verbatim rather than paraphrased.
 */
export function libraryStatusLine(state, isKo = false) {
	if (state?.status === "searching") return isKo ? "3D 라이브러리 검색 중…" : "Searching the 3D library…";
	if (state?.status === "error") return state.reason ?? "";
	if (state?.status === "idle") return isKo ? "소품을 검색하세요 — 의자, 램프, 자동차." : "Search for a prop — a chair, a lamp, a car.";
	if (!state?.cards?.length) return state?.reason ?? (isKo ? "일치하는 모델이 없습니다." : "No models matched.");
	return isKo
		? `${state.total}개 중 ${state.cards.length}개 모델`
		: `${state.cards.length} of ${state.total} models`;
}
