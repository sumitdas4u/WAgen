# Changelog

## 1.2.0 - 2026-03-01

- Added production-ready agent profile routing by linked number and channel mode (`qr`/`api`).
- Added backend agent profile APIs (`/api/agents/profiles`) with create, update, list, and delete support.
- Added `agent_profiles` database schema + compatibility migration and indexes.
- Updated WhatsApp auto-reply pipeline to resolve active agent profile per channel/number with safe fallback to global user bot settings.
- Updated dashboard flow:
  - Chat-first entry with setup prompts when WhatsApp is not connected.
  - Settings submenu for QR setup and Official API setup.
  - Dedicated Bot Agents tab using backend persistence.
- Added legal/support pages and shared landing shell:
  - Privacy Policy
  - Terms of Service
  - Contact Us
- Updated package versions to `1.2.0` for root, API, Web, and Landing apps.
