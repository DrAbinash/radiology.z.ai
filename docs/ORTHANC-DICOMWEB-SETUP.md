# Orthanc DICOMweb Plugin Setup

**Required for OHIF and Weasis to fetch images from Orthanc.**
Without this plugin, the viewer launch buttons won't show images.

---

## What it does

The DICOMweb plugin adds 3 standard endpoints to Orthanc:
- **QIDO-RS** — `GET /dicom-web/studies` (search studies)
- **WADO-RS** — `GET /dicom-web/studies/:uid` (retrieve images)
- **STOW-RS** — `POST /dicom-web/studies` (store images)

OHIF and Weasis use these to pull images from Orthanc into the viewer on your laptop.

---

## Setup on Synology (if Orthanc runs in Docker)

### Step 1 — Check if the plugin is already installed

```bash
docker exec <orthanc-container> orthanc --plugins
```

If you see `dicomweb` in the list, skip to Step 3.

### Step 2 — Install the plugin

If Orthanc is running from the official image, use the version with plugins:

```yaml
# In your Orthanc docker-compose:
services:
  orthanc:
    image: orthancteam/orthanc:latest   # includes all plugins
    ports:
      - "8042:8042"   # REST API + DICOMweb
      - "4242:4242"   # DICOM (for scanners to send images)
    volumes:
      - orthanc_data:/var/lib/orthanc/db
      - ./orthanc.json:/etc/orthanc/orthanc.json
    environment:
      - ORTHANC_NAME=Hope-NeuroTrauma-PACS
```

### Step 3 — Enable the plugin in orthanc.json

Create or edit `orthanc.json` (mount it into the container):

```json
{
  "Name": "Hope-NeuroTrauma-PACS",
  "HttpPort": 8042,
  "AuthenticationEnabled": true,
  "RegisteredUsers": {
    "orthanc": "orthanc-password"
  },

  "DicomWeb": {
    "Enable": true,
    "Root": "/dicom-web",
    "EnableWado": true,
    "SimplifyTags": true,
    "StudiesMetadata": "Full",
    "SeriesMetadata": "Full"
  }
}
```

### Step 4 — Restart Orthanc

```bash
docker compose restart orthanc
```

### Step 5 — Verify

```bash
# Test the DICOMweb endpoint (use your Orthanc credentials)
curl -u orthanc:orthanc-password http://<nas-ip>:8042/dicom-web/studies?limit=1

# Should return JSON with study metadata, not an error
```

---

## Configure the standalone to use it

In your standalone `.env`:

```env
# Orthanc (where studies live)
ORTHANC_URL=http://<nas-ip>:8042
ORTHANC_USER=orthanc
ORTHANC_PASSWORD=orthanc-password

# DICOMweb endpoint (where viewers fetch images)
DICOM_WEB_URL=http://<nas-ip>:8042/dicom-web

# Weasis desktop app (opens on your laptop)
WEASIS_URL=weasis://

# OHIF (leave empty to use Orthanc's built-in viewer, OR set a local OHIF)
OHIF_URL=
```

Then restart the standalone:
```bash
docker compose restart radiology
```

---

## Weasis setup (on your laptop)

1. **Install Weasis** — download from [weasis.org](https://weasis.org/en/getting-started/download/)
   - Windows: `.exe` installer
   - It registers the `weasis://` protocol automatically

2. **Test it** — click any "Weasis" button in the worklist
   - Weasis opens on your laptop
   - It fetches images from `http://<nas-ip>:8042/dicom-web`
   - The study appears in the viewer

3. **If Weasis doesn't open** — check:
   - Weasis is installed and opened at least once
   - Your laptop can reach the NAS: `curl http://<nas-ip>:8042/dicom-web/studies`
   - The `weasis://` protocol is registered (Windows: Settings → Apps → Default apps)

---

## OHIF setup (optional — alternative web viewer)

### Option A: Use Orthanc's built-in viewer (simplest)

Leave `OHIF_URL` empty in `.env`. The worklist shows a "Viewer" button that opens Orthanc's built-in DICOMweb viewer.

### Option B: Run OHIF in Docker on the NAS

```yaml
# Add to your docker-compose:
ohif:
  image: orthancteam/ohif-viewer:latest
  ports:
    - "3004:80"
  environment:
    - ORTHANC_URL=http://<nas-ip>:8042
```

Then set `OHIF_URL=http://<nas-ip>:3004` in `.env`.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Weasis" button does nothing | Install Weasis on your laptop; open it once manually |
| Weasis opens but shows no images | Check `DICOM_WEB_URL` is reachable from your laptop |
| OHIF shows blank | Check Orthanc DICOMweb plugin is enabled (`orthanc --plugins`) |
| 401 Unauthorized | Set `ORTHANC_USER` + `ORTHANC_PASSWORD` in `.env` to match Orthanc's `RegisteredUsers` |
| "dicom-web" not in plugins list | Use `orthancteam/orthanc:latest` image (includes plugins) |

---

## Quick verification checklist

```bash
# 1. Orthanc is running
curl http://<nas-ip>:8042/system
# → {"Name":"Hope-NeuroTrauma-PACS","Version":"..."}

# 2. DICOMweb plugin is enabled
curl -u orthanc:password http://<nas-ip>:8042/dicom-web/studies?limit=1
# → JSON array of studies (not 404)

# 3. Standalone can reach Orthanc
# Settings → Test Orthanc → "Connected — Orthanc X.Y.Z"

# 4. Viewer buttons appear in the worklist
# → Each study row shows "Weasis" and/or "OHIF" buttons

# 5. Weasis opens on your laptop
# → Click "Weasis" → desktop app opens with the study
```
