#!/usr/bin/env bash
set -Eeuo pipefail

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
command -v node >/dev/null || fail "Node.js is required."
command -v npm >/dev/null || fail "npm is required."
command -v npx >/dev/null || fail "npx is required."

printf '\nPyongLive Cloudflare bootstrap\n'
printf 'This creates/configures Cloudflare resources and deploys the Worker.\n'
printf 'It does not print or save the Stream API token.\n\n'

npx wrangler whoami >/dev/null || fail "Wrangler is not authenticated. Run wrangler login in this Debian environment first."

ACCOUNT_ID="${CF_ACCOUNT_ID:-}"
if [[ -z "$ACCOUNT_ID" ]]; then
  read -r -p "Cloudflare account ID: " ACCOUNT_ID
fi
[[ "$ACCOUNT_ID" =~ ^[a-f0-9]{32}$ ]] || fail "Account ID must be 32 hexadecimal characters."

printf '\nChecking D1 database...\n'
get_db_id() {
  npx wrangler d1 list --json 2>/dev/null | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
 try {
  const x=JSON.parse(s); const rows=Array.isArray(x)?x:(x.result||x.databases||[]);
  const d=rows.find(v=>v.name==="pyonglive-db"||v.database_name==="pyonglive-db");
  process.stdout.write(d?(d.uuid||d.database_id||d.id||""):"");
 } catch {}
});'
}
DB_ID="$(get_db_id)"
if [[ -z "$DB_ID" ]]; then
  npx wrangler d1 create pyonglive-db
  DB_ID="$(get_db_id)"
fi
[[ "$DB_ID" =~ ^[a-f0-9-]{30,}$ ]] || fail "Could not resolve D1 database ID. Check 'npx wrangler d1 list --json'."
export DB_ID
node --input-type=module -e '
import fs from "node:fs";
const p="wrangler.jsonc";
let s=fs.readFileSync(p,"utf8");
s=s.replace(/"database_id"\s*:\s*"REPLACE_WITH_D1_DATABASE_ID"/, "\"database_id\": \"" + process.env.DB_ID + "\"");
if(s.includes("REPLACE_WITH_D1_DATABASE_ID")) throw new Error("D1 placeholder replacement failed");
fs.writeFileSync(p,s);
'

printf '\nChecking R2 bucket...\n'
R2_EXISTS="$(npx wrangler r2 bucket list --json 2>/dev/null | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
 try {
  const x=JSON.parse(s); const rows=Array.isArray(x)?x:(x.result||x.buckets||[]);
  process.stdout.write(rows.some(v=>v.name==="pyonglive-assets")?"yes":"no");
 } catch { process.stdout.write("unknown"); }
});')"
if [[ "$R2_EXISTS" != "yes" ]]; then
  npx wrangler r2 bucket create pyonglive-assets || fail "Could not create R2 bucket. Check bucket list and account permissions."
fi

printf '\nInstalling dependencies and checking source...\n'
npm install
npm run typecheck

printf '\nApplying D1 migration remotely...\n'
npx wrangler d1 migrations apply pyonglive-db --remote

printf '\nCreate a dedicated Stream API token in Cloudflare Dashboard > Manage Account > API Tokens.\n'
printf 'Grant Account / Stream / Edit permissions (recording lookup requires Stream read access too).\n'
read -r -s -p "Paste the dedicated Stream API token (input hidden): " STREAM_TOKEN
printf '\n'
[[ -n "$STREAM_TOKEN" ]] || fail "A Stream API token is required."
read -r -p "Cloudflare Stream customer code (from the Stream playback hostname): " CUSTOMER_CODE
[[ -n "$CUSTOMER_CODE" ]] || fail "Stream customer code is required."

ADMIN_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
printf '%s' "$ACCOUNT_ID" | npx wrangler secret put CF_ACCOUNT_ID
printf '%s' "$STREAM_TOKEN" | npx wrangler secret put CF_STREAM_API_TOKEN
printf '%s' "$CUSTOMER_CODE" | npx wrangler secret put STREAM_CUSTOMER_CODE
printf '%s' "$ADMIN_TOKEN" | npx wrangler secret put ADMIN_API_TOKEN
unset STREAM_TOKEN CUSTOMER_CODE

printf '\nDeploying PyongLive Worker...\n'
npx wrangler deploy

printf '\nDeployment command completed. Verify the /health endpoint and run a real test broadcast.\n'
printf 'Admin API token (save securely; shown once):\n%s\n' "$ADMIN_TOKEN"
printf 'Do not commit this token or send it in chat.\n'
