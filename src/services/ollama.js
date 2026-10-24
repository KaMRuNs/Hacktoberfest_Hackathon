import { config } from '../config.js';

const { ollamaUrl, speed } = config;

export async function chat({ model, messages, json = true, numPredict = speed.numPredict }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), speed.timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        think: false,
        keep_alive: speed.keepAlive,
        ...(json && { format: 'json' }),
        options: { temperature: speed.temperature, num_predict: numPredict, num_ctx: speed.numCtx },
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return { content: data.message.content, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export function vision(model, prompt, imageBase64) {
  return chat({ model, messages: [{ role: 'user', content: prompt, images: [imageBase64] }] });
}

export async function status() {
  const [tags, ps] = await Promise.all([
    fetch(`${ollamaUrl}/api/tags`).then((r) => r.json()),
    fetch(`${ollamaUrl}/api/ps`).then((r) => r.json()),
  ]);
  return {
    installed: tags.models.map((m) => m.name),
    loaded: ps.models.map((m) => m.name),
  };
}
