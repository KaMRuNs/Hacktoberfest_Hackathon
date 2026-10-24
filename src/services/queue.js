// One waiting job per student: a newer frame replaces an older waiting one, so there is never a backlog.
// Jobs run one at a time because a CPU-bound Ollama serves one image at a time anyway.
const waiting = new Map();
let running = false;

export function enqueue(studentId, job, onDropped) {
  waiting.get(studentId)?.onDropped?.();
  waiting.delete(studentId); // re-insert at the back for round-robin fairness
  waiting.set(studentId, { job, onDropped });
  pump();
}

async function pump() {
  if (running) return;
  running = true;
  while (waiting.size) {
    const [studentId, { job }] = waiting.entries().next().value;
    waiting.delete(studentId);
    try {
      await job();
    } catch (err) {
      console.error('Queue job failed:', err);
    }
  }
  running = false;
}

export const queueSize = () => waiting.size;
