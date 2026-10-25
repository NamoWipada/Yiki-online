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

// รองรับข้อความเดี่ยว เช่น "รอบ 12 506 58", "12: 506-58" และ "506 58"
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

// อ่านเฉพาะบรรทัดผลมาตรฐาน เพื่อไม่หยิบเลขจากหัวข้อ เวลา หรือบรรทัดสรุปซ้ำ
function parseResultLines(text) {
  const results = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^(\d{1,3})\s*:\s*(\d{1,2}:\d{2})\s*(?:➡️?|→|->)?\s*(\d{3})\s*-\s*(\d{2})\s*$/u);
    if (!match) continue;
    const roundNo = Number(match[1]);
    if (roundNo < 1 || roundNo > 214) continue;
    results.push({ roundNo, time: match[2].padStart(5, "0"), top: match[3], bottom: match[4] });
  }
  return results;
}

function bangkokDate(timestamp) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

async function saveLineEvents(payload, env) {
  let accepted = 0;
  for (const event of payload.events || []) {
    if (event.type !== "message" || event.message?.type !== "text") continue;
    const eventId = event.webhookEventId || crypto.randomUUID();
    const groupId = event.source?.groupId || event.source?.roomId || null;
    const occurredAt = new Date(event.timestamp || Date.now()).toISOString();
    const drawDate = bangkokDate(event.timestamp || Date.now());
    let parsedRows = parseResultLines(event.message.text);
    if (!parsedRows.length) {
      const single = parseResult(event.message.text);
      if (single?.roundNo && single.roundNo <= 214) parsedRows = [{ ...single, time: null }];
    }
    if (!parsedRows.length) continue;

    const statements = parsedRows.map((parsed) => env.DB.prepare(
      `INSERT INTO daily_results
       (draw_date, round_no, draw_time, top_number, bottom_number, source_text, line_group_id, event_id, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(draw_date, round_no) DO UPDATE SET
         draw_time = excluded.draw_time,
         top_number = excluded.top_number,
         bottom_number = excluded.bottom_number,
         source_text = excluded.source_text,
         line_group_id = excluded.line_group_id,
         event_id = excluded.event_id,
         occurred_at = excluded.occurred_at,
         updated_at = datetime('now')`
    ).bind(drawDate, parsed.roundNo, parsed.time, parsed.top, parsed.bottom, event.message.text, groupId, eventId, occurredAt));
    const batch = await env.DB.batch(statements);
    accepted += batch.reduce((total, result) => total + (result.meta?.changes || 0), 0);
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
    const requestedDate = url.searchParams.get("date");
    const latest = requestedDate || (await env.DB.prepare(
      "SELECT MAX(draw_date) AS draw_date FROM daily_results"
    ).first())?.draw_date || bangkokDate(Date.now());
    const { results } = await env.DB.prepare(
      `SELECT round_no, draw_time, top_number, bottom_number, occurred_at, updated_at
       FROM daily_results WHERE draw_date = ? ORDER BY round_no ASC`
    ).bind(latest).all();
    return json({ ok: true, draw_date: latest, expected_rounds: 214, filled: results.length, results });
  }

  if (url.pathname === "/api/result-dates" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT draw_date, COUNT(*) AS filled, MAX(round_no) AS latest_round
       FROM daily_results GROUP BY draw_date ORDER BY draw_date DESC LIMIT 90`
    ).all();
    return json({ ok: true, dates: results });
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

export { parseResult, parseResultLines, bangkokDate, verifyLineSignature };
