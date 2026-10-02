import { useState, useEffect, useRef } from "react";
import { ko } from "../locale.js";
import { useBus } from "../app-context.js";
import { createProductionPilot, issueText } from "../production/agent-pilot.js";
import { createAgentTransport, nextSelectedModel, modelIsSelectable, effortOptions, storeModel } from "../workflow/agent-client.js";
import {
	listConnections,
	createConnection,
	updateConnection,
	removeConnection,
	testConnection,
	fetchFullSnapshotProgressive,
} from "../production/source-client.js";

export default function ProductionPanel({
	isOpen,
	onClose,
	productionDomain,
	buildAgentContext,
	readEditor,
}) {
	const bus = useBus();
	const [connections, setConnections] = useState([]);
	const [selectedConnId, setSelectedConnId] = useState("");
	const [projectId, setProjectId] = useState("");
	const [loading, setLoading] = useState(false);
	const [progress, setProgress] = useState(null);
	const [error, setError] = useState(null);
	const [testResult, setTestResult] = useState(null);

	// Config modal state
	const [configOpen, setConfigOpen] = useState(false);
	const [configMode, setConfigMode] = useState("create"); // "create" | "edit"
	const [cfgName, setCfgName] = useState("");
	const [cfgUrl, setCfgUrl] = useState("http://127.0.0.1:8000");
	const [cfgKey, setCfgKey] = useState("");

	// Loaded source snapshot state (local candidate before or after apply)
	const [loadedCandidate, setLoadedCandidate] = useState(null);
	const [syncTime, setSyncTime] = useState(null);
	const [applySuccess, setApplySuccess] = useState(false);
	const abortRef = useRef(null);

	// Execution / controller state
	const [plan, setPlan] = useState(null); // compiled plan units
	const [planIssues, setPlanIssues] = useState([]);
	const [prepareBusy, setPrepareBusy] = useState(false);
	const [runBusy, setRunBusy] = useState(false);
	const [activeRunId, setActiveRunId] = useState(null);
	const [unitStatuses, setUnitStatuses] = useState({}); // unitId → state string
	const [execError, setExecError] = useState(null);
	// Grant state: user must explicitly consent before launch
	const [grantPending, setGrantPending] = useState(false);
 const [pilotModels, setPilotModels] = useState([]);
 const [pilotProviders, setPilotProviders] = useState([]);
 const [pilotModel, setPilotModel] = useState('');
 const [pilotEffort, setPilotEffort] = useState('');
 const [pilotBusy, setPilotBusy] = useState(false);
 const [pilotActivity, setPilotActivity] = useState('');
 const pilotRef = useRef(null);
 const agentTransport = useRef(null);
 if(!agentTransport.current)agentTransport.current=createAgentTransport({surface:'studio'});
 useEffect(()=>{
  if(!isOpen)return;
  let cancelled=false;
  agentTransport.current.models().then(({models,providers})=>{
   if(cancelled)return;
   setPilotModels(models);setPilotProviders(providers);
   setPilotModel(current=>nextSelectedModel(providers,models,current));
  }).catch(error=>{if(!cancelled)setPilotActivity('Service agent : '+error.message);});
  return ()=>{cancelled=true;};
 },[isOpen]);
 async function handleAgentPilot() {
  if(pilotBusy || runBusy)return;
  setPilotBusy(true);setExecError(null);
  pilotRef.current=createProductionPilot({domain:productionDomain,bus,transport:agentTransport.current,
   buildContext:buildAgentContext,readEditor,onEvent:event=>{
    if(event.type==='step')setPilotActivity(event.task.id);
    else if(event.type==='refresh')setPilotActivity(event.message);
    else if(event.type==='tool.start')setPilotActivity(event.name);
    else if(event.type==='text.delta')setPilotActivity(value=>(value+event.text).slice(-800));
   }});
  try {await pilotRef.current.run({model:pilotModel,effort:pilotEffort});setPilotActivity('Production vérifiée.');}
  catch(error){setExecError('Pilotage IA : '+error.message);}
  finally{setPilotBusy(false);}
 }
 useEffect(()=>()=>{void pilotRef.current?.stop();},[]);

	// Production domain sync
	const productionDoc = productionDomain?.production || productionDomain?.read?.();
 const currentSource = productionDoc?.source;
 useEffect(()=>{
  const units=productionDoc?.plan?.units || [];
  setPlan(units.length?units:null);
  setPlanIssues(productionDoc?.plan?.issues || []);
 },[productionDoc?.plan]);
 async function runProduction(action, args) {
  const receipt = await bus.run(action, args);
  if (receipt?.ok === false) throw new Error(receipt.message || receipt.summary || "Production command failed");
  return receipt;
 }
 useEffect(() => {
  const checkpoint = productionDoc?.executionCheckpoint;
  setUnitStatuses(Object.fromEntries((checkpoint?.units || []).map(u => [u.unitId, u.state])));
  const latestRun = checkpoint?.runs?.at(-1);
  if (latestRun) setActiveRunId(latestRun.runId);
 }, [productionDoc?.executionCheckpoint]);
 useEffect(() => () => abortRef.current?.abort(), []);

	useEffect(() => {
		if (isOpen) {
			loadConnections();
		}
	}, [isOpen]);

	useEffect(() => {
		if (currentSource && !loadedCandidate) {
			setLoadedCandidate({
				snapshot: currentSource.snapshot || (currentSource.characters ? currentSource : null),
				manifest: currentSource.manifest || null,
			});
			if (currentSource.projectId) {
				setProjectId(currentSource.projectId);
			}
			if (currentSource.connectionId) {
				setSelectedConnId(currentSource.connectionId);
			}
		}
	}, [currentSource]);

	async function loadConnections() {
		try {
			const list = await listConnections();
			setConnections(list);
			if (list.length > 0 && !selectedConnId) {
				setSelectedConnId(list[0].id);
			}
		} catch (err) {
			console.warn("Could not load connections:", err);
		}
	}

	const selectedConn = connections.find((c) => c.id === selectedConnId) || null;

	function openConfigFor(mode) {
		setConfigMode(mode);
		if (mode === "edit" && selectedConn && !selectedConn.isEnv) {
			setCfgName(selectedConn.name);
			setCfgUrl(selectedConn.baseUrl);
		} else {
			setCfgName("");
			setCfgUrl("http://127.0.0.1:8000");
		}
		setCfgKey("");
		setConfigOpen(true);
		setError(null);
	}

	async function handleTestConnection(connId) {
		const targetId = connId || selectedConnId;
		if (!targetId) return;
		setTestResult({ testing: true });
		try {
			const res = await testConnection(targetId);
			setTestResult({
				ok: true,
				latencyMs: res.latencyMs,
				sections: res.supportedSections?.join(", "),
			});
		} catch (err) {
			setTestResult({
				ok: false,
				error: err.message,
			});
		}
	}

	async function handleSaveConnection(e) {
		e.preventDefault();
		if (!cfgName || !cfgUrl) return;
		setError(null);
		try {
			if (configMode === "edit" && selectedConnId && !selectedConn?.isEnv) {
				await updateConnection(selectedConnId, {
					name: cfgName,
					baseUrl: cfgUrl,
					credential: cfgKey.trim() ? cfgKey.trim() : undefined,
				});
			} else {
				const created = await createConnection({
					name: cfgName,
					baseUrl: cfgUrl,
					credential: cfgKey.trim() ? cfgKey.trim() : undefined,
				});
				setSelectedConnId(created.id);
			}
			setCfgKey(""); // Never retain secret in memory/state
			setConfigOpen(false);
			await loadConnections();
		} catch (err) {
			setError(`Erreur de configuration: ${err.message}`);
		}
	}

	async function handleDeleteConnection() {
		if (!selectedConnId || selectedConn?.isEnv) return;
		if (!window.confirm?.(ko("Supprimer cette connexion ?", "이 연결을 삭제하시겠습니까?"))) return;
		setError(null);
		try {
			await removeConnection(selectedConnId);
			setConfigOpen(false);
			const list = await listConnections();
			setConnections(list);
			setSelectedConnId(list[0]?.id || "");
		} catch (err) {
			setError(`Erreur de suppression: ${err.message}`);
		}
	}

	async function handleFetchProject() {
		if (!selectedConnId || !projectId.trim()) return;
		if (abortRef.current) {
			abortRef.current.abort();
		}
		const controller = new AbortController();
		abortRef.current = controller;

		setLoading(true);
		setError(null);
		setProgress({ phase: "start", message: "Initialisation..." });

		try {
			const result = await fetchFullSnapshotProgressive(selectedConnId, projectId.trim(), {
				onProgress: (p) => setProgress(p),
				signal: controller.signal,
			});

			setLoadedCandidate(result);
			setSyncTime(new Date().toLocaleTimeString());
			setProgress(null);
		} catch (err) {
			if (err.code !== "CANCELLED") {
				setError(`Échec de la récupération: ${err.message}`);
			}
			setProgress(null);
		} finally {
			setLoading(false);
		}
	}

	function handleApplyToProduction() {
		if (!loadedCandidate?.snapshot || !productionDomain) return;
		try {
			productionDomain.recordAction("production.set_source", () => {
				productionDomain.setSourceSnapshot(
					loadedCandidate.snapshot,
					loadedCandidate.manifest,
					selectedConnId,
					projectId
				);
			});
			// Reset execution state when a new source is applied
			setPlan(null);
			setPlanIssues([]);
			setActiveRunId(null);
			setUnitStatuses({});
			setExecError(null);
			setGrantPending(false);
			setApplySuccess(true);
			setTimeout(() => setApplySuccess(false), 4000);
		} catch (err) {
			setError(`Erreur lors de l'application : ${err.message}`);
		}
	}

	// --- Execution handlers ---

	async function handlePrepare() {
		const doc = productionDomain?.read?.();
		const prodId = doc?.productionId;
		if (!prodId) {
			setExecError("Aucune production active disponible.");
			return;
		}

		setPrepareBusy(true);
		setExecError(null);
		setPlan(null);
		setPlanIssues([]);
		setGrantPending(false);
		try {
			await runProduction("production.prepare", { productionId: prodId });
			const updatedDoc = productionDomain.read();
			const units = updatedDoc?.plan?.units ?? [];
			setPlan(Array.isArray(units) ? units : Object.values(units));
			setPlanIssues(updatedDoc?.plan?.issues ?? []);
			if (Array.isArray(units) && units.length > 0) {
				setGrantPending(true); // Ask for consent before running
			}
		} catch (err) {
			setExecError(`Erreur de préparation : ${err.message}`);
		} finally {
			setPrepareBusy(false);
		}
	}

	async function handleGrantAndRunStage(stage) {
		const doc = productionDomain?.read?.();
		const prodId = doc?.productionId;
		if (!prodId) return;

		setRunBusy(true);
		setExecError(null);
		try {
			const res = await runProduction("production.runStage", {
				productionId: prodId,
				stage,
				expectedPlanRevision: doc.planRevision,
			});
			const runId = res?.output?.runId || res?.runId;
			setActiveRunId(runId ?? null);
			setGrantPending(true);

			const updatedDoc = productionDomain.read();
			const chkUnits = updatedDoc?.executionCheckpoint?.units || [];
			const statusMap = {};
			for (const u of chkUnits) {
				statusMap[u.unitId] = u.state;
			}
			setUnitStatuses(statusMap);
		} catch (err) {
			setExecError(`Erreur d'exécution : ${err.message}`);
		} finally {
			setRunBusy(false);
		}
	}

	async function handlePause() {
		const doc = productionDomain?.read?.();
		const prodId = doc?.productionId;
		if (!prodId || !activeRunId) return;
		try {
			await runProduction("production.pause", { productionId: prodId, runId: activeRunId });
		} catch (err) {
			setExecError(`Erreur de pause : ${err.message}`);
		}
	}

	async function handleResume() {
		const doc = productionDomain?.read?.();
		const prodId = doc?.productionId;
		if (!prodId || !activeRunId) return;
		try {
			await runProduction("production.resume", { productionId: prodId, runId: activeRunId });
			const updatedDoc = productionDomain.read();
			const chkUnits = updatedDoc?.executionCheckpoint?.units || [];
			const statusMap = {};
			for (const u of chkUnits) {
				statusMap[u.unitId] = u.state;
			}
			setUnitStatuses(statusMap);
		} catch (err) {
			setExecError(`Erreur de reprise : ${err.message}`);
		}
	}

	async function handleRetryUnit(unitId) {
		const doc = productionDomain?.read?.();
		const prodId = doc?.productionId;
		if (!prodId) return;
		try {
			await runProduction("production.retry", { productionId: prodId, unitId });
			setUnitStatuses(Object.fromEntries((productionDomain.read().executionCheckpoint?.units || []).map(u => [u.unitId, u.state])));
		} catch (err) {
			setExecError(`Erreur de relance : ${err.message}`);
		}
	}

	if (!isOpen) return null;

	const snapshot = loadedCandidate?.snapshot;
	const manifest = loadedCandidate?.manifest;

	const charCount = snapshot?.characters?.length ?? 0;
	const setCount = snapshot?.sets?.length ?? 0;
	const sceneCount = snapshot?.scenes?.length ?? 0;
	const shotCount = snapshot?.shots?.length ?? 0;

	return (
		<aside className="panel production-drawer" aria-label="Production distante">
			<div className="production-drawer-header">
				<h3>{ko("Production distante", "원격 프로덕션")}</h3>
				<button
					type="button"
					className="production-close-btn"
					onClick={onClose}
					aria-label="Fermer"
				>
					✕
				</button>
			</div>

			<div className="production-drawer-content">
				{/* 1. Connection section */}
				<div className="production-section connection-box">
					<div className="production-row">
						<label htmlFor="prod-conn-select">{ko("Connexion :", "연결 :")}</label>
						<select
							id="prod-conn-select"
							value={selectedConnId}
							onChange={(e) => {
								setSelectedConnId(e.target.value);
								setTestResult(null);
							}}
							disabled={loading}
						>
							{connections.map((c) => (
								<option key={c.id} value={c.id}>
									{c.name} ({c.baseUrl}) {c.credentialConfigured ? "🔑" : "⚠️ sans clé"}
								</option>
							))}
							{connections.length === 0 && (
								<option value="">{ko("Aucune connexion configurée", "구성된 연결 없음")}</option>
							)}
						</select>
						<button
							type="button"
							className="btn-small"
							onClick={() => {
								if (configOpen) {
									setConfigOpen(false);
								} else {
									openConfigFor(selectedConn && !selectedConn.isEnv ? "edit" : "create");
								}
							}}
						>
							{configOpen ? ko("Fermer", "닫기") : ko("Configurer", "설정")}
						</button>
					</div>

					{selectedConn && !selectedConn.credentialConfigured && (
						<div style={{ color: "var(--warning-color, #e6a700)", fontSize: "12px", marginTop: "4px" }}>
							⚠️ {ko(
								"Aucune clé secrète configurée. Cliquez sur Configurer pour renseigner le Bearer token.",
								"비밀 키가 구성되지 않았습니다. Bearer 토큰을 입력하려면 설정을 클릭하세요."
							)}
						</div>
					)}

					{/* Inline config form */}
					{configOpen && (
						<form className="production-config-form" onSubmit={handleSaveConnection}>
							<div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
								{selectedConn && !selectedConn.isEnv && (
									<button
										type="button"
										className={`btn-small ${configMode === "edit" ? "btn-primary" : "btn-secondary"}`}
										onClick={() => openConfigFor("edit")}
									>
										{ko("Modifier la connexion", "연결 수정")}
									</button>
								)}
								<button
									type="button"
									className={`btn-small ${configMode === "create" ? "btn-primary" : "btn-secondary"}`}
									onClick={() => openConfigFor("create")}
								>
									{ko("+ Nouvelle connexion", "+ 새 연결")}
								</button>
							</div>

							<div className="form-field">
								<label>{ko("Nom de la connexion :", "연결 이름 :")}</label>
								<input
									type="text"
									value={cfgName}
									onChange={(e) => setCfgName(e.target.value)}
									placeholder="Mon workflow distant"
									required
								/>
							</div>
							<div className="form-field">
								<label>{ko("URL de l'API :", "API URL :")}</label>
								<input
									type="url"
									value={cfgUrl}
									onChange={(e) => setCfgUrl(e.target.value)}
									placeholder="http://127.0.0.1:8000"
									required
								/>
							</div>
							<div className="form-field">
								<label>{ko("Clé secrète (Bearer token) :", "비밀 키 (Bearer 토큰) :")}</label>
								<input
									type="password"
									value={cfgKey}
									onChange={(e) => setCfgKey(e.target.value)}
									placeholder={configMode === "edit" && selectedConn?.credentialConfigured ? "Laisser vide pour conserver la clé actuelle" : "Clé secrète d'accès (write-only)"}
									autoComplete="new-password"
								/>
								<small className="field-hint">
									{ko(
										"Envoyée directement au sidecar local. Jamais stockée dans le navigateur.",
										"로컬 사이드카로만 전송되며 브라우저에 저장되지 않습니다."
									)}
								</small>
							</div>
							<div className="form-actions" style={{ display: "flex", gap: "8px", justifyContent: "space-between" }}>
								<div style={{ display: "flex", gap: "6px" }}>
									<button type="submit" className="btn-primary btn-small">
										{configMode === "edit" ? ko("Mettre à jour", "업데이트") : ko("Enregistrer", "저장")}
									</button>
									<button
										type="button"
										className="btn-secondary btn-small"
										onClick={() => setConfigOpen(false)}
									>
										{ko("Annuler", "취소")}
									</button>
								</div>
								{configMode === "edit" && selectedConn && !selectedConn.isEnv && (
									<button
										type="button"
										className="btn-danger btn-small"
										style={{ color: "#ff6b6b", background: "transparent", border: "1px solid #ff6b6b" }}
										onClick={handleDeleteConnection}
									>
										{ko("Supprimer", "삭제")}
									</button>
								)}
							</div>
						</form>
					)}

					<div className="production-row test-row">
						<button
							type="button"
							className="btn-link"
							onClick={() => handleTestConnection()}
							disabled={!selectedConnId || loading}
						>
							{ko("Tester la connexion", "연결 테스트")}
						</button>
						{testResult?.testing && <span>{ko("Test en cours...", "테스트 중...")}</span>}
						{testResult?.ok && (
							<span className="status-success">
								✓ {testResult.latencyMs}ms ({testResult.sections})
							</span>
						)}
						{testResult?.ok === false && (
							<span className="status-error">✕ {testResult.error}</span>
						)}
					</div>
				</div>

				{/* 2. Project ID & Fetch */}
				<div className="production-section project-input-box">
					<label htmlFor="prod-project-id">{ko("ID du projet :", "프로젝트 ID :")}</label>
					<div className="production-row">
						<input
							id="prod-project-id"
							type="text"
							value={projectId}
							onChange={(e) => setProjectId(e.target.value)}
							placeholder="ex: 88LTeGwzPgE"
							disabled={loading}
						/>
						<button
							type="button"
							className="btn-primary"
							onClick={handleFetchProject}
							disabled={loading || pilotBusy || runBusy || !selectedConnId || !projectId.trim()}
						>
							{loading ? ko("Récupération…", "가져오는 중…") : ko("Récupérer", "가져오기")}
						</button>
					</div>

					{progress && (
						<div className="fetch-progress-card">
							<div className="progress-label">{progress.message}</div>
							{progress.totalCount > 0 && (
								<div className="progress-bar-bg">
									<div
										className="progress-bar-fill"
										style={{
											width: `${Math.min(100, Math.round((progress.loadedCount / progress.totalCount) * 100))}%`,
										}}
									/>
								</div>
							)}
						</div>
					)}

					{error && <div className="production-error-banner">{error}</div>}
				</div>

				{/* 3. Snapshot summary & steps */}
				{snapshot && (
					<div className="production-section snapshot-summary">
						<div className="summary-title-row">
							<h4>{snapshot.title || `Projet ${snapshot.projectId}`}</h4>
							<span className="tag revision-tag">r{snapshot.revision}</span>
						</div>
						<div className="summary-meta">
							<span>{snapshot.project?.durationSeconds} s</span>
							<span>·</span>
							<span>{snapshot.project?.aspect || "9:16"}</span>
							<span>·</span>
							<span>{snapshot.project?.fps || 24} fps</span>
						</div>
						<div className="summary-counts">
							{charCount} {ko("personnages", "캐릭터")} · {setCount} {ko("décor", "세트")} · {sceneCount} {ko("scène", "씬")} · {shotCount} {ko("plans", "샷")}
						</div>
						{syncTime && (
							<div className="sync-status-row">
								<small>{ko("Synchronisation :", "동기화 :")} {syncTime}</small>
								<button
									type="button"
									className="btn-link"
									onClick={handleFetchProject}
									disabled={loading}
								>
									{ko("Actualiser", "새로고침")}
								</button>
							</div>
						)}

						{/* Action button to bind snapshot into local project */}
						<div className="production-apply-bar">
							<button
								type="button"
								className="btn-primary btn-block"
								onClick={handleApplyToProduction}
								disabled={loading || pilotBusy || runBusy}
							>
								{currentSource?.snapshot?.projectId === snapshot.projectId
									? ko("Actualiser cette production", "이 프로덕션 업데이트")
									: ko("Utiliser cette production", "이 프로덕션 사용")}
							</button>
							{applySuccess && (
								<div style={{ color: "#22c55e", fontSize: "13px", marginTop: "8px", textAlign: "center", fontWeight: "bold" }}>
									✓ {ko("Source enregistrée ; préparer puis exécuter les étapes.", "로컬 씬에 프로덕션이 적용되었습니다!")}
								</div>
							)}
						</div>
					</div>
				)}

				{/* 4. Execution section — prepare → grant → run */}
				<div className="production-section execution-box" style={{ marginTop: "12px" }}>
					<h5 style={{ margin: "0 0 8px" }}>{ko("Exécution", "실행")}</h5>

					<button
						type="button"
						className="btn-primary btn-block"
						onClick={handlePrepare}
						disabled={prepareBusy || runBusy || pilotBusy || !currentSource}
					>
						{prepareBusy
							? ko("Compilation…", "컴파일 중…")
							: ko("Préparer le plan", "계획 준비")}
					</button>

					{planIssues.length > 0 && (
						<div style={{ marginTop: "8px" }}>
							<strong style={{ fontSize: "12px", color: "var(--warning-color, #e6a700)" }}>
								⚠️ {planIssues.length} {ko("problème(s)", "문제")}
							</strong>
							<ul style={{ margin: "4px 0 0 16px", fontSize: "11px", maxHeight: "80px", overflow: "auto" }}>
								{planIssues.slice(0, 6).map((issue, i) => (
									<li key={i}>{issueText(issue)}</li>
								))}
							</ul>
						</div>
					)}

					{plan && plan.length > 0 && (
						<div style={{ marginTop: "10px" }}>
       <div className="production-agent-pilot" style={{padding:'10px',border:'1px solid var(--border)',borderRadius:'6px',marginBottom:'10px'}}>
        <strong>Pilotage IA du Studio</strong>
        <p style={{fontSize:'12px'}}>L’agent lit chaque scène et réalise les directives : nouveaux VRM Atelier, décor et objets, caméras, prises Kimodo et interactions. Il vérifie chaque étape avant de poursuivre. Les générations utilisent les services configurés du Studio.</p>
        <label style={{display:'block'}}>Modèle IA <select style={{maxWidth:'100%',display:'block'}} value={pilotModel} disabled={pilotBusy || runBusy} onChange={event=>{setPilotModel(event.target.value);setPilotEffort('');storeModel(event.target.value);}}>
         <option value="">Choisir un modèle disponible</option>
         {pilotModels.map(model=><option key={model.id} value={model.id} disabled={!modelIsSelectable(pilotProviders,model.id)}>{model.label || model.id}</option>)}
        </select></label>
        {effortOptions(pilotModels.find(model=>model.id===pilotModel)).length>0 && <label> Raisonnement <select value={pilotEffort} disabled={pilotBusy} onChange={event=>setPilotEffort(event.target.value)}><option value="">Par défaut</option>{effortOptions(pilotModels.find(model=>model.id===pilotModel)).map(effort=><option key={effort} value={effort}>{effort}</option>)}</select></label>}
        <div style={{marginTop:'8px',display:'flex',gap:'6px'}}>
         <button type="button" className="btn-primary btn-small" disabled={pilotBusy || runBusy || !pilotModel || !buildAgentContext} onClick={handleAgentPilot}>{productionDoc?.agentExecution ? 'Reprendre le pilotage IA' : 'Lancer la réalisation par l’IA'}</button>
         {pilotBusy && <button type="button" className="btn-secondary btn-small" onClick={()=>void pilotRef.current?.stop().catch(error=>setExecError(error.message))}>Arrêter le pilote</button>}
        </div>
        {pilotActivity && <p role="status" style={{fontSize:'12px',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{pilotActivity}</p>}
        {Object.entries(productionDoc?.agentExecution?.steps || {}).map(([id,step])=><div key={id} style={{fontSize:'11px'}}>{id} · {step.status}{step.error && <span role="alert"> — {step.error}</span>}</div>)}
       </div>
							<div style={{ fontSize: "12px", marginBottom: "6px" }}>
								<strong>{plan.length}</strong> {ko("unité(s) à exécuter", "실행 단위")}
								{" · "}
								<span style={{ color: "var(--accent, #8b5cf6)" }}>
									{plan.filter((u) => u.stage === "avatar").length} {ko("avatars", "아바타")}
								</span>
								{" · "}
								<span style={{ color: "var(--accent, #8b5cf6)" }}>
									{plan.filter((u) => u.stage === "motion-clip").length} {ko("clips", "클립")}
								</span>
							</div>

							{grantPending && (
								<div style={{
									background: "rgba(139,92,246,0.10)",
									border: "1px solid rgba(139,92,246,0.3)",
									borderRadius: "6px",
									padding: "10px",
									marginBottom: "8px",
									fontSize: "12px",
								}}>
									<p style={{ margin: "0 0 8px", fontWeight: "bold" }}>
										{ko(
											"Exécution directe sans agent IA (avancé). Ces boutons utilisent les producteurs natifs configurés.",
											"유료 호출이 실행됩니다. 시작을 확인하세요."
										)}
									</p>
									<div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
										{["scene", "avatar", "cast", "shot", "motion-clip", "expressions", "interaction"].map((stage) => {
											const count = plan.filter((u) => u.stage === stage).length;
											if (!count) return null;
											return (
												<button
													key={stage}
													type="button"
													className="btn-primary btn-small"
													onClick={() => handleGrantAndRunStage(stage)}
													disabled={runBusy || pilotBusy}
												>
													{runBusy ? "…" : `▶ ${stage} (${count})`}
												</button>
											);
										})}
									</div>
									<button
										type="button"
										className="btn-secondary btn-small"
										style={{ marginTop: "6px" }}
										onClick={() => setGrantPending(false)}
									>
										{ko("Annuler", "취소")}
									</button>
								</div>
							)}

							{activeRunId && (
								<div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
									<button
										type="button"
										className="btn-small btn-secondary"
										onClick={handlePause}
										disabled={!runBusy}
									>
										⏸ {ko("Pause", "일시정지")}
									</button>
									<button
										type="button"
										className="btn-small btn-secondary"
										onClick={handleResume}
										disabled={runBusy || pilotBusy}
									>
										▶ {ko("Reprendre", "재개")}
									</button>
								</div>
							)}

							{Object.keys(unitStatuses).length > 0 && (
								<div style={{ marginTop: "8px", maxHeight: "140px", overflow: "auto" }}>
         <small>Historique de l’exécution directe</small>
									{Object.entries(unitStatuses).map(([unitId, state]) => (
										<div
											key={unitId}
											style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", padding: "2px 0" }}
										>
											<span style={{
												display: "inline-block", width: "8px", height: "8px",
												borderRadius: "50%",
												background: state === "done" ? "#22c55e" : state === "failed" ? "#ef4444" : state === "running" ? "#f59e0b" : "#6b7280",
											}} />
											<span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{unitId}</span>
											<span style={{ opacity: 0.7 }}>{state}</span>
											{state === "failed" && (
												<button type="button" disabled={pilotBusy || runBusy} className="btn-link" style={{ fontSize: "10px" }} onClick={() => handleRetryUnit(unitId)}>↺</button>
											)}
										</div>
									))}
								</div>
							)}
						</div>
					)}

					{execError && (
						<div className="production-error-banner" style={{ marginTop: "8px" }}>{execError}</div>
					)}
				</div>
			</div>
		</aside>
	);
}
