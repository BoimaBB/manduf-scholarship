// Shared definitions for the applicant app, status page and admin dashboard.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.MANDUF_CONFIG || {};
export const configured = !!cfg.supabaseUrl && !cfg.supabaseUrl.includes('YOUR-PROJECT');
export const sb = configured ? createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

// ---------- small helpers ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')); return isNaN(n) ? 0 : n; };
export const nle = (v) => (v === null || v === undefined || v === '') ? '—' : 'NLe ' + Number(v).toLocaleString('en-GB', { maximumFractionDigits: 2 });
export const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const wordCount = (s) => (String(s || '').trim().match(/\S+/g) || []).length;
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (crypto.getRandomValues(new Uint8Array(1))[0] % 16); return (c === 'x' ? r : (r & 3) | 8).toString(16); }));

// Sierra Leone numbers to international digits for WhatsApp/SMS links (e.g. 076123456 → 23276123456)
export function intlPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('232')) return d;
  if (d.startsWith('0')) return '232' + d.slice(1);
  if (d.length === 8) return '232' + d;
  return d;
}

// Readable text from a Supabase / Postgres error
export function errText(e) {
  if (!e) return 'Something went wrong.';
  const m = e.message || e.error_description || String(e);
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No internet connection. Check your data or Wi-Fi and try again.';
  return m.replace(/^.*?ERROR:\s*/, '');
}

export function settingsText(s) {
  if (!s) return '';
  return s.closing_date ? `Closing date: ${fmtDate(s.closing_date)}` : '';
}

// ---------- statuses ----------
export const STATUS = {
  submitted:    { label: 'Received',            tone: 'neutral', text: 'Your application has been received and is waiting to be reviewed.' },
  under_review: { label: 'Under review',        tone: 'neutral', text: 'The Scholarship Committee is reviewing your application.' },
  shortlisted:  { label: 'Shortlisted',         tone: 'good',    text: 'You have been shortlisted. The Foundation may contact you for an interview or a home visit.' },
  awarded:      { label: 'Awarded',             tone: 'best',    text: 'Congratulations — you have been awarded a ManDuF scholarship.' },
  waitlisted:   { label: 'On the waiting list', tone: 'neutral', text: 'You are on the waiting list. You will be contacted if a place becomes available.' },
  not_awarded:  { label: 'Not successful',      tone: 'bad',     text: 'Your application was not successful this time. Thank you for applying.' },
  ineligible:   { label: 'Not eligible',        tone: 'bad',     text: 'Your application did not meet the eligibility requirements.' },
};

// ---------- the application form ----------
// Each step lists its fields. Types: text, email, tel, date, number, radio, checks, textarea,
// results, costs, activities, referees, documents, review.
export const WASSCE_GRADES = ['A1', 'B2', 'B3', 'C4', 'C5', 'C6', 'D7', 'E8', 'F9'];
export const SUBJECTS = ['English Language', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'Integrated Science',
  'Agricultural Science', 'Economics', 'Geography', 'Government', 'History', 'Literature in English', 'Commerce',
  'Financial Accounting', 'Business Management', 'Civic Education', 'Further Mathematics', 'French',
  'Christian Religious Studies', 'Islamic Religious Studies'];
export const INSTITUTIONS = ['Njala University', 'University of Sierra Leone — Fourah Bay College',
  'University of Sierra Leone — IPAM', 'University of Sierra Leone — College of Medicine and Allied Health Sciences',
  'Ernest Bai Koroma University of Science and Technology', 'Eastern Technical University of Sierra Leone',
  'Milton Margai Technical University', 'University of Makeni'];

export const COST_ITEMS = [
  { id: 'tuition', label: 'Tuition fees' },
  { id: 'registration', label: 'Registration / administrative fees' },
  { id: 'books', label: 'Books & learning materials' },
  { id: 'other', label: 'Other approved cost', named: true },
];

export const DOCUMENTS = [
  { key: 'admission_letter', label: 'Year One admission letter', required: true },
  { key: 'wassce_slip', label: 'WASSCE result slip', required: true },
  { key: 'fee_structure', label: 'Official fee structure or invoice for Year One', required: true },
  { key: 'id_document', label: 'National ID, passport or birth certificate', required: true },
  { key: 'photo', label: 'Recent passport-size photograph', required: true, hint: 'A clear photo of your face against a plain background.' },
  { key: 'origin_letter', label: 'Letter confirming you are from Mandu Chiefdom', hint: 'From a Town Chief, Section Chief or the Paramount Chief’s office. If you do not have it yet, bring it to the office.' },
  { key: 'need_evidence', label: 'Evidence of financial need', hint: 'For example a payslip, or a letter from a community leader.' },
  { key: 'reference_1', label: 'Reference letter — academic referee' },
  { key: 'reference_2', label: 'Reference letter — community referee' },
];

export const STEPS = [
  { id: 'personal', title: 'About you', section: 'A', fields: [
    { id: 'surname', label: 'Surname (family name)', type: 'text', required: true, half: true },
    { id: 'first_names', label: 'First name(s)', type: 'text', required: true, half: true },
    { id: 'other_names', label: 'Other names', type: 'text', half: true },
    { id: 'gender', label: 'Gender', type: 'radio', options: ['Female', 'Male'], required: true, half: true },
    { id: 'dob', label: 'Date of birth', type: 'date', required: true, half: true },
    { id: 'nin', label: 'National ID (NIN) or passport number', type: 'text', required: true, half: true, hint: 'If you have neither, give your birth certificate number.' },
    { id: 'mobile', label: 'Mobile phone', type: 'tel', required: true, half: true, placeholder: '076 123 456' },
    { id: 'whatsapp', label: 'Is this number on WhatsApp?', type: 'radio', options: ['Yes', 'No'], half: true },
    { id: 'email', label: 'Email address', type: 'email', half: true, hint: 'Optional' },
    { id: 'hometown', label: 'Hometown or village', type: 'text', required: true, half: true },
    { id: 'section', label: 'Section in Mandu Chiefdom', type: 'text', required: true, half: true },
    { id: 'address', label: 'Where you live now', type: 'text', required: true, half: true },
    { id: 'disability', label: 'Do you have a disability or special need the Committee should know about?', type: 'radio', options: ['No', 'Yes'], hint: 'Optional — this will not count against you.' },
    { id: 'disability_detail', label: 'Please describe', type: 'text', showIf: (d) => d.disability === 'Yes' },
  ] },
  { id: 'family', title: 'Your family', section: 'B', intro: 'This helps the Committee understand your circumstances. It is kept confidential.', fields: [
    { id: 'guardian_name', label: 'Parent or guardian’s full name', type: 'text', required: true, half: true },
    { id: 'guardian_relationship', label: 'Relationship to you', type: 'text', required: true, half: true },
    { id: 'guardian_occupation', label: 'Their occupation', type: 'text', required: true, half: true },
    { id: 'guardian_phone', label: 'Their phone number', type: 'tel', required: true, half: true },
    { id: 'guardian_address', label: 'Their address', type: 'text' },
    { id: 'parent_status', label: 'Status of your parents', type: 'radio', required: true,
      options: ['Both living', 'Father deceased', 'Mother deceased', 'Both deceased'] },
    { id: 'emergency_name', label: 'Emergency contact (if different)', type: 'text', half: true },
    { id: 'emergency_phone', label: 'Emergency contact phone', type: 'tel', half: true },
  ] },
  { id: 'admission', title: 'Your admission', section: 'C', intro: 'Use the details on your Year One admission letter.', fields: [
    { id: 'institution', label: 'University or institution', type: 'text', required: true, list: 'institutions' },
    { id: 'campus', label: 'Campus', type: 'text', half: true },
    { id: 'faculty', label: 'Faculty / department', type: 'text', required: true, half: true },
    { id: 'programme', label: 'Programme of study', type: 'text', required: true, half: true, placeholder: 'e.g. BSc Nursing' },
    { id: 'level', label: 'Level of programme', type: 'radio', required: true, half: true, options: ['Certificate', 'Diploma', "Bachelor's", 'Other'] },
    { id: 'level_other', label: 'Other level — please state', type: 'text', showIf: (d) => d.level === 'Other' },
    { id: 'admission_no', label: 'Admission number', type: 'text', required: true, half: true },
    { id: 'admission_date', label: 'Date on the admission letter', type: 'date', required: true, half: true },
    { id: 'mode', label: 'Mode of study', type: 'radio', options: ['Full-time', 'Part-time'], required: true, half: true },
    { id: 'duration', label: 'Programme length (years)', type: 'number', min: 1, max: 7, required: true, half: true },
    { id: 'start_date', label: 'Expected start of classes', type: 'date', half: true },
  ] },
  { id: 'academic', title: 'Your school results', section: 'D', fields: [
    { id: 'school', label: 'Secondary school attended', type: 'text', required: true, half: true },
    { id: 'year_completed', label: 'Year completed', type: 'number', min: 2000, max: 2100, required: true, half: true },
    { id: 'wassce_index', label: 'WASSCE index number', type: 'text', required: true, half: true },
    { id: 'sittings', label: 'Number of sittings', type: 'radio', options: ['One', 'Two'], required: true, half: true },
    { id: 'results', label: 'Your WASSCE results', type: 'results', rows: 8, hint: 'Enter at least 5 subjects, starting with your best.' },
    { id: 'awards', label: 'Awards and achievements', type: 'textarea', rowsH: 2, hint: 'Optional' },
  ] },
  { id: 'finance', title: 'Costs and finances', section: 'E', intro: 'Use the figures on your institution’s official fee structure. All amounts in New Leones (NLe). Accommodation is not covered by this scholarship, so do not include it.', fields: [
    { id: 'costs', label: 'Year One costs', type: 'costs' },
    { id: 'who_pays', label: 'Who will pay the rest of your costs?', type: 'text', required: true },
    { id: 'income_source', label: 'Main source of household income', type: 'radio', required: true,
      options: ['Farming', 'Trading', 'Salaried job', 'Casual work', 'None', 'Other'] },
    { id: 'income_other', label: 'Other income source', type: 'text', showIf: (d) => d.income_source === 'Other' },
    { id: 'household_income', label: 'Estimated household income per month (NLe)', type: 'number', min: 0, half: true },
    { id: 'household_size', label: 'People in your household', type: 'number', min: 1, required: true, half: true },
    { id: 'in_school', label: 'Of these, how many are in school or college?', type: 'number', min: 0, half: true },
    { id: 'dependants', label: 'People who depend on you', type: 'number', min: 0, half: true },
    { id: 'other_support', label: 'Other support received or applied for', type: 'checks',
      options: ['Government Grant-in-Aid', 'Other scholarship', 'Family / sponsor', 'None'] },
    { id: 'other_support_detail', label: 'Name of the support and amount', type: 'text',
      showIf: (d) => (d.other_support || []).some((x) => x !== 'None') },
    { id: 'hardship', label: 'Briefly explain the financial difficulties your household faces', type: 'textarea', rowsH: 3, required: true, hint: '2–3 sentences.' },
  ] },
  { id: 'statement', title: 'Your statement', section: 'F & G', fields: [
    { id: 'statement', label: 'Personal statement', type: 'textarea', rowsH: 12, required: true, maxWords: 500,
      hint: 'Up to 500 words. Tell us: (1) your background in Mandu Chiefdom; (2) why you chose your programme and your career goals; (3) challenges you have faced and how you dealt with them; (4) how this scholarship will help you and how you will give back to your community.' },
    { id: 'activities', label: 'Community involvement and leadership', type: 'activities', rows: 3,
      hint: 'Clubs, prefect roles, faith or youth groups, volunteering. Optional, but it counts for 10% of your score.' },
  ] },
  { id: 'referees', title: 'Your referees', section: 'H', intro: 'Give two people who are not relatives: one teacher or principal, and one community leader such as a chief or religious leader.', fields: [
    { id: 'referees', label: 'Referees', type: 'referees' },
  ] },
  { id: 'documents', title: 'Your documents', section: 'I', intro: 'Take a clear photo of each document in good light, or choose a PDF. Each file is uploaded straight away, so you can continue later.', fields: [
    { id: 'documents', label: 'Documents', type: 'documents' },
  ] },
  { id: 'review', title: 'Check and submit', section: 'J', fields: [
    { id: 'review', type: 'review' },
  ] },
];

// Flat list of simple fields (for review screens and Excel export)
export const SIMPLE_FIELDS = STEPS.flatMap((s) => s.fields.filter((f) =>
  !['results', 'costs', 'activities', 'referees', 'documents', 'review'].includes(f.type)).map((f) => ({ ...f, step: s })));

export function costTotals(costs = []) {
  const t = { total: 0, covered: 0, requested: 0 };
  costs.forEach((c) => { t.total += num(c.total); t.covered += num(c.covered); t.requested += num(c.requested); });
  return t;
}

// Answer as display text
export function answerText(f, d) {
  const v = d[f.id];
  if (Array.isArray(v)) return v.join(', ');
  if (f.type === 'date' && v) return fmtDate(v);
  return v === undefined || v === null ? '' : String(v);
}

// HTML summary of a whole application (used by the applicant review step and the admin dashboard)
export function applicationSummaryHTML(d, opts = {}) {
  const edit = (step) => opts.editable ? `<button type="button" class="link" data-goto="${step}">Edit</button>` : '';
  let h = '';
  STEPS.forEach((s, i) => {
    if (s.id === 'review' || s.id === 'documents') return;
    const rows = [];
    s.fields.forEach((f) => {
      if (f.showIf && !f.showIf(d)) return;
      if (f.type === 'results') {
        const r = (d.results || []).filter((x) => x && (x.subject || x.grade));
        rows.push(`<div class="sum-row"><dt>${esc(f.label)}</dt><dd>${r.length ? r.map((x) => `${esc(x.subject)} <b>${esc(x.grade)}</b>`).join('; ') : '<span class="muted">None entered</span>'}</dd></div>`);
      } else if (f.type === 'costs') {
        const t = costTotals(d.costs);
        rows.push(`<div class="sum-row wide"><dt>${esc(f.label)}</dt><dd><table class="mini"><thead><tr><th>Item</th><th>Total</th><th>Already covered</th><th>Requested</th></tr></thead><tbody>${
          (d.costs || []).filter((c) => num(c.total) || num(c.requested)).map((c) => `<tr><td>${esc(c.label || c.item)}${c.covered_source ? `<br><small class="muted">covered by ${esc(c.covered_source)}</small>` : ''}</td><td>${nle(num(c.total))}</td><td>${nle(num(c.covered))}</td><td>${nle(num(c.requested))}</td></tr>`).join('')
        }<tr class="tot"><td>Total</td><td>${nle(t.total)}</td><td>${nle(t.covered)}</td><td>${nle(t.requested)}</td></tr></tbody></table></dd></div>`);
      } else if (f.type === 'activities') {
        const a = (d.activities || []).filter((x) => x && (x.role || x.org));
        rows.push(`<div class="sum-row wide"><dt>${esc(f.label)}</dt><dd>${a.length ? '<ul class="plain">' + a.map((x) => `<li><b>${esc(x.role)}</b>${x.org ? ', ' + esc(x.org) : ''}${x.period ? ` (${esc(x.period)})` : ''}${x.achieved ? ` — ${esc(x.achieved)}` : ''}</li>`).join('') + '</ul>' : '<span class="muted">None entered</span>'}</dd></div>`);
      } else if (f.type === 'referees') {
        (d.referees || []).forEach((r, k) => rows.push(`<div class="sum-row"><dt>${k === 0 ? 'Academic referee' : 'Community referee'}</dt><dd>${r && r.name ? `${esc(r.name)}, ${esc(r.position || '')}<br>${esc(r.phone || '')} ${esc(r.email || '')}` : '<span class="muted">Not given</span>'}</dd></div>`));
      } else if (f.type === 'textarea') {
        rows.push(`<div class="sum-row wide"><dt>${esc(f.label)}${f.maxWords ? ` <small class="muted">(${wordCount(d[f.id])} words)</small>` : ''}</dt><dd class="prose">${esc(answerText(f, d)) || '<span class="muted">—</span>'}</dd></div>`);
      } else {
        rows.push(`<div class="sum-row"><dt>${esc(f.label)}</dt><dd>${esc(answerText(f, d)) || '<span class="muted">—</span>'}</dd></div>`);
      }
    });
    h += `<section class="sum-section"><header><h3><span class="sec">${esc(s.section)}</span> ${esc(s.title)}</h3>${edit(i)}</header><dl>${rows.join('')}</dl></section>`;
  });
  return h;
}
