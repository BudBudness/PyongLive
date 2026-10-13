# Deployment

This scaffold does not provision Cloudflare resources or deploy automatically.

## Required resources
1. Worker: pyonglive-api
2. D1 database: pyonglive-db
3. R2 bucket: pyonglive-assets
4. Cloudflare Stream enabled on the target account

## Bootstrap
Run `bash scripts/bootstrap-cloudflare.sh` from the repository root in the Debian environment where Wrangler is authenticated. It creates/resolves the D1 database and R2 bucket, applies the migration, prompts privately for the Stream API token and customer code, generates an admin token, configures Worker secrets, and deploys. Review the script before running it. It updates the local `wrangler.jsonc` with the D1 ID; commit that non-secret ID to the repository if you want future deployments from another checkout.

The Stream API token must have Stream read/write permissions. Do not paste the token into chat or commit it to GitHub.

## Before production release
Run `npm install` and `npm run typecheck`, then test live ingest, viewer playback, recording retrieval, replay URLs, and unauthorized admin requests against the deployed Worker.

## Initial API contract
- GET /health
- GET /api/events and GET /api/events/:id
- GET /api/events/:id/replay (checks for a ready Cloudflare Stream recording after the event ends)
- POST /api/events (authenticated)
- POST /api/events/:id/start (authenticated; returns private ingest details)
- POST /api/events/:id/end (authenticated)
- GET / (event viewer and creator controls)

Automatic recording and replay behavior must be verified against the real Cloudflare account before production release.
