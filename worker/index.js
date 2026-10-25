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

function extractMessageDate(text, fallbackTimestamp = Date.now()) {
  const slashDate = text.match(/(?:^|\D)(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})(?:\D|$)/);
  if (slashDate) {
    let year = Number(slashDate[3]);
    if (year < 100) year += 2000;
    if (year > 2400) year -= 543;
    const month = Number(slashDate[2]);
    const day = Number(slashDate[1]);
    const valid = new Date(Date.UTC(year, month - 1, day));
    if (valid.getUTCFullYear() === year && valid.getUTCMonth() === month - 1 && valid.getUTCDate() === day) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  const isoDate = text.match(/(?:^|\D)(20\d{2})-(\d{2})-(\d{2})(?:\D|$)/);
  if (isoDate) return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;
  return bangkokDate(fallbackTimestamp);
}

async function saveLineEvents(payload, env) {
  const summary = { accepted: 0, inserted: 0, updated: 0, ignored: 0, rejected: 0, sources: [] };
  for (const event of payload.events || []) {
    if (event.type !== "message" || event.message?.type !== "text") continue;
    const eventId = event.webhookEventId || crypto.randomUUID();
    const source = await resolveLineSource(event.source || {}, env);
    const allowedName = env.ALLOWED_LINE_GROUP_NAME?.trim().toLocaleLowerCase();
    if (allowedName && (source.type !== "group" || source.name.trim().toLocaleLowerCase() !== allowedName)) {
      summary.rejected += 1;
      continue;
    }
    const occurredAt = new Date(event.timestamp || Date.now()).toISOString();
    const drawDate = extractMessageDate(event.message.text, event.timestamp || Date.now());
    const receivedBefore = await env.DB.prepare("SELECT event_id FROM webhook_receipts WHERE event_id = ?").bind(eventId).first();
    if (receivedBefore) { summary.ignored += 1; continue; }
    let parsedRows = parseResultLines(event.message.text);
    if (!parsedRows.length) {
      const single = parseResult(event.message.text);
      if (single?.roundNo && single.roundNo <= 214) parsedRows = [{ ...single, time: null }];
    }
    parsedRows = [...new Map(parsedRows.map((row) => [row.roundNo, row])).values()];
    if (!parsedRows.length) continue;

    const placeholders = parsedRows.map(() => "?").join(",");
    const existing = await env.DB.prepare(
      `SELECT round_no, draw_time, top_number, bottom_number FROM group_daily_results WHERE draw_date = ? AND source_id = ? AND round_no IN (${placeholders})`
    ).bind(drawDate, source.id, ...parsedRows.map((row) => row.roundNo)).all();
    const existingByRound = new Map(existing.results.map((row) => [Number(row.round_no), row]));
    const newRows = parsedRows.filter((row) => !existingByRound.has(row.roundNo));
    const rowsToSave = newRows;
    const inserted = newRows.length;
    const updated = 0;
    const ignored = parsedRows.length - rowsToSave.length;

    const statements = rowsToSave.map((parsed) => env.DB.prepare(
      `INSERT INTO group_daily_results
       (draw_date, source_id, round_no, draw_time, top_number, bottom_number, source_text, event_id, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(draw_date, source_id, round_no) DO NOTHING`
    ).bind(drawDate, source.id, parsed.roundNo, parsed.time, parsed.top, parsed.bottom, event.message.text, eventId, occurredAt));
    statements.push(env.DB.prepare(
      `INSERT INTO webhook_receipts
       (event_id, source_id, draw_date, received_rows, inserted_rows, updated_rows, ignored_rows, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(eventId, source.id, drawDate, parsedRows.length, inserted, updated, ignored, occurredAt));
    await env.DB.batch(statements);
    summary.accepted += parsedRows.length;
    summary.inserted += inserted;
    summary.updated += updated;
    summary.ignored += ignored;
    if (!summary.sources.some((item) => item.id === source.id)) summary.sources.push(source);
  }
  return summary;
}

function fallbackSourceName(type, id) {
  const shortId = id.slice(-6) || "unknown";
  if (type === "group") return `กลุ่ม LINE · ${shortId}`;
  if (type === "room") return `ห้อง LINE · ${shortId}`;
  return `แชต LINE · ${shortId}`;
}

async function resolveLineSource(source, env) {
  const type = source.type || "unknown";
  const id = source.groupId || source.roomId || source.userId || "unknown";
  let name = fallbackSourceName(type, id), pictureUrl = null, memberCount = null;
  if (type === "group" && env.LINE_CHANNEL_ACCESS_TOKEN) {
    try {
      const response = await fetch(`https://api.line.me/v2/bot/group/${encodeURIComponent(id)}/summary`, {
        headers: { authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
      });
      if (response.ok) {
        const profile = await response.json();
        name = profile.groupName || name;
        pictureUrl = profile.pictureUrl || null;
        memberCount = profile.memberCount ?? null;
      }
    } catch { /* ชื่อสำรองยังทำให้รับผลต่อได้ */ }
  }
  await env.DB.prepare(
    `INSERT INTO line_sources (source_id, source_type, source_name, picture_url, member_count, last_seen_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(source_id) DO UPDATE SET
       source_type = excluded.source_type,
       source_name = CASE WHEN excluded.source_name LIKE '% · %' THEN line_sources.source_name ELSE excluded.source_name END,
       picture_url = COALESCE(excluded.picture_url, line_sources.picture_url),
       member_count = COALESCE(excluded.member_count, line_sources.member_count),
       last_seen_at = datetime('now'), updated_at = datetime('now')`
  ).bind(id, type, name, pictureUrl, memberCount).run();
  return { id, type, name, member_count: memberCount };
}

async function discoverCjworld() {
  const page = await fetch("https://www.cjworld6.com/login", {
    headers: { "user-agent": "Mozilla/5.0 (compatible; YikiAnalytics/1.0)" },
    redirect: "follow",
  });
  const html = await page.text();
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)]
    .map((match) => new URL(match[1], page.url).href)
    .filter((src) => /pages\/(login|lotto)-/.test(src));
  const candidates = new Set();
  for (const scriptUrl of scripts) {
    const script = await (await fetch(scriptUrl)).text();
    for (const match of script.matchAll(/["'`]([^"'`]{1,180})["'`]/g)) {
      const value = match[1];
      if (/api|login|signin|auth|lotto|result|yeekee|yiki/i.test(value)) candidates.add(value);
    }
  }
  return { ok: page.ok, final_url: page.url, status: page.status, scripts, candidates: [...candidates].slice(0, 200) };
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/health") {
    return json({ ok: true, service: "yiki-analytics", time: new Date().toISOString() });
  }

  if (url.pathname === "/api/cjworld/discover" && request.method === "GET") {
    return json(await discoverCjworld());
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

    const result = await saveLineEvents(payload, env);
    return json({ ok: true, ...result });
  }

  if (url.pathname === "/api/sources" && request.method === "GET") {
    const date = url.searchParams.get("date") || bangkokDate(Date.now());
    const { results } = await env.DB.prepare(
      `SELECT s.source_id, s.source_type, s.source_name, s.member_count,
              COUNT(r.id) AS filled, MAX(r.round_no) AS latest_round, MAX(r.updated_at) AS last_result_at
       FROM line_sources s JOIN group_daily_results r ON r.source_id = s.source_id
       WHERE r.draw_date = ? GROUP BY s.source_id ORDER BY last_result_at DESC`
    ).bind(date).all();
    return json({ ok: true, draw_date: date, sources: results });
  }

  if (url.pathname === "/api/results" && request.method === "GET") {
    const requestedDate = url.searchParams.get("date");
    const latest = requestedDate || (await env.DB.prepare(
      "SELECT MAX(draw_date) AS draw_date FROM group_daily_results"
    ).first())?.draw_date || bangkokDate(Date.now());
    const requestedSource = url.searchParams.get("source_id");
    const selectedSource = requestedSource || (await env.DB.prepare(
      `SELECT source_id FROM group_daily_results WHERE draw_date = ? ORDER BY updated_at DESC LIMIT 1`
    ).bind(latest).first())?.source_id;
    if (!selectedSource) return json({ ok: true, draw_date: latest, expected_rounds: 214, filled: 0, results: [], source: null, last_receipt: null });
    const { results } = await env.DB.prepare(
      `SELECT round_no, draw_time, top_number, bottom_number, occurred_at, updated_at
       FROM group_daily_results WHERE draw_date = ? AND source_id = ? ORDER BY round_no ASC`
    ).bind(latest, selectedSource).all();
    const source = await env.DB.prepare(
      `SELECT source_id, source_type, source_name, member_count, last_seen_at FROM line_sources WHERE source_id = ?`
    ).bind(selectedSource).first();
    const receipt = await env.DB.prepare(
      `SELECT received_rows, inserted_rows, updated_rows, ignored_rows, created_at
       FROM webhook_receipts WHERE draw_date = ? AND source_id = ? ORDER BY created_at DESC LIMIT 1`
    ).bind(latest, selectedSource).first();
    return json({ ok: true, draw_date: latest, expected_rounds: 214, filled: results.length, missing: 214 - results.length, results, source, last_receipt: receipt || null });
  }

  if (url.pathname === "/api/result-dates" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT draw_date, COUNT(*) AS total_records, COUNT(DISTINCT source_id) AS source_count,
              MAX(round_no) AS latest_round, MAX(updated_at) AS last_updated
       FROM group_daily_results GROUP BY draw_date ORDER BY draw_date DESC LIMIT 90`
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

export { parseResult, parseResultLines, bangkokDate, extractMessageDate, verifyLineSignature, fallbackSourceName };
