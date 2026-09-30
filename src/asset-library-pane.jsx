/**
 * The 3D library tab: search Poly Pizza, then drop a model into the set.
 *
 * This pane owns no transport of its own. The search goes through the editor's
 * own command bus (`asset.searchLibrary`) and so does the download
 * (`asset.downloadLibraryModel`), which is the same door the agent uses. One
 * implementation means a licence the pane greys out is a licence the agent
 * cannot install either, and the pane never has to re-derive what a download
 * needs from a result row.
 *
 * Why the key is not here: the library's search API sends no CORS headers, so a
 * page cannot read its response at all. The sidecar makes that call; this pane
 * only ever talks to its own origin.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useBus } from "./app-context.js";
import { ko, isKo } from "./locale.js";
import "./asset-library-pane.css";
import {
	DEFAULT_LIBRARY_QUERY,
	SEARCH_DEBOUNCE_MS,
	libraryBlockedReason,
	libraryCardMeta,
	libraryCards,
	libraryDownloadArgs,
	libraryStatusLine,
} from "./asset-library.js";

export { DEFAULT_LIBRARY_QUERY, SEARCH_DEBOUNCE_MS, libraryBlockedReason, libraryCard, libraryCardMeta, libraryCards, libraryDownloadArgs } from "./asset-library.js";

function LibraryCard({ card, onPlace, busy }) {
	const blocked = libraryBlockedReason(card, isKo);
	const [failed, setFailed] = useState(false);
	return (
		<button
			type="button"
			className={`asset-card library-card${card.usable ? "" : " library-card-blocked"}`}
			key={card.id}
			disabled={Boolean(blocked) || busy}
			title={blocked ?? ko(`Place ${card.title} at 1:1 into the scene`, `${card.title}을(를) 실제 크기로 씬에 놓기`)}
			onClick={() => onPlace(card)}
			data-library-id={card.id}
			data-library-usable={card.usable ? "yes" : "no"}
		>
			{card.thumbnailUrl && !failed ? (
				<img className="asset-card-preview" src={card.thumbnailUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
			) : (
				<span className="asset-card-preview library-card-placeholder" aria-hidden="true">◇</span>
			)}
			<span className="asset-card-label">{card.title}</span>
			<span className="asset-card-kind">{blocked ?? libraryCardMeta(card, isKo)}</span>
		</button>
	);
}

/**
 * The pane. `onPlaced` receives the receipt so a host can select the new object
 * and report what happened; the pane never writes to the document itself.
 */
export default function AssetLibraryPane({ onPlaced, limit = 12 }) {
	const bus = useBus();
	const [query, setQuery] = useState("");
	const [state, setState] = useState({ status: "idle", cards: [], total: 0, reason: null, warnings: [] });
	const [busyId, setBusyId] = useState(null);
	// One search at a time, and the last one wins: a slow earlier request must
	// never replace the results of a later one.
	const requestRef = useRef(0);

	const runSearch = useCallback(async (term) => {
		const clean = String(term ?? "").trim();
		if (!clean) { setState({ status: "idle", cards: [], total: 0, reason: null, warnings: [] }); return; }
		const ticket = requestRef.current + 1;
		requestRef.current = ticket;
		setState((previous) => ({ ...previous, status: "searching" }));
		let receipt;
		try {
			receipt = await bus.run("asset.searchLibrary", { query: clean, limit });
		} catch (error) {
			if (requestRef.current !== ticket) return;
			setState({ status: "error", cards: [], total: 0, reason: error?.message ?? String(error), warnings: [] });
			return;
		}
		if (requestRef.current !== ticket) return;
		const output = receipt?.output ?? {};
		setState({
			status: "ready",
			cards: libraryCards(output),
			total: Number.isFinite(output.total) ? output.total : 0,
			// A library with no key configured is not an error: it is a state the
			// user fixes once, and the sentence says which variable to set.
			reason: typeof output.reason === "string" ? output.reason : null,
			warnings: [...(receipt?.warnings ?? [])],
		});
	}, [bus, limit]);

	useEffect(() => {
		const timer = setTimeout(() => { void runSearch(query); }, SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [query, runSearch]);

	const place = useCallback(async (card) => {
		if (!card?.usable) return;
		setBusyId(card.id);
		try {
			const receipt = await bus.run("asset.downloadLibraryModel", libraryDownloadArgs(card));
			onPlaced?.(receipt, card);
		} finally {
			setBusyId(null);
		}
	}, [bus, onPlaced]);

	const heading = libraryStatusLine(state, isKo);

	return (
		<section className="assets-section library-pane">
			<h3 className="assets-section-title">{ko("3D library", "3D 라이브러리")}</h3>
			<div className="library-search">
				<input
					type="search"
					className="library-search-input"
					value={query}
					placeholder={ko("Search models (English works best)", "모델 검색 (영어 권장)")}
					aria-label={ko("Search the 3D library", "3D 라이브러리 검색")}
					onChange={(event) => setQuery(event.target.value)}
				/>
			</div>
			<p className="library-status" aria-live="polite">{heading}</p>
			{state.warnings.length ? (
				<ul className="library-warnings">
					{state.warnings.map((warning) => <li key={warning}>{warning}</li>)}
				</ul>
			) : null}
			{state.cards.length ? (
				<div className="assets-grid">
					{state.cards.map((card) => (
						<LibraryCard key={card.id} card={card} onPlace={place} busy={busyId !== null} />
					))}
				</div>
			) : null}
		</section>
	);
}
