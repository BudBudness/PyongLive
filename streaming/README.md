# PyongLive zero-subscription streaming prototype

This prototype replaces Cloudflare Stream's media plane with the free, open-source MediaMTX server. MediaMTX supports RTMP ingest, HLS playback and recording to disk. See the [official documentation](https://mediamtx.org/docs/kickoff/introduction).

## Cost boundary

- MediaMTX software: free.
- Local development on a computer you already own: no additional hosting subscription.
- Public, always-on broadcasting: still requires an always-on reachable host, bandwidth and storage. This repository does not create free hosting or guarantee zero operating cost.
- This is an infrastructure prototype, not yet a production migration of the Worker API. The current production Worker still creates Cloudflare Stream live inputs. Do not expect the existing Creator button to use MediaMTX until the API provider adapter and replay flow are migrated.

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

## Public access and security

Do not expose port 8888 directly to the internet without HTTPS and appropriate access controls. For public playback, place HLS behind a TLS-enabled reverse proxy and set the playback base URL to that HTTPS hostname. Restrict RTMP publishing to trusted broadcasters; use a unique path per event and protect publishing credentials. Do not put secrets in GitHub source, client-side code, or public event metadata.

## Next migration work

- Add a Worker media-provider interface with explicit `cloudflare` and `mediamtx` modes.
- Issue a per-event publishing credential/path without exposing shared server credentials to viewers.
- Store the media provider and media path in D1.
- Implement a secure recording index/replay URL flow for the persistent recording volume.
- Add production end-to-end tests against a reachable MediaMTX host.
- Only switch production after these tests pass and a zero-subscription host is actually available.
