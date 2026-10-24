import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { db, q } from '../db.js';
import { analyzeFrame } from './analyzer.js';
import { enqueue } from './queue.js';

const room = (examId) => `exam:${examId}`;

async function saveImage(student, imageBase64) {
  const dir = path.join(config.storageDir, String(student.exam_id));
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${student.id}-${Date.now()}.jpg`);
  await fs.writeFile(file, Buffer.from(imageBase64, 'base64'));
  return `/frames/${student.exam_id}/${path.basename(file)}`;
}

const storeResults = db.transaction((frameId, stages, final, severity, source) => {
  let finalId;
  for (const r of stages) {
    const isFinal = r === final;
    const { lastInsertRowid } = q.createResult.run({
      frame_id: frameId,
      stage: r.stage,
      model: r.model,
      category: r.category,
      suspicious: r.suspicious ? 1 : 0,
      confidence: r.confidence,
      reason: r.reason,
      latency_ms: r.latencyMs,
      source,
      is_final: isFinal ? 1 : 0,
      severity: isFinal ? severity : null,
    });
    if (isFinal) finalId = lastInsertRowid;
  }
  return finalId;
});

function publish(io, student, frame, final, severity, source, resultId) {
  io.to(room(student.exam_id)).emit('frame:result', {
    studentId: student.id,
    frameId: frame.id,
    url: frame.url,
    source,
    category: final.category,
    confidence: final.confidence,
    reason: final.reason,
    model: final.model,
    latencyMs: final.latencyMs,
  });
  if (!severity) return;
  const { lastInsertRowid } = q.createFlag.run(student.id, frame.id, resultId, severity);
  io.to(room(student.exam_id)).emit('flag:new', q.flagById.get(lastInsertRowid));
}

export async function handleFrame(io, student, { hash, imageBase64 }) {
  const url = await saveImage(student, imageBase64);
  const frame = { id: q.createFrame.run(student.id, hash, url).lastInsertRowid, url };
  io.to(room(student.exam_id)).emit('frame:new', { studentId: student.id, frameId: frame.id, url });

  const cached = q.cachedResult.get(hash);
  if (cached) {
    const final = {
      stage: cached.stage, model: cached.model, category: cached.category, suspicious: !!cached.suspicious,
      confidence: cached.confidence, reason: cached.reason, latencyMs: 0,
    };
    const resultId = storeResults(frame.id, [final], final, cached.severity, 'cache');
    publish(io, student, frame, final, cached.severity, 'cache', resultId);
    return { source: 'cache' };
  }

  enqueue(
    student.id,
    async () => {
      io.to(room(student.exam_id)).emit('frame:analyzing', { studentId: student.id, frameId: frame.id });
      const { stages, final, severity } = await analyzeFrame(imageBase64);
      const resultId = storeResults(frame.id, stages, final, severity, 'live');
      publish(io, student, frame, final, severity, 'live', resultId);
    },
    () => io.to(room(student.exam_id)).emit('frame:skipped', { studentId: student.id, frameId: frame.id }),
  );
  return { source: 'queued' };
}
