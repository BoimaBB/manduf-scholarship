// Applicant app: eligibility check → 9-step form with autosave → document uploads → submit → receipt.
import { sb, configured, $, $$, esc, num, nle, fmtDate, wordCount, uuid, errText,
  STEPS, DOCUMENTS, COST_ITEMS, WASSCE_GRADES, SUBJECTS, INSTITUTIONS,
  costTotals, applicationSummaryHTML } from './common.js';

const DRAFT_KEY = 'manduf-draft-v1';
const RECEIPT_KEY = 'manduf-receipt-v1';
const MAX_BYTES = 5 * 1024 * 1024;

const main = $('#main');
const progress = $('#progress');
const actions = $('#actions');

let settings = null;
let state = loadDraft() || newDraft();

function newDraft() {
  return { id: uuid(), step: 0, started: false, gate: {}, data: { costs: [], results: [], activities: [], referees: [{}, {}] }, docs: {}, savedAt: null };
}
function loadDraft() {
  try { const s = JSON.parse(localStorage.getItem(DRAFT_KEY)); return s && s.id ? s : null; } catch { return null; }
}
let saveTimer;
function saveDraft(immediate) {
  clearTimeout(saveTimer);
  const write = () => {
    state.savedAt = new Date().toISOString();
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
    const el = $('#saved'); if (el) el.textContent = 'Saved on this phone';
  };
  immediate ? write() : (saveTimer = setTimeout(write, 400));
}
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ======================================================================
// Start-up
// ======================================================================
async function init() {
  if (!configured) {
    main.innerHTML = `<div class="notice bad"><b>This portal is not connected yet.</b><br>The administrator needs to add the Supabase address and key to <code>assets/config.js</code>. See the README.</div>`;
    return;
  }
  try {
    const { data, error } = await sb.from('settings').select('*').eq('id', 1).single();
    if (error) throw error;
    settings = data;
  } catch (e) {
    main.innerHTML = `<div class="notice bad"><b>Could not connect.</b><br>${esc(errText(e))}</div><button class="btn" onclick="location.reload()">Try again</button>`;
    return;
  }
  if (state.started) renderForm(); else renderIntro();
}

function isClosed() {
  if (!settings) return false;
  if (!settings.applications_open) return true;
  if (settings.closing_date) {
    const end = new Date(settings.closing_date + 'T23:59:59');
    if (Date.now() > end.getTime()) return true;
  }
  return false;
}

// ======================================================================
// Intro + eligibility check
// ======================================================================
const GATE = [
  { id: 'year_one', q: 'Are you starting Year One of a university or college programme this academic year?' },
  { id: 'has_admission_letter', q: 'Do you have an official admission letter for Year One?' },
  { id: 'from_mandu', q: 'Are you from Mandu Chiefdom, Kailahun District (by birth, parentage or long-term residence)?' },
];

function renderIntro() {
  progress.classList.add('hidden');
  actions.classList.add('hidden');
  const receipt = (() => { try { return JSON.parse(localStorage.getItem(RECEIPT_KEY)); } catch { return null; } })();
  const closed = isClosed();
  const hasDraft = !!state.savedAt;
  main.innerHTML = `
    <section class="hero">
      <span class="motto">Educate one, empower all</span>
      <h1>Apply for a ManDuF scholarship</h1>
      <p>For students from Mandu Chiefdom who are starting Year One at university or college. The scholarship helps with tuition, registration and other approved study costs. It does not cover accommodation.</p>
    </section>
    <div class="facts">
      <div class="fact"><b>${esc(settings.academic_year)}</b><span>Academic year</span></div>
      <div class="fact"><b>${settings.closing_date ? esc(fmtDate(settings.closing_date)) : 'Open now'}</b><span>Closing date</span></div>
      <div class="fact"><b>About 30 minutes</b><span>You can stop and continue later on this phone</span></div>
      <div class="fact"><b>5 documents</b><span>Admission letter, WASSCE slip, fee structure, ID, photo</span></div>
    </div>
    ${receipt ? `<div class="notice good">You submitted application <b>${esc(receipt.app_no)}</b> on ${esc(fmtDate(receipt.at))}. <a href="status.html?app=${encodeURIComponent(receipt.app_no)}">Check its status</a>.</div>` : ''}
    ${closed ? `<div class="notice bad"><b>Applications are closed.</b><br>${settings.contact_phone || settings.contact_email ? `For questions contact ${esc([settings.contact_phone, settings.contact_email].filter(Boolean).join(' or '))}.` : ''}</div>` : `
    <form class="gate" id="gate" novalidate>
      <h2>Can you apply?</h2>
      ${GATE.map((g) => `
        <div class="q" data-q="${g.id}">
          <p>${esc(g.q)}</p>
          <div class="choices">
            ${['Yes', 'No'].map((o) => `<label class="choice"><input type="radio" name="${g.id}" value="${o.toLowerCase()}" ${state.gate[g.id] === o.toLowerCase() ? 'checked' : ''}><span>${o}</span></label>`).join('')}
          </div>
        </div>`).join('')}
      <div id="gate-msg"></div>
      <button class="btn primary" type="submit" style="width:100%;margin-top:8px">${hasDraft ? 'Continue my application' : 'Start my application'}</button>
      ${hasDraft ? `<p class="small muted" style="margin-top:10px">You have an unfinished application saved on this phone from ${esc(fmtDate(state.savedAt))}. <button type="button" class="link" id="restart">Start again instead</button></p>` : ''}
    </form>`}
    ${settings.submit_note ? `<p class="small muted">${esc(settings.submit_note)}</p>` : ''}
    ${settings.contact_phone || settings.contact_email ? `<p class="small muted">Questions? Contact ${esc([settings.contact_phone, settings.contact_email].filter(Boolean).join(' or '))}.</p>` : ''}`;

  const gate = $('#gate');
  if (!gate) return;
  gate.addEventListener('change', (e) => { state.gate[e.target.name] = e.target.value; $('#gate-msg').innerHTML = ''; });
  $('#restart')?.addEventListener('click', () => {
    if (!confirm('Delete the unfinished application saved on this phone and start again?')) return;
    localStorage.removeItem(DRAFT_KEY); state = newDraft(); renderIntro();
  });
  gate.addEventListener('submit', (e) => {
    e.preventDefault();
    const missing = GATE.filter((g) => !state.gate[g.id]);
    if (missing.length) { $('#gate-msg').innerHTML = `<div class="notice bad">Please answer all three questions.</div>`; return; }
    if (state.gate.year_one !== 'yes' || state.gate.has_admission_letter !== 'yes') {
      $('#gate-msg').innerHTML = `<div class="notice bad"><b>Sorry, you cannot apply.</b><br>This scholarship is only for students entering Year One who hold an official admission letter. Continuing students are not eligible.</div>`; return;
    }
    if (state.gate.from_mandu !== 'yes') {
      $('#gate-msg').innerHTML = `<div class="notice bad"><b>Sorry, you cannot apply.</b><br>This scholarship is only for students from Mandu Chiefdom, Kailahun District.</div>`; return;
    }
    state.started = true; saveDraft(true); renderForm();
  });
}

// ======================================================================
// Form rendering
// ======================================================================
function req(f) { return f.required ? '<span class="req" aria-hidden="true">*</span>' : ''; }
function hint(f) { return f.hint ? `<span class="hint" id="h-${f.id}">${esc(f.hint)}</span>` : ''; }
const val = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), state.data);

function fieldHTML(f) {
  const d = state.data;
  const v = d[f.id] ?? '';
  const cls = `field${f.half ? ' half' : ''}${f.showIf && !f.showIf(d) ? ' hidden' : ''}`;
  const desc = f.hint ? ` aria-describedby="h-${f.id}"` : '';
  const err = `<div class="err" id="e-${f.id}"></div>`;
  switch (f.type) {
    case 'text': case 'email': case 'tel': case 'date': case 'number':
      return `<div class="${cls}" data-field="${f.id}"><label for="f-${f.id}">${esc(f.label)}${req(f)}</label>${hint(f)}
        <input id="f-${f.id}" data-path="${f.id}" type="${f.type}" value="${esc(v)}"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}
          ${f.type === 'number' ? 'inputmode="numeric"' : ''}${f.min !== undefined ? ` min="${f.min}"` : ''}${f.max !== undefined ? ` max="${f.max}"` : ''}
          ${f.type === 'tel' ? 'autocomplete="tel"' : ''}${f.list ? ` list="dl-${f.list}"` : ''}${desc}>${err}</div>`;
    case 'textarea':
      return `<div class="${cls}" data-field="${f.id}"><label for="f-${f.id}">${esc(f.label)}${req(f)}</label>${hint(f)}
        <textarea id="f-${f.id}" data-path="${f.id}" rows="${f.rowsH || 4}"${desc}>${esc(v)}</textarea>
        ${f.maxWords ? `<div class="counter" id="c-${f.id}">${wordCount(v)} / ${f.maxWords} words</div>` : ''}${err}</div>`;
    case 'radio': case 'checks': {
      const type = f.type === 'radio' ? 'radio' : 'checkbox';
      const cur = f.type === 'checks' ? (Array.isArray(v) ? v : []) : v;
      return `<div class="${cls}" data-field="${f.id}" role="group" aria-labelledby="l-${f.id}"><span class="label" id="l-${f.id}">${esc(f.label)}${req(f)}</span>${hint(f)}
        <div class="choices">${f.options.map((o) => `<label class="choice"><input type="${type}" name="${f.id}" data-path="${f.id}" data-kind="${f.type}" value="${esc(o)}" ${(f.type === 'checks' ? cur.includes(o) : cur === o) ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('')}</div>${err}</div>`;
    }
    case 'results': {
      const rows = Array.from({ length: f.rows }, (_, i) => d.results?.[i] || {});
      return `<div class="${cls}" data-field="${f.id}"><span class="label">${esc(f.label)}<span class="req">*</span></span>${hint(f)}
        <div class="rows">${rows.map((r, i) => `<div class="result-row">
          <input type="text" aria-label="Subject ${i + 1}" placeholder="Subject ${i + 1}" list="dl-subjects" data-path="results.${i}.subject" value="${esc(r.subject || '')}">
          <select aria-label="Grade for subject ${i + 1}" data-path="results.${i}.grade"><option value="">Grade</option>${WASSCE_GRADES.map((g) => `<option ${r.grade === g ? 'selected' : ''}>${g}</option>`).join('')}</select>
        </div>`).join('')}</div>${err}</div>`;
    }
    case 'costs': {
      ensureCosts();
      const t = costTotals(d.costs);
      return `<div class="${cls}" data-field="costs"><span class="label">${esc(f.label)}</span>
        ${d.costs.map((c, i) => `<div class="cost">
          <div class="c-name">${c.named ? `<input type="text" placeholder="Other cost (name it)" aria-label="Name of other cost" data-path="costs.${i}.label" value="${esc(c.label === 'Other approved cost' ? '' : c.label)}">` : esc(c.label)}</div>
          <div class="c-grid">
            <div><label for="c${i}t">Total cost</label><input id="c${i}t" type="number" inputmode="decimal" min="0" data-path="costs.${i}.total" data-cost="${i}" value="${esc(c.total ?? '')}"></div>
            <div><label for="c${i}c">Already covered</label><input id="c${i}c" type="number" inputmode="decimal" min="0" data-path="costs.${i}.covered" data-cost="${i}" value="${esc(c.covered ?? '')}"></div>
            <div class="c-req"><label for="c${i}r">Amount requested</label><input id="c${i}r" type="number" inputmode="decimal" min="0" data-path="costs.${i}.requested" data-cost="${i}" data-requested value="${esc(c.requested ?? '')}"></div>
          </div>
          <div class="c-src ${num(c.covered) ? '' : 'hidden'}" style="margin-top:8px"><input type="text" placeholder="Who is covering this part?" aria-label="Source of covered amount" data-path="costs.${i}.covered_source" value="${esc(c.covered_source || '')}"></div>
        </div>`).join('')}
        <div class="totals" id="cost-totals"><span>Total requested</span><b>${nle(t.requested)}</b></div>${err}</div>`;
    }
    case 'activities': {
      const rows = Array.from({ length: f.rows }, (_, i) => d.activities?.[i] || {});
      return `<div class="${cls}" data-field="${f.id}"><span class="label">${esc(f.label)}</span>${hint(f)}
        <div class="rows">${rows.map((r, i) => `<div class="rowcard"><div class="rc-title">Activity ${i + 1}</div><div class="grid">
          <div class="field half"><label for="a${i}r">Role or activity</label><input id="a${i}r" type="text" data-path="activities.${i}.role" value="${esc(r.role || '')}"></div>
          <div class="field half"><label for="a${i}o">Organisation or group</label><input id="a${i}o" type="text" data-path="activities.${i}.org" value="${esc(r.org || '')}"></div>
          <div class="field half"><label for="a${i}p">When (from–to)</label><input id="a${i}p" type="text" placeholder="e.g. 2023–2025" data-path="activities.${i}.period" value="${esc(r.period || '')}"></div>
          <div class="field half"><label for="a${i}a">What you did or achieved</label><input id="a${i}a" type="text" data-path="activities.${i}.achieved" value="${esc(r.achieved || '')}"></div>
        </div></div>`).join('')}</div></div>`;
    }
    case 'referees': {
      const titles = ['Referee 1 — teacher or principal', 'Referee 2 — community leader'];
      return `<div class="${cls}" data-field="${f.id}"><div class="rows">${[0, 1].map((i) => { const r = d.referees?.[i] || {}; return `<div class="rowcard"><div class="rc-title">${titles[i]}</div><div class="grid">
          <div class="field half" data-field="ref${i}name"><label for="r${i}n">Full name<span class="req">*</span></label><input id="r${i}n" type="text" data-path="referees.${i}.name" value="${esc(r.name || '')}"><div class="err"></div></div>
          <div class="field half" data-field="ref${i}pos"><label for="r${i}p">Position and institution or community<span class="req">*</span></label><input id="r${i}p" type="text" data-path="referees.${i}.position" value="${esc(r.position || '')}"><div class="err"></div></div>
          <div class="field half" data-field="ref${i}phone"><label for="r${i}t">Phone number<span class="req">*</span></label><input id="r${i}t" type="tel" data-path="referees.${i}.phone" value="${esc(r.phone || '')}"><div class="err"></div></div>
          <div class="field half"><label for="r${i}e">Email (optional)</label><input id="r${i}e" type="email" data-path="referees.${i}.email" value="${esc(r.email || '')}"></div>
        </div></div>`; }).join('')}</div></div>`;
    }
    case 'documents':
      return `<div class="${cls}" data-field="documents">${DOCUMENTS.map(docHTML).join('')}<div class="err" id="e-documents"></div></div>`;
    case 'review':
      return reviewHTML();
  }
  return '';
}

function ensureCosts() {
  const d = state.data;
  if (!Array.isArray(d.costs) || d.costs.length !== COST_ITEMS.length) {
    d.costs = COST_ITEMS.map((c) => ({ item: c.id, label: c.label, named: !!c.named, total: '', covered: '', covered_source: '', requested: '' }));
  }
}

function docHTML(doc) {
  const s = state.docs[doc.key];
  const status = s?.status === 'done' ? 'done' : s?.status === 'failed' ? 'failed' : '';
  const thumb = s?.thumb ? `style="background-image:url('${s.thumb}')"` : '';
  const label = s?.mime === 'application/pdf' ? 'PDF' : s?.status === 'done' && !s.thumb ? 'Added' : '';
  const stateText = s?.status === 'uploading' ? '<span class="spinner"></span> Uploading…'
    : s?.status === 'done' ? `Uploaded: ${esc(s.name)}`
    : s?.status === 'failed' ? esc(s.error || 'Upload failed.')
    : esc(doc.hint || (doc.required ? 'Required' : 'Optional'));
  return `<div class="doc ${status}" data-doc="${doc.key}">
    <div class="thumb" ${thumb}>${label}</div>
    <div class="info"><b>${esc(doc.label)}${doc.required ? '<span class="req">*</span>' : ''}</b><div class="state">${stateText}</div></div>
    <label class="btn small"><input type="file" accept="image/*,application/pdf" data-upload="${doc.key}">${s?.status === 'done' ? 'Replace' : s?.status === 'failed' ? 'Try again' : 'Add'}</label>
  </div>`;
}

function reviewHTML() {
  const d = state.data;
  const missingDocs = DOCUMENTS.filter((x) => x.required && state.docs[x.key]?.status !== 'done');
  return `<div class="field">
    <p>Check your answers. Tap <b>Edit</b> to change anything.</p>
    ${applicationSummaryHTML(d, { editable: true })}
    <section class="sum-section"><header><h3><span class="sec">I</span> Documents</h3><button type="button" class="link" data-goto="${STEPS.findIndex((s) => s.id === 'documents')}">Edit</button></header>
      <dl>${DOCUMENTS.map((x) => `<div class="sum-row"><dt>${esc(x.label)}</dt><dd>${state.docs[x.key]?.status === 'done' ? '✓ Uploaded' : x.required ? '<b style="color:var(--bad)">Missing</b>' : '<span class="muted">Not added</span>'}</dd></div>`).join('')}</dl>
    </section>
    ${missingDocs.length ? `<div class="notice bad">Upload the required documents before submitting: ${missingDocs.map((x) => esc(x.label)).join(', ')}.</div>` : ''}
    <div class="declare">
      <h3>Declaration</h3>
      <label class="check"><input type="checkbox" data-path="declaration" ${d.declaration ? 'checked' : ''}>
        <span>I declare that the information in this application and my documents is true and complete, and that I am entering Year One. I understand that false information will lead to disqualification or withdrawal of any award, with refund of any funds paid. I agree that the Mandu Foundation may verify my information and use it only to administer this scholarship. If awarded, I will use the funds only for approved study costs, submit my results each semester or year, and tell the Foundation about any change in my studies.</span></label>
      <div class="field" data-field="declaration"><div class="err"></div></div>
      <label class="check"><input type="checkbox" data-path="guardian_consent" ${d.guardian_consent ? 'checked' : ''}>
        <span>My parent or guardian${d.guardian_name ? `, ${esc(d.guardian_name)},` : ''} has seen this application, confirms the family and financial information, and supports it.</span></label>
      <div class="field" data-field="guardian_consent"><div class="err"></div></div>
      <div class="field" data-field="signature_name"><label for="f-signature_name">Type your full name as your signature<span class="req">*</span></label>
        <input id="f-signature_name" type="text" data-path="signature_name" value="${esc(d.signature_name || '')}" autocomplete="name"><div class="err"></div></div>
      <input type="text" name="website" data-path="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px">
    </div>
    <div id="submit-msg"></div>
  </div>`;
}

function renderForm() {
  const i = state.step;
  const step = STEPS[i];
  progress.classList.remove('hidden');
  progress.innerHTML = `<div class="meta"><span>Step ${i + 1} of ${STEPS.length}: ${esc(step.title)}</span><span id="saved" class="saved">${state.savedAt ? 'Saved on this phone' : ''}</span></div>
    <div class="bar" role="progressbar" aria-valuemin="1" aria-valuemax="${STEPS.length}" aria-valuenow="${i + 1}" aria-label="Application progress"><i style="width:${((i + 1) / STEPS.length) * 100}%"></i></div>`;
  main.innerHTML = `
    <div class="step-head"><h2><span class="sec">${esc(step.section)}</span> ${esc(step.title)}</h2>${step.intro ? `<p class="muted">${esc(step.intro)}</p>` : ''}</div>
    <form id="stepform" class="grid" novalidate autocomplete="on">${step.fields.map(fieldHTML).join('')}</form>
    <datalist id="dl-subjects">${SUBJECTS.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
    <datalist id="dl-institutions">${INSTITUTIONS.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>`;
  actions.classList.remove('hidden');
  const last = i === STEPS.length - 1;
  $('.inner', actions).innerHTML = `
    <button type="button" class="btn back" id="back">${i === 0 ? 'Exit' : 'Back'}</button>
    <button type="button" class="btn primary" id="next">${last ? 'Submit application' : 'Save and continue'}</button>`;
  $('#back').onclick = () => { saveDraft(true); if (i === 0) { state.started = false; saveDraft(true); renderIntro(); } else go(i - 1); };
  $('#next').onclick = () => (last ? submit() : next());
  bindForm();
}

function go(i) { state.step = i; saveDraft(true); renderForm(); window.scrollTo(0, 0); }

// ======================================================================
// Input handling
// ======================================================================
function setPath(path, value) {
  const keys = path.split('.');
  let o = state.data;
  keys.slice(0, -1).forEach((k, idx) => {
    const nextIsIndex = /^\d+$/.test(keys[idx + 1]);
    if (o[k] == null) o[k] = nextIsIndex ? [] : {};
    o = o[k];
  });
  o[keys[keys.length - 1]] = value;
}

function bindForm() {
  const form = $('#stepform');
  const onChange = (e) => {
    const el = e.target;
    const path = el.dataset.path;
    if (!path) return;
    if (el.dataset.kind === 'checks') {
      let arr = $$(`input[name="${el.name}"]:checked`, form).map((x) => x.value);
      if (el.value === 'None' && el.checked) { arr = ['None']; $$(`input[name="${el.name}"]`, form).forEach((x) => { x.checked = x.value === 'None'; }); }
      else if (el.checked) { arr = arr.filter((x) => x !== 'None'); $$(`input[name="${el.name}"][value="None"]`, form).forEach((x) => { x.checked = false; }); }
      setPath(path, arr);
    } else if (el.type === 'checkbox') setPath(path, el.checked);
    else setPath(path, el.value);

    if (el.dataset.cost !== undefined) onCost(el);
    const wrap = el.closest('.field'); if (wrap) wrap.classList.remove('invalid');
    const f = STEPS[state.step].fields.find((x) => x.id === path);
    if (f?.maxWords) {
      const c = $(`#c-${f.id}`); const n = wordCount(el.value);
      c.textContent = `${n} / ${f.maxWords} words`; c.classList.toggle('over', n > f.maxWords);
    }
    refreshVisibility();
    saveDraft();
  };
  form.addEventListener('input', onChange);
  form.addEventListener('change', onChange);
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) go(+g.dataset.goto); });
  $$('input[data-upload]', form).forEach((inp) => inp.addEventListener('change', () => { if (inp.files[0]) upload(inp.dataset.upload, inp.files[0]); inp.value = ''; }));
}

function refreshVisibility() {
  STEPS[state.step].fields.filter((f) => f.showIf).forEach((f) => {
    const w = $(`[data-field="${f.id}"]`); if (w) w.classList.toggle('hidden', !f.showIf(state.data));
  });
}

function onCost(el) {
  const i = +el.dataset.cost;
  const c = state.data.costs[i];
  if (el.hasAttribute('data-requested')) c.manual = el.value !== '';
  else if (!c.manual) {
    const r = Math.max(num(c.total) - num(c.covered), 0);
    c.requested = c.total === '' ? '' : String(r);
    const ri = $(`#c${i}r`); if (ri) ri.value = c.requested;
  }
  const src = el.closest('.cost').querySelector('.c-src');
  src.classList.toggle('hidden', !num(c.covered));
  $('#cost-totals b').textContent = nle(costTotals(state.data.costs).requested);
}

// ======================================================================
// Validation
// ======================================================================
function setError(key, msg) {
  const w = $(`[data-field="${key}"]`);
  if (!w) return;
  w.classList.add('invalid');
  const e = $('.err', w); if (e) e.textContent = msg;
}

function validateStep(i) {
  const step = STEPS[i]; const d = state.data; const errors = [];
  $$('.field.invalid').forEach((w) => w.classList.remove('invalid'));
  step.fields.forEach((f) => {
    if (f.showIf && !f.showIf(d)) return;
    const v = d[f.id];
    const empty = v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && !v.length);
    if (f.required && empty && !['results', 'costs', 'referees', 'documents', 'review'].includes(f.type)) errors.push([f.id, 'Please answer this question.']);
    if (!empty && f.type === 'email' && !/^\S+@\S+\.\S+$/.test(v)) errors.push([f.id, 'Check the email address.']);
    if (!empty && f.type === 'tel' && String(v).replace(/\D/g, '').length < 8) errors.push([f.id, 'Enter a full phone number.']);
    if (!empty && f.type === 'number' && ((f.min !== undefined && num(v) < f.min) || (f.max !== undefined && num(v) > f.max))) errors.push([f.id, `Enter a number between ${f.min} and ${f.max ?? 'any'}.`]);
    if (f.maxWords && wordCount(v) > f.maxWords) errors.push([f.id, `Shorten this to ${f.maxWords} words or fewer.`]);
    if (f.type === 'date' && !empty && f.id === 'dob' && new Date(v) > new Date()) errors.push([f.id, 'Check the date of birth.']);
    if (f.type === 'results') {
      const done = (d.results || []).filter((r) => r && r.subject && r.grade).length;
      const partial = (d.results || []).some((r) => r && (!!r.subject !== !!r.grade));
      if (done < 5) errors.push(['results', 'Enter at least 5 subjects with their grades.']);
      else if (partial) errors.push(['results', 'Each subject needs a grade.']);
    }
    if (f.type === 'costs') {
      const t = costTotals(d.costs);
      if (!num(d.costs?.[0]?.total)) errors.push(['costs', 'Enter your tuition fees from the fee structure.']);
      else if (t.requested <= 0) errors.push(['costs', 'Enter the amount you are asking the Foundation for.']);
      else if ((d.costs || []).some((c) => num(c.requested) > num(c.total))) errors.push(['costs', 'The amount requested for an item cannot be more than its total cost.']);
    }
    if (f.type === 'referees') {
      [0, 1].forEach((k) => {
        const r = d.referees?.[k] || {};
        if (!r.name?.trim()) errors.push([`ref${k}name`, 'Enter the referee’s name.']);
        if (!r.position?.trim()) errors.push([`ref${k}pos`, 'Enter their position.']);
        if (String(r.phone || '').replace(/\D/g, '').length < 8) errors.push([`ref${k}phone`, 'Enter a full phone number.']);
      });
    }
    if (f.type === 'documents') {
      const miss = DOCUMENTS.filter((x) => x.required && state.docs[x.key]?.status !== 'done');
      if (Object.values(state.docs).some((x) => x.status === 'uploading')) errors.push(['documents', 'Wait for uploads to finish.']);
      else if (miss.length) { errors.push(['documents', 'Upload: ' + miss.map((x) => x.label).join(', ') + '.']); miss.forEach((x) => $(`[data-doc="${x.key}"]`)?.classList.add('invalid')); }
    }
    if (f.type === 'review') {
      if (!d.declaration) errors.push(['declaration', 'Tick to confirm the declaration.']);
      if (!d.guardian_consent) errors.push(['guardian_consent', 'Your parent or guardian must support the application.']);
      if (!d.signature_name?.trim()) errors.push(['signature_name', 'Type your full name.']);
    }
  });
  errors.forEach(([k, m]) => setError(k, m));
  if (errors.length) {
    const first = $('.field.invalid') || $('.doc.invalid');
    first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    first?.querySelector('input,textarea,select')?.focus({ preventScroll: true });
  }
  return errors.length === 0;
}

function next() { if (validateStep(state.step)) go(state.step + 1); }

// ======================================================================
// Document upload (images are shrunk on the phone to save data)
// ======================================================================
async function shrinkImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
    const t = document.createElement('canvas'); const ts = 96 / Math.max(w, h);
    t.width = Math.round(w * ts); t.height = Math.round(h * ts);
    t.getContext('2d').drawImage(img, 0, 0, t.width, t.height);
    return { blob, thumb: t.toDataURL('image/jpeg', 0.6) };
  } finally { URL.revokeObjectURL(url); }
}

function redrawDoc(key) {
  const el = $(`[data-doc="${key}"]`); if (!el) return;
  el.outerHTML = docHTML(DOCUMENTS.find((x) => x.key === key));
  const inp = $(`[data-doc="${key}"] input[data-upload]`);
  inp.addEventListener('change', () => { if (inp.files[0]) upload(key, inp.files[0]); inp.value = ''; });
}

async function upload(key, file) {
  const prev = state.docs[key];
  const fail = (msg) => { state.docs[key] = { ...(prev?.status === 'done' ? prev : {}), status: prev?.status === 'done' ? 'done' : 'failed', error: msg }; redrawDoc(key); if (prev?.status === 'done') toast(msg); saveDraft(true); };
  state.docs[key] = { status: 'uploading', name: file.name }; redrawDoc(key);
  let blob = file, thumb = null, mime = file.type, ext = 'pdf';
  try {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) { mime = 'application/pdf'; ext = 'pdf'; }
    else if (file.type.startsWith('image/') || !file.type) {
      try { ({ blob, thumb } = await shrinkImage(file)); mime = 'image/jpeg'; ext = 'jpg'; }
      catch { return fail('This picture could not be read. Take the photo again, or choose a JPG, PNG or PDF file.'); }
    } else return fail('Choose a photo or a PDF file.');
    if (blob.size > MAX_BYTES) return fail('This file is larger than 5 MB. Take a photo of the page instead, or choose a smaller file.');
    const path = `${state.id}/${key}-${Date.now()}.${ext}`;
    const { error } = await sb.storage.from('documents').upload(path, blob, { contentType: mime, upsert: false });
    if (error) throw error;
    state.docs[key] = { status: 'done', path, name: file.name, size: blob.size, mime, thumb };
    redrawDoc(key); saveDraft(true);
    const w = $('[data-field="documents"]'); if (w) w.classList.remove('invalid');
  } catch (e) { fail('Upload failed: ' + errText(e) + ' Tap “Try again”.'); }
}

// ======================================================================
// Submit
// ======================================================================
async function submit() {
  if (!validateStep(state.step)) return;
  const btn = $('#next'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Submitting…';
  const msg = $('#submit-msg'); msg.innerHTML = '';
  const d = state.data;
  const form = {
    ...d,
    ...state.gate,
    costs: (d.costs || []).map(({ manual, named, ...c }) => ({ ...c, label: c.label || c.item })),
    results: (d.results || []).filter((r) => r && r.subject),
    activities: (d.activities || []).filter((r) => r && (r.role || r.org)),
    documents: DOCUMENTS.filter((x) => state.docs[x.key]?.status === 'done').map((x) => ({ key: x.key, label: x.label, path: state.docs[x.key].path, name: state.docs[x.key].name })),
    website: d.website || '',
  };
  try {
    const { data, error } = await sb.rpc('submit_application', { p_id: state.id, p_form: form });
    if (error) throw error;
    const r = Array.isArray(data) ? data[0] : data;
    const receipt = { app_no: r.app_no, code: r.access_code, name: `${d.first_names} ${d.surname}`, at: new Date().toISOString() };
    localStorage.setItem(RECEIPT_KEY, JSON.stringify(receipt));
    localStorage.removeItem(DRAFT_KEY);
    state = newDraft();
    renderDone(receipt);
  } catch (e) {
    msg.innerHTML = `<div class="notice bad"><b>Your application was not submitted.</b><br>${esc(errText(e))}</div>`;
    msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
    btn.disabled = false; btn.textContent = 'Submit application';
  }
}

function renderDone(r) {
  progress.classList.add('hidden'); actions.classList.add('hidden');
  main.innerHTML = `<div class="receipt">
    <div class="tick" aria-hidden="true">✓</div>
    <h1>Application submitted</h1>
    <p>Thank you, ${esc(r.name)}. Your application reached the Mandu Foundation on ${esc(fmtDate(r.at))}.</p>
    <div class="codebox"><div><span>Application number</span><b>${esc(r.app_no)}</b></div><div><span>Access code</span><b>${esc(r.code)}</b></div></div>
    <div class="notice" style="text-align:left"><b>Write these down or take a screenshot now.</b> You need both to check your status. The access code cannot be shown again.</div>
    <div class="btns no-print">
      <a class="btn primary" href="status.html?app=${encodeURIComponent(r.app_no)}">Check my status</a>
      <button class="btn" onclick="window.print()">Print or save this receipt</button>
    </div>
    <h3 style="margin-top:24px;text-align:left">What happens next</h3>
    <ul style="text-align:left">
      <li>Staff check that your application and documents are complete.</li>
      <li>The Committee scores applications on financial need, results, your statement and community service.</li>
      <li>Shortlisted applicants may be called for an interview or visited at home.</li>
      <li>Check your status with your application number and access code. The Foundation may also call or message you.</li>
    </ul>
  </div>`;
  window.scrollTo(0, 0);
}

init();
