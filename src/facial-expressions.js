// Authored scene seconds, independent of body motion and playback direction.
export function validateExpressionTracks(value, supported = null) {
 if (!Array.isArray(value) || value.length > 64) throw new Error('Expected at most 64 expression tracks');
 const names = new Set();
 return value.map(track => {
  const name = track?.expression;
  if (typeof name !== 'string' || !name || name.length > 128 || names.has(name)) throw new Error('Expression names must be unique');
  if (supported && !supported.includes(name)) throw new Error(`Expression unavailable on this avatar: ${name}`);
  names.add(name);
  if (!Array.isArray(track.keys) || !track.keys.length || track.keys.length > 512) throw new Error(`Invalid keys for ${name}`);
  let previous = -1;
  const keys = track.keys.map(key => {
   if (!Number.isFinite(key?.t) || key.t < 0 || key.t > 3600 || key.t <= previous || !Number.isFinite(key.weight) || key.weight < 0 || key.weight > 1) throw new Error(`Invalid time or weight for ${name}; use ascending seconds and weights 0–1`);
   previous = key.t;
   return { t: key.t, weight: key.weight };
  });
  return { expression: name, keys };
 });
}

export function expressionWeight(keys, seconds) {
 if (!keys?.length || !Number.isFinite(seconds) || seconds < keys[0].t) return 0;
 for (let i = 1; i < keys.length; i++) {
  if (seconds < keys[i].t) {
   const a = keys[i - 1], b = keys[i];
   return a.weight + (b.weight - a.weight) * (seconds - a.t) / (b.t - a.t);
  }
 }
 return keys[keys.length - 1].weight;
}
