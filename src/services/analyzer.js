import { z } from 'zod';
import { config } from '../config.js';
import { vision } from './ollama.js';

export const CATEGORIES = ['normal_ide', 'ai_chat', 'messaging', 'other_website', 'copy_from_doc', 'unclear'];
const SUSPICIOUS = new Set(['ai_chat', 'messaging', 'other_website', 'copy_from_doc']);

const PROMPT = `You are reviewing one screenshot from a student's computer during a closed-book programming exam.
Allowed on screen: a code editor or IDE, a terminal, the exam question page, a file explorer.
Classify what is visible into exactly one category:
- normal_ide: only allowed tools are visible
- ai_chat: an AI assistant or chatbot (ChatGPT, Gemini, Claude, Copilot chat, DeepSeek, etc.)
- messaging: a chat or messaging app (WhatsApp, Messenger, Telegram, Discord, etc.)
- other_website: any other website (search engine, Stack Overflow, YouTube, online docs)
- copy_from_doc: a document or notes that contain solutions or code
- unclear: cannot tell
Reply ONLY with JSON: {"category": "...", "confidence": 0.0-1.0, "reason": "one short sentence describing what is visible"}`;

const Output = z.object({
  category: z.enum(CATEGORIES),
  confidence: z.coerce.number().min(0).max(1).catch(0.5),
  reason: z.string().max(300).catch(''),
});

function unclear(base, reason, latencyMs = null) {
  return { ...base, category: 'unclear', suspicious: false, confidence: 0, reason, latencyMs };
}

async function classify(stage, model, imageBase64) {
  const base = { stage, model };
  try {
    const { content, latencyMs } = await vision(model, PROMPT, imageBase64);
    let json;
    try {
      json = JSON.parse(content);
    } catch {
      return unclear(base, 'Model returned invalid JSON', latencyMs);
    }
    const parsed = Output.safeParse(json);
    if (!parsed.success) return unclear(base, 'Model output did not match the schema', latencyMs);
    const { category, confidence, reason } = parsed.data;
    return { ...base, category, confidence, reason, suspicious: SUSPICIOUS.has(category), latencyMs };
  } catch (err) {
    return unclear(base, err.name === 'AbortError' ? 'Model timed out' : `Model error: ${err.message}`);
  }
}

// Returns every stage's result, the final one, and a flag severity (null = no flag).
export async function analyzeFrame(imageBase64) {
  const triage = await classify('triage', config.models.triage, imageBase64);
  const needsSecond = config.secondOpinion
    && (triage.category === 'unclear' || (triage.suspicious && triage.confidence >= 0.5));

  if (!needsSecond) {
    const severity = triage.suspicious ? (triage.confidence >= 0.7 ? 'high' : 'low') : null;
    return { stages: [triage], final: triage, severity };
  }

  const confirm = await classify('confirm', config.models.confirm, imageBase64);
  const severity = confirm.suspicious ? 'high' : triage.suspicious ? 'low' : null;
  return { stages: [triage, confirm], final: confirm, severity };
}
