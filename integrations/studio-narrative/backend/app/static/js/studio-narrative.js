(() => {
 'use strict';
 const app = document.getElementById('narrative-app');
 if (!app) return;
 const id = encodeURIComponent(app.dataset.projectId), base = `/api/studio/v1/projects/${id}`, v2 = `/api/studio/v2/projects/${id}`;
 const $ = name => document.getElementById('n-' + name);
 const emptyContent = $('content').innerHTML;
 const state = { source: null, job: null, candidate: null, scene: 0, tab: 'scene', events: 0, timer: null, generation: 0, busy: false, savedVersion: null, history: [], pendingLaunch: null };
 const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const time = value => Number(value || 0).toFixed(2) + ' s';
 const active = () => ['queued', 'running'].includes(state.job?.status);
 function message(text, bad = false) { $('message').hidden = !text; $('message').textContent = text; $('message').style.borderColor = bad ? '#d34a35' : '#a48154'; }
 async function api(path, method = 'GET', body, key) {
  const response = await fetch(path, { method, headers: { 'X-UI-Client': 'reproduction', ...(body ? {'Content-Type':'application/json'} : {}), ...(key ? {'Idempotency-Key': key} : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.detail?.message || (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || data))); error.status = response.status; throw error; }
  return data;
 }
 function controls() {
  const locked = state.busy || active();
  $('start').disabled = locked || !state.source?.canAnalyse;
  $('tts').disabled = locked; $('model').disabled = locked; $('instructions').disabled = locked;
  $('cancel').hidden = !active(); $('cancel').disabled = state.busy;
  $('history').disabled = locked;
  $('apply').disabled = locked || !state.candidate?.readiness?.directivesReady || state.savedVersion != null || state.candidate?.sourceFingerprint !== state.source?.sourceFingerprint;
  $('publish').disabled = locked || !state.savedVersion;
  $('resume').hidden = !['failed','cancelled'].includes(state.job?.status);
  $('resume').disabled = locked || !state.source?.canAnalyse;
  $('status').textContent = state.job ? ({queued:'En attente',running:'Analyse en cours',succeeded:'Directives validées',failed:'Analyse interrompue',cancelled:'Arrêtée'}[state.job.status] || state.job.status) + ' · ' + state.job.stage : 'Sources';
  document.querySelectorAll('[data-reanalyse]').forEach(button => { button.disabled = locked || !state.source?.canAnalyse; });
 }
 async function sources(selected) {
  state.source = await api(v2 + '/sources' + (selected ? '?selectedTtsId=' + encodeURIComponent(selected) : ''));
  const source = state.source;
  $('title').textContent = source.title;
  $('tts').innerHTML = source.ttsOptions.length ? source.ttsOptions.map(t => `<option value="${t.id}">TTS ${t.id} · ${esc(t.voice)} · ${time(t.durationSeconds)}${t.transcribed ? '' : ' · à transcrire'}</option>`).join('') : '<option value="">Aucun audio TTS</option>';
  if (selected || source.selectedTtsId) $('tts').value = selected || source.selectedTtsId;
  if (!$('model').value) $('model').value = source.defaultModel;
  $('meta').innerHTML = source.canAnalyse ? `<span>Audio mesuré <strong>${time(source.durationSeconds)}</strong></span><span>Timeline <strong>${source.frameCount} frames · 24 fps</strong></span><span>Narration <strong>${source.segments.length} segments</strong></span><span>Capacité actuelle <strong>20 min · 32 scènes · 256 plans</strong></span>` : '';
  if (!source.canAnalyse) message(source.message, true);
  controls();
 }
 async function history() {
  const data = await api(v2 + '/analyses'); state.history = data.analyses;
  $('history').innerHTML = '<option value="">Choisir une analyse</option>' + data.analyses.map(j => `<option value="${esc(j.id)}">${esc(j.createdAt.slice(0,16).replace('T',' '))} · ${esc(j.status)} · ${esc(j.id)}</option>`).join('');
  if (state.job) $('history').value = state.job.preparationId;
 }
 async function poll(generation) {
  if (generation !== state.generation || !state.job) return;
  try {
   const job = await api(base + '/preparations/' + state.job.preparationId + '?afterEventId=' + state.events);
   if (generation !== state.generation) return;
   state.job = job;
   for (const ev of job.events) { state.events = ev.eventId; $('log').textContent += ev.message + '\n'; }
   $('log').scrollTop = $('log').scrollHeight;
   if (job.status === 'failed') message(job.events.findLast?.(e => e.type === 'pipeline_failed')?.message || 'L’analyse a échoué. Consultez le journal puis reprenez les étapes validées.', true);
   if (job.status === 'succeeded' && !state.candidate) {
    const candidate = await api(base + '/preparations/' + job.preparationId + '/result');
    if (generation !== state.generation) return;
    state.candidate = candidate; state.scene = 0; render();
    message('Récit validé. Vous pouvez enregistrer ses directives dans le brouillon, puis publier la version destinée au Studio.');
    await history();
   }
   controls();
   if (active() || job.events.length === 50) state.timer = setTimeout(() => poll(generation), active() ? 1800 : 0);
  } catch (error) { message(error.message, true); if (generation === state.generation) state.timer = setTimeout(() => poll(generation), 5000); }
 }
 async function selectJob(jobId) {
  clearTimeout(state.timer); state.generation++; state.candidate = null; state.events = 0; state.savedVersion = null;
  $('log').textContent = ''; message('');
  if (!jobId) { state.job = null; render(); controls(); return; }
  const prior = state.history.find(j => j.id === jobId);
  if (prior) { await sources(prior.selectedTtsId); $('model').value = prior.model; $('instructions').value = prior.instructions; }
  state.job = {preparationId:jobId,status:'queued',stage:'chargement'};
  controls(); await poll(state.generation);
 }
 async function start(fromSceneId = null, reuse = false) {
  if (state.busy || active() || !state.source?.canAnalyse) return;
  state.busy = true; controls(); message('');
  try {
   const body = {selectedTtsId: state.source.selectedTtsId, model: $('model').value.trim() || null,
    instructions: $('instructions').value, expectedSourceFingerprint: state.source.sourceFingerprint,
    expectedDraftVersion: state.source.draftVersion, parentJobId: (fromSceneId || reuse) ? state.job?.preparationId : null, fromSceneId};
   const signature = JSON.stringify(body);
   if (state.pendingLaunch?.signature !== signature) state.pendingLaunch = {signature, key: crypto.randomUUID()};
   const created = await api(v2 + '/analyses', 'POST', body, state.pendingLaunch.key);
   state.pendingLaunch = null;
   state.busy = false; await history(); await selectJob(created.preparationId);
  } catch(error) { if (error.status && error.status < 500) state.pendingLaunch = null; message(error.message, true); }
  finally { state.busy = false; controls(); }
 }
 function render() {
  if (!state.candidate) { $('scenes').innerHTML = ''; $('content').innerHTML = emptyContent; return; }
  const draft = state.candidate.draft, scene = draft.scenes[state.scene], named = Object.fromEntries(draft.characters.map(c => [c.id,c.name]));
  const set = draft.sets.find(s => s.id === scene.setId);
  for (const s of draft.sets) for (const p of s.props || []) named[p.id] = p.name;
  $('scenes').innerHTML = draft.scenes.map((s,i) => `<button class="n-scene ${i===state.scene?'active':''}" data-scene="${i}" aria-current="${i===state.scene?'true':'false'}">${String(i+1).padStart(2,'0')} · ${esc(draft.sets.find(e=>e.id===s.setId)?.name || s.setId)}<span>${time(s.globalStartSeconds)} → ${time(s.globalEndSeconds)}</span></button>`).join('');
  const tabs = `<div class="n-tabs" role="tablist"><button role="tab" aria-selected="${state.tab==='scene'}" data-tab="scene" class="${state.tab==='scene'?'active':''}">Mise en scène</button><button role="tab" aria-selected="${state.tab==='world'}" data-tab="world" class="${state.tab==='world'?'active':''}">Personnages & décors</button><button role="tab" aria-selected="${state.tab==='story'}" data-tab="story" class="${state.tab==='story'?'active':''}">Récit global</button></div>`;
  let content = '';
  if (state.tab === 'story') {
   content = `<h2>Le récit complet</h2><p class="n-synopsis">${esc(draft.extensions?.narrative?.synopsis)}</p><h3>Narration finale</h3>` + draft.narration.map(n=>`<div class="n-card"><span class="n-muted">${time(n.startSeconds)} → ${time(n.endSeconds)}</span><p>${esc(n.text)}</p></div>`).join('') + '<h3>Choix de mise en scène</h3>' + (draft.extensions?.narrative?.editorialChoices || []).map(c=>`<p class="n-card">${esc(c)}</p>`).join('');
  } else if (state.tab === 'world') {
   content = '<h2>Personnages réutilisables</h2><div class="n-grid">' + draft.characters.map(c=>`<div class="n-card"><strong>${esc(c.name)}</strong><p>${esc(c.appearance)}</p><span class="n-muted">${esc(c.id)} · ${c.heightMeters || '—'} m · ${esc(c.avatar?.strategy || 'builtin')}</span></div>`).join('') + '</div><h3>Décors fonctionnels</h3>' + draft.sets.map(s=>`<div class="n-card"><strong>${esc(s.name)}</strong><p>${esc(s.description)}</p><p class="n-muted">${s.structure.length} structures · ${s.props.length} objets utiles</p>${s.props.map(p=>`<p>${esc(p.name)} · ${esc(JSON.stringify(p.positionMeters))} · ${esc(JSON.stringify(p.dimensionsMeters))}</p>`).join('')}</div>`).join('');
  } else {
   const shots = draft.shots.filter(s=>s.sceneId===scene.id), actions = draft.actions.filter(a=>a.sceneId===scene.id);
   const entries = Object.fromEntries(scene.entryState.map(s=>[s.entityId,s]));
   content = `<div class="n-actions" style="justify-content:space-between"><h2>${esc(set?.name || scene.id)}</h2><button class="n-button" data-reanalyse="${esc(scene.id)}">Réanalyser depuis cette scène</button></div><p class="n-synopsis">${esc(scene.summary)}</p><p class="n-muted">${esc(scene.timeContext)} · ${time(scene.globalStartSeconds)} → ${time(scene.globalEndSeconds)} · ${scene.cast.map(c=>esc(named[c.characterId])).join(', ')}</p><div class="n-timeline" aria-label="Montage des plans">` + shots.map(s=>`<div class="n-cut" style="flex:${s.endSeconds-s.startSeconds}">${esc(s.id)}<small>${time(s.endSeconds-s.startSeconds)}</small></div>`).join('') + '</div><div class="n-grid"><div><h3>Actions & interactions</h3>' + actions.map(a=>`<div class="n-card"><strong>${esc(named[a.characterId])}</strong><span class="n-muted"> · ${time(a.startSeconds)} → ${time(a.endSeconds)}</span><p>${esc(a.description)}</p>${a.participantIds?.length ? `<p class="n-muted">Avec ${a.participantIds.map(p=>esc(named[p])).join(', ')} · ${esc(a.eventId)}</p>` : ''}${a.effects?.length ? `<p class="n-muted">Résultat : ${a.effects.map(e=>esc(named[e.entityId])+ ' — '+esc(e.condition)).join('; ')}</p>` : ''}</div>`).join('') + '</div><div><h3>Caméras & cuts</h3>' + scene.cameras.map(c=>`<div class="n-card"><strong>${esc(c.name)}</strong><p>${esc(c.directive)}</p><p class="n-muted">${c.cameraKeys.length} clés · ${esc(c.interpolation)} · ${esc(c.id)}</p></div>`).join('') + shots.map(s=>`<div class="n-card"><strong>${esc(s.id)} → ${esc(s.cameraId)}</strong><p>${esc(s.directive)}</p><span class="n-muted">${time(s.startSeconds)} → ${time(s.endSeconds)} · offset ${s.cameraOffsetFrame || 0} frames</span></div>`).join('') + '</div></div><h3>Continuité de la scène</h3><div style="overflow:auto"><table class="n-state"><thead><tr><th>Entité</th><th>À l’entrée</th><th>À la sortie</th></tr></thead><tbody>' + scene.exitState.map(s=>`<tr><td>${esc(named[s.entityId] || s.entityId)}</td><td>${esc(entries[s.entityId]?.condition)}${entries[s.entityId]?.heldBy ? ' · tenu par '+esc(named[entries[s.entityId].heldBy]):''}</td><td>${esc(s.condition)}${s.heldBy ? ' · tenu par '+esc(named[s.heldBy]):''}</td></tr>`).join('') + '</tbody></table></div><p class="n-muted" style="margin-top:16px">La réanalyse conserve les étapes précédentes et recalcule cette scène ainsi que les suivantes pour propager la continuité.</p>';
  }
  $('content').innerHTML = tabs + content; controls();
 }
 async function action(callback) { if(state.busy) return; state.busy = true; controls(); try {await callback();} catch(error){message(error.message,true);} finally{state.busy=false;controls();} }
 $('start').addEventListener('click',()=>start());
 $('resume').addEventListener('click',()=>start(null,true));
 $('tts').addEventListener('change',()=>action(async()=>{clearTimeout(state.timer);state.generation++;state.job=null;state.candidate=null;state.savedVersion=null;render();message('');await sources($('tts').value);}));
 $('history').addEventListener('change',()=>action(()=>selectJob($('history').value)));
 $('cancel').addEventListener('click',()=>action(async()=>{await api(base+'/preparations/'+state.job.preparationId+'/cancel','POST');message('Arrêt demandé. L’appel en cours se terminera avant l’arrêt du service.');}));
 $('apply').addEventListener('click',()=>action(async()=>{
  const result = await api(base+'/preparations/'+state.job.preparationId+'/apply','POST',{expectedCandidateVersion:state.candidate.candidateVersion,expectedDraftVersion:state.source.draftVersion,expectedSourceFingerprint:state.candidate.sourceFingerprint,mode:'preview'});
  state.savedVersion=result.draftVersion;state.source.draftVersion=result.draftVersion;message('Brouillon enregistré. Publier crée une version immuable que le Studio pourra importer.');
 }));
 $('publish').addEventListener('click',()=>action(async()=>{
  const result=await api(base+'/revisions','POST',{mode:'structured',draftVersion:state.savedVersion},crypto.randomUUID());
  message('Version '+result.revision+' publiée pour l’import dans le Studio. Les animations et assets restent à réaliser à partir des directives.');
 }));
 app.addEventListener('click',event=>{
  const scene=event.target.closest('[data-scene]'), tab=event.target.closest('[data-tab]'), reanalyse=event.target.closest('[data-reanalyse]');
  if(scene){state.scene=Number(scene.dataset.scene);render();}
  if(tab){state.tab=tab.dataset.tab;render();}
  if(reanalyse)start(reanalyse.dataset.reanalyse);
 });
 window.addEventListener('pagehide',()=>{state.generation++;clearTimeout(state.timer);});
 action(async()=>{await sources();await history();if(state.history.length)await selectJob(state.history[0].id);});
})();
