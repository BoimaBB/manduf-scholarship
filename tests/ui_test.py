"""End-to-end UI test against the in-browser mock backend.

Run:  python3 tests/ui_test.py   (needs Python Playwright + Chromium)
Screenshots are written to tests/shots/.
"""
import http.server, threading, functools, os, sys, io
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'tests' / 'shots'; SHOTS.mkdir(exist_ok=True)
FILES = ROOT / 'tests' / 'files'; FILES.mkdir(exist_ok=True)

# sample documents
from PIL import Image, ImageDraw
for name, colour in [('letter.jpg', '#ffffff'), ('slip.jpg', '#f4f4f4'), ('id.jpg', '#dfe9f5'), ('photo.jpg', '#c9a27e')]:
    im = Image.new('RGB', (2400, 1800), colour); ImageDraw.Draw(im).text((100, 100), name, fill='black'); im.save(FILES / name, quality=90)
(FILES / 'fees.pdf').write_bytes(b'%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
(FILES / 'notes.txt').write_text('not allowed')

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
class Quiet(handler.func):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:8765'

MOCK = (ROOT / 'tests' / 'mock-supabase.js').read_text()
XLSX_MOCK = """export const utils = { book_new: () => ({ sheets: {} }), json_to_sheet: (rows) => ({ rows }),
  book_append_sheet: (wb, ws, name) => { wb.sheets[name] = ws.rows; } };
export function writeFile(wb, name) { window.__xlsx = { name, sheets: wb.sheets }; }"""
CONFIG = "window.MANDUF_CONFIG = { supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'test' };"

errors = []
def wire(page):
    page.route('**/supabase-js@2/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=MOCK))
    page.route('https://cdn.sheetjs.com/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=XLSX_MOCK))
    page.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    page.route('https://fonts.gstatic.com/**', lambda r: r.abort())
    page.route('**/assets/config.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=CONFIG))
    page.on('pageerror', lambda e: errors.append(f'{page.url}: {e}'))
    page.on('dialog', lambda d: d.accept())

def ok(msg): print('  PASS:', msg)

with sync_playwright() as p:
    browser = p.chromium.launch()
    # ================= applicant on a phone =================
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page(); wire(page)
    page.goto(BASE + '/index.html')
    expect(page.get_by_role('heading', name='Apply for a ManDuF scholarship')).to_be_visible()
    page.screenshot(path=SHOTS / '01-intro.png', full_page=True)

    # continuing student is turned away
    page.locator('[data-q=year_one] label', has_text='No').click()
    page.locator('[data-q=has_admission_letter] label', has_text='Yes').click()
    page.locator('[data-q=from_mandu] label', has_text='Yes').click()
    page.get_by_role('button', name='Start my application').click()
    expect(page.get_by_text('Continuing students are not eligible')).to_be_visible(); ok('non-Year-One applicant is turned away')
    page.locator('[data-q=year_one] label', has_text='Yes').click()
    page.get_by_role('button', name='Start my application').click()

    # step 1: validation then fill
    page.get_by_role('button', name='Save and continue').click()
    assert page.locator('.field.invalid').count() >= 8; ok('required fields flagged on step 1')
    page.screenshot(path=SHOTS / '02-validation.png')
    fill = lambda lab, v: page.get_by_label(lab).fill(v)
    fill('Surname (family name)', 'Kamara'); fill('First name(s)', 'Fatmata Isha')
    page.locator('[data-field=gender] label', has_text='Female').click()
    fill('Date of birth', '2007-03-14'); fill('National ID (NIN) or passport number', 'SL123456')
    fill('Mobile phone', '076 123 456'); page.locator('[data-field=whatsapp] label', has_text='Yes').click()
    fill('Hometown or village', 'Mobai'); fill('Section in Mandu Chiefdom', 'Bombohun'); fill('Where you live now', 'Mobai, Mandu Chiefdom')
    page.locator('[data-field=disability] label', has_text='No').click()
    page.get_by_role('button', name='Save and continue').click()

    # step 2 family
    expect(page.get_by_role('heading', name='B Your family')).to_be_visible()
    fill('Parent or guardian’s full name', 'Musa Kamara'); fill('Relationship to you', 'Father'); fill('Their occupation', 'Farmer'); fill('Their phone number', '077 222 333')
    page.locator('[data-field=parent_status] label', has_text='Mother deceased').click()
    page.get_by_role('button', name='Save and continue').click()

    # reload: draft survives
    page.reload()
    expect(page.get_by_role('heading', name='C Your admission')).to_be_visible(); ok('draft restored after reload at step 3')

    # step 3 admission
    fill('University or institution', 'Njala University'); fill('Faculty / department', 'Nursing'); fill('Programme of study', 'BSc Nursing')
    page.locator('[data-field=level] label', has_text="Bachelor's").click()
    fill('Admission number', 'NU/26/0412'); fill('Date on the admission letter', '2026-09-01')
    page.locator('[data-field=mode] label', has_text='Full-time').click(); fill('Programme length (years)', '4')
    page.get_by_role('button', name='Save and continue').click()

    # step 4 results
    fill('Secondary school attended', 'Ahmadiyya Secondary School, Kailahun'); fill('Year completed', '2025'); fill('WASSCE index number', '4250123456')
    page.locator('[data-field=sittings] label', has_text='One').click()
    for i, (s, g) in enumerate([('English Language', 'B3'), ('Mathematics', 'C4'), ('Biology', 'B2'), ('Chemistry', 'C5'), ('Physics', 'C6')]):
        page.get_by_label(f'Subject {i + 1}', exact=True).fill(s); page.get_by_label(f'Grade for subject {i + 1}').select_option(g)
    page.get_by_role('button', name='Save and continue').click()

    # step 5 finance — requested auto-calculated
    page.locator('#c0t').fill('6000000'); page.locator('#c0c').fill('1000000')
    assert page.locator('#c0r').input_value() == '5000000'; ok('requested = total − covered, calculated automatically')
    page.get_by_placeholder('Who is covering this part?').first.fill('Uncle in Kenema')
    page.locator('#c1t').fill('450000')
    expect(page.locator('#cost-totals b')).to_have_text('NLe 5,450,000'); ok('total requested shown: NLe 5,450,000')
    assert page.get_by_text('Accommodation').count() >= 1  # only the "not covered" note
    fill('Who will pay the rest of your costs?', 'My uncle')
    page.locator('[data-field=income_source] label', has_text='Farming').click()
    fill('Estimated household income per month (NLe)', '1500'); fill('People in your household', '7'); fill('Of these, how many are in school or college?', '4')
    page.locator('[data-field=other_support] label', has_text='None').click()
    fill('Briefly explain the financial difficulties your household faces', 'My father farms rice and cocoa. My mother died in 2022. Four of us are in school.')
    page.screenshot(path=SHOTS / '03-finance.png', full_page=True)
    page.get_by_role('button', name='Save and continue').click()

    # step 6 statement with word limit
    page.get_by_label('Personal statement').fill('word ' * 510)
    expect(page.locator('#c-statement')).to_have_class('counter over')
    page.get_by_role('button', name='Save and continue').click()
    expect(page.get_by_text('Shorten this to 500 words or fewer.')).to_be_visible(); ok('500-word limit enforced')
    page.get_by_label('Personal statement').fill('I grew up in Mobai in Mandu Chiefdom. ' * 20)
    page.locator('#a0r').fill('School prefect'); page.locator('#a0o').fill('Ahmadiyya Secondary School')
    page.get_by_role('button', name='Save and continue').click()

    # step 7 referees
    for i, (n, pos, ph) in enumerate([('Mr Sahr Lebbie', 'Principal, Ahmadiyya SS', '078 111 222'), ('Chief Momoh Kanneh', 'Section Chief, Bombohun', '079 333 444')]):
        page.locator(f'#r{i}n').fill(n); page.locator(f'#r{i}p').fill(pos); page.locator(f'#r{i}t').fill(ph)
    page.get_by_role('button', name='Save and continue').click()

    # step 8 documents
    page.get_by_role('button', name='Save and continue').click()
    expect(page.locator('#e-documents')).to_contain_text('Upload:'); ok('missing documents blocked')
    page.locator('[data-upload=admission_letter]').set_input_files(str(FILES / 'notes.txt'))
    expect(page.locator('[data-doc=admission_letter]')).to_have_class('doc failed'); ok('wrong file type rejected')
    for key, f in [('admission_letter', 'letter.jpg'), ('wassce_slip', 'slip.jpg'), ('fee_structure', 'fees.pdf'), ('id_document', 'id.jpg'), ('photo', 'photo.jpg')]:
        page.locator(f'[data-upload={key}]').set_input_files(str(FILES / f))
        expect(page.locator(f'[data-doc={key}]')).to_have_class('doc done', timeout=8000)
    size = page.evaluate("JSON.parse(localStorage.__mockdb).objects")
    big = [v['size'] for k, v in size.items() if 'letter' in k or 'admission' in k]
    assert max(big) < 400_000, big; ok(f'2400×1800 photo shrunk before upload ({max(big)//1024} KB)')
    page.screenshot(path=SHOTS / '04-documents.png', full_page=True)
    page.get_by_role('button', name='Save and continue').click()

    # step 9 review & submit
    expect(page.get_by_role('heading', name='J Check and submit')).to_be_visible()
    page.get_by_role('button', name='Submit application').click()
    expect(page.get_by_text('Tick to confirm the declaration.')).to_be_visible(); ok('declaration required')
    page.locator('[data-path=declaration]').check(); page.locator('[data-path=guardian_consent]').check()
    page.get_by_label('Type your full name as your signature').fill('Fatmata Isha Kamara')
    page.screenshot(path=SHOTS / '05-review.png', full_page=True)
    page.get_by_role('button', name='Submit application').click()
    expect(page.get_by_role('heading', name='Application submitted')).to_be_visible()
    expect(page.locator('.codebox')).to_contain_text('MDF-2026-0001'); expect(page.locator('.codebox')).to_contain_text('K7P2QX')
    ok('submitted: MDF-2026-0001 / K7P2QX'); page.screenshot(path=SHOTS / '06-receipt.png', full_page=True)

    # status page
    page.get_by_role('link', name='Check my status').click()
    page.get_by_role('button', name='Check status').click()
    expect(page.locator('.status-card')).to_contain_text('Received'); ok('status page shows Received')
    page.locator('#code').fill('WRONG1'); page.get_by_role('button', name='Check status').click()
    expect(page.get_by_text('No application found.')).to_be_visible(); ok('wrong access code refused')
    ctx_storage = ctx.storage_state()

    # ================= admin on a desktop =================
    actx = browser.new_context(viewport={'width': 1440, 'height': 900}, storage_state=ctx_storage, accept_downloads=True)
    a = actx.new_page(); wire(a)
    a.goto(BASE + '/admin.html')
    a.get_by_label('Email').fill('admin@manduf.org'); a.get_by_label('Password').fill('wrong'); a.get_by_role('button', name='Sign in').click()
    expect(a.get_by_text('Wrong email or password.')).to_be_visible(); ok('bad password refused')
    a.get_by_label('Email').fill('admin@manduf.org'); a.get_by_label('Password').fill('password123'); a.get_by_role('button', name='Sign in').click()
    expect(a.locator('table.data')).to_contain_text('Fatmata Isha KAMARA'); ok('admin sees the new application')
    a.screenshot(path=SHOTS / '07-admin-list.png')
    a.locator('table.data tbody tr').first.click()
    expect(a.locator('.docgrid a')).to_have_count(5)
    a.screenshot(path=SHOTS / '08-admin-detail.png')

    # score
    a.locator('.ptabs button', has_text='Score').click()
    for k, v in [('financial_need', '9'), ('academic_merit', '7'), ('personal_statement', '8'), ('leadership', '6')]:
        a.locator(f'#scoreform [name={k}]').fill(v)
    expect(a.locator('#wt')).to_have_text('79'); ok('live weighted score 9×4+7×3+8×2+6 = 79')
    a.get_by_role('button', name='Save my score').click()
    expect(a.locator('.ptabs ~ .pbody')).to_contain_text('Average 79')
    a.screenshot(path=SHOTS / '09-admin-score.png')

    # review & award
    a.locator('.ptabs button', has_text='Review').click()
    for k in ['screen_form_complete', 'screen_docs_complete', 'screen_year_one', 'screen_origin']:
        a.locator(f'#review [name={k}]').check()
    a.locator('#review [value=eligible]').check()
    a.locator('#status').select_option('awarded')
    a.locator('#amount_awarded').fill('5000000'); a.locator('#review [value=Tuition]').check(); a.locator('#award_period').select_option('renewable')
    a.locator('#public_message').fill('Please visit the Foundation office in Daru with your ID before 30 November.')
    a.get_by_role('button', name='Save review').click()
    expect(a.locator('#dpill')).to_contain_text('Awarded'); ok('award saved')

    # notify
    a.locator('.ptabs button', has_text='Notify').click()
    expect(a.locator('#msg')).to_have_value(__import__('re').compile('Congratulations Fatmata'))
    href = a.locator('#wa').get_attribute('href'); assert href.startswith('https://wa.me/23276123456?text='), href; ok('WhatsApp link uses +232 number')
    a.screenshot(path=SHOTS / '10-admin-notify.png')

    # ranking, export, settings, staff
    a.get_by_role('link', name='Ranking').click(); a.locator('#budget').fill('6000000')
    expect(a.locator('#bsum')).to_contain_text('top 1 applicant'); ok('ranking + budget line')
    a.get_by_role('link', name='Applications').click(); a.get_by_role('button', name='Export to Excel').click()
    a.wait_for_function('window.__xlsx'); x = a.evaluate('window.__xlsx')
    row = x['sheets']['Applications'][0]
    assert row['Average score (/100)'] == 79 and row['Amount awarded (NLe)'] == 5000000 and 'Nationality' not in row, row
    assert not any('ccommodation' in k for k in row), 'accommodation column found'
    ok(f"Excel export: {len(row)} columns, scores sheet rows = {len(x['sheets']['Scores'])}")
    a.get_by_role('link', name='Staff').click()
    a.get_by_label('Full name').fill('Assessor Two'); a.get_by_label('Login email').fill('assessor@manduf.org'); a.get_by_role('button', name='Add staff member').click()
    expect(a.locator('table.data')).to_contain_text('Assessor Two'); ok('staff member added')
    a.get_by_role('link', name='Settings').click()
    a.get_by_label('Closing date').fill('2026-11-30'); a.get_by_role('button', name='Save settings').click()
    expect(a.get_by_text('Settings saved')).to_be_visible(); ok('settings saved')
    a.screenshot(path=SHOTS / '11-admin-settings.png')

    # assessor cannot decide
    a.get_by_role('button', name='Sign out').click()
    a.get_by_label('Email').fill('assessor@manduf.org'); a.get_by_label('Password').fill('password123'); a.get_by_role('button', name='Sign in').click()
    expect(a.locator('.topbar nav')).not_to_contain_text('Settings')
    a.locator('table.data tbody tr').first.click()
    expect(a.locator('#status')).to_be_disabled(); assert a.locator('.ptabs button', has_text='Notify').count() == 0; ok('assessor: review read-only, no Notify/Settings')

    # applicant sees the award
    page = actx.new_page(); wire(page); page.set_viewport_size({'width': 390, 'height': 844})
    page.goto(BASE + '/status.html'); page.get_by_role('button', name='Check status').click()
    expect(page.locator('.status-card')).to_contain_text('Awarded'); expect(page.locator('.status-card')).to_contain_text('NLe 5,000,000')
    ok('applicant status shows award and message'); page.screenshot(path=SHOTS / '12-status-awarded.png', full_page=True)

    browser.close()
srv.shutdown()
if errors:
    print('PAGE ERRORS:', *errors, sep='\n  '); sys.exit(1)
print('ALL UI TESTS PASSED')
