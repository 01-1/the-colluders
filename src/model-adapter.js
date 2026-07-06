import { openRouterConfig } from "./model-config.js";

export function parseEnv(text) {
  const env = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

export function configFromEnv(env = {}, baseConfig = openRouterConfig) {
  const modelList = String(env.OPENROUTER_MODELS || "").split(",").map((model) => model.trim()).filter(Boolean);
  if (modelList.length < 2 || modelList.some((model) => !model.endsWith(":free"))) {
    return baseConfig;
  }

  return {
    ...baseConfig,
    freeModels: {
      colluder: modelList[0],
      monitor: modelList[1]
    }
  };
}

export function createModelClient({ apiKey, fetchFn = fetch, config = openRouterConfig } = {}) {
  const available = Boolean(apiKey);

  async function complete({ role, prompt, timeoutMs = config.timeoutMs }) {
    if (!available) {
      return { ok: false, unavailable: true, reason: "OPENROUTER_API_KEY is not configured." };
    }

    const model = role === "monitor" ? config.freeModels.monitor : config.freeModels.colluder;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchFn(config.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "http://localhost:4177",
          "X-Title": "The Colluders"
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are playing The Colluders. Follow the requested role and output only the requested game text." },
            { role: "user", content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 220
        })
      });

      if (!response.ok) {
        return { ok: false, model, reason: `OpenRouter request failed with HTTP ${response.status}.` };
      }

      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content?.trim();
      return text ? { ok: true, model, text } : { ok: false, model, reason: "OpenRouter returned no message text." };
    } catch (error) {
      return {
        ok: false,
        model,
        timeout: error?.name === "AbortError",
        reason: error?.name === "AbortError" ? "OpenRouter request timed out." : "OpenRouter request failed."
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    available,
    config: {
      provider: config.provider,
      freeModels: config.freeModels,
      publicModelSource: config.publicModelSource,
      timeoutMs: config.timeoutMs
    },
    complete
  };
}
