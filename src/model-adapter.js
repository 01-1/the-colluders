const openRouterEndpoint = "https://openrouter.ai/api/v1/chat/completions";
const defaultTimeoutMs = 12000;

export function createModelClient({ apiKey, fetchFn = fetch, endpoint = openRouterEndpoint, timeoutMs = defaultTimeoutMs } = {}) {
  const available = Boolean(apiKey);

  async function complete({ model, prompt, timeoutMs: requestTimeoutMs = timeoutMs }) {
    if (!available) {
      return { ok: false, unavailable: true, reason: "OPENROUTER_API_KEY is not configured." };
    }
    if (!model) {
      return { ok: false, reason: "No OpenRouter model was selected." };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetchFn(endpoint, {
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
      provider: "openrouter",
      timeoutMs
    },
    complete
  };
}
