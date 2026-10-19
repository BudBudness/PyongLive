# PyongLive

**The world, live.**

PyongLive is a live broadcasting platform by Pyong Recordz Ltd. The first release focuses on scheduled events, creator-controlled live broadcasts, public playback, and replay availability.

## Architecture

- Cloudflare Workers: API and application boundary
- Cloudflare D1: event and broadcast metadata
- Cloudflare R2: assets and supporting files
- Cloudflare Stream: current production live ingest, playback, and recordings (paid service)
- MediaMTX: optional open-source streaming provider adapter and local prototype under `streaming/`; production remains on Cloudflare Stream unless explicitly configured
- GitHub Actions: continuous integration

## Status

The Worker deploys through GitHub Actions and has a production health check. A complete public MediaMTX deployment still requires a reachable media host, HTTPS HLS delivery, recording-index exposure, and an end-to-end broadcast test.

## Zero-subscription streaming prototype

See [`streaming/README.md`](streaming/README.md) for the MediaMTX Docker Compose setup, local RTMP ingest, HLS playback, and recording test. MediaMTX itself is free; public always-on hosting and bandwidth are not guaranteed to be free. The Worker contains an explicit MediaMTX provider adapter and recording lookup path, but production defaults to Cloudflare Stream. Do not switch providers until the MediaMTX host, public HTTPS playback, recording index, and full live-to-replay flow are verified.

## Development and deployment

- Run `npm install` and `npm run typecheck` for local verification.
- Review `scripts/bootstrap-cloudflare.sh`, then run it from the repository root inside the authenticated Debian/Wrangler environment to provision resources and deploy. It will ask for the dedicated Cloudflare Stream API token and customer code; credentials are entered privately in the terminal.
- See `docs/PRODUCT_CONSTITUTION.md` for product boundaries and `docs/DEPLOYMENT.md` for deployment details.
