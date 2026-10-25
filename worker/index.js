const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
});

const bytesToBase64 = (bytes) => {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
};

async function verifyLineSignature(body, signature, secret) {
  if (!signature || !secret) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return bytesToBase64(new Uint8Array(digest)) === signature;
}

// รองรับ เช่น "รอบ 12 506 58", "12: 506-58" และ "506 58"
function parseResult(text) {
  const normalized = text.replace(/[,:|/\-]+/g, " ").replace(/\s+/g, " ").trim();
  const numbers = normalized.match(/\d+/g) || [];
  if (numbers.length < 2) return null;

  const bottom = numbers.at(-1);
  const top = numbers.at(-2);
  if (!/^\d{3}$/.test(top) || !/^\d{2}$/.test(bottom)) return null;

  const possibleRound = numbers.at(-3);
  return {
    roundNo: possibleRound && /^\d{1,3}$/.test(possibleRound) ? Number(possibleRound) : null,
    top,
    bottom,
  };
}

async function saveLineEvents(payload, env) {
  let accepted = 0;
  for (const event of payload.events || []) {
    if (event.type !== "message" || event.message?.type !== "text") continue;
    const parsed = parseResult(event.message.text);
    if (!parsed) continue;

    const eventId = event.webhookEventId || crypto.randomUUID();
    const groupId = event.source?.groupId || event.source?.roomId || null;
    const occurredAt = new Date(event.timestamp || Date.now()).toISOString();
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO results
       (event_id, round_no, top_number, bottom_number, source_text, line_group_id, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(eventId, parsed.roundNo, parsed.top, parsed.bottom, event.message.text, groupId, occurredAt).run();
    accepted += result.meta?.changes || 0;
  }
  return accepted;
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/health") {
    return json({ ok: true, service: "yiki-analytics", time: new Date().toISOString() });
  }

  if (url.pathname === "/api/line/webhook" && request.method === "POST") {
    const body = await request.text();
    const valid = await verifyLineSignature(
      body,
      request.headers.get("x-line-signature"),
      env.LINE_CHANNEL_SECRET
    );
    if (!valid) return json({ ok: false, error: "invalid signature" }, 401);

    let payload;
    try { payload = JSON.parse(body); }
    catch { return json({ ok: false, error: "invalid json" }, 400); }

    const accepted = await saveLineEvents(payload, env);
    return json({ ok: true, accepted });
  }

  if (url.pathname === "/api/results" && request.method === "GET") {
    const requested = Number(url.searchParams.get("limit") || 264);
    const limit = Math.min(Math.max(requested, 1), 1000);
    const { results } = await env.DB.prepare(
      `SELECT id, round_no, top_number, bottom_number, occurred_at
       FROM results ORDER BY occurred_at DESC LIMIT ?`
    ).bind(limit).all();
    return json({ ok: true, results });
  }

  return json({ ok: false, error: "not found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
};

export { parseResult, verifyLineSignature };
