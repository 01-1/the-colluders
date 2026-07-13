export const maxJsonBodyBytes = 64 * 1024;

export async function readJsonBody(request, { maxBytes = maxJsonBodyBytes } = {}) {
  const declaredLength = Number(request.headers?.["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw httpError(413, "Request body is too large.");

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw httpError(413, "Request body is too large.");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};

  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "Request body must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw httpError(400, "Request body must be a JSON object.");
  }
  return parsed;
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
