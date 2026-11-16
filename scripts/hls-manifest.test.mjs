import test from "node:test";
import assert from "node:assert/strict";
import { hasPlayableHlsManifest } from "./hls-manifest.mjs";

function response(body, url = "https://stream.example/master.m3u8", ok = true) {
  return { ok, url, text: async () => body };
}

test("accepts a media playlist with segments", async () => {
  const result = await hasPlayableHlsManifest("https://stream.example/media.m3u8", async () =>
    response("#EXTM3U\n#EXTINF:6.0,\nsegment-1.ts\n")
  );
  assert.equal(result, true);
});

test("follows a master playlist to its relative media playlist", async () => {
  const calls = [];
  const fetcher = async url => {
    calls.push(String(url));
    if (calls.length === 1) {
      return response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000\nvariants/720p.m3u8\n", "https://stream.example/live/master.m3u8");
    }
    return response("#EXTM3U\n#EXTINF:6.0,\nsegment-1.ts\n", String(url));
  };

  const result = await hasPlayableHlsManifest("https://stream.example/live/master.m3u8", fetcher);
  assert.equal(result, true);
  assert.deepEqual(calls, [
    "https://stream.example/live/master.m3u8",
    "https://stream.example/live/variants/720p.m3u8"
  ]);
});

test("rejects malformed manifests", async () => {
  const result = await hasPlayableHlsManifest("https://stream.example/master.m3u8", async () =>
    response("not an HLS manifest")
  );
  assert.equal(result, false);
});

test("rejects an unavailable master playlist", async () => {
  const result = await hasPlayableHlsManifest("https://stream.example/master.m3u8", async () =>
    response("", "https://stream.example/master.m3u8", false)
  );
  assert.equal(result, false);
});

test("rejects a master playlist without a variant URI", async () => {
  const result = await hasPlayableHlsManifest("https://stream.example/master.m3u8", async () =>
    response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000\n")
  );
  assert.equal(result, false);
});
