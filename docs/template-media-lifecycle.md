# Template Media Lifecycle

## Phase 1 — Template Creation

User uploads image in the template creator UI.

```
POST /api/meta/templates/upload-media
```

Two things happen in parallel:

| Meta Upload | Our Storage |
|---|---|
| `graphStartUploadSession()` + `graphUploadFileHandle()` | `uploadTemplateHeaderMedia()` |
| Returns a submission **handle** (base64 string) e.g. `"4:S25v...=="` | Tries **Supabase** first (if `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set), falls back to **Postgres** `media_uploads` table |
| Used for Meta's template review process | Returns a public URL: Supabase CDN URL or `https://wagenai.com/api/media/{uuid}` |

Template is then submitted to Meta with:
- `components[HEADER].example.header_handle = [handle]` — for Meta's review
- `header_media_url = mediaUrl` — stored in our DB

Template status → **PENDING**

---

## Phase 2 — Meta Approval

Meta reviews and approves the template. Upon approval, Meta stores the image on its CDN and **replaces the submission handle** with a real CDN URL:

```
Before (PENDING):
  example.header_handle = ["4:S25v...==:aW1h..."]   ← submission handle

After (APPROVED):
  example.header_handle = ["https://scontent.whatsapp.net/v/t61.29466-34/..."]  ← CDN URL
```

Template status → **APPROVED**

---

## Phase 3 — Sync from Meta

Triggered by clicking **"Sync from Meta"** in the Templates page, or via `POST /api/meta/templates/sync`.

```
Fetches /{waba_id}/message_templates from Meta API
        ↓
Updates in DB per template:
  components_json  ← refreshed with latest data (CDN URL now in header_handle)
  header_media_url ← populated from header_handle CDN URL
                     (COALESCE — won't overwrite a manually set URL)
```

> **Note:** Meta CDN URLs (`scontent.whatsapp.net`) expire in ~2–3 months. Re-sync periodically to refresh them.

---

## Phase 4 — Sending the Template

All modules (inbox / broadcast / sequence / webhook / flow nodes) go through the same path:

```
resolveTemplatePayload(template, variableValues)
        ↓
resolveHeaderMediaReference() — checks fallback chain in order:

  1. explicitId        user-provided Meta media ID (from send dialog)
  2. explicitUrl       user-provided URL (uploaded in send dialog → /api/media/uuid or Supabase)
  3. header_media_url  set at creation time OR populated by sync
  4. example.header_url[0]   if Meta returned this field
  5. example.header_handle[0] if it is a URL (CDN URL after approval)

        ↓
If a URL/ID is found:
  builds: { type: "header", parameters: [{ type: "image", image: { link: url } }] }
          ↓
  rewriteUrlComponentsToMediaId()
    → downloads the image from the URL
    → re-uploads to Meta's /media API (per-phone-number-id)
    → replaces { link } with { id: Number(mediaId) }
      (Meta's send API requires an integer media ID, not a URL)

If nothing found (null):
  header component is OMITTED from the request
  → causes Meta error 132012 "Parameter format does not match"
  → fix: ensure header_media_url is populated via sync
```

Final payload sent to Meta:
```json
{
  "template": {
    "name": "1st_message_lead",
    "language": { "code": "en_US" },
    "components": [
      {
        "type": "header",
        "parameters": [{ "type": "image", "image": { "id": 1234567890 } }]
      },
      {
        "type": "body",
        "parameters": [{ "type": "text", "text": "Sumit" }]
      }
    ]
  }
}
```

---

## Storage Summary

| Storage | Purpose | Format | Expiry |
|---|---|---|---|
| **Meta upload API** | Template review sample | Submission handle (base64) | One-time, review only |
| **Meta CDN** (`scontent.whatsapp.net`) | Approved image reference | HTTPS URL in `header_handle` | ~2–3 months |
| **Supabase Storage** | Our persistent copy for sending | Public CDN URL | No expiry |
| **Postgres `media_uploads`** | Fallback when Supabase not configured | `/api/media/{uuid}` proxy URL | No expiry (DB-backed) |
| **Meta `/media` API** | Short-lived send ID | Integer `id` | Minutes (per-send only) |

---

## Key Insight

The image travels through two systems for two different purposes:

- **Meta's upload API** → stores the sample for Meta's review process, returns a handle
- **Our storage** (Supabase or Postgres) → stores the image so our app can re-use it for every send

At send time, the URL from our storage is downloaded by our server and **re-uploaded fresh** to Meta's `/media` endpoint to get a short-lived integer ID — which is what Meta's send API actually requires.
