# PyongLive

**The world, live.**

PyongLive is a live broadcasting platform by Pyong Recordz Ltd. The first release focuses on scheduled events, creator-controlled live broadcasts, public playback, and replay availability.

## Architecture

- Cloudflare Workers: API and application boundary
- Cloudflare D1: event and broadcast metadata
- Cloudflare R2: assets and supporting files
- Cloudflare Stream: current production live ingest, playback, and recordings (paid service)
- MediaMTX: zero-subscription local streaming prototype under `streaming/` (not yet wired into the production Worker)
- GitHub Actions: continuous integration

## Status

Initial scaffold in progress. No production resources are provisioned by this repository alone. Configure Cloudflare bindings and secrets before deploying.

## Zero-subscription streaming prototype

See [`streaming/README.md`](streaming/README.md) for the MediaMTX Docker Compose setup, local RTMP ingest, HLS playback, and recording test. MediaMTX itself is free; public always-on hosting and bandwidth are not guaranteed to be free. The production Worker still uses Cloudflare Stream until the provider adapter and replay flow are migrated and verified.

## Development and deployment

- Run `npm install` and `npm run typecheck` for local verification.
- Review `scripts/bootstrap-cloudflare.sh`, then run it from the repository root inside the authenticated Debian/Wrangler environment to provision resources and deploy. It will ask for the dedicated Cloudflare Stream API token and customer code; credentials are entered privately in the terminal.
- See `docs/PRODUCT_CONSTITUTION.md` for product boundaries and `docs/DEPLOYMENT.md` for deployment details.
