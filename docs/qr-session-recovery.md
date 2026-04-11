# QR Session Recovery

When the QR channel shows `Needs re-link`, the session likely lost WhatsApp encryption sync or got stuck in reconnect thrash.

Use this recovery sequence:

1. Keep the main WhatsApp phone online and unlocked for a few minutes.
2. Open WhatsApp on the phone and remove the stale linked device for the platform.
3. In the dashboard, reconnect the QR channel and scan the fresh QR code.
4. Re-test from a different WhatsApp number using a direct 1:1 chat.

Notes:

- Group, broadcast, and newsletter traffic is intentionally ignored by the QR inbound pipeline.
- A direct message that shows `Waiting for this message` is usually a WhatsApp decrypt/session-sync problem, not a Typo routing problem.
- The backend now forces a clean re-link when it detects repeated reconnect loops or repeated direct-message decrypt failures with no successful direct inbound traffic.
