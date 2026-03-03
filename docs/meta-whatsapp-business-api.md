# Meta WhatsApp Business API Integration (WAgen AI v1.2)

This project now supports Embedded Signup for Official WhatsApp Business API mode.

## 1) Required Meta App setup

1. Create Meta app in Business mode.
2. Add products:
   - WhatsApp
   - Facebook Login for Business
3. Enable Embedded Signup in WhatsApp configuration.
4. Configure OAuth redirect URI:
   - `https://wagenai.com/meta-callback`
5. Configure webhook callback:
   - `https://wagenai.com/meta-webhook`
6. Subscribe webhook fields:
   - `messages`
   - `message_status`
   - `templates`
   - `phone_number_name_update`

## 2) Backend environment

Set these in `apps/api/.env`:

```env
META_APP_ID=...
META_APP_SECRET=...
META_EMBEDDED_SIGNUP_CONFIG_ID=...
META_VERIFY_TOKEN=...
META_REDIRECT_URI=https://wagenai.com/meta-callback
META_PHONE_REGISTRATION_PIN=123456
META_GRAPH_VERSION=v19.0
META_TOKEN_ENCRYPTION_KEY=long-random-secret
```

Notes:
- Access tokens are stored encrypted in DB (`whatsapp_business_connections.access_token_encrypted`).
- `META_TOKEN_ENCRYPTION_KEY` is required whenever Meta integration is configured.
- `META_PHONE_REGISTRATION_PIN` should be a 6-digit PIN used for `/{phone-number-id}/register`.

## 3) Implemented API endpoints

Authenticated:
- `GET /api/meta/business/config`
- `GET /api/meta/business/status`
- `POST /api/meta/business/complete`
- `POST /api/meta/business/disconnect`
- `POST /api/meta/business/send-text`

Public webhook:
- `GET /meta-webhook` (verification)
- `POST /meta-webhook` (events)

Also available under `/api/meta/webhook`.

## 4) Frontend flow

Dashboard -> Settings -> "Connect WhatsApp Business API":
- Loads Facebook SDK
- Calls `FB.login` with `config_id`, `response_type=code`
- Sends code to backend (`/api/meta/business/complete`)
- Stores resolved connection (WABA + phone number ID)

Redirect callback page:
- `/meta-callback`

## 5) AI reply flow (Official API mode)

Incoming webhook message:
1. Resolve connected account by `phone_number_id`
2. Track inbound conversation
3. Resolve agent profile by channel (`api`) + linked number
4. Generate AI reply
5. Send reply via Meta Graph API
6. Store outbound message and broadcast realtime updates

## 6) Pricing clarity in UI

Dashboard now states:
- Platform fee: `Rs.249/month`
- Meta conversation charges: billed separately by Meta
