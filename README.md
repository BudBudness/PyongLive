# PyongLive

**The world, live.**

PyongLive is a live broadcasting platform by Pyong Recordz Ltd. The first release focuses on scheduled events, creator-controlled live broadcasts, public playback, and replay availability.

## Architecture

- Cloudflare Workers: API and application boundary
- Cloudflare D1: event and broadcast metadata
- Cloudflare R2: assets and supporting files
- Cloudflare Stream: live ingest, video encoding, playback, and recordings
- GitHub Actions: continuous integration

## Status

Initial scaffold in progress. No production resources are provisioned by this repository alone. Configure Cloudflare bindings and secrets before deploying.

## Development and deployment

- Run `npm install` and `npm run typecheck` for local verification.
- Review `scripts/bootstrap-cloudflare.sh`, then run it from the repository root inside the authenticated Debian/Wrangler environment to provision resources and deploy. It will ask for the dedicated Cloudflare Stream API token and customer code; credentials are entered privately in the terminal.
- See `docs/PRODUCT_CONSTITUTION.md` for product boundaries and `docs/DEPLOYMENT.md` for deployment details.
