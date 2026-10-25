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
    if (roundNo < 1 || roundNo > 264) continue;
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

function extractExplicitMessageDate(text) {
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
  return null;
}

function extractMessageDate(text, fallbackTimestamp = Date.now()) {
  return extractExplicitMessageDate(text) || bangkokDate(fallbackTimestamp);
}

async function saveLineEvents(payload, env) {
  const summary = { accepted: 0, inserted: 0, updated: 0, ignored: 0, rejected: 0, date_changes: 0, sources: [] };
  for (const event of payload.events || []) {
    const eventId = event.webhookEventId || crypto.randomUUID();
    const source = await resolveLineSource(event.source || {}, env);
    const messageType = event.message?.type || event.type || "unknown";
    const rawText = event.message?.type === "text" ? event.message.text : null;
    const occurredAt = new Date(event.timestamp || Date.now()).toISOString();
    let drawDate = bangkokDate(event.timestamp || Date.now());
    const logStatement = (status, parsedRows = 0, insertedRows = 0, duplicateRows = 0) => env.DB.prepare(
      `INSERT INTO line_message_log
       (event_id, source_id, source_type, source_name, draw_date, message_id, sender_user_id, message_type,
        raw_text, parsed_rows, inserted_rows, duplicate_rows, status, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO NOTHING`
    ).bind(eventId, source.id, source.type, source.name, drawDate, event.message?.id || null,
      event.source?.userId || null, messageType, rawText, parsedRows, insertedRows, duplicateRows, status, occurredAt);
    const receivedBefore = await env.DB.prepare(
      "SELECT event_id FROM line_message_log WHERE event_id = ? UNION SELECT event_id FROM webhook_receipts WHERE event_id = ? LIMIT 1"
    ).bind(eventId, eventId).first();
    if (receivedBefore) { summary.ignored += 1; continue; }
    if (event.type !== "message" || event.message?.type !== "text") {
      await logStatement("unsupported").run();
      summary.ignored += 1;
      continue;
    }
    const allowedName = env.ALLOWED_LINE_GROUP_NAME?.trim().toLocaleLowerCase();
    if (allowedName && (source.type !== "group" || source.name.trim().toLocaleLowerCase() !== allowedName)) {
      await logStatement("rejected_group").run();
      summary.rejected += 1;
      continue;
    }
    const explicitDrawDate = extractExplicitMessageDate(event.message.text);
    if (explicitDrawDate) {
      drawDate = explicitDrawDate;
      await env.DB.prepare(
        `INSERT INTO line_source_settings (source_id, active_draw_date, changed_by_event_id, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(source_id) DO UPDATE SET active_draw_date = excluded.active_draw_date,
           changed_by_event_id = excluded.changed_by_event_id, updated_at = datetime('now')`
      ).bind(source.id, drawDate, eventId).run();
      summary.date_changes += 1;
    } else {
      const activeDate = await env.DB.prepare(
        "SELECT active_draw_date FROM line_source_settings WHERE source_id = ?"
      ).bind(source.id).first();
      drawDate = activeDate?.active_draw_date || drawDate;
    }
    let parsedRows = parseResultLines(event.message.text);
    if (!parsedRows.length) {
      const single = parseResult(event.message.text);
      if (single?.roundNo && single.roundNo <= 264) parsedRows = [{ ...single, time: null }];
    }
    parsedRows = [...new Map(parsedRows.map((row) => [row.roundNo, row])).values()];
    if (!parsedRows.length) {
      if (explicitDrawDate) {
        await logStatement("accepted").run();
        if (!summary.sources.some((item) => item.id === source.id)) summary.sources.push(source);
        continue;
      }
      await logStatement("no_results").run();
      summary.ignored += 1;
      continue;
    }

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
    statements.push(logStatement("accepted", parsedRows.length, inserted, ignored));
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
       FROM line_sources s LEFT JOIN group_daily_results r ON r.source_id = s.source_id AND r.draw_date = ?
       GROUP BY s.source_id ORDER BY COALESCE(last_result_at, s.last_seen_at) DESC`
    ).bind(date).all();
    return json({ ok: true, draw_date: date, sources: results });
  }

  if (url.pathname === "/api/line-status" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT l.draw_date, l.source_name, l.message_type, l.status, l.parsed_rows,
              l.inserted_rows, l.duplicate_rows, l.occurred_at
       FROM line_message_log l ORDER BY l.created_at DESC LIMIT 20`
    ).all();
    return json({ ok: true, events: results });
  }

  if (url.pathname === "/api/results" && request.method === "GET") {
    const requestedDate = url.searchParams.get("date");
    const latest = requestedDate || (await env.DB.prepare(
      "SELECT MAX(draw_date) AS draw_date FROM group_daily_results"
    ).first())?.draw_date || bangkokDate(Date.now());
    const requestedSource = url.searchParams.get("source_id");
    const selectedSource = requestedSource || (await env.DB.prepare(
      `SELECT source_id FROM group_daily_results WHERE draw_date = ? ORDER BY updated_at DESC LIMIT 1`
    ).bind(latest).first())?.source_id || (await env.DB.prepare(
      `SELECT source_id FROM line_message_log WHERE draw_date = ? AND status IN ('accepted', 'no_results') ORDER BY created_at DESC LIMIT 1`
    ).bind(latest).first())?.source_id;
    if (!selectedSource) return json({ ok: true, draw_date: latest, expected_rounds: 264, filled: 0, results: [], source: null, last_receipt: null, stats: { messages: 0, accepted_messages: 0, unreadable_messages: 0, new_rounds: 0, duplicate_rounds: 0 } });
    const { results } = await env.DB.prepare(
      `SELECT round_no, draw_time, top_number, bottom_number, occurred_at, updated_at
       FROM group_daily_results WHERE draw_date = ? AND source_id = ? ORDER BY round_no ASC`
    ).bind(latest, selectedSource).all();
    const source = await env.DB.prepare(
      `SELECT source_id, source_type, source_name, member_count, last_seen_at FROM line_sources WHERE source_id = ?`
    ).bind(selectedSource).first();
    const activeDate = await env.DB.prepare(
      "SELECT active_draw_date, updated_at FROM line_source_settings WHERE source_id = ?"
    ).bind(selectedSource).first();
    const receipt = await env.DB.prepare(
      `SELECT received_rows, inserted_rows, updated_rows, ignored_rows, created_at
       FROM webhook_receipts WHERE draw_date = ? AND source_id = ? ORDER BY created_at DESC LIMIT 1`
    ).bind(latest, selectedSource).first();
    const stats = await env.DB.prepare(
      `SELECT COUNT(*) AS messages,
              COALESCE(SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END), 0) AS accepted_messages,
              COALESCE(SUM(CASE WHEN status = 'no_results' THEN 1 ELSE 0 END), 0) AS unreadable_messages,
              COALESCE(SUM(inserted_rows), 0) AS new_rounds,
              COALESCE(SUM(duplicate_rows), 0) AS duplicate_rounds
       FROM line_message_log WHERE draw_date = ? AND source_id = ?`
    ).bind(latest, selectedSource).first();
    return json({ ok: true, draw_date: latest, active_line_date: activeDate?.active_draw_date || null, active_line_date_updated_at: activeDate?.updated_at || null, expected_rounds: 264, filled: results.length, missing: 264 - results.length, results, source, last_receipt: receipt || null, stats });
  }

  if (url.pathname === "/api/results" && request.method === "PUT") {
    let body;
    try { body = await request.json(); }
    catch { return json({ ok: false, error: "invalid json" }, 400); }
    const drawDate = /^20\d{2}-\d{2}-\d{2}$/.test(body.draw_date || "") ? body.draw_date : null;
    const sourceId = String(body.source_id || "manual:web").slice(0, 160);
    const sourceName = String(body.source_name || "กรอกข้อมูลจากหน้าเว็บ").slice(0, 160);
    if (!drawDate || !Array.isArray(body.rows)) return json({ ok: false, error: "draw_date and rows are required" }, 400);
    const validRows = [];
    const seen = new Set();
    for (const row of body.rows) {
      const roundNo = Number(row.round_no);
      if (!Number.isInteger(roundNo) || roundNo < 1 || roundNo > 264 || seen.has(roundNo)) continue;
      const top = String(row.top_number || "");
      const bottom = String(row.bottom_number || "");
      if (!/^\d{3}$/.test(top) || !/^\d{2}$/.test(bottom)) return json({ ok: false, error: `invalid number at round ${roundNo}` }, 400);
      const time = /^\d{1,2}:\d{2}$/.test(row.draw_time || "") ? row.draw_time.padStart(5, "0") : null;
      seen.add(roundNo);
      validRows.push({ roundNo, time, top, bottom });
    }
    const before = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM group_daily_results WHERE draw_date = ? AND source_id = ?"
    ).bind(drawDate, sourceId).first();
    const eventId = `manual-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const statements = [
      env.DB.prepare(
        `INSERT INTO line_sources (source_id, source_type, source_name, last_seen_at)
         VALUES (?, 'manual', ?, datetime('now'))
         ON CONFLICT(source_id) DO UPDATE SET source_name = excluded.source_name, last_seen_at = datetime('now'), updated_at = datetime('now')`
      ).bind(sourceId, sourceName),
      env.DB.prepare("DELETE FROM group_daily_results WHERE draw_date = ? AND source_id = ?").bind(drawDate, sourceId),
      env.DB.prepare(
        `INSERT INTO result_change_log (draw_date, source_id, action, before_rows, after_rows, changed_rows)
         VALUES (?, ?, 'save_table', ?, ?, ?)`
      ).bind(drawDate, sourceId, Number(before?.total || 0), validRows.length, Math.max(Number(before?.total || 0), validRows.length)),
    ];
    if (validRows.length) {
      const valueSql = validRows.map(() => "(?, ?, ?, ?, ?, ?, 'แก้ไขจากหน้าเว็บ', ?, ?)").join(",");
      const bindings = validRows.flatMap((row) => [drawDate, sourceId, row.roundNo, row.time, row.top, row.bottom, eventId, now]);
      statements.splice(2, 0, env.DB.prepare(
        `INSERT INTO group_daily_results
         (draw_date, source_id, round_no, draw_time, top_number, bottom_number, source_text, event_id, occurred_at)
         VALUES ${valueSql}`
      ).bind(...bindings));
    }
    await env.DB.batch(statements);
    return json({ ok: true, draw_date: drawDate, source_id: sourceId, saved_rows: validRows.length, persisted: true });
  }

  if (url.pathname === "/api/results" && request.method === "DELETE") {
    const drawDate = url.searchParams.get("date");
    const sourceId = url.searchParams.get("source_id");
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(drawDate || "") || !sourceId) return json({ ok: false, error: "date and source_id are required" }, 400);
    const before = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM group_daily_results WHERE draw_date = ? AND source_id = ?"
    ).bind(drawDate, sourceId).first();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM group_daily_results WHERE draw_date = ? AND source_id = ?").bind(drawDate, sourceId),
      env.DB.prepare(
        `INSERT INTO result_change_log (draw_date, source_id, action, before_rows, after_rows, changed_rows)
         VALUES (?, ?, 'delete_results', ?, 0, ?)`
      ).bind(drawDate, sourceId, Number(before?.total || 0), Number(before?.total || 0)),
    ]);
    return json({ ok: true, deleted_rows: Number(before?.total || 0), persisted: true });
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
