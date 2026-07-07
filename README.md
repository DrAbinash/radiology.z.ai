# Radiology Workstation — Standalone

**MRI / CT / USG / X-ray reporting for 2 users.** Pulls studies from Orthanc on your Synology NAS. Launches OHIF/Weasis on your laptop. AI-assisted via Ollama. Does NOT touch your ERP.

---

## Architecture

```
Synology NAS                          Your Laptop
┌──────────────────────┐              ┌──────────────────┐
│ Orthanc (:8042)      │◄──DICOM──── │ Weasis (desktop) │
│  (studies live here) │             │ OHIF (browser)   │
│                      │              └──────────────────┘
│ Radiology (:3002)    │◄──HTTP─────── (browser)
│  + Postgres (:5432)  │
│                      │              Windows PC
│  (ERP untouched)     │              ┌──────────────────┐
└──────────────────────┘──────HTTP───►│ Ollama (:11434)  │
                                      │  llama3.2 / etc  │
                                      └──────────────────┘
```

---

## Deploy in 6 Steps

### 1. Get the code on your NAS
```bash
ssh admin@<nas-ip>
cd /volume1/docker
git clone https://github.com/DrAbinash/radiology.z.ai.git radiology
cd radiology
cp .env.example .env
```

### 2. Edit `.env`
Set at minimum:
- `ORTHANC_URL` — your Orthanc address (e.g. `http://192.168.1.100:8042`)
- `DICOM_WEB_URL` — usually `<orthanc>/dicom-web`
- `RAD_DB_PASSWORD` — pick a strong password
- `ADMIN_PASSWORD` / `RADIOLOGIST_PASSWORD` — your login passwords

Leave `HTTPS_ENABLED=false` unless you've put a reverse proxy with a real
TLS certificate in front of this app. Accessing it as plain
`http://<nas-ip>:3002` (the normal case) requires this to stay `false`,
or login will not work.

### 3. Build & start
```bash
docker compose up -d --build
```

### 4. Create DB tables + users (one-time)
```bash
docker compose exec radiology sh -c "cd /app && npx drizzle-kit push --config drizzle.config.ts"
docker compose exec radiology sh -c "cd /app && npx tsx scripts/seed-defaults.ts"
```

### 5. Open it
Go to `http://<nas-ip>:3002` → log in with your username/password.

### 6. (Optional) Ollama AI on your Windows PC
```powershell
winget install Ollama.Ollama
ollama pull llama3.2
# Set System env: OLLAMA_HOST = 0.0.0.0:11434, restart Ollama
```
Then in the workstation: Settings (⚙️) → AI → set `OLLAMA_URL` → Test.

---

## Weasis (desktop viewer on your laptop)

1. Download from [weasis.org](https://weasis.org/en/getting-started/download/)
2. Install on your laptop
3. The `weasis://` protocol auto-registers — clicking "Weasis" in the worklist opens it
4. Weasis pulls images from Orthanc's DICOMweb endpoint

## OHIF (web viewer)

Leave `OHIF_URL` empty to use Orthanc's built-in viewer, or install OHIF separately.

---

## Keyboard shortcuts
| Key | Action |
|-----|--------|
| `/` | Search findings |
| `Ctrl+1-9` | Toggle study tab |
| `Alt+1-9` | Toggle finding button |
| `Alt+F` / `Alt+I` | Focus Findings / Impression |
| `Ctrl+S` | Save draft |
| `Ctrl+Enter` | Finalize & Sign |
| `Ctrl+P` | Print preview |

---

## Merge with ERP later (optional)

If you later want the ERP to own the reporting:
1. Set `ERP_API_URL` + `BOUNDARY_API_KEY` in `.env`
2. The "deliver" action pushes to the ERP boundary API
3. Eventually: move the radiology tables into the ERP Postgres, delete the boundary layer

The ERP is never modified by this standalone service.

---

## Backups

Your draft/finalized reports, protocols, and settings live in the Postgres
container, not in Orthanc. Back it up regularly:

```bash
chmod +x scripts/backup-db.sh   # one-time
./scripts/backup-db.sh
```

This writes a compressed dump to `./backups/`. Schedule it daily via
Synology's **Control Panel → Task Scheduler → Create → Scheduled Task →
User-defined script**, running `sh /volume1/docker/radiology/scripts/backup-db.sh`.

To restore:
```bash
gunzip -c backups/radiology-<date>.sql.gz | docker compose exec -T radiology-db \
  psql -U "$RAD_DB_USER" -d "$RAD_DB_NAME"
```

## Troubleshooting
| Problem | Fix |
|---------|-----|
| Can't log in | Run the seed script (step 4) |
| Worklist empty | Check `ORTHANC_URL` — Orthanc must be reachable from the container |
| Weasis doesn't open | Install Weasis on your laptop; the `weasis://` protocol must be registered |
| AI buttons fail | Check Ollama is running + `OLLAMA_URL` is correct in Settings → AI |
