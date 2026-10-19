# PyongLive zero-subscription streaming prototype

This prototype replaces Cloudflare Stream's media plane with the free, open-source MediaMTX server. MediaMTX supports RTMP ingest, HLS playback and recording to disk. See the [official documentation](https://mediamtx.org/docs/kickoff/introduction).

## Cost boundary

- MediaMTX software: free.
- Local development on a computer you already own: no additional hosting subscription.
- Public, always-on broadcasting: still requires an always-on reachable host, bandwidth and storage. This repository does not create free hosting or guarantee zero operating cost.
- The Worker API includes an optional MediaMTX provider adapter and recording lookup path, but production defaults to Cloudflare Stream. Do not switch the provider until a reachable MediaMTX host, HTTPS playback, exposed recording-index service, and end-to-end live-to-replay test are verified.

## Local test

Requirements: Docker Engine with the Compose plugin and FFmpeg.

1. Edit `mediamtx.yml` and replace `REPLACE_WITH_A_LONG_RANDOM_PASSWORD` with a long random password. Do not commit a real password.
2. Start MediaMTX:

   ```sh
   cd streaming
   docker compose up -d
   docker compose logs -f mediamtx
   ```

3. Publish a local test pattern from another terminal (replace the password):

   ```sh
   ffmpeg -re -f lavfi -i testsrc2=size=1280x720:rate=30 \
     -re -f lavfi -i sine=frequency=880:sample_rate=44100 \
     -c:v libx264 -preset ultrafast -pix_fmt yuv420p -g 60 \
     -c:a aac -b:a 128k -f flv \
     'rtmp://publisher:REPLACE_WITH_A_LONG_RANDOM_PASSWORD@127.0.0.1:1935/pyonglive-test'
   ```

4. Open the HLS stream in VLC or a compatible HLS player:

   `http://127.0.0.1:8888/pyonglive-test/index.m3u8`

5. Stop FFmpeg with Ctrl+C. Recordings are written inside the persistent `pyonglive-recordings` Docker volume. Inspect the server logs and verify the recording before moving on.

## Worker provider configuration

The Worker now supports an explicit provider switch. It defaults to `cloudflare` to avoid changing production behavior unexpectedly. To test MediaMTX after deploying a reachable server, configure these Worker environment variables in the Cloudflare dashboard:

- `MEDIA_PROVIDER=mediamtx`
- `MEDIAMTX_RTMP_BASE_URL=rtmp://YOUR_REACHABLE_HOST:1935`
- `MEDIAMTX_HLS_BASE_URL=https://YOUR_HTTPS_HLS_HOST`
- `MEDIAMTX_PUBLISH_USERNAME=publisher`
- `MEDIAMTX_PUBLISH_PASSWORD` — must exactly match the password in `mediamtx.yml`
- `MEDIAMTX_RECORDING_INDEX_URL` — public HTTPS origin routed to the recording-index service (for example, `https://media.example.com`)
- `MEDIAMTX_RECORDING_INDEX_TOKEN` — long random secret, also supplied to the recording-index container as `MEDIAMTX_RECORDING_INDEX_TOKEN`

Use the RTMP URL returned by the admin-protected `/start` endpoint as a complete publishing URL; it embeds the publishing username/password. Do not publish that URL or include it in logs. The HLS base URL must be reachable by viewers and should use HTTPS in production.

The provider adapter assigns an unguessable path per event and persists the MediaMTX path in the existing `stream_uid` column. No database migration is needed. Cloudflare remains the default until `MEDIA_PROVIDER` is explicitly changed.

The `recording-index.mjs` companion service scans recordings for the event path and serves the selected file without exposing directory listings. Set `MEDIAMTX_RECORDING_INDEX_TOKEN` and `PUBLIC_RECORDINGS_BASE_URL` in the shell before starting Compose; the latter must be the public HTTPS origin routed by a reverse proxy to port 8090. Configure the same token in the Worker as `MEDIAMTX_RECORDING_INDEX_TOKEN`, and set `MEDIAMTX_RECORDING_INDEX_URL` to that public origin. The reverse proxy must route `/api/recordings` and `/recordings/*` to the recording-index service. Keep port 8090 private; Compose binds it to loopback only.

**Known gap:** the recording index has syntax validation but has not yet been tested against an actual MediaMTX recording or public reverse proxy. Do not switch production until a real broadcast, recording discovery, replay playback, and end-to-end tests pass. The admin must stop the encoder before ending an event; the Worker currently changes event status but does not remotely terminate an active MediaMTX publisher.

## Public access and security

Do not expose port 8888 directly to the internet without HTTPS and appropriate access controls. For public playback, place HLS behind a TLS-enabled reverse proxy and set the playback base URL to that HTTPS hostname. Restrict RTMP publishing to trusted broadcasters; use a unique path per event and protect publishing credentials. Do not put secrets in GitHub source, client-side code, or public event metadata.

## Remaining migration blockers

The Worker provider adapter, per-event publishing path, D1 path persistence, and secure recording-index/replay lookup are implemented. The following production work is still unverified:

- Provision a reachable, always-on MediaMTX host with persistent storage. A computer already owned by the operator can be used for a local trial, but it is not a public always-on host unless it remains online and is reachable.
- Put HLS playback and the recording-index service behind HTTPS; keep the recording-index port private and configure the shared bearer token securely.
- Run a real broadcast from an encoder, confirm HLS playback from a separate network/device, stop the broadcast, confirm a recording appears, and play the replay including HTTP byte-range seeking.
- Verify event start/end behavior and operational recovery after MediaMTX restarts.
- Only then set `MEDIA_PROVIDER=mediamtx` in production. Until all checks pass, keep the production provider on Cloudflare Stream.

No zero-cost public hosting or bandwidth source has been provisioned by this repository. MediaMTX is free software; a genuinely zero-cash-cost public deployment depends on access to an already-owned, always-on machine and internet connection.
