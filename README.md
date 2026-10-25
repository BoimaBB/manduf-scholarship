# ManDuF Scholarship Portal

Online application and review system for the **Mandu Foundation (ManDuF) Scholarship** — Year One entrants from Mandu Chiefdom, Kailahun District.

| Page | Who uses it | What it does |
|---|---|---|
| `index.html` | Applicants (phone) | Eligibility check, 9-step form (sections A–J of the paper form), autosave, document upload, receipt with application number + access code |
| `status.html` | Applicants | Check status with application number + access code; see the Foundation's message and any award |
| `admin.html` | Staff (computer) | Login; list, search, filter; documents; screening & eligibility; rubric scoring by each assessor; ranking with budget line; decisions & awards; WhatsApp/SMS/email messages; Excel export; print/PDF; settings; staff |

The rules match the 5-page form: only Year One entrants with an admission letter, no nationality question, accommodation not covered, rubric 40/30/20/10.

## How it is built

- **Front end:** plain HTML, CSS and JavaScript, with no build step. It can be hosted free on GitHub Pages.
- **Back end:** [Supabase](https://supabase.com). This provides the Postgres database, file storage for documents, and staff logins. All access rules are enforced inside the database (row-level security):
  - Applicants have no login. They can only submit through `submit_application()` and read their own status through `check_status()`.
  - Applicants can add files to their own unsubmitted application folder. They cannot read, list or replace anything.
  - Assessors can read applications and documents. They can score, and edit only their own scores.
  - Admins can also screen, decide, notify, change settings and manage staff.
- **Access codes:** stored only as a hash.
- **Applications:** one application per National ID per academic year.
- **Low bandwidth:** photos are shrunk on the phone to about 1600 px before upload (a 3 MB camera photo becomes roughly 200–400 KB). Drafts are saved on the phone, so an applicant can stop and continue later.

## Set up (about 30 minutes)

### 1. Create the Supabase project
1. Sign up at supabase.com and create a new project (free plan). Choose a strong database password and keep it safe.
2. Open **SQL Editor → New query**, paste the whole of `supabase/schema.sql`, and click **Run**.
3. Make yourself the first admin:
   - Go to **Authentication → Users → Add user → Create new user**. Enter your email and a password, and tick *Auto Confirm User*.
   - In the SQL Editor, run this (change the name and email):
     ```sql
     insert into public.staff (user_id, email, full_name, role)
     select id, email, 'Your Name', 'admin' from auth.users where email = 'you@example.com';
     ```
4. Recommended: under **Authentication → Sign In / Providers**, turn off *Allow new users to sign up*. Staff logins are then created only by you.

### 2. Connect the website
1. In Supabase open **Project Settings → API**. Copy the *Project URL* and the *anon public* key.
2. Put them in `assets/config.js`. The anon key is meant to be public; the database rules protect the data.

### 3. Publish on GitHub Pages
1. Push this folder to a GitHub repository (for example `BoimaBB/manduf-scholarship`).
2. In the repository go to **Settings → Pages**. Set Source to *Deploy from a branch*, Branch to `main`, and folder to `/ (root)`.
3. After about a minute the site is live at `https://<user>.github.io/<repo>/`:
   - Applicants use `…/index.html`.
   - Staff use `…/admin.html`.
4. In Supabase, go to **Authentication → URL Configuration**:
   - Set the *Site URL* to your Pages address.
   - Add `…/admin.html` to the *Redirect URLs*.

   Password-reset and invite emails then open the admin page.

### 4. Before opening applications
- Sign in to `admin.html`, open **Settings**, and set:
  - academic year
  - closing date
  - enquiry phone and email
  - any note for applicants
- Add assessors under **Staff**. Create each login in Supabase first (Authentication → Users), then add the person in the Staff page with the role *Assessor* or *Admin*.
- Submit one test application from your phone, check it in the dashboard, then delete it. To delete, open the SQL Editor and run `delete from applications where app_no = 'MDF-2026-0001';`, and remove its folder under Storage → documents.

## Everyday use
- **Screening:** open an application. Check the documents. Tick the screening boxes and set eligibility.
- **Scoring:** each assessor opens the **Score** tab and gives 0–10 per criterion. The weighted score (out of 100) and the average across assessors are calculated automatically.
- **Ranking:** shows scored, eligible applicants by average score. Enter the budget to see how far it reaches. The ranking guides the Committee; it does not decide.
- **Decisions:** set the status. For an award, enter the amount, what it covers and the award period. Write a *Message to applicant*; it appears on their status page.
- **Notify:** the **Notify** tab prepares the message. It opens WhatsApp, SMS or email on your own device with the text filled in. No paid SMS service is needed.
- **Export:** *Export to Excel* gives one sheet of all applications (every answer, screening, scores and decision) and one sheet of individual scores.
- **Close applications:** untick *Accept new applications* in Settings, or let the closing date pass.
- **New academic year:** change the academic year in Settings. New numbers then start with the new year, and last year's applications stay in the database.

## Limits to know
- **Free plan limits:** Supabase's free plan limits database size, storage and monthly use, and may pause projects that are inactive for a while. Check the current limits on supabase.com before the intake opens.
  - Each application uses about 1–2 MB of documents.
  - Upgrade to a paid plan if the intake is large or the portal must stay always on.
- **Editing after submission:** applicants cannot edit an application once submitted. Staff can record corrections in *Internal notes*, or ask the applicant to bring documents to the office.
- **Abandoned drafts:** files from drafts that are never submitted stay in storage. Admins can delete old folders under Storage → documents.
- **Lost access codes:** they cannot be recovered. Staff can look up the application number in the dashboard and give the status by phone.

## Tests
- `tests/run_db_tests.sh` runs the database rules on a throwaway local Postgres, with Supabase stand-ins. It needs PostgreSQL 15 or later installed.
- `tests/ui_test.py` drives the whole flow in a headless browser against an in-browser mock back end: apply, upload, submit, status, admin scoring, award, notify, export and the assessor's limits. It needs `pip install playwright pillow` and `playwright install chromium`.
