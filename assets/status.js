// Applicant status lookup by application number + access code.
import { sb, configured, $, esc, nle, fmtDate, errText, STATUS } from './common.js';

const out = $('#result');
const params = new URLSearchParams(location.search);
try {
  const saved = JSON.parse(localStorage.getItem('manduf-receipt-v1') || 'null');
  $('#app').value = params.get('app') || saved?.app_no || '';
  if (saved && saved.app_no === $('#app').value) $('#code').value = saved.code || '';
} catch { /* ignore */ }

$('#lookup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const app = $('#app').value.trim(); const code = $('#code').value.trim();
  if (!app || !code) { out.innerHTML = '<div class="notice bad">Enter both your application number and access code.</div>'; return; }
  if (!configured) { out.innerHTML = '<div class="notice bad">This portal is not connected yet.</div>'; return; }
  const btn = $('#lookup button'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Checking…';
  try {
    const { data, error } = await sb.rpc('check_status', { p_app_no: app, p_code: code });
    if (error) throw error;
    const r = Array.isArray(data) ? data[0] : data;
    if (!r) {
      out.innerHTML = '<div class="notice bad"><b>No application found.</b><br>Check the application number and access code exactly as shown on your receipt. If you have lost your access code, contact the Foundation office.</div>';
    } else {
      const s = STATUS[r.status] || { label: r.status, tone: 'neutral', text: '' };
      out.innerHTML = `<div class="status-card ${s.tone}">
        <span class="pill ${s.tone}">${esc(s.label)}</span>
        <h2>${r.first_name ? `${esc(r.first_name)}, ` : ''}${esc(s.text.charAt(0).toLowerCase() + s.text.slice(1))}</h2>
        ${r.amount_awarded ? `<p><b>Amount awarded: ${esc(nle(r.amount_awarded))}</b></p>` : ''}
        ${r.public_message ? `<div class="notice"><b>Message from the Foundation</b><br>${esc(r.public_message)}</div>` : ''}
        <p class="small muted">Application ${esc(r.app_no)}, submitted ${esc(fmtDate(r.submitted_at))}. Last updated ${esc(fmtDate(r.updated_at))}.</p>
      </div>`;
    }
  } catch (err) {
    out.innerHTML = `<div class="notice bad">${esc(errText(err))}</div>`;
  } finally { btn.disabled = false; btn.textContent = 'Check status'; }
});
