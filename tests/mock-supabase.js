// In-browser stand-in for supabase-js used only by the UI tests.
// Data lives in localStorage so the applicant and admin pages share it.
const KEY = '__mockdb';
const load = () => JSON.parse(localStorage.getItem(KEY) || 'null') || seed();
const save = (db) => localStorage.setItem(KEY, JSON.stringify(db));
function seed() {
  const db = {
    settings: [{ id: 1, academic_year: '2026/2027', applications_open: true, closing_date: null, submit_note: null, contact_phone: '076 000 000', contact_email: 'info@manduf.org' }],
    users: [{ id: 'u-admin', email: 'admin@manduf.org', password: 'password123' }, { id: 'u-ass', email: 'assessor@manduf.org', password: 'password123' }],
    staff: [{ user_id: 'u-admin', email: 'admin@manduf.org', full_name: 'Admin One', role: 'admin' }],
    applications: [], scores: [], objects: {}, seq: 0, session: null,
  };
  save(db); return db;
}
const ok = (data) => ({ data, error: null });
const fail = (message) => ({ data: null, error: { message } });

function overview(db) {
  return db.applications.map((a) => {
    const s = db.scores.filter((x) => x.application_id === a.id && x.weighted_total != null);
    const avg = (k) => s.length ? Math.round(s.reduce((t, x) => t + Number(x[k]), 0) / s.length * 10) / 10 : null;
    return { ...a, n_scores: s.length, avg_score: avg('weighted_total'), avg_need: avg('financial_need'), avg_merit: avg('academic_merit'), avg_statement: avg('personal_statement'), avg_leadership: avg('leadership') };
  });
}

class Query {
  constructor(table) { this.table = table; this.filters = []; this.op = 'select'; this.one = null; this.orderBy = null; }
  select() { if (this.op === 'select') this.op = 'select'; else this.returning = true; return this; }
  eq(c, v) { this.filters.push([c, v]); return this; }
  order(c, o = {}) { this.orderBy = [c, o.ascending === false ? -1 : 1]; return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  update(p) { this.op = 'update'; this.patch = p; return this; }
  upsert(r) { this.op = 'upsert'; this.row = r; return this; }
  delete() { this.op = 'delete'; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
  run() {
    const db = load();
    const me = db.session?.user?.id;
    const staff = db.staff.find((s) => s.user_id === me);
    const t = this.table;
    if (t !== 'settings' && !staff) return t === 'staff' ? ok(this.one ? null : []) : fail('permission denied for table ' + t);
    let rows = t === 'application_overview' ? overview(db) : db[t];
    const match = (r) => this.filters.every(([c, v]) => r[c] === v);
    let out;
    if (this.op === 'select') out = rows.filter(match);
    else if (this.op === 'update') {
      if (t !== 'scores' && t !== 'staff' && staff.role !== 'admin') return ok([]);
      out = rows.filter(match); out.forEach((r) => Object.assign(r, this.patch, { updated_at: new Date().toISOString() }));
      if (t === 'applications') out.forEach((r) => { if (['awarded', 'waitlisted', 'not_awarded', 'ineligible'].includes(this.patch.status)) { r.decided_at = new Date().toISOString(); r.decided_by = me; } });
    } else if (this.op === 'upsert') {
      const r = { ...this.row };
      if (t === 'scores') {
        if (r.assessor_id !== me) return fail('new row violates row-level security policy');
        r.weighted_total = r.financial_need * 4 + r.academic_merit * 3 + r.personal_statement * 2 + r.leadership;
        const i = rows.findIndex((x) => x.application_id === r.application_id && x.assessor_id === r.assessor_id);
        i >= 0 ? (rows[i] = r) : rows.push(r);
      }
      out = [r];
    } else if (this.op === 'delete') {
      db[t] = rows.filter((r) => !match(r)); out = [];
      if (t === 'staff') db.scores = db.scores.filter((s) => db.staff.some((x) => x.user_id === s.assessor_id));
    }
    save(db);
    if (this.orderBy) { const [c, d] = this.orderBy; out = [...out].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * d); }
    out = JSON.parse(JSON.stringify(out));
    if (this.one === 'single') return out.length === 1 ? ok(out[0]) : fail('JSON object requested, multiple (or no) rows returned');
    if (this.one === 'maybe') return ok(out[0] || null);
    return ok(out);
  }
}

const enc = (s) => Array.from(s).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16);

async function rpc(name, a) {
  await new Promise((r) => setTimeout(r, 60));
  const db = load();
  if (name === 'submit_application') {
    const f = a.p_form; const s = db.settings[0];
    if (!s.applications_open) return fail('Applications are closed.');
    if (db.applications.some((x) => x.id === a.p_id)) return fail('This application has already been submitted.');
    if (f.year_one !== 'yes' || f.has_admission_letter !== 'yes') return fail('Only students entering Year One with an admission letter may apply.');
    for (const k of ['admission_letter', 'wassce_slip', 'fee_structure', 'id_document', 'photo']) {
      if (!(f.documents || []).some((d) => d.key === k && db.objects[d.path])) return fail('Required document missing: ' + k);
    }
    db.seq++;
    const app_no = `MDF-${s.academic_year.slice(0, 4)}-${String(db.seq).padStart(4, '0')}`;
    const code = 'K7P2QX';
    db.applications.push({ id: a.p_id, app_no, access_code_hash: enc(code + a.p_id), academic_year: s.academic_year, submitted_at: new Date().toISOString(),
      full_name: `${f.first_names} ${f.other_names || ''} ${f.surname.toUpperCase()}`.replace(/\s+/g, ' ').trim(), gender: f.gender, mobile: f.mobile, email: f.email || null, nin: f.nin,
      section: f.section, institution: f.institution, programme: f.programme, level: f.level,
      amount_requested: (f.costs || []).reduce((t, c) => t + (parseFloat(c.requested) || 0), 0), form: f,
      documents: f.documents.map((d) => ({ ...d, size: db.objects[d.path].size, mime: db.objects[d.path].mime })),
      status: 'submitted', screen_form_complete: false, screen_docs_complete: false, screen_year_one: false, screen_origin: false,
      eligibility: null, amount_awarded: null, award_covers: null, award_period: null, public_message: null, internal_notes: null, updated_at: new Date().toISOString() });
    save(db);
    return ok([{ app_no, access_code: code }]);
  }
  if (name === 'check_status') {
    const r = db.applications.find((x) => x.app_no === a.p_app_no.trim().toUpperCase() && x.access_code_hash === enc(a.p_code.trim().toUpperCase() + x.id));
    return ok(r ? [{ app_no: r.app_no, first_name: r.form.first_names.split(' ')[0], status: r.status, public_message: r.public_message,
      amount_awarded: r.status === 'awarded' ? r.amount_awarded : null, submitted_at: r.submitted_at, updated_at: r.updated_at }] : []);
  }
  if (name === 'add_staff') {
    const me = db.staff.find((s) => s.user_id === db.session?.user?.id);
    if (me?.role !== 'admin') return fail('Only admins can add staff.');
    const u = db.users.find((x) => x.email === a.p_email.toLowerCase());
    if (!u) return fail(`No login exists for ${a.p_email}. Create or invite the user in Supabase first.`);
    db.staff = db.staff.filter((s) => s.user_id !== u.id).concat({ user_id: u.id, email: u.email, full_name: a.p_full_name, role: a.p_role });
    save(db); return ok(null);
  }
  return fail('unknown rpc ' + name);
}

const files = {};
export function createClient() {
  return {
    from: (t) => new Query(t),
    rpc: (n, a) => ({ then: (res, rej) => rpc(n, a).then(res, rej) }),
    auth: {
      async getSession() { return ok({ session: load().session }); },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithPassword({ email, password }) {
        const db = load(); const u = db.users.find((x) => x.email === email && x.password === password);
        if (!u) return fail('Invalid login credentials');
        db.session = { user: { id: u.id, email: u.email } }; save(db); return ok({ session: db.session });
      },
      async signOut() { const db = load(); db.session = null; save(db); return ok(null); },
      async updateUser() { return ok({}); },
      async resetPasswordForEmail() { return ok({}); },
    },
    storage: {
      from: () => ({
        async upload(path, blob, opts) {
          await new Promise((r) => setTimeout(r, 120));
          const db = load(); const folder = path.split('/')[0];
          if (db.applications.some((a) => a.id === folder)) return fail('new row violates row-level security policy');
          if (blob.size > 5 * 1024 * 1024) return fail('The object exceeded the maximum allowed size');
          db.objects[path] = { size: blob.size, mime: opts.contentType }; save(db);
          const reader = new FileReader();
          await new Promise((r) => { reader.onload = r; reader.readAsDataURL(blob); });
          try { sessionStorage.setItem('obj:' + path, reader.result); } catch { /* ignore */ }
          return ok({ path });
        },
        async createSignedUrls(paths) {
          return ok(paths.map((p) => ({ path: p, signedUrl: localStorage.getItem('url:' + p) || 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#e4f0f1"/><text x="20" y="105" font-size="18" fill="#0f5f6b">document</text></svg>') })));
        },
      }),
    },
  };
}
