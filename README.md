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

## Development

See `docs/PRODUCT_CONSTITUTION.md` for product boundaries and `docs/DEPLOYMENT.md` for the deployment sequence.
