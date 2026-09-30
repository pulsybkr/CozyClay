// Lightweight persisted IK keys. Reject malformed project input before it
// reaches Three's quaternion/vector constructors; retain no runtime objects.
const vector = (value, quaternion = false) => {
  const fields = quaternion ? ['x','y','z','w'] : ['x','y','z'];
  return value && fields.every(field => Number.isFinite(value[field]))
    ? Object.fromEntries(fields.map(field => [field,value[field]])) : null;
};
export function normalizeCorrectionKeys(rows) {
  if (!Array.isArray(rows)) return [];
  const result = new Map();
  for (const row of rows.slice(0,30000)) {
    if (!Number.isInteger(row?.frame) || row.frame < 0 || row.frame > 1e6 || !row.tracks || typeof row.tracks !== 'object') continue;
    const tracks = {};
    for (const [name,key] of Object.entries(row.tracks).slice(0,64)) {
      if (!/^[A-Za-z][A-Za-z0-9_:-]{0,95}$/.test(name) || ['constructor','prototype','__proto__'].includes(name) || !key) continue;
      const cleaned = {};
      for (const field of ['q','baseQ','chainP']) {
        if (!Array.isArray(key[field]) || !key[field].length || key[field].length > 3) continue;
        const values = key[field].map(value => vector(value,field !== 'chainP'));
        if (values.every(Boolean)) cleaned[field] = values;
      }
      for (const field of ['p','basePos']) { const value = vector(key[field]); if (value) cleaned[field] = value; }
      if (!cleaned.q && !cleaned.p) continue;
      if (key.keepTranslations === true) cleaned.keepTranslations = true;
      tracks[name] = cleaned;
    }
    if (Object.keys(tracks).length) result.set(row.frame,{frame:row.frame,tracks});
  }
  return [...result.values()].sort((a,b) => a.frame-b.frame);
}
