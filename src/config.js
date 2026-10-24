import 'dotenv/config';

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  ollamaUrl: env.OLLAMA_URL || 'http://127.0.0.1:11434',
  models: {
    triage: env.MODEL_TRIAGE || 'gemma4:e2b',
    confirm: env.MODEL_CONFIRM || 'gemma4:e4b',
    summary: env.MODEL_SUMMARY || 'qwen3.5:4b',
  },
  // e4b needs ~7 GB RAM; only enable on machines that can hold it next to e2b.
  secondOpinion: env.SECOND_OPINION === 'true',
  speed: {
    keepAlive: '60m',
    numPredict: 120,
    numCtx: 2048,
    temperature: 0.1,
    timeoutMs: Number(env.MODEL_TIMEOUT_MS || 90000),
  },
  capture: {
    intervalMs: 2500,
    maxWidth: 768,
    jpegQuality: 0.7,
    changeThreshold: 12, // Hamming distance on a 256-bit dHash
  },
  storageDir: 'storage/frames',
  dbPath: 'data/fairlens.db',
};
