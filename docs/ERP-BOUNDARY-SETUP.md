# ERP Boundary Setup Guide

**How to connect the standalone radiology service to your ERP for patient data.**

---

## What this does

Lets the standalone fetch patient demographics, referring doctor, clinical
history, and bill status from your ERP — by matching the accession number.
The ERP is never modified; the boundary is additive and read-only.

---

## Step 1 — Pull the latest ERP code

The boundary route is committed to the `feature/website-login-redirection`
branch on your ERP repo:

```bash
cd /volume1/docker/care-on-synology1   # (or wherever your ERP is)
git pull origin feature/website-login-redirection
```

This brings in:
- `artifacts/api-server/src/routes/boundary.ts` (the 8 endpoints)
- `routes/index.ts` (registration — 2 lines)
- `Layout.tsx` (the "Radiology Cockpit" sidebar button — optional)
- `docker-compose.yml` (radiology-db + radiology services — optional, only
  if you want the federated monorepo version too)

## Step 2 — Set the boundary API key

Generate a shared secret:
```bash
openssl rand -hex 32
# copy the output
```

Add to your ERP's `.env`:
```env
BOUNDARY_API_KEY=<paste-the-output-here>
```

## Step 3 — Set the same key in the standalone's `.env`

```env
ERP_API_URL=http://<nas-ip>:<erp-port>
BOUNDARY_API_KEY=<same-key-as-above>
```

## Step 4 — Rebuild the ERP API

```bash
docker compose up -d --build api
```

## Step 5 — Verify

```bash
# From your laptop, test the boundary (replace with your values):
curl -H "X-Boundary-Key: <your-key>" \
     http://<nas-ip>:<erp-port>/api/boundary/studies?modality=MR&status=acquired

# Should return JSON: { "studies": [...] }
```

Then open the standalone worklist — each study should now show:
- ✓ Proper patient name (from ERP, not DICOM format)
- ✓ Age / Sex (from ERP registration)
- ✓ Referring doctor
- ✓ Study name (ordered test name)
- ✓ Bill status badge
- ✓ "✓ ERP data linked" indicator in the cockpit

---

## What the boundary reads from the ERP

Only these tables (all NON-radiology — they stay when you remove ERP reporting):

| Table | What it provides |
|-------|-----------------|
| `patients` | Name, age, sex, phone, DOB |
| `radiology_studies` | Accession number, modality, body part, status, priority |
| `orders` + `order_tests` | Ordered study name |
| `bills` | Bill status (paid/pending) |

**It does NOT read or depend on:**
- The ERP's reporting cockpit / workspace
- The ERP's ~20 radiology-AI tables
- The ERP's report templates / snippets / quick-findings
- Any accounting or billing mutation logic

This is why it's safe to remove ERP radiology reporting later — the boundary
only reads patient/order/bill data, which stays.

---

## What the boundary writes back (optional)

When you finalize a report in the standalone:

```
POST /api/boundary/studies/ACC-123/report
{ "finalReportText": "...", "reportedBy": "Dr. Abinash Kumar", ... }
```

This stores the report text in `radiology_studies.finalReport` — the same
column the ERP's own reporting used. So the ERP's existing:
- Print screen
- Delivery tracking
- Patient portal
- WhatsApp delivery

...all keep working without any changes.

When you mark a study as delivered:
```
POST /api/boundary/studies/ACC-123/deliver
```
This logs the print issuance in `radiology_film_issues` and sets the study
status to `delivered`.

---

## If the ERP is down

The standalone keeps working with Orthanc data only:
- Worklist shows DICOM patient names (instead of ERP names)
- No referring doctor or clinical history
- No bill status
- Finalize still works (stores locally)
- Delivery push fails silently (retry later)

When the ERP comes back, enrichment resumes automatically.
