# Deployment

This scaffold does not provision Cloudflare resources or deploy automatically.

## Required resources
1. Worker: pyonglive-api
2. D1 database: pyonglive-db
3. R2 bucket: pyonglive-assets
4. Cloudflare Stream enabled on the target account

## Before first deploy
1. Create the D1 database and replace the placeholder database_id in wrangler.jsonc.
2. Create the R2 bucket.
3. Apply migrations/0001_init.sql.
4. Set CF_ACCOUNT_ID, CF_STREAM_API_TOKEN, and ADMIN_API_TOKEN as Worker secrets; set STREAM_CUSTOMER_CODE as a variable.
5. Run npm install and npm run typecheck.
6. Test live ingest, viewer playback, recording retrieval, and replay URLs before production release.

## Initial API contract
- GET /health
- GET /api/events and GET /api/events/:id
- POST /api/events (authenticated)
- POST /api/events/:id/start (authenticated; returns private ingest details)
- POST /api/events/:id/end (authenticated)

Automatic recording and replay behavior must be verified against the real Cloudflare account before production release.
