# PyongLive Product Constitution

## Identity
- Product: PyongLive
- Owner: Pyong Recordz Ltd.
- Tagline: The world, live.

## First milestone
1. Create an event.
2. Start a broadcast and return private ingest credentials to an authenticated operator.
3. Let viewers retrieve event metadata and watch the stream.
4. End the event.
5. Verify recording processing and replay availability end-to-end.

## Architecture
- GitHub: source control and CI/CD.
- Cloudflare Workers: API boundary.
- Cloudflare D1: event metadata and state.
- Cloudflare R2: assets.
- Cloudflare Stream: live ingest, encoding, playback, and recordings.
- Add Durable Objects or another managed real-time service only when interactive presence/chat is required.

## Security boundaries
- Stream API credentials and ADMIN_API_TOKEN are server-side secrets only.
- Never expose ingest keys through public event endpoints.
- Never commit .dev.vars, real .env files, OAuth tokens, or Cloudflare credentials.
- Add full authentication, authorization, rate limiting, abuse controls, and monitoring before public launch.

## Initial non-goals
Ticketing/payments, multi-guest interactive studio, native apps, and automated moderation.

## Lifecycle
GOVERN → DISCOVER → SPECIFY → ARCHITECT → PLAN → BUILD → VERIFY → RELEASE → OPERATE → EVOLVE.

Prefer simple functions and deterministic workflows before introducing agents.
