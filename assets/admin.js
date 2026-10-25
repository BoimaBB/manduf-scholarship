// Admin dashboard: staff login, applications, review & screening, rubric scoring,
// ranking, decisions, applicant notifications, Excel export, settings and staff.
import { sb, configured, $, $$, esc, num, nle, fmtDate, intlPhone, errText,
  STATUS, DOCUMENTS, SIMPLE_FIELDS, COST_ITEMS, applicationSummaryHTML, answerText } from './common.js';

const root = $('#root');
const CRITERIA = [
  { id: 'financial_need', label: 'Financial Need', weight: 40, evidence: 'Funding gap in Section E; household income and size; parental status; evidence of need.' },
  { id: 'academic_merit', label: 'Academic Merit', weight: 30, evidence: 'WASSCE results; awards; programme admitted to.' },
  { id: 'personal_statement', label: 'Personal Statement', weight: 20, evidence: 'Clarity, honesty, realistic goals, commitment to community.' },
  { id: 'leadership', label: 'Leadership & Community', weight: 10, evidence: 'Roles and impact in Section G; referee comments.' },
];
const COVERS = ['Tuition', 'Registration', 'Books & materials', 'Other'];
const PERIODS = { one_year: 'One year', renewable: 'Renewable yearly, subject to performance', full_programme: 'Full programme' };

const S = { session: null, me: null, settings: null, staff: [], apps: [], myScored: new Set(),
  filter: { q: '', status: '', elig: '', mine: false }, sort: { key: 'submitted_at', dir: -1 }, budget: '' };
const isAdmin = () => S.me?.role === 'admin';
const staffName = (id) => S.staff.find((s) => s.user_id === id)?.full_name || 'Former staff member';
const pill = (status) => { const s = STATUS[status] || { label: status, tone: '' }; return `<span class="pill ${s.tone}">${esc(s.label)}</span>`; };
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3000); }
async function q(promise) { const { data, error } = await promise; if (error) throw error; return data; }

// ======================================================================
// Authentication
// ======================================================================
async function init() {
  if (!configured) { root.innerHTML = `<div class="login"><h2>Not connected</h2><p>Add the Supabase address and key to <code>assets/config.js</code> first. See the README.</p></div>`; return; }
  const hash = window.__authHash || '';
  sb.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY') renderSetPassword('Choose a new password'); });
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  if (S.session && /type=(invite|recovery)/.test(hash)) return renderSetPassword(/invite/.test(hash) ? 'Welcome — choose your password' : 'Choose a new password');
  if (!S.session) return renderLogin();
  await start();
}

function renderLogin(msg = '') {
  root.innerHTML = `<form class="login" id="login" novalidate>
    <img src="assets/logo.jpg" alt="">
    <h1 style="font-size:1.4rem;margin-top:12px">Scholarship admin</h1>
    <p class="muted">Sign in with your Mandu Foundation staff account.</p>
    ${msg}
    <div class="field"><label for="em">Email</label><input id="em" type="email" autocomplete="username" required></div>
    <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required></div>
    <button class="btn primary" style="width:100%" type="submit">Sign in</button>
    <p style="margin-top:12px"><button type="button" class="link" id="forgot">Forgot password?</button></p>
  </form>`;
  $('#login').onsubmit = async (e) => {
    e.preventDefault();
    const b = $('#login button[type=submit]'); b.disabled = true; b.innerHTML = '<span class="spinner"></span> Signing in…';
    const { data, error } = await sb.auth.signInWithPassword({ email: $('#em').value.trim(), password: $('#pw').value });
    if (error) return renderLogin(`<div class="notice bad">${esc(/invalid/i.test(error.message) ? 'Wrong email or password.' : errText(error))}</div>`);
    S.session = data.session; await start();
  };
  $('#forgot').onclick = async () => {
    const email = $('#em').value.trim();
    if (!email) return renderLogin('<div class="notice bad">Type your email first, then tap “Forgot password?”.</div>');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
    renderLogin(error ? `<div class="notice bad">${esc(errText(error))}</div>` : '<div class="notice good">If that email has a staff account, a reset link is on its way.</div>');
  };
}

function renderSetPassword(title) {
  root.innerHTML = `<form class="login" id="setpw" novalidate>
    <img src="assets/logo.jpg" alt=""><h1 style="font-size:1.4rem;margin-top:12px">${esc(title)}</h1>
    <div class="field"><label for="p1">New password (at least 8 characters)</label><input id="p1" type="password" autocomplete="new-password"></div>
    <div class="field"><label for="p2">Repeat password</label><input id="p2" type="password" autocomplete="new-password"></div>
    <div id="pmsg"></div><button class="btn primary" style="width:100%" type="submit">Save password</button></form>`;
  $('#setpw').onsubmit = async (e) => {
    e.preventDefault();
    const p1 = $('#p1').value, p2 = $('#p2').value;
    if (p1.length < 8) return ($('#pmsg').innerHTML = '<div class="notice bad">Use at least 8 characters.</div>');
    if (p1 !== p2) return ($('#pmsg').innerHTML = '<div class="notice bad">The passwords do not match.</div>');
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) return ($('#pmsg').innerHTML = `<div class="notice bad">${esc(errText(error))}</div>`);
    history.replaceState(null, '', location.pathname); toast('Password saved');
    const { data } = await sb.auth.getSession(); S.session = data.session; await start();
  };
}

async function start() {
  try {
    S.me = await q(sb.from('staff').select('*').eq('user_id', S.session.user.id).maybeSingle());
    if (!S.me) {
      root.innerHTML = `<div class="login"><h2>No staff access</h2><p>You are signed in as ${esc(S.session.user.email)}, but this account is not on the staff list. Ask an admin to add you.</p><button class="btn" id="out">Sign out</button></div>`;
      $('#out').onclick = signOut; return;
    }
    [S.settings, S.staff] = await Promise.all([
      q(sb.from('settings').select('*').eq('id', 1).single()),
      q(sb.from('staff').select('*').order('full_name')),
    ]);
  } catch (e) { root.innerHTML = `<div class="login"><h2>Could not load</h2><p>${esc(errText(e))}</p><button class="btn" onclick="location.reload()">Try again</button></div>`; return; }
  window.addEventListener('hashchange', route);
  route();
}
async function signOut() { await sb.auth.signOut(); location.hash = ''; location.reload(); }

// ======================================================================
// Shell + routing
// ======================================================================
function shell(active, body) {
  const tabs = [['applications', 'Applications'], ['ranking', 'Ranking'], ...(isAdmin() ? [['settings', 'Settings'], ['staff', 'Staff']] : []), ['account', 'My account']];
  root.innerHTML = `<header class="topbar">
      <div class="brand"><img src="assets/logo.jpg" alt="">ManDuF Scholarships ${esc(S.settings.academic_year)}</div>
      <nav>${tabs.map(([k, l]) => `<a href="#/${k}" class="${active === k ? 'on' : ''}">${l}</a>`).join('')}</nav>
      <div class="me">${esc(S.me.full_name)} (${esc(S.me.role)}) <button class="link" id="signout">Sign out</button></div>
    </header><div class="page" id="page">${body}</div>`;
  $('#signout').onclick = signOut;
}

async function route() {
  const [, view, id] = (location.hash || '#/applications').split('/');
  try {
    if (view === 'app' && id) return await viewDetail(id);
    if (view === 'ranking') return await viewRanking();
    if (view === 'settings' && isAdmin()) return viewSettings();
    if (view === 'staff' && isAdmin()) return await viewStaff();
    if (view === 'account') return viewAccount();
    return await viewList();
  } catch (e) {
    shell(view, `<div class="notice bad"><b>Could not load this page.</b><br>${esc(errText(e))}</div>`);
  }
}

async function loadApps() {
  const [apps, mine] = await Promise.all([
    q(sb.from('application_overview').select('*').order('submitted_at', { ascending: false })),
    q(sb.from('scores').select('application_id').eq('assessor_id', S.me.user_id)),
  ]);
  S.apps = apps || [];
  S.myScored = new Set((mine || []).map((x) => x.application_id));
}

// ======================================================================
// Applications list
// ======================================================================
async function viewList() {
  shell('applications', '<p class="muted"><span class="spinner"></span> Loading applications…</p>');
  await loadApps();
  const counts = {}; S.apps.forEach((a) => { counts[a.status] = (counts[a.status] || 0) + 1; });
  const totalReq = S.apps.reduce((s, a) => s + num(a.amount_requested), 0);
  const totalAw = S.apps.filter((a) => a.status === 'awarded').reduce((s, a) => s + num(a.amount_awarded), 0);
  $('#page').innerHTML = `
    <div class="stats">
      <div class="stat"><b>${S.apps.length}</b><span>Applications</span></div>
      <div class="stat"><b>${S.apps.filter((a) => a.n_scores > 0).length}</b><span>Scored</span></div>
      <div class="stat"><b>${S.apps.filter((a) => !S.myScored.has(a.id)).length}</b><span>Waiting for your score</span></div>
      <div class="stat"><b>${nle(totalReq)}</b><span>Total requested</span></div>
      <div class="stat"><b>${nle(totalAw)}</b><span>Total awarded</span></div>
    </div>
    <div class="chips">
      <button class="chip ${S.filter.status === '' ? 'on' : ''}" data-st="">All<b>${S.apps.length}</b></button>
      ${Object.keys(STATUS).map((k) => `<button class="chip ${S.filter.status === k ? 'on' : ''}" data-st="${k}">${esc(STATUS[k].label)}<b>${counts[k] || 0}</b></button>`).join('')}
    </div>
    <div class="toolbar">
      <input type="search" id="q" placeholder="Search name, number, programme, section…" value="${esc(S.filter.q)}" aria-label="Search applications">
      <select id="elig" aria-label="Eligibility"><option value="">Any eligibility</option><option value="eligible" ${S.filter.elig === 'eligible' ? 'selected' : ''}>Eligible</option><option value="not_eligible" ${S.filter.elig === 'not_eligible' ? 'selected' : ''}>Not eligible</option><option value="none" ${S.filter.elig === 'none' ? 'selected' : ''}>Not yet decided</option></select>
      <label class="check" style="margin:0"><input type="checkbox" id="mine" ${S.filter.mine ? 'checked' : ''}> Not yet scored by me</label>
      <span class="spacer"></span>
      <button class="btn" id="export">Export to Excel</button>
    </div>
    <div class="tablewrap" id="tbl"></div>`;
  $$('.chip').forEach((c) => (c.onclick = () => { S.filter.status = c.dataset.st; viewListRefresh(); }));
  $('#q').oninput = (e) => { S.filter.q = e.target.value; drawTable(); };
  $('#elig').onchange = (e) => { S.filter.elig = e.target.value; drawTable(); };
  $('#mine').onchange = (e) => { S.filter.mine = e.target.checked; drawTable(); };
  $('#export').onclick = exportExcel;
  drawTable();
}
function viewListRefresh() { $$('.chip').forEach((c) => c.classList.toggle('on', c.dataset.st === S.filter.status)); drawTable(); }

function filtered() {
  const f = S.filter; const term = f.q.trim().toLowerCase();
  return S.apps.filter((a) => (!f.status || a.status === f.status)
    && (!f.elig || (f.elig === 'none' ? !a.eligibility : a.eligibility === f.elig))
    && (!f.mine || !S.myScored.has(a.id))
    && (!term || [a.app_no, a.full_name, a.programme, a.institution, a.section, a.mobile].join(' ').toLowerCase().includes(term)));
}

function drawTable() {
  const rows = filtered();
  const { key, dir } = S.sort;
  rows.sort((a, b) => { const x = a[key], y = b[key]; if (x == null) return 1; if (y == null) return -1; return (typeof x === 'number' || !isNaN(x) && x !== '' ? num(x) - num(y) : String(x).localeCompare(String(y))) * dir; });
  const th = (k, l, cls = '') => `<th class="sort ${cls}" data-k="${k}" aria-sort="${key === k ? (dir > 0 ? 'ascending' : 'descending') : 'none'}">${l}${key === k ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  $('#tbl').innerHTML = rows.length ? `<table class="data"><thead><tr>
      ${th('app_no', 'Number')}${th('full_name', 'Name')}${th('gender', 'Gender')}${th('section', 'Section')}${th('programme', 'Programme')}
      ${th('amount_requested', 'Requested', 'num')}<th>Checks</th>${th('avg_score', 'Score', 'num')}${th('status', 'Status')}${th('submitted_at', 'Received')}
    </tr></thead><tbody>${rows.map((a) => `<tr data-id="${a.id}" tabindex="0">
      <td>${esc(a.app_no)}</td><td><b>${esc(a.full_name)}</b></td><td>${esc(a.gender || '')}</td><td>${esc(a.section || '')}</td>
      <td>${esc(a.programme || '')}<br><small class="muted">${esc(a.institution || '')}</small></td>
      <td class="num">${nle(a.amount_requested)}</td>
      <td><span class="dots" title="Form complete, documents complete, Year One verified, origin verified">${['screen_form_complete', 'screen_docs_complete', 'screen_year_one', 'screen_origin'].map((k) => `<i class="${a[k] ? 'y' : ''}"></i>`).join('')}</span>${a.eligibility === 'not_eligible' ? ' <small style="color:var(--bad)">Not eligible</small>' : ''}</td>
      <td class="num">${a.avg_score != null ? `<b>${a.avg_score}</b> <small class="muted">(${a.n_scores})</small>` : '<span class="muted">—</span>'}${S.myScored.has(a.id) ? '' : '<br><small class="muted">needs your score</small>'}</td>
      <td>${pill(a.status)}</td><td>${fmtDate(a.submitted_at)}</td></tr>`).join('')}</tbody></table>`
    : `<div class="empty">${S.apps.length ? 'No applications match these filters.' : 'No applications yet. Share the application link with students to get started.'}</div>`;
  $$('#tbl th.sort').forEach((h) => (h.onclick = () => { S.sort = { key: h.dataset.k, dir: S.sort.key === h.dataset.k ? -S.sort.dir : 1 }; drawTable(); }));
  $$('#tbl tbody tr').forEach((r) => { r.onclick = () => (location.hash = `#/app/${r.dataset.id}`); r.onkeydown = (e) => { if (e.key === 'Enter') r.click(); }; });
}

// ======================================================================
// Application detail
// ======================================================================
let D = null; // current application
async function viewDetail(id) {
  shell('applications', '<p class="muted"><span class="spinner"></span> Loading application…</p>');
  if (!S.apps.length) await loadApps();
  const [app, scores] = await Promise.all([
    q(sb.from('applications').select('*').eq('id', id).single()),
    q(sb.from('scores').select('*').eq('application_id', id)),
  ]);
  D = { app, scores: scores || [], tab: D?.app?.id === id ? D.tab : 'review' };
  const a = app; const f = a.form || {};
  const list = filtered(); const idx = list.findIndex((x) => x.id === id);
  const prev = list[idx - 1], next = list[idx + 1];
  $('#page').innerHTML = `
    <div class="dhead">
      <a class="link" href="#/applications">← All applications</a>
      <span class="spacer"></span>
      ${prev ? `<a class="btn small" href="#/app/${prev.id}">Previous</a>` : ''}${next ? `<a class="btn small" href="#/app/${next.id}">Next</a>` : ''}
      <button class="btn small" onclick="window.print()">Print / PDF</button>
    </div>
    <div class="dhead"><h1>${esc(a.full_name)}</h1><span id="dpill">${pill(a.status)}</span><span class="muted">${esc(a.app_no)}, received ${fmtDate(a.submitted_at)}</span></div>
    <div class="detail">
      <div>
        <div class="card print-only" id="print-decision"></div>
        <div class="card"><h2>Documents</h2><div class="docgrid" id="docs"><span class="muted">Loading documents…</span></div></div>
        <div class="card"><h2>Application</h2>${applicationSummaryHTML(f)}
          <section class="sum-section"><header><h3><span class="sec">J</span> Declaration</h3></header><dl>
            <div class="sum-row"><dt>Declaration accepted</dt><dd>${f.declaration ? 'Yes' : 'No'}</dd></div>
            <div class="sum-row"><dt>Parent / guardian supports</dt><dd>${f.guardian_consent ? 'Yes' : 'No'}</dd></div>
            <div class="sum-row"><dt>Signed (typed name)</dt><dd>${esc(f.signature_name || '')}</dd></div>
          </dl></section>
        </div>
      </div>
      <aside class="panel">
        <div class="ptabs" role="tablist">
          <button data-t="review" role="tab">Review</button><button data-t="score" role="tab">Score</button>${isAdmin() ? '<button data-t="notify" role="tab">Notify</button>' : ''}
        </div>
        <div class="pbody" id="pbody"></div>
      </aside>
    </div>`;
  $$('.ptabs button').forEach((b) => (b.onclick = () => { D.tab = b.dataset.t; drawPanel(); }));
  drawPanel(); drawPrintDecision(); loadDocs();
}

async function loadDocs() {
  const docs = D.app.documents || [];
  const el = $('#docs');
  let urls = {};
  if (docs.length) {
    try {
      const data = await q(sb.storage.from('documents').createSignedUrls(docs.map((d) => d.path), 3600));
      (data || []).forEach((u) => { if (u.signedUrl) urls[u.path] = u.signedUrl; });
    } catch (e) { el.innerHTML = `<div class="notice bad">Documents could not be loaded: ${esc(errText(e))}</div>`; return; }
  }
  el.innerHTML = DOCUMENTS.map((meta) => {
    const d = docs.find((x) => x.key === meta.key);
    if (!d) return `<div class="missing"><div class="pv">—</div><span>${esc(meta.label)}<br><small class="muted">Not uploaded</small></span></div>`;
    const u = urls[d.path]; const isImg = (d.mime || '').startsWith('image/');
    return `<a href="${esc(u || '#')}" target="_blank" rel="noopener"><div class="pv" ${isImg && u ? `style="background-image:url('${esc(u)}')"` : ''}>${isImg ? '' : 'PDF'}</div><span>${esc(meta.label)}${d.size ? `<br><small class="muted">${Math.round(d.size / 1024)} KB</small>` : ''}</span></a>`;
  }).join('');
}

function drawPanel() {
  $$('.ptabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === D.tab));
  const body = $('#pbody');
  if (D.tab === 'score') return drawScore(body);
  if (D.tab === 'notify' && isAdmin()) return drawNotify(body);
  return drawReview(body);
}

function drawPrintDecision() {
  const a = D.app; const avg = avgScore();
  $('#print-decision').innerHTML = `<h2>Review summary</h2><p>Status: <b>${esc(STATUS[a.status]?.label || a.status)}</b>. Eligibility: ${esc(a.eligibility === 'eligible' ? 'Eligible' : a.eligibility === 'not_eligible' ? 'Not eligible' : 'Not decided')}.
    Average score: <b>${avg != null ? avg : '—'}</b> / 100 from ${D.scores.length} assessor(s). Amount requested: ${nle(a.amount_requested)}. Amount awarded: ${nle(a.amount_awarded)}.</p>`;
}
const avgScore = () => { const s = D.scores.filter((x) => x.weighted_total != null); return s.length ? Math.round(s.reduce((t, x) => t + num(x.weighted_total), 0) / s.length * 10) / 10 : null; };

// ---------- Review (screening & decision) ----------
function drawReview(body) {
  const a = D.app; const ro = !isAdmin(); const dis = ro ? 'disabled' : '';
  const chk = (k, l) => `<label><input type="checkbox" name="${k}" ${a[k] ? 'checked' : ''} ${dis}> ${l}</label>`;
  body.innerHTML = `<form id="review" novalidate>
    ${ro ? '<div class="notice">Only admins can change screening and decisions. You can score this application in the Score tab.</div>' : ''}
    <div class="field"><span class="label">Screening</span><div class="checklist">
      ${chk('screen_form_complete', 'Form complete')}${chk('screen_docs_complete', 'All required documents attached and readable')}
      ${chk('screen_year_one', 'Year One admission verified')}${chk('screen_origin', 'Origin from Mandu Chiefdom verified')}</div></div>
    <div class="field"><span class="label">Eligibility</span><div class="inline-choices">
      <label><input type="radio" name="eligibility" value="eligible" ${a.eligibility === 'eligible' ? 'checked' : ''} ${dis}> Eligible</label>
      <label><input type="radio" name="eligibility" value="not_eligible" ${a.eligibility === 'not_eligible' ? 'checked' : ''} ${dis}> Not eligible</label></div></div>
    <div class="field ${a.eligibility === 'not_eligible' ? '' : 'hidden'}" id="reasonf"><label for="ineligible_reason">Reason not eligible</label><input id="ineligible_reason" name="ineligible_reason" type="text" value="${esc(a.ineligible_reason || '')}" ${dis}></div>
    <div class="grid" style="gap:0 12px">
      <div class="field half"><label for="interview_date">Interview / visit date</label><input id="interview_date" name="interview_date" type="date" value="${esc(a.interview_date || '')}" ${dis}></div>
      <div class="field half"><label for="interview_outcome">Interview / visit outcome</label><input id="interview_outcome" name="interview_outcome" type="text" value="${esc(a.interview_outcome || '')}" ${dis}></div>
    </div>
    <div class="field"><label for="status">Status</label><select id="status" name="status" ${dis}>${Object.entries(STATUS).map(([k, s]) => `<option value="${k}" ${a.status === k ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></div>
    <div id="awardbox" class="${a.status === 'awarded' ? '' : 'hidden'}">
      <div class="field"><label for="amount_awarded">Amount awarded (NLe)</label><input id="amount_awarded" name="amount_awarded" type="number" min="0" value="${esc(a.amount_awarded ?? '')}" ${dis}>
        <span class="hint">Requested: ${nle(a.amount_requested)}</span></div>
      <div class="field"><span class="label">Covers</span><div class="inline-choices">${COVERS.map((c) => `<label><input type="checkbox" name="award_covers" value="${esc(c)}" ${(a.award_covers || []).includes(c) ? 'checked' : ''} ${dis}> ${esc(c)}</label>`).join('')}</div></div>
      <div class="field"><label for="award_period">Award period</label><select id="award_period" name="award_period" ${dis}><option value="">Choose…</option>${Object.entries(PERIODS).map(([k, l]) => `<option value="${k}" ${a.award_period === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label for="public_message">Message to applicant</label><span class="hint">Shown on the applicant’s status page.</span><textarea id="public_message" name="public_message" rows="3" ${dis}>${esc(a.public_message || '')}</textarea></div>
    <div class="field"><label for="internal_notes">Internal notes</label><span class="hint">Staff only.</span><textarea id="internal_notes" name="internal_notes" rows="3" ${dis}>${esc(a.internal_notes || '')}</textarea></div>
    ${a.decided_at ? `<p class="small muted">Decision recorded ${fmtDate(a.decided_at)}${a.decided_by ? ` by ${esc(staffName(a.decided_by))}` : ''}.</p>` : ''}
    ${ro ? '' : '<button class="btn primary" type="submit" style="width:100%">Save review</button>'}
  </form>`;
  const form = $('#review');
  form.onchange = () => {
    $('#reasonf').classList.toggle('hidden', form.eligibility.value !== 'not_eligible');
    $('#awardbox').classList.toggle('hidden', form.status.value !== 'awarded');
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const patch = {
      screen_form_complete: form.screen_form_complete.checked, screen_docs_complete: form.screen_docs_complete.checked,
      screen_year_one: form.screen_year_one.checked, screen_origin: form.screen_origin.checked,
      eligibility: fd.get('eligibility') || null, ineligible_reason: fd.get('ineligible_reason') || null,
      interview_date: fd.get('interview_date') || null, interview_outcome: fd.get('interview_outcome') || null,
      status: fd.get('status'), public_message: fd.get('public_message') || null, internal_notes: fd.get('internal_notes') || null,
    };
    if (patch.eligibility === 'not_eligible' && patch.status !== 'ineligible' && !confirm('Marked “Not eligible” but status is not “Not eligible”. Save anyway?')) return;
    if (patch.status === 'awarded') {
      patch.amount_awarded = fd.get('amount_awarded') === '' ? null : num(fd.get('amount_awarded'));
      patch.award_covers = fd.getAll('award_covers'); patch.award_period = fd.get('award_period') || null;
      if (!patch.amount_awarded) return toast('Enter the amount awarded.');
      if (patch.amount_awarded > num(D.app.amount_requested) && !confirm('The amount awarded is more than the amount requested. Save anyway?')) return;
    }
    const b = form.querySelector('button[type=submit]'); b.disabled = true;
    try {
      const data = await q(sb.from('applications').update(patch).eq('id', D.app.id).select().single());
      D.app = data; toast('Review saved');
      const ov = S.apps.find((x) => x.id === data.id); if (ov) Object.assign(ov, patch);
      $('#dpill').innerHTML = pill(data.status);
      drawPrintDecision(); drawPanel();
    } catch (err) { toast(errText(err)); b.disabled = false; }
  };
}

// ---------- Score (rubric) ----------
function drawScore(body) {
  const mine = D.scores.find((s) => s.assessor_id === S.me.user_id) || {};
  const others = D.scores.filter((s) => s.weighted_total != null);
  const avg = avgScore();
  body.innerHTML = `<form id="scoreform" novalidate>
    <p class="small muted">Score each criterion from 0 to 10. Weighted score = score × weight ÷ 10.</p>
    ${CRITERIA.map((c) => `<div class="score-row"><div><b>${esc(c.label)} (${c.weight}%)</b><small>${esc(c.evidence)}</small></div>
      <input type="number" name="${c.id}" min="0" max="10" step="0.5" inputmode="decimal" aria-label="${esc(c.label)} score out of 10" value="${mine[c.id] ?? ''}"></div>`).join('')}
    <div class="score-total"><span>Your weighted score</span><span><b id="wt">—</b> / 100</span></div>
    <p class="guide">9–10 excellent, well-documented evidence; 7–8 good; 5–6 fair; 3–4 weak; 0–2 very weak or none.</p>
    <div class="field"><label for="comments">Comments</label><textarea id="comments" name="comments" rows="3" placeholder="Strengths, concerns, things to verify">${esc(mine.comments || '')}</textarea></div>
    <button class="btn primary" type="submit" style="width:100%">${mine.assessor_id ? 'Update my score' : 'Save my score'}</button>
  </form>
  <h3 style="margin-top:20px">All assessors ${avg != null ? `<span class="pill">Average ${avg}</span>` : ''}</h3>
  ${others.length ? `<table class="mini"><thead><tr><th>Assessor</th>${CRITERIA.map((c) => `<th title="${esc(c.label)}">${c.label.split(' ')[0]}</th>`).join('')}<th>Total</th></tr></thead><tbody>
    ${others.map((s) => `<tr><td>${esc(staffName(s.assessor_id))}${s.comments ? `<br><small class="muted">${esc(s.comments)}</small>` : ''}</td>${CRITERIA.map((c) => `<td>${s[c.id] ?? ''}</td>`).join('')}<td><b>${s.weighted_total}</b></td></tr>`).join('')}
  </tbody></table>` : '<p class="muted">No scores yet.</p>'}`;
  const form = $('#scoreform');
  const calc = () => {
    const vals = CRITERIA.map((c) => form[c.id].value);
    $('#wt').textContent = vals.every((v) => v !== '') ? (CRITERIA.reduce((t, c) => t + num(form[c.id].value) * c.weight / 10, 0)).toFixed(1).replace(/\.0$/, '') : '—';
  };
  form.oninput = calc; calc();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const row = { application_id: D.app.id, assessor_id: S.me.user_id, comments: form.comments.value || null };
    for (const c of CRITERIA) {
      const v = form[c.id].value;
      if (v === '' || num(v) < 0 || num(v) > 10) return toast(`Give ${c.label} a score from 0 to 10.`);
      row[c.id] = num(v);
    }
    try {
      await q(sb.from('scores').upsert(row, { onConflict: 'application_id,assessor_id' }));
      D.scores = await q(sb.from('scores').select('*').eq('application_id', D.app.id));
      S.myScored.add(D.app.id);
      const ov = S.apps.find((x) => x.id === D.app.id); if (ov) { ov.avg_score = avgScore(); ov.n_scores = D.scores.length; }
      toast('Score saved'); drawPrintDecision(); drawPanel();
    } catch (err) { toast(errText(err)); }
  };
}

// ---------- Notify applicant ----------
function messageFor(kind) {
  const a = D.app; const first = (a.form?.first_names || '').split(' ')[0] || 'Applicant';
  const link = new URL('status.html', location.href.split('#')[0]).href;
  const tail = ` Check your status at ${link} with your application number ${a.app_no} and access code.`;
  const T = {
    received: `Dear ${first}, the Mandu Foundation has received your scholarship application ${a.app_no}.${tail}`,
    documents: `Dear ${first}, your ManDuF scholarship application ${a.app_no} is missing some documents: [list them]. Please bring or send them to the Foundation office by [date].`,
    interview: `Dear ${first}, you have been shortlisted for a ManDuF scholarship (${a.app_no}). Please come for an interview on ${a.interview_date ? fmtDate(a.interview_date) : '[date]'} at [place and time]. Bring your original documents.`,
    awarded: `Congratulations ${first}! You have been awarded a ManDuF scholarship${a.amount_awarded ? ` of ${nle(a.amount_awarded)}` : ''} (${a.app_no}). ${a.public_message || 'Please visit the Foundation office with your ID to complete the next steps.'}`,
    waitlisted: `Dear ${first}, your ManDuF scholarship application ${a.app_no} is on the waiting list. We will contact you if a place becomes available.`,
    not_awarded: `Dear ${first}, thank you for applying for a ManDuF scholarship (${a.app_no}). We are sorry that your application was not successful this time. We wish you every success in your studies.`,
    ineligible: `Dear ${first}, thank you for applying for a ManDuF scholarship (${a.app_no}). Your application did not meet the eligibility requirements${a.ineligible_reason ? `: ${a.ineligible_reason}` : ''}.`,
  };
  return T[kind] || T.received;
}

function drawNotify(body) {
  const a = D.app;
  const def = { awarded: 'awarded', waitlisted: 'waitlisted', not_awarded: 'not_awarded', ineligible: 'ineligible', shortlisted: 'interview' }[a.status] || 'received';
  body.innerHTML = `<div class="field"><label for="tpl">Message</label><select id="tpl">
      ${[['received', 'Application received'], ['documents', 'Documents missing'], ['interview', 'Interview invitation'], ['awarded', 'Award'], ['waitlisted', 'Waiting list'], ['not_awarded', 'Not successful'], ['ineligible', 'Not eligible']].map(([k, l]) => `<option value="${k}" ${k === def ? 'selected' : ''}>${l}</option>`).join('')}
    </select></div>
    <div class="field"><label for="msg">Text (edit before sending)</label><textarea id="msg" rows="8"></textarea></div>
    <p class="small muted">Sends from your own phone or email app to ${esc(a.mobile || 'no phone given')}${a.email ? ` / ${esc(a.email)}` : ''}${a.form?.whatsapp === 'No' ? ' (applicant said this number is not on WhatsApp)' : ''}.</p>
    <div class="notify-btns">
      <a class="btn teal" id="wa" target="_blank" rel="noopener">WhatsApp</a>
      <a class="btn" id="sms">SMS</a>
      <a class="btn" id="mail">Email</a>
      <button class="btn" id="copy" type="button">Copy text</button>
    </div>`;
  const upd = () => {
    const t = $('#msg').value; const p = intlPhone(a.mobile);
    $('#wa').href = p ? `https://wa.me/${p}?text=${encodeURIComponent(t)}` : '#';
    $('#sms').href = p ? `sms:+${p}?&body=${encodeURIComponent(t)}` : '#';
    $('#mail').href = a.email ? `mailto:${a.email}?subject=${encodeURIComponent('ManDuF scholarship application ' + a.app_no)}&body=${encodeURIComponent(t)}` : '#';
    $('#mail').classList.toggle('hidden', !a.email);
  };
  const fill = () => { $('#msg').value = messageFor($('#tpl').value); upd(); };
  $('#tpl').onchange = fill; $('#msg').oninput = upd;
  $('#copy').onclick = async () => { try { await navigator.clipboard.writeText($('#msg').value); toast('Copied'); } catch { $('#msg').select(); toast('Press Ctrl+C to copy'); } };
  fill();
}

// ======================================================================
// Ranking
// ======================================================================
async function viewRanking() {
  shell('ranking', '<p class="muted"><span class="spinner"></span> Loading…</p>');
  await loadApps();
  $('#page').innerHTML = `<h1 style="font-size:1.4rem">Ranking</h1>
    <p class="muted" style="max-width:760px">Scored applications in order of average score. Applications marked not eligible are left out. Enter the budget to see how far it reaches down the list. The ranking guides the Committee; it does not decide awards.</p>
    <div class="toolbar"><label for="budget"><b>Budget (NLe)</b></label><input id="budget" type="number" min="0" style="width:200px" value="${esc(S.budget)}"><span id="bsum" class="muted"></span></div>
    <div class="tablewrap" id="rk"></div>`;
  const draw = () => {
    const rows = S.apps.filter((a) => a.avg_score != null && a.eligibility !== 'not_eligible' && a.status !== 'ineligible')
      .sort((a, b) => num(b.avg_score) - num(a.avg_score) || num(b.avg_need) - num(a.avg_need));
    const budget = num(S.budget); let cum = 0; let funded = 0;
    $('#rk').innerHTML = rows.length ? `<table class="data"><thead><tr><th class="num">Rank</th><th>Number</th><th>Name</th><th>Section</th>
      <th class="num">Need</th><th class="num">Merit</th><th class="num">Statement</th><th class="num">Leadership</th><th class="num">Average</th><th class="num">Assessors</th>
      <th class="num">Requested</th><th class="num">Running total</th><th>Status</th></tr></thead><tbody>
      ${rows.map((a, i) => { cum += num(a.amount_requested); const inB = S.budget !== '' && cum <= budget; if (inB) funded++;
        return `<tr data-id="${a.id}" class="${inB ? 'funded' : ''}"><td class="num">${i + 1}</td><td>${esc(a.app_no)}</td><td><b>${esc(a.full_name)}</b></td><td>${esc(a.section || '')}</td>
        <td class="num">${a.avg_need ?? ''}</td><td class="num">${a.avg_merit ?? ''}</td><td class="num">${a.avg_statement ?? ''}</td><td class="num">${a.avg_leadership ?? ''}</td>
        <td class="num"><b>${a.avg_score}</b></td><td class="num">${a.n_scores}</td><td class="num">${nle(a.amount_requested)}</td><td class="num">${nle(cum)}</td><td>${pill(a.status)}</td></tr>`; }).join('')}
      </tbody></table>` : '<div class="empty">No scored applications yet.</div>';
    $('#bsum').textContent = S.budget !== '' && rows.length ? `Covers the full request of the top ${funded} applicant${funded === 1 ? '' : 's'} (highlighted).` : '';
    $$('#rk tbody tr').forEach((r) => (r.onclick = () => (location.hash = `#/app/${r.dataset.id}`)));
  };
  $('#budget').oninput = (e) => { S.budget = e.target.value; draw(); };
  draw();
}

// ======================================================================
// Settings, staff, account
// ======================================================================
function viewSettings() {
  const s = S.settings;
  shell('settings', `<h1 style="font-size:1.4rem">Settings</h1>
    <form id="sets" class="card formgrid" novalidate>
      <div class="field"><label for="academic_year">Academic year</label><input id="academic_year" name="academic_year" type="text" value="${esc(s.academic_year)}" placeholder="2026/2027">
        <span class="hint">New application numbers use the first four characters, e.g. MDF-2026-0001.</span></div>
      <div class="field"><label for="closing_date">Closing date</label><input id="closing_date" name="closing_date" type="date" value="${esc(s.closing_date || '')}"></div>
      <div class="field full"><label class="check"><input type="checkbox" name="applications_open" ${s.applications_open ? 'checked' : ''}> Accept new applications</label></div>
      <div class="field"><label for="contact_phone">Enquiries phone</label><input id="contact_phone" name="contact_phone" type="text" value="${esc(s.contact_phone || '')}"></div>
      <div class="field"><label for="contact_email">Enquiries email</label><input id="contact_email" name="contact_email" type="email" value="${esc(s.contact_email || '')}"></div>
      <div class="field full"><label for="submit_note">Note shown on the application page</label><textarea id="submit_note" name="submit_note" rows="2" placeholder="e.g. Bring original documents to the Foundation office in Daru when invited.">${esc(s.submit_note || '')}</textarea></div>
      <div class="field full"><button class="btn primary" type="submit">Save settings</button></div>
    </form>
    <div class="card" style="max-width:760px"><h2>Links to share</h2>
      <p>Application: <a href="index.html" target="_blank">${esc(new URL('index.html', location.href.split('#')[0]).href)}</a><br>
      Status check: <a href="status.html" target="_blank">${esc(new URL('status.html', location.href.split('#')[0]).href)}</a></p></div>`);
  $('#sets').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    const patch = { academic_year: f.academic_year.value.trim(), closing_date: f.closing_date.value || null, applications_open: f.applications_open.checked,
      contact_phone: f.contact_phone.value.trim() || null, contact_email: f.contact_email.value.trim() || null, submit_note: f.submit_note.value.trim() || null };
    if (!/^\d{4}/.test(patch.academic_year)) return toast('Academic year must start with a year, e.g. 2026/2027.');
    try { S.settings = await q(sb.from('settings').update(patch).eq('id', 1).select().single()); toast('Settings saved'); viewSettings(); }
    catch (err) { toast(errText(err)); }
  };
}

async function viewStaff() {
  S.staff = await q(sb.from('staff').select('*').order('full_name'));
  shell('staff', `<h1 style="font-size:1.4rem">Staff</h1>
    <div class="tablewrap" style="max-width:860px;margin-bottom:20px"><table class="data"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>
      ${S.staff.map((s) => `<tr style="cursor:default"><td><b>${esc(s.full_name)}</b></td><td>${esc(s.email)}</td>
        <td><select data-role="${s.user_id}" ${s.user_id === S.me.user_id ? 'disabled' : ''} aria-label="Role for ${esc(s.full_name)}"><option value="assessor" ${s.role === 'assessor' ? 'selected' : ''}>Assessor</option><option value="admin" ${s.role === 'admin' ? 'selected' : ''}>Admin</option></select></td>
        <td>${s.user_id === S.me.user_id ? '<small class="muted">You</small>' : `<button class="link" data-del="${s.user_id}">Remove</button>`}</td></tr>`).join('')}
    </tbody></table></div>
    <form id="addstaff" class="card formgrid" novalidate>
      <h2 class="full">Add a staff member</h2>
      <p class="full small muted">First create their login in Supabase (Authentication → Users → Add user), then add them here. Assessors can view and score applications. Admins can also screen, decide, notify and change settings.</p>
      <div class="field"><label for="sname">Full name</label><input id="sname" type="text" required></div>
      <div class="field"><label for="semail">Login email</label><input id="semail" type="email" required></div>
      <div class="field"><label for="srole">Role</label><select id="srole"><option value="assessor">Assessor</option><option value="admin">Admin</option></select></div>
      <div class="field" style="align-self:end"><button class="btn primary" type="submit">Add staff member</button></div>
    </form>`);
  $('#addstaff').onsubmit = async (e) => {
    e.preventDefault();
    if (!$('#sname').value.trim() || !$('#semail').value.trim()) return toast('Enter a name and email.');
    try { await q(sb.rpc('add_staff', { p_email: $('#semail').value.trim(), p_full_name: $('#sname').value.trim(), p_role: $('#srole').value })); toast('Staff member added'); viewStaff(); }
    catch (err) { toast(errText(err)); }
  };
  $$('[data-role]').forEach((sel) => (sel.onchange = async () => {
    try { await q(sb.from('staff').update({ role: sel.value }).eq('user_id', sel.dataset.role)); toast('Role updated'); } catch (err) { toast(errText(err)); }
  }));
  $$('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Remove this person from the staff list? Their scores will also be deleted.')) return;
    try { await q(sb.from('staff').delete().eq('user_id', b.dataset.del)); toast('Removed'); viewStaff(); } catch (err) { toast(errText(err)); }
  }));
}

function viewAccount() {
  shell('account', `<h1 style="font-size:1.4rem">My account</h1>
    <form id="pw" class="card" style="max-width:420px" novalidate>
      <p>Signed in as <b>${esc(S.session.user.email)}</b> (${esc(S.me.role)}).</p>
      <div class="field"><label for="np">New password (at least 8 characters)</label><input id="np" type="password" autocomplete="new-password"></div>
      <button class="btn primary" type="submit">Change password</button>
    </form>`);
  $('#pw').onsubmit = async (e) => {
    e.preventDefault(); const p = $('#np').value;
    if (p.length < 8) return toast('Use at least 8 characters.');
    const { error } = await sb.auth.updateUser({ password: p });
    toast(error ? errText(error) : 'Password changed'); if (!error) $('#np').value = '';
  };
}

// ======================================================================
// Excel export
// ======================================================================
async function exportExcel() {
  const btn = $('#export'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Preparing…';
  try {
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
    const [apps, scores] = await Promise.all([
      q(sb.from('applications').select('*').order('app_no')),
      q(sb.from('scores').select('*')),
    ]);
    const ov = Object.fromEntries(S.apps.map((a) => [a.id, a]));
    const rows = apps.map((a) => {
      const f = a.form || {}; const o = ov[a.id] || {};
      const r = {
        'Application no.': a.app_no, 'Received': a.submitted_at?.slice(0, 10), 'Full name': a.full_name, 'Status': STATUS[a.status]?.label || a.status,
        'Eligibility': a.eligibility || '', 'Reason not eligible': a.ineligible_reason || '',
        'Form complete': a.screen_form_complete ? 'Yes' : 'No', 'Documents complete': a.screen_docs_complete ? 'Yes' : 'No',
        'Year One verified': a.screen_year_one ? 'Yes' : 'No', 'Origin verified': a.screen_origin ? 'Yes' : 'No',
        'Average score (/100)': o.avg_score ?? '', 'Need (avg /10)': o.avg_need ?? '', 'Merit (avg /10)': o.avg_merit ?? '',
        'Statement (avg /10)': o.avg_statement ?? '', 'Leadership (avg /10)': o.avg_leadership ?? '', 'Assessors': o.n_scores ?? 0,
        'Amount requested (NLe)': num(a.amount_requested), 'Amount awarded (NLe)': a.amount_awarded == null ? '' : num(a.amount_awarded),
        'Award covers': (a.award_covers || []).join(', '), 'Award period': PERIODS[a.award_period] || '',
        'Interview date': a.interview_date || '', 'Interview outcome': a.interview_outcome || '',
        'Message to applicant': a.public_message || '', 'Internal notes': a.internal_notes || '',
      };
      SIMPLE_FIELDS.forEach((fl) => { r[fl.label] = answerText(fl, f); });
      r['WASSCE results'] = (f.results || []).map((x) => `${x.subject} ${x.grade}`).join('; ');
      COST_ITEMS.forEach((c) => { const x = (f.costs || []).find((y) => y.item === c.id) || {};
        r[`${c.label}: total`] = num(x.total) || ''; r[`${c.label}: covered`] = num(x.covered) || ''; r[`${c.label}: requested`] = num(x.requested) || ''; });
      r['Activities'] = (f.activities || []).map((x) => [x.role, x.org, x.period, x.achieved].filter(Boolean).join(', ')).join('; ');
      (f.referees || []).forEach((x, i) => { r[`Referee ${i + 1}`] = [x?.name, x?.position, x?.phone, x?.email].filter(Boolean).join(', '); });
      r['Documents uploaded'] = (a.documents || []).map((d) => DOCUMENTS.find((m) => m.key === d.key)?.label || d.key).join('; ');
      return r;
    });
    const byId = Object.fromEntries(apps.map((a) => [a.id, a]));
    const srows = scores.map((s) => ({ 'Application no.': byId[s.application_id]?.app_no, 'Applicant': byId[s.application_id]?.full_name,
      'Assessor': staffName(s.assessor_id), 'Financial need': s.financial_need, 'Academic merit': s.academic_merit,
      'Personal statement': s.personal_statement, 'Leadership': s.leadership, 'Weighted total': s.weighted_total, 'Comments': s.comments || '' }));
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(rows); ws1['!cols'] = Object.keys(rows[0] || {}).map(() => ({ wch: 20 }));
    XLSX.utils.book_append_sheet(wb, ws1, 'Applications');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(srows.length ? srows : [{ Note: 'No scores yet' }]), 'Scores');
    XLSX.writeFile(wb, `ManDuF_applications_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (e) { toast('Export failed: ' + errText(e)); }
  finally { btn.disabled = false; btn.textContent = 'Export to Excel'; }
}

init();
