import { useState } from 'react';
import Foldout from './Foldout.jsx';
import { useCastTransaction } from '../domains/cast.js';
import { isVrmModel } from '../character-models.js';
import { supportedVrmExpressions } from '../vrm-runtime.js';
import { validateExpressionTracks, expressionWeight } from '../facial-expressions.js';

export default function FacialExpressionsPanel({ hidden, character, rig, seconds, duration, onAgent }) {
 const { run } = useCastTransaction();
 const [selected, setSelected] = useState('');
 const [weight, setWeight] = useState(0.7);
 const [instruction, setInstruction] = useState('');
 const [error, setError] = useState('');
 const supported = supportedVrmExpressions(rig);
 const names = supported.map(value => value.name);
 const name = names.includes(selected) ? selected : names[0] ?? '';
 const tracks = character.expressions ?? [];
 const unsupported = tracks.filter(track => !names.includes(track.expression));
 function save(next) {
  try {
   const expressions = validateExpressionTracks(next, names);
   run('character.update', { characterId: character.id, patch: { expressions } });
   setError('');
  } catch (err) { setError(err.message); }
 }
 function addKey() {
  const old = tracks.find(track => track.expression === name);
  const keys = [...(old?.keys ?? []).filter(key => Math.abs(key.t - seconds) > 0.00001), { t: seconds, weight }].sort((a, b) => a.t - b.t);
  save([...tracks.filter(track => track.expression !== name), { expression: name, keys }]);
 }
 function askAgent() {
  onAgent();
  window.dispatchEvent(new CustomEvent('cozyclay:agent-draft', { detail: `Génère les expressions faciales du personnage ${character.id} uniquement. Intention : ${instruction}. Durée de la scène : ${duration.toFixed(3)} secondes. Expressions disponibles : ${JSON.stringify(supported)}. Inspecte character.set puis écris expressions sous forme de pistes [{expression, keys:[{t,weight}]}]. t est en secondes de scène, croissant et unique, entre 0 et ${duration.toFixed(3)}; weight entre 0 et 1. Interpolation linéaire, poids nul avant la première clé et dernière valeur maintenue après la dernière clé. Termine chaque émotion par une clé à poids 0 si elle doit disparaître. Tu peux ajouter des clignements explicites si blink est disponible. Conserve les autres champs et les animations du corps. Utilise uniquement les noms disponibles. N'appelle aucune génération de mouvement, image ou voix.` }));
 }
 return <Foldout hidden={hidden || !isVrmModel(character.model)} title="Expressions faciales">
  <div className="facial-editor">
   <p className="subject-model-note">{seconds.toFixed(2)} s · Clés indépendantes des mouvements du corps</p>
   {!rig && <p>Chargement de l’avatar…</p>}
   {rig && !names.length && <p>Cet avatar ne fournit aucune expression.</p>}
   {names.length > 0 && <>
    <label>Expression<select aria-label="Expression faciale" value={name} onChange={event => setSelected(event.target.value)}>{supported.map(item => <option key={item.name} value={item.name}>{item.name}{item.isBinary ? ' (binaire)' : ''}</option>)}</select></label>
    <label>Intensité<input aria-label="Intensité faciale" type="number" min="0" max="1" step="0.1" value={weight} onChange={event => setWeight(Number(event.target.value))} /></label>
    <button type="button" onClick={addKey}>Ajouter / remplacer la clé ici</button>
    {tracks.map(track => <div key={track.expression} className="facial-track">
     <strong>{track.expression} · {expressionWeight(track.keys, seconds).toFixed(2)}</strong>
     <button type="button" aria-label={`Supprimer ${track.expression}`} onClick={() => save(tracks.filter(item => item !== track))}>Supprimer la piste</button>
     {track.keys.map(key => <div key={key.t}><span>{key.t.toFixed(2)} s · {key.weight.toFixed(2)}</span><button type="button" aria-label={`Supprimer clé ${track.expression} ${key.t}`} onClick={() => save(tracks.flatMap(item => item !== track ? [item] : item.keys.length === 1 ? [] : [{ ...item, keys: item.keys.filter(value => value !== key) }]))}>×</button></div>)}
    </div>)}
    <label>Intention pour l’IA<textarea aria-label="Intention expressions faciales" placeholder="D’abord surpris, puis souriant à partir de 3 secondes…" value={instruction} onChange={event => setInstruction(event.target.value)} /></label>
    <button type="button" disabled={!instruction.trim()} onClick={askAgent}>Préparer la demande IA</button>
    <p className="subject-model-note">La demande s’ouvre dans l’Agent. Choisissez votre modèle puis envoyez-la.</p>
   </>}
   {unsupported.length > 0 && <p role="alert">Expressions indisponibles sur cet avatar : {unsupported.map(track => track.expression).join(', ')}. <button type="button" onClick={() => save(tracks.filter(track => names.includes(track.expression)))}>Retirer ces pistes</button></p>}
   {error && <p role="alert">{error}</p>}
  </div>
 </Foldout>;
}
