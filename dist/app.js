const navItems = document.querySelectorAll('.nav-item');
const pages = document.querySelectorAll('.page');
const titles = { dashboard: 'รับข้อความใหม่จาก LINE', three: 'คำนวณชุด 3 หลัก', four: 'วิเคราะห์ 264 รอบ', guide: 'คู่มือเทคนิค' };
function showPage(target, item) {
  navItems.forEach((nav) => nav.classList.toggle('active', nav === item));
  pages.forEach((page) => page.classList.toggle('active', page.id === target));
  document.getElementById('pageTitle').textContent = titles[target];
  document.getElementById('sidebar').classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const realtimeDateInput = document.getElementById('realtimeDate');
const realtimeSourceSelect = document.getElementById('realtimeSourceSelect');
const historyRows = document.getElementById('historyRows');
const dailyHistoryList = document.getElementById('dailyHistoryList');

function thailandDate() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function renderRealtimeRows(results = []) {
  const byRound = new Map(results.map((item) => [Number(item.round_no), item]));
  historyRows.innerHTML = Array.from({ length: 214 }, (_, index) => {
    const round = index + 1;
    const item = byRound.get(round);
    return `<tr class="${item ? 'round-received' : 'round-waiting'}">
      <td><span class="round-no">${String(round).padStart(3, '0')}</span></td>
      <td>${item?.draw_time || '—'}</td>
      <td class="mono realtime-number">${item?.top_number || '— — —'}</td>
      <td class="mono realtime-number">${item?.bottom_number || '— —'}</td>
      <td>${item ? '<span class="verified">✓ รับข้อมูลแล้ว</span>' : '<span class="waiting">รอผล</span>'}</td>
    </tr>`;
  }).join('');
}

async function loadRealtimeResults({ quiet = false } = {}) {
  const date = realtimeDateInput.value || thailandDate();
  const sourceId = realtimeSourceSelect.value;
  const message = document.getElementById('syncMessage');
  if (!quiet) {
    message.className = 'sync-message loading';
    message.querySelector('span').textContent = 'กำลังโหลดข้อมูลล่าสุด';
  }
  try {
    const query = new URLSearchParams({ date });
    if (sourceId) query.set('source_id', sourceId);
    const response = await fetch(`/api/results?${query}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const results = payload.results || [];
    renderRealtimeRows(results);
    document.getElementById('realtimeFilled').textContent = payload.filled || 0;
    document.getElementById('realtimeGroupName').textContent = payload.source?.source_name || 'ยังไม่พบกลุ่ม';
    document.getElementById('realtimeDateLabel').textContent = payload.draw_date || date;
    const latest = results.at(-1);
    document.getElementById('latestTop').textContent = latest?.top_number || '---';
    document.getElementById('latestBottom').textContent = latest?.bottom_number || '--';
    document.getElementById('latestRound').textContent = latest ? String(latest.round_no).padStart(3, '0') : '—';
    document.getElementById('realtimeSource').textContent = latest ? `${payload.source?.source_name || 'LINE'} · เวลา ${latest.draw_time || 'ไม่ระบุ'}` : 'รอข้อมูลจาก LINE Webhook';
    document.getElementById('realtimeStatus').textContent = results.length ? `อัปเดตแล้ว ${results.length} จาก 214 รอบ` : 'วันนี้ยังไม่มีผลส่งเข้ามา';
    message.className = 'sync-message success';
    const receipt = payload.last_receipt;
    const receiptText = receipt ? ` · ข้อความล่าสุด: เพิ่มใหม่ ${receipt.inserted_rows} / ข้ามรอบที่มีแล้ว ${receipt.ignored_rows}` : '';
    message.querySelector('span').textContent = `ซิงก์ล่าสุด ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}${receiptText}`;
    remaining = 30;
  } catch (error) {
    renderRealtimeRows([]);
    message.className = 'sync-message error';
    message.querySelector('span').textContent = `เชื่อมต่อข้อมูลไม่ได้ (${error.message})`;
  }
}

async function loadRealtimeSources({ preserve = true } = {}) {
  const date = realtimeDateInput.value || thailandDate();
  const previous = preserve ? realtimeSourceSelect.value : '';
  const response = await fetch(`/api/sources?date=${encodeURIComponent(date)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const sources = payload.sources || [];
  const options = sources.length ? sources.map((source) => {
    const option = document.createElement('option');
    option.value = source.source_id;
    option.textContent = `${source.source_name} · ${source.filled}/214 รอบ`;
    return option;
  }) : [Object.assign(document.createElement('option'), { value: '', textContent: 'ยังไม่พบกลุ่ม' })];
  realtimeSourceSelect.replaceChildren(...options);
  if (previous && sources.some((source) => source.source_id === previous)) realtimeSourceSelect.value = previous;
}

function formatThaiDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00+07:00`));
}

async function loadDailyHistory() {
  try {
    const response = await fetch('/api/result-dates', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const dates = payload.dates || [];
    document.getElementById('historyDayCount').textContent = `${dates.length} วันที่บันทึกไว้`;
    dailyHistoryList.innerHTML = '';
    if (!dates.length) {
      dailyHistoryList.innerHTML = '<p class="history-empty">ยังไม่มีข้อมูลย้อนหลัง เมื่อแชร์ผลเข้ากลุ่ม Test API ระบบจะสร้างประวัติของวันนั้นอัตโนมัติ</p>';
      return;
    }
    dates.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `history-day${item.draw_date === realtimeDateInput.value ? ' active' : ''}`;
      button.innerHTML = `<span>${formatThaiDate(item.draw_date)}</span><strong>${item.total_records} รายการ</strong><small>${item.source_count} กลุ่ม · รอบล่าสุด ${String(item.latest_round || 0).padStart(3, '0')}</small>`;
      button.addEventListener('click', async () => {
        realtimeDateInput.value = item.draw_date;
        await loadRealtimeSources({ preserve: false });
        await loadRealtimeResults();
        await loadDailyHistory();
        document.querySelector('.realtime-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      dailyHistoryList.appendChild(button);
    });
  } catch (error) {
    dailyHistoryList.innerHTML = `<p class="history-empty">โหลดประวัติไม่ได้ (${error.message})</p>`;
  }
}

realtimeDateInput.value = thailandDate();
renderRealtimeRows();
document.getElementById('refreshRealtime').addEventListener('click', async () => { await loadRealtimeSources(); await loadRealtimeResults(); await loadDailyHistory(); });
realtimeDateInput.addEventListener('change', async () => { await loadRealtimeSources({ preserve: false }); await loadRealtimeResults(); await loadDailyHistory(); });
realtimeSourceSelect.addEventListener('change', () => loadRealtimeResults());
loadRealtimeSources().then(() => loadRealtimeResults()).catch(() => loadRealtimeResults());
loadDailyHistory();

const pairMap = { '0': '2', '1': '7', '2': '0', '3': '8', '4': '5', '5': '4', '6': '9', '7': '1', '8': '3', '9': '6' };
const sequenceBases = ['089', '567', '243', '190', '789'];

function expandJeeb(number) {
  return [...number].reduce((results, digit) =>
    results.flatMap((prefix) => [prefix + digit, prefix + pairMap[digit]]), ['']);
}

function numberSignature(number) {
  return [...number].sort().join('');
}

function expandTwoDigitRows(number) {
  const [tens, units] = number;
  return [
    [pairMap[tens] + units, pairMap[tens] + pairMap[units]],
    [tens + units, tens + pairMap[units]],
  ];
}

const doubleNumbers = Array.from({ length: 10 }, (_, number) => `${number}${number}`);
const jprNumbers = ['17', '71', '02', '20', '38', '83', '45', '54', '69', '96'];

function isSiblingPair(first, second) {
  const difference = Math.abs(Number(first) - Number(second));
  return difference === 1 || difference === 9;
}

function ruleTrigger(top, bottom) {
  const topUnit = top[2];
  const bottomTens = bottom[0];
  return {
    trick1: isSiblingPair(topUnit, bottomTens),
    trick2: topUnit === bottomTens,
    pair: `${topUnit}${bottomTens}`,
  };
}

function comparedDigitsHtml(top, bottom) {
  return `<span class="compared-number">บน ${top.slice(0, 2)}<mark>${top[2]}</mark></span><i>เทียบ</i><span class="compared-number">ล่าง <mark>${bottom[0]}</mark>${bottom[1]}</span>`;
}

function ruleRecommendationHtml(top, bottom) {
  const trigger = ruleTrigger(top, bottom);
  const blocks = [];
  if (trigger.trick1) blocks.push(`<div class="rule-tip t1"><b>RULE เทคนิค 1 · พี่น้อง ${top[2]}–${bottom[0]}</b><div class="rule-digit-view">${comparedDigitsHtml(top, bottom)}</div><span>ตาม 4 รอบถัดไป: เลขเบิ้ล หรือเลข จปร.</span><small>เบิ้ล ${doubleNumbers.join(', ')}<br>จปร. ${jprNumbers.join(', ')}</small></div>`);
  if (trigger.trick2) blocks.push(`<div class="rule-tip t2"><b>RULE เทคนิค 2 · รูซ้ำ ${top[2]}–${bottom[0]}</b><div class="rule-digit-view">${comparedDigitsHtml(top, bottom)}</div><span>ตาม 4 รอบถัดไป: พี่น้องใน 2 ตัวท้ายบน หรือ 2 ตัวล่าง</span></div>`);
  return blocks.length ? `<div class="rule-recommendation"><strong>คำแนะนำ RULE</strong><p class="rule-compare">เทียบหน่วยบน ${top[2]} ↔ สิบล่าง ${bottom[0]}</p>${blocks.join('')}</div>` : `<div class="rule-recommendation quiet"><strong>คำแนะนำ RULE</strong><span>เทียบหน่วยบน ${top[2]} ↔ สิบล่าง ${bottom[0]} · รอบนี้ยังไม่เป็นพี่น้องหรือรูซ้ำ</span></div>`;
}

const huntSignalPairs = ['33', '88', '38', '83'];
const huntTargetPairs = ['43', '48', '53', '58'];
function unique(values) { return [...new Set(values)]; }
function pairRangeTargets(pair) { return unique(expandTwoDigitRows(pair).flat()).map((value) => `${value}0–${value}9`); }

function independentTechniqueData(top, bottom, context = {}) {
  const cards = [], topTargets = [], bottomTargets = [], reasons = [];
  const foundSignal = huntSignalPairs.find((pair) => top.includes(pair) || bottom.includes(pair));
  if (foundSignal) {
    const ranges = huntTargetPairs.map((pair) => `${pair}0–${pair}9`);
    cards.push(`<article class="extra-technique hunt"><b>เทคนิค 3 · สัญญาณล่าเลขจาก ${foundSignal}</b><span>แนะนำ 43, 48, 53, 58 แล้วลากเป็นเลข 3 ตัว</span><small>${ranges.join(' · ')} · ติดตามไม่เกิน 6 รอบ พบแล้วหยุด</small></article>`);
    topTargets.push(...ranges); bottomTargets.push(...huntTargetPairs); reasons.push(`สีม่วง: พบชุดล่าเลข ${foundSignal}`);
  }
  if (context.roundInLot === 1) {
    const seed = top[2] + bottom, targets = expandJeeb(seed);
    cards.push(`<article class="extra-technique running"><b>เทคนิค 4 · จับเลขวิ่งจากรอบแรก</b><span>หน่วยบน ${top[2]} + เลขล่าง ${bottom} = ${seed}</span><small>เลข 3 ตัว: ${targets.join(', ')} · ติดตาม 8–10 รอบ</small></article>`);
    topTargets.push(...targets); bottomTargets.push(...targets.map((value) => value.slice(-2))); reasons.push('สีฟ้า: หน่วยบน + สองตัวล่างของรอบแรก');
  }
  if (/^(\d)\1\1$/.test(top)) {
    cards.push(`<article class="extra-technique triple"><b>เทคนิค 5 · พบเลขตอง ${top}</b><span>เก็บข้อมูลรอบก่อนตอง</span><small>รอรอบถัดไป แล้วนำคู่เลขก่อน–หลังตองมาสร้างชุดลาก 3 ตัว</small></article>`); reasons.push(`สีชมพู: พบเลขตอง ${top}`);
  }
  if (context.previousTop && /^(\d)\1\1$/.test(context.previousTop) && context.twoBackTop && context.twoBackBottom) {
    const sourcePairs = unique([context.twoBackTop.slice(-2), context.twoBackBottom, top.slice(-2), bottom]);
    const ranges = unique(sourcePairs.flatMap(pairRangeTargets));
    cards.push(`<article class="extra-technique triple"><b>เทคนิค 5 · ครบคู่ก่อน–หลังเลขตอง ${context.previousTop}</b><span>คู่ตั้งต้น ${sourcePairs.join(', ')}</span><small>ชุดลาก 3 ตัว: ${ranges.join(' · ')}</small></article>`);
    topTargets.push(...ranges); bottomTargets.push(...sourcePairs); reasons.push(`สีชมพู: คำนวณรอบก่อน–หลังตอง ${context.previousTop}`);
  }
  return { html: cards.length ? `<section class="extra-techniques"><header><b>คำแนะนำเพิ่มเติม · ไม่ต้องรอจีบเรียง</b><span>${cards.length} เทคนิคที่เข้าเงื่อนไข</span></header>${cards.join('')}</section>` : '', topTargets: unique(topTargets), bottomTargets: unique(bottomTargets), reasons, count: cards.length };
}

function chanceSummaryHtml(top, bottom, techniques) {
  const trigger = ruleTrigger(top, bottom), topTargets = [...techniques.topTargets], bottomTargets = [...techniques.bottomTargets];
  if (trigger.trick1) { topTargets.push(...doubleNumbers, ...jprNumbers); bottomTargets.push(...doubleNumbers, ...jprNumbers); }
  if (trigger.trick2) {
    const siblings = ['01','10','12','21','23','32','34','43','45','54','56','65','67','76','78','87','89','98','90','09'];
    topTargets.push(...siblings); bottomTargets.push(...siblings);
  }
  return `<section class="chance-summary"><header><b>สรุปเลขที่เทคนิคแนะนำในรอบนี้</b><span>แนวทางจากแพทเทิร์น ไม่รับประกันผล</span></header><div><article><small>เลขบน / สองตัวท้ายบน</small><strong>${unique(topTargets).join(', ') || 'ยังไม่มีชุดแนะนำ'}</strong></article><article><small>เลขล่าง</small><strong>${unique(bottomTargets).join(', ') || 'ยังไม่มีชุดแนะนำ'}</strong></article></div></section>`;
}

let activeLot = null;

function matchingGroups(top) {
  const signature = numberSignature(top);
  return sequenceBases.map((base, index) => {
    const variants = expandJeeb(base);
    const hits = variants.filter((value) => numberSignature(value) === signature);
    return { index, base, variants, hits };
  }).filter((group) => group.hits.length);
}

function renderLot() {
  if (!activeLot) return;
  const workspace = document.getElementById('roundWorkspace');
  document.getElementById('manualLot').hidden = false;
  document.getElementById('activeLotName').textContent = activeLot.name;
  document.getElementById('lotProgress').textContent = `${activeLot.completed} / 4 รอบ`;
  workspace.innerHTML = activeLot.rounds.map((round, index) => {
    const locked = index > activeLot.completed;
    const statusText = round.status === 'won' ? 'ได้แล้ว · ไปต่อ' : round.status === 'miss' ? 'ไม่พบจีบเรียง' : activeLot.ended ? 'ล็อตจบแล้ว' : locked ? 'รอรอบก่อนหน้า' : 'พร้อมคำนวณ';
    return `<article class="round-card ${locked ? 'locked' : ''} ${round.status === 'won' ? 'won' : ''} ${round.status === 'miss' ? 'done-no-match' : ''}" data-round="${index}">
      <div class="round-main">
        <div class="round-index"><span>${String(index + 1).padStart(2, '0')}</span></div>
        <div class="round-inputs">
          <label>3 ตัวบน<input class="lot-top" inputmode="numeric" maxlength="3" value="${round.top}" placeholder="000" ${locked || round.status ? 'disabled' : ''}></label>
          <label>2 ตัวล่าง<input class="lot-bottom" inputmode="numeric" maxlength="2" value="${round.bottom}" placeholder="00" ${locked || round.status ? 'disabled' : ''}></label>
          <button class="calculate-round" type="button" ${locked || round.status ? 'disabled' : ''}>คำนวณรอบนี้</button>
        </div>
        <div class="round-status"><span>สถานะ</span><strong>${statusText}</strong></div>
      </div>
      ${round.output || ''}
    </article>`;
  }).join('');
}

function buildRoundOutput(top, bottom, groups, context = {}) {
  const ruleHtml = ruleRecommendationHtml(top, bottom);
  const techniques = independentTechniqueData(top, bottom, context);
  if (groups.length) {
    techniques.topTargets.push(...expandJeeb(top));
    techniques.bottomTargets.push(...expandTwoDigitRows(top.slice(-2)).flat());
  }
  const summaryHtml = chanceSummaryHtml(top, bottom, techniques);
  if (!groups.length) return `<div class="round-output"><div class="round-message no-match"><b>คำแนะนำเลขจีบ:</b> ไม่พบเลข ${top} ในจีบเรียง — ไม่สร้างเลข จปล</div>${ruleHtml}${techniques.html}${summaryHtml}</div>`;
  const signature = numberSignature(top);
  const groupsHtml = sequenceBases.map((base, index) => {
    const variants = expandJeeb(base);
    const isGroupHit = groups.some((group) => group.index === index);
    return `<div class="compact-group ${isGroupHit ? 'hit-group' : ''}"><b>กลุ่ม ${index + 1} · ${base}</b><div>${variants.map((value) => `<i class="${numberSignature(value) === signature ? 'hit' : ''}">${value}</i>`).join('')}</div></div>`;
  }).join('');
  const topLastTwo = top.slice(-2);
  const twoDigitRows = expandTwoDigitRows(topLastTwo);
  const threeDigitValues = expandJeeb(top);
  const threeDigitRows = [threeDigitValues.slice(0, 4), threeDigitValues.slice(4)];
  return `<div class="round-output">
    <div class="round-message"><b>คำแนะนำเลขจีบ:</b> พบเลข <strong>${top}</strong> ในจีบเรียง ${groups.length} กลุ่ม · ไฮไลต์ตัวที่ตรงแล้ว</div>
    <div class="compact-groups">${groupsHtml}</div>
    <div class="round-jeeb">
      <section class="calc-pattern-card"><header><span>จปล 3 หลัก</span><b>8 ตัว</b></header><p>เลขตั้งต้น <strong>${top}</strong> · สลับตามคู่ จปล ทีละหลัก</p>${threeDigitRows.map((row, index) => `<div class="pattern-row"><strong>แถว ${index + 1}</strong><div>${row.map((value) => `<i>${value}</i>`).join('')}</div></div>`).join('')}<small>ผลคำนวณ 3 หลัก · ${threeDigitValues.join(', ')}</small></section>
      <section class="calc-pattern-card"><header><span>จปล 2 หลัก</span><b>4 ตัว</b></header><p>คำนวณจากเลข <strong>${twoDigitRows[0][0]}</strong></p>${twoDigitRows.map((row, index) => `<div class="pattern-row"><strong>แถว ${index + 1}</strong><div>${row.map((value) => `<i>${value}</i>`).join('')}</div></div>`).join('')}<small>ผลคำนวณ 2 หลัก · ${twoDigitRows.flat().join(', ')}</small></section>
    </div>${ruleHtml}${techniques.html}${summaryHtml}
  </div>`;
}

document.getElementById('startLot').addEventListener('click', () => {
  const lotName = document.getElementById('lotName').value.trim() || `ล็อต ${new Date().toLocaleTimeString('th-TH', {hour:'2-digit', minute:'2-digit'})}`;
  activeLot = { name: lotName, completed: 0, ended: false, hitRounds: [], rounds: Array.from({ length: 4 }, () => ({ top: '', bottom: '', status: '', output: '' })) };
  const state = document.getElementById('lotState');
  state.className = 'lot-state active';
  state.innerHTML = '<i></i><span>กำลังทำล็อต · รอบที่ 1</span>';
  renderLot();
  requestAnimationFrame(() => document.getElementById('manualLot').scrollIntoView({ behavior: 'smooth', block: 'start' }));
});

document.getElementById('loadMockLot').addEventListener('click', () => {
  const mockRounds = [
    { top: '506', bottom: '58' },
    { top: '872', bottom: '62' },
    { top: '476', bottom: '20' },
    { top: '383', bottom: '61' },
  ];
  const rounds = mockRounds.map(({ top, bottom }, index) => {
    const groups = matchingGroups(top);
    const context = { roundInLot: index + 1, previousTop: mockRounds[index - 1]?.top, twoBackTop: mockRounds[index - 2]?.top, twoBackBottom: mockRounds[index - 2]?.bottom };
    return { top, bottom, status: groups.length ? 'won' : 'miss', output: buildRoundOutput(top, bottom, groups, context) };
  });
  const hitRounds = rounds.map((round, index) => round.status === 'won' ? index + 1 : null).filter(Boolean);
  activeLot = { name: 'Mockup จากตาราง · รอบ 1–4', completed: 4, ended: true, hitRounds, rounds };
  document.getElementById('lotName').value = 'Mockup จากตาราง';
  const state = document.getElementById('lotState');
  state.className = hitRounds.length ? 'lot-state won' : 'lot-state';
  state.innerHTML = `<i></i><span>Mockup ครบ 4 รอบ · พบจีบเรียง ${hitRounds.length} รอบ</span>`;
  renderLot();
  requestAnimationFrame(() => document.getElementById('manualLot').scrollIntoView({ behavior: 'smooth', block: 'start' }));
});

document.getElementById('roundWorkspace').addEventListener('input', (event) => {
  if (event.target.matches('input')) event.target.value = event.target.value.replace(/\D/g, '');
});

document.getElementById('roundWorkspace').addEventListener('click', (event) => {
  const button = event.target.closest('.calculate-round');
  if (!button || !activeLot || activeLot.ended) return;
  const card = button.closest('.round-card');
  const index = Number(card.dataset.round);
  const top = card.querySelector('.lot-top').value.trim();
  const bottom = card.querySelector('.lot-bottom').value.trim();
  if (!/^\d{3}$/.test(top) || !/^\d{2}$/.test(bottom)) {
    card.querySelector('.round-status strong').textContent = 'กรอกตัวเลขให้ครบ';
    return;
  }
  const groups = matchingGroups(top);
  const round = activeLot.rounds[index];
  const context = { roundInLot: index + 1, previousTop: activeLot.rounds[index - 1]?.top, twoBackTop: activeLot.rounds[index - 2]?.top, twoBackBottom: activeLot.rounds[index - 2]?.bottom };
  round.top = top; round.bottom = bottom; round.output = buildRoundOutput(top, bottom, groups, context);
  round.status = groups.length ? 'won' : 'miss';
  activeLot.completed = index + 1;
  if (groups.length) activeLot.hitRounds.push(index + 1);
  if (activeLot.completed === 4) activeLot.ended = true;

  const state = document.getElementById('lotState');
  if (activeLot.ended) {
    state.className = activeLot.hitRounds.length ? 'lot-state won' : 'lot-state';
    state.innerHTML = `<i></i><span>ครบ 4 รอบ · ได้ ${activeLot.hitRounds.length} รอบ · จบล็อต</span>`;
  } else if (groups.length) {
    state.className = 'lot-state won';
    state.innerHTML = `<i></i><span>ได้แล้วในรอบที่ ${index + 1} · ไปต่อรอบที่ ${index + 2}</span>`;
  } else {
    state.className = 'lot-state active';
    state.innerHTML = `<i></i><span>ไม่พบ · ไปต่อรอบที่ ${index + 2}</span>`;
  }
  renderLot();
  requestAnimationFrame(() => document.querySelector(`[data-round="${index}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
});

const dailyDate = document.getElementById('dailyDate');
const dailyRows = document.getElementById('dailyRows');
dailyDate.value = new Date().toISOString().slice(0, 10);

function dailyStorageKey() { return `yiki-daily-264-${dailyDate.value}`; }

function readDailyData() {
  try { return JSON.parse(localStorage.getItem(dailyStorageKey())) || []; }
  catch { return []; }
}

function saveDailyData() {
  const values = [...dailyRows.querySelectorAll('tr')].map((row) => ({
    top: row.querySelector('.daily-top').value,
    bottom: row.querySelector('.daily-bottom').value,
  }));
  localStorage.setItem(dailyStorageKey(), JSON.stringify(values));
  updateDailyCounts();
}

function renderDailyTable() {
  const saved = readDailyData();
  dailyRows.innerHTML = Array.from({ length: 264 }, (_, index) => {
    const item = saved[index] || { top: '', bottom: '' };
    const lot = Math.floor(index / 4) + 1;
    const roundInLot = (index % 4) + 1;
    return `<tr class="${roundInLot === 1 ? 'lot-start' : ''}" data-daily-round="${index + 1}" data-lot="${lot}"><td class="daily-lot"><b>ล็อต ${String(lot).padStart(2, '0')}</b><small>รอบ ${roundInLot}/4</small></td><td><span class="round-no">${String(index + 1).padStart(3, '0')}</span></td><td><div class="number-editor"><input class="daily-top" inputmode="numeric" maxlength="3" value="${item.top || ''}" placeholder="000"><button class="edit-number" type="button" aria-label="แก้ไขเลข 3 ตัวบน" title="แก้ไข">✎</button></div><div class="digit-preview top-preview"></div></td><td><div class="number-editor"><input class="daily-bottom" inputmode="numeric" maxlength="2" value="${item.bottom || ''}" placeholder="00"><button class="edit-number" type="button" aria-label="แก้ไขเลข 2 ตัวล่าง" title="แก้ไข">✎</button></div><div class="digit-preview bottom-preview"></div></td><td class="daily-match"><span class="pending">รอวิเคราะห์</span></td><td class="daily-hit">—</td><td class="daily-pair">—</td><td class="daily-rule">—</td><td class="daily-follow">—</td><td class="daily-result"><span class="result-empty">กดวิเคราะห์เพื่อดูผล</span></td></tr>`;
  }).join('');
  updateDailyCounts();
}

function updateDailyCounts() {
  const filled = [...dailyRows.querySelectorAll('tr')].filter((row) => /^\d{3}$/.test(row.querySelector('.daily-top').value) && /^\d{2}$/.test(row.querySelector('.daily-bottom').value)).length;
  document.getElementById('filledCount').textContent = filled;
}

function digitPreviewHtml(number, classes) {
  return [...number].map((digit, index) => `<i class="${unique(classes[index] || []).join(' ')}">${digit}</i>`).join('');
}

function analyzeDailyRounds() {
  const hitRounds = [];
  const ruleEvents = [];
  const trackers = [];
  const jeebTrackers = [];
  let ruleTriggerCount = 0;
  let ruleHitCount = 0;
  const allDailyRows = [...dailyRows.querySelectorAll('tr')];
  allDailyRows.forEach((row, index) => {
    const top = row.querySelector('.daily-top').value;
    const bottom = row.querySelector('.daily-bottom').value;
    const matchCell = row.querySelector('.daily-match');
    const hitCell = row.querySelector('.daily-hit');
    const pairCell = row.querySelector('.daily-pair');
    const ruleCell = row.querySelector('.daily-rule');
    const followCell = row.querySelector('.daily-follow');
    const resultCell = row.querySelector('.daily-result');
    const topPreview = row.querySelector('.top-preview');
    const bottomPreview = row.querySelector('.bottom-preview');
    row.classList.remove('has-jeeb', 'has-rule', 'rule-won', 'lot-predicted', 'lot-missed', 'numbers-analyzed');
    row.querySelector('.lot-verdict')?.remove();
    if (!/^\d{3}$/.test(top) || !/^\d{2}$/.test(bottom)) {
      matchCell.innerHTML = '<span class="pending">ไม่มีข้อมูล</span>'; hitCell.textContent = '—'; pairCell.textContent = '—'; ruleCell.textContent = '—'; followCell.textContent = '—'; resultCell.innerHTML = '<span class="result-empty">ไม่มีข้อมูล</span>'; topPreview.innerHTML = ''; bottomPreview.innerHTML = ''; return;
    }

    const followMessages = [];
    const hitReasons = [];
    jeebTrackers.filter((tracker) => !tracker.resolved).forEach((tracker) => {
      const elapsed = index - tracker.start;
      if (elapsed < 1 || elapsed > 4) return;
      const hit3 = tracker.three.includes(top);
      const hit2 = tracker.two.includes(bottom);
      if (hit3 || hit2) {
        tracker.resolved = true;
        row.classList.add('rule-won');
        const matches = [hit3 ? `3 หลัก ${top}` : '', hit2 ? `2 หลัก ${bottom}` : ''].filter(Boolean).join(' + ');
        followMessages.push(`<span class="jeeb-follow hit"><b>จปล เข้าเป้า · <mark>${matches}</mark></b><small>คำนวณจากรอบ ${tracker.start + 1} · พบในรอบติดตาม ${elapsed}/4</small></span>`);
        hitReasons.push(`ผลเข้าเป้า จปล: ${matches}`);
      } else {
        const last = elapsed === 4;
        followMessages.push(`<span class="jeeb-follow ${last ? 'expired' : ''}"><b>ติดตาม จปล จากรอบ ${tracker.start + 1}</b><small>รอบ ${elapsed}/4 · ยังไม่พบเลขที่คำนวณไว้${last ? ' · จบการติดตาม' : ''}</small></span>`);
        if (last) tracker.resolved = true;
      }
    });
    trackers.filter((tracker) => !tracker.resolved).forEach((tracker) => {
      const elapsed = index - tracker.start;
      if (elapsed < 1 || elapsed > 4) return;
      let hitLabel = '';
      let hitKind = '';
      if (tracker.type === 1) {
        const topPair = top.slice(-2);
        if (topPair[0] === topPair[1]) { hitLabel = `พบเบิ้ล ${topPair}`; hitKind = 'double-hit'; }
        else if (pairMap[topPair[0]] === topPair[1]) { hitLabel = `พบ จปร. ${topPair}`; hitKind = 'jpr-hit'; }
      } else {
        const topPair = top.slice(-2);
        if (isSiblingPair(topPair[0], topPair[1])) { hitLabel = `พี่น้องบน ${topPair}`; hitKind = 'sibling-hit'; }
        else if (isSiblingPair(bottom[0], bottom[1])) { hitLabel = `พี่น้องล่าง ${bottom}`; hitKind = 'sibling-hit'; }
      }
      if (hitLabel) {
        tracker.resolved = true;
        ruleHitCount += 1;
        row.classList.add('rule-won');
        followMessages.push(`<span class="rule-hit ${hitKind}"><b>RULE เข้าเป้า · <mark>${hitLabel}</mark></b><small>T${tracker.type} เริ่มจากรอบ ${tracker.start + 1} · พบในรอบติดตาม ${elapsed}/4</small></span>`);
        hitReasons.push(`ผลเข้าเป้า RULE: ${hitLabel}`);
        ruleEvents.push({ kind: 'hit', round: index + 1, text: `T${tracker.type} จากรอบ ${tracker.start + 1} → ${hitLabel}` });
      } else {
        const last = elapsed === 4;
        followMessages.push(`<span class="rule-track ${last ? 'expired' : ''}">T${tracker.type} จากรอบ ${tracker.start + 1} · ${elapsed}/4 ${last ? 'ครบกำหนด' : 'ยังไม่พบ'}</span>`);
        if (last) {
          tracker.resolved = true;
          ruleEvents.push({ kind: 'expired', round: index + 1, text: `T${tracker.type} จากรอบ ${tracker.start + 1} → ครบ 4 รอบ` });
        }
      }
    });

    const groups = matchingGroups(top);
    if (!groups.length) {
      matchCell.innerHTML = '<span class="no-hit">ไม่พบ</span>'; hitCell.textContent = '—'; pairCell.textContent = '—';
    } else {
      row.classList.add('has-jeeb');
      const matchingValues = groups.flatMap((group) => group.hits);
      const twoRows = expandTwoDigitRows(top.slice(-2));
      jeebTrackers.push({ start: index, resolved: false, three: expandJeeb(top), two: twoRows.flat() });
      matchCell.innerHTML = `<span class="has-hit">พบ ${groups.map((group) => `กลุ่ม ${group.index + 1}`).join(', ')}</span>`;
      hitCell.innerHTML = matchingValues.map((value) => `<b>${value}</b>`).join(' ');
      pairCell.innerHTML = `<span>${twoRows[0].join(', ')}</span><span>${twoRows[1].join(', ')}</span>`;
      hitRounds.push({ round: index + 1, top, groups, matchingValues, twoRows });
    }

    const trigger = ruleTrigger(top, bottom);
    const triggerMessages = [];
    if (trigger.trick1) {
      trackers.push({ type: 1, start: index, resolved: false });
      ruleTriggerCount += 1;
      row.classList.add('has-rule');
      triggerMessages.push(`<span class="rule-trigger t1"><b>T1 พี่น้อง ${top[2]}–${bottom[0]}</b><span class="rule-digit-view">${comparedDigitsHtml(top, bottom)}</span><small>4 รอบถัดไป: เบิ้ล / จปร.</small></span>`);
      ruleEvents.push({ kind: 'trigger', round: index + 1, text: `T1 พี่น้อง ${top[2]}–${bottom[0]} · ตามเบิ้ล/จปร.` });
    }
    if (trigger.trick2) {
      trackers.push({ type: 2, start: index, resolved: false });
      ruleTriggerCount += 1;
      row.classList.add('has-rule');
      triggerMessages.push(`<span class="rule-trigger t2"><b>T2 รูซ้ำ ${top[2]}–${bottom[0]}</b><span class="rule-digit-view">${comparedDigitsHtml(top, bottom)}</span><small>4 รอบถัดไป: พี่น้องบน/ล่าง</small></span>`);
      ruleEvents.push({ kind: 'trigger', round: index + 1, text: `T2 รูซ้ำ ${top[2]}–${bottom[0]} · ตามเลขพี่น้อง` });
    }
    ruleCell.innerHTML = triggerMessages.length ? triggerMessages.join('') : '<span class="rule-none">—</span>';
    followCell.innerHTML = followMessages.length ? followMessages.join('') : '<span class="rule-none">—</span>';
    const resultBlocks = [];
    if (groups.length) resultBlocks.push(`<div class="result-block result-jeeb"><b>จีบเรียง · ${matchCell.innerText}</b><span>เลขที่ตรง ${hitCell.innerText}</span><small>จปล 2 หลัก: ${pairCell.innerText.replace(/\n/g, ' · ')}</small></div>`);
    if (triggerMessages.length) resultBlocks.push(`<div class="result-block result-rule">${triggerMessages.join('')}</div>`);
    if (followMessages.length) resultBlocks.push(`<div class="result-block result-follow">${followMessages.join('')}</div>`);
    const previousRow = allDailyRows[index - 1];
    const twoBackRow = allDailyRows[index - 2];
    const techniqueContext = {
      roundInLot: (index % 4) + 1,
      previousTop: previousRow?.querySelector('.daily-top').value,
      twoBackTop: twoBackRow?.querySelector('.daily-top').value,
      twoBackBottom: twoBackRow?.querySelector('.daily-bottom').value,
    };
    const techniques = independentTechniqueData(top, bottom, techniqueContext);
    if (groups.length) {
      techniques.topTargets.push(...expandJeeb(top));
      techniques.bottomTargets.push(...expandTwoDigitRows(top.slice(-2)).flat());
    }
    if (techniques.html) resultBlocks.push(`<div class="result-block result-extra">${techniques.html}</div>`);
    if (techniques.count || triggerMessages.length) resultBlocks.push(`<div class="result-block result-summary">${chanceSummaryHtml(top, bottom, techniques)}</div>`);

    const topClasses = [[], [], []], bottomClasses = [[], []], reasons = [...techniques.reasons, ...hitReasons];
    if (groups.length) { topClasses.forEach((list) => list.push('hl-jeeb')); reasons.unshift('สีเขียวอ่อน: เลขบนตรงจีบเรียง'); }
    if (trigger.trick1) { topClasses[2].push('hl-sibling'); bottomClasses[0].push('hl-sibling'); reasons.push(`สีส้ม: พี่น้อง ${top[2]}–${bottom[0]}`); }
    if (trigger.trick2) { topClasses[2].push('hl-same'); bottomClasses[0].push('hl-same'); reasons.push(`สีเขียวเข้ม: รูซ้ำ ${top[2]}–${bottom[0]}`); }
    const foundHunt = huntSignalPairs.find((pair) => top.includes(pair) || bottom.includes(pair));
    if (foundHunt) {
      const topAt = top.indexOf(foundHunt), bottomAt = bottom.indexOf(foundHunt);
      if (topAt >= 0) { topClasses[topAt].push('hl-hunt'); topClasses[topAt + 1].push('hl-hunt'); }
      if (bottomAt >= 0) { bottomClasses[bottomAt].push('hl-hunt'); bottomClasses[bottomAt + 1].push('hl-hunt'); }
    }
    if (techniqueContext.roundInLot === 1) { topClasses[2].push('hl-running'); bottomClasses.forEach((list) => list.push('hl-running')); }
    if (/^(\d)\1\1$/.test(top)) topClasses.forEach((list) => list.push('hl-triple'));
    topPreview.innerHTML = digitPreviewHtml(top, topClasses);
    bottomPreview.innerHTML = digitPreviewHtml(bottom, bottomClasses);
    row.classList.add('numbers-analyzed');
    resultCell.innerHTML = resultBlocks.length ? resultBlocks.join('') : '<span class="result-empty">ยังไม่พบสัญญาณในรอบนี้</span>';
  });

  for (let lot = 1; lot <= 66; lot += 1) {
    const rows = allDailyRows.filter((row) => Number(row.dataset.lot) === lot);
    const complete = rows.every((row) => /^\d{3}$/.test(row.querySelector('.daily-top').value) && /^\d{2}$/.test(row.querySelector('.daily-bottom').value));
    if (!complete) continue;
    const predicted = rows.some((row) => row.querySelector('.daily-result').innerText.includes('เข้าเป้า'));
    rows.forEach((row) => row.classList.add(predicted ? 'lot-predicted' : 'lot-missed'));
    const badge = document.createElement('span');
    badge.className = `lot-verdict ${predicted ? 'yes' : 'no'}`;
    badge.textContent = predicted ? '✓ ทำนายเข้าเป้า' : '× ยังไม่เข้าเป้า';
    rows[0].querySelector('.daily-lot').appendChild(badge);
  }
  document.getElementById('hitCount').textContent = hitRounds.length;
  document.getElementById('hitRoundList').innerHTML = hitRounds.length ? hitRounds.map((item) => `<i>รอบ ${item.round} · ${item.top} · ${item.matchingValues.join('/')} · ${item.twoRows.flat().join(', ')}</i>`).join('') : '<em>ไม่พบรอบที่เข้าเลขจีบเรียง</em>';
  document.getElementById('ruleTriggerCount').textContent = ruleTriggerCount;
  document.getElementById('ruleHitCount').textContent = ruleHitCount;
  document.getElementById('ruleRoundList').innerHTML = ruleEvents.length ? ruleEvents.map((event) => `<i class="${event.kind}">รอบ ${event.round} · ${event.text}</i>`).join('') : '<em>ไม่พบสัญญาณ RULE</em>';
  saveDailyData();
}

dailyRows.addEventListener('input', (event) => {
  if (!event.target.matches('input')) return;
  event.target.value = event.target.value.replace(/\D/g, '');
  saveDailyData();
});
dailyRows.addEventListener('click', (event) => {
  const button = event.target.closest('.edit-number');
  if (!button) return;
  const row = button.closest('tr');
  row.classList.remove('numbers-analyzed');
  button.parentElement.querySelector('input').focus();
});

dailyDate.addEventListener('change', renderDailyTable);
document.getElementById('analyzeRounds').addEventListener('click', analyzeDailyRounds);
document.getElementById('importRounds').addEventListener('click', () => {
  const lines = document.getElementById('bulkInput').value.trim().split(/\n+/).filter(Boolean).slice(0, 264);
  const rows = [...dailyRows.querySelectorAll('tr')];
  lines.forEach((line, index) => {
    const numbers = line.match(/\d+/g) || [];
    if (numbers[0]) rows[index].querySelector('.daily-top').value = numbers[0].padStart(3, '0').slice(-3);
    if (numbers[1]) rows[index].querySelector('.daily-bottom').value = numbers[1].padStart(2, '0').slice(-2);
  });
  saveDailyData();
});
document.getElementById('clearDaily').addEventListener('click', () => {
  localStorage.removeItem(dailyStorageKey());
  document.getElementById('bulkInput').value = '';
  document.getElementById('hitCount').textContent = '0';
  document.getElementById('hitRoundList').innerHTML = '<em>ยังไม่มีข้อมูลวิเคราะห์</em>';
  document.getElementById('ruleTriggerCount').textContent = '0';
  document.getElementById('ruleHitCount').textContent = '0';
  document.getElementById('ruleRoundList').innerHTML = '<em>ยังไม่มีข้อมูลวิเคราะห์</em>';
  renderDailyTable();
});
document.getElementById('loadImageMock').addEventListener('click', () => {
  document.getElementById('bulkInput').value = window.mock264;
  document.getElementById('importRounds').click();
  analyzeDailyRounds();
});
document.getElementById('loadTechniqueMock').addEventListener('click', () => {
  const techniqueMock = [
    ['129','08'], ['333','02'], ['828','83'], ['438','58'],
    ['764','09'], ['795','43'], ['908','90'], ['683','40'],
    ['430','48'], ['190','50'], ['884','38'], ['567','41'],
  ];
  const rows = [...dailyRows.querySelectorAll('tr')];
  rows.forEach((row, index) => {
    row.querySelector('.daily-top').value = techniqueMock[index]?.[0] || '';
    row.querySelector('.daily-bottom').value = techniqueMock[index]?.[1] || '';
  });
  document.getElementById('bulkInput').value = techniqueMock.map((item) => item.join(' ')).join('\n');
  saveDailyData();
  analyzeDailyRounds();
});
renderDailyTable();

document.getElementById('menuToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});
const shell = document.querySelector('.shell');
const sidebarCollapse = document.getElementById('sidebarCollapse');
if (localStorage.getItem('yiki-sidebar-mini') === '1') shell.classList.add('sidebar-mini');
sidebarCollapse.addEventListener('click', () => {
  shell.classList.toggle('sidebar-mini');
  localStorage.setItem('yiki-sidebar-mini', shell.classList.contains('sidebar-mini') ? '1' : '0');
  sidebarCollapse.setAttribute('aria-label', shell.classList.contains('sidebar-mini') ? 'ขยายเมนูด้านข้าง' : 'พับเมนูด้านข้าง');
});

let remaining = 30;
setInterval(() => {
  remaining = remaining <= 0 ? 30 : remaining - 1;
  if (remaining === 30) loadRealtimeSources().then(() => loadRealtimeResults({ quiet: true })).catch(() => loadRealtimeResults({ quiet: true }));
  const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
  const seconds = String(remaining % 60).padStart(2, '0');
  document.getElementById('countdown').textContent = `${minutes}:${seconds}`;
  document.getElementById('progressBar').style.width = `${(remaining / 30) * 100}%`;
}, 1000);
