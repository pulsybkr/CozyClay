// Server-only HTTP transport. Credentials never enter renderer props or projects.
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readKimodoMotion } from './read-npz.mjs';

export function createKimodoApiClient({
 origin = process.env.CCLAY_KIMODO_API_URL,
 token = process.env.CCLAY_KIMODO_API_TOKEN,
 fetchImpl = fetch,
 timeoutMs = Number(process.env.CCLAY_KIMODO_API_TIMEOUT_MS || 900000),
} = {}) {
 const base = new URL(origin);
 if (base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Kimodo API URL must be an origin without credentials or path');
 if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname))) throw new Error('Kimodo API requires HTTPS');
 if (!token?.trim()) throw new Error('Set CCLAY_KIMODO_API_TOKEN in the server environment');
 if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid Kimodo API timeout');

 async function request(path, { signal, method = 'GET', body, key, binary = false } = {}) {
  const response = await fetchImpl(new URL(path, base), {
   method, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
   headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
   ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
   let detail; try { detail = await response.json(); } catch {}
   // Report codes/fields only: arbitrary upstream messages could echo credentials.
   const code = detail?.error?.code ?? `HTTP_${response.status}`;
   const field = detail?.error?.field;
   throw Object.assign(new Error(`Kimodo API ${String(code).replaceAll(token, '[redacted]')}${field ? ` (${String(field).replaceAll(token, '[redacted]')})` : ''}`), { code, status: response.status });
  }
  if (!binary) return response.json();
  const chunks = []; let size = 0;
  if (!response.body) throw new Error('Kimodo returned an empty artifact');
  for await (const chunk of response.body) {
   size += chunk.byteLength;
   if (size > 64 * 1024 * 1024) { await response.body.cancel?.().catch(() => {}); throw new Error('Kimodo NPZ exceeds 64 MiB'); }
   chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
 }
 const capabilities = () => request('/api/v2/capabilities');

 async function generate({ segments, constraints = [], diffusionSteps = 100, seed, signal, onLine, nativeOut }) {
  if (!Array.isArray(segments) || !segments.length || segments.length > 8 || segments.some(s => typeof s.prompt !== 'string' || !s.prompt.trim() || s.prompt.length > 1000 || !Number.isFinite(s.duration) || s.duration < 1 || s.duration > 10) || segments.reduce((a,s) => a + s.duration, 0) > 30) throw new Error('Kimodo API requires 1–8 segments of 1–10 seconds, at most 30 seconds total');
  const controller = new AbortController();
  const scoped = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const stop = () => controller.abort(new Error('Kimodo generation interrupted'));
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  let inputBuffer = '';
  const control = chunk => { inputBuffer += String(chunk); const lines = inputBuffer.split('\n'); inputBuffer = lines.pop(); for (const line of lines) if (line.trim() === 'cozyclay:cancel') stop(); };
  process.stdin.on('data', control);
  const timer = setTimeout(() => controller.abort(new Error('Kimodo job deadline exceeded')), timeoutMs);
  let jobId, finished = false;
  try {
   const caps = await request('/api/v2/capabilities', { signal: scoped });
   if (caps.api_version !== '2' || caps.fps !== 30) throw new Error('Kimodo API must announce v2 and the supported 30 fps generation clock');
   const payload = {
    client_request_id: randomUUID(),
    ...(segments.length === 1 ? { prompt: segments[0].prompt, duration: segments[0].duration } : { segments }),
    constraints, diffusion_steps: diffusionSteps, postprocess: true,
    first_heading_angle: 0, guidance: { type: constraints.length ? 'separated' : 'regular', text_weight: 2, constraint_weight: 2 },
    ...(Number.isInteger(seed) ? { seed: seed >>> 0 } : {}),
   };
   const key = randomUUID();
   let job;
   // A retry uses the same idempotency key and exact payload.
   for (let attempt = 0; attempt < 2; attempt++) {
    try { job = await request('/api/v2/jobs', { method: 'POST', body: payload, key, signal: scoped }); break; }
    catch (error) { if (attempt || scoped.aborted || (error.status && error.status < 500)) throw error; }
   }
   if (typeof job?.job_id !== 'string' || !job.job_id) throw new Error('Kimodo creation response has no job_id');
   jobId = job.job_id;
   const path = `/api/v2/jobs/${encodeURIComponent(jobId)}`;
   let lastStage;
   for (;;) {
    scoped.throwIfAborted();
    if (job.job_id !== jobId) throw new Error('Kimodo returned a different job_id');
    if (job.stage !== lastStage) { onLine?.(`kimodo-api: ${job.status} / ${job.stage}`); lastStage = job.stage; }
    if (job.status === 'succeeded') { finished = true; break; }
    if (['failed', 'cancelled'].includes(job.status)) { finished = true; throw new Error(`Kimodo job ${job.status}: ${job.error?.code ?? 'NO_ERROR_CODE'}`); }
    if (!['queued', 'running', 'cancelling'].includes(job.status)) throw new Error('Unknown Kimodo job state');
    await delay(Math.max(250, Math.min(5000, Number(job.poll_after_ms) || 1500)), undefined, { signal: scoped });
    job = await request(path, { signal: scoped });
   }
   const metadata = await request(`${path}/metadata`, { signal: scoped });
   if (metadata.joint_count !== 77 || metadata.fps !== 30 || metadata.units !== 'meters' || metadata.up_axis !== '+Y' || metadata.ground_plane !== 'XZ' || metadata.rest_pose !== 'standard_tpose' || !Array.isArray(metadata.joint_names) || metadata.joint_names.length !== 77 || new Set(metadata.joint_names).size !== 77 || !Array.isArray(metadata.parents) || metadata.parents.length !== 77 || !Number.isInteger(metadata.frame_count) || metadata.frame_count < 1 || metadata.frame_count > 900) throw new Error('Kimodo metadata does not match the SOMA77 motion contract');
   const artifact = metadata.files?.npz;
   if (!artifact || !Number.isInteger(artifact.bytes) || artifact.bytes < 1 || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) throw new Error('Kimodo NPZ metadata is missing size or SHA-256');
   // Always use the authenticated canonical endpoint, never an arbitrary URL.
   const bytes = await request(`${path}/npz`, { binary: true, signal: scoped });
   if (bytes.length !== artifact.bytes || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256.toLowerCase()) throw new Error('Kimodo NPZ size or SHA-256 mismatch');
   const scratch = await mkdtemp(join(tmpdir(), 'cozy-kimodo-api-'));
   try {
    const file = join(scratch, 'motion.npz');
    await writeFile(file, bytes);
    const loaded = readKimodoMotion(file);
    if (loaded.frames !== metadata.frame_count || loaded.fps !== metadata.fps || !loaded.globalRotMats.every(Number.isFinite) || !loaded.posedJoints.every(Number.isFinite)) throw new Error('Kimodo NPZ arrays do not match metadata');
    if (nativeOut) await writeFile(nativeOut, bytes);
    return { loaded, metadata };
   } finally { await rm(scratch, { recursive: true, force: true }); }
  } catch (error) {
   if (jobId && !finished) {
    try { await request(`/api/v2/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', signal: AbortSignal.timeout(10000) }); }
    catch { onLine?.('kimodo-api: cancellation could not be confirmed'); }
   }
   throw error;
  } finally { clearTimeout(timer); process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); process.stdin.removeListener('data', control); process.stdin.pause(); }
 }
 return { capabilities, generate };
}
