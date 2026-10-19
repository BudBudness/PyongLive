import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const temp = await mkdtemp(path.join(os.tmpdir(), "pyonglive-recording-index-"));
const token = "test-index-token";
const port = 18090;
const base = "http://127.0.0.1:" + port;
const eventPath = "event-" + "a".repeat(32) + "-" + "b".repeat(32);
let child;

try {
  const recordingDir = path.join(temp, eventPath, "2026-10-18");
  await mkdir(recordingDir, { recursive: true });
  await writeFile(path.join(recordingDir, "sample.mp4"), Buffer.from("fake-mp4-content"));

  child = spawn(process.execPath, ["streaming/recording-index.mjs"], {
    env: {
      ...process.env,
      RECORDINGS_DIR: temp,
      INDEX_TOKEN: token,
      PUBLIC_BASE_URL: base,
      PORT: String(port)
    },
    stdio: "ignore"
  });

  let healthy = false;
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(base + "/health");
      if (response.ok) { healthy = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(healthy, true, "recording index should start");

  const unauthorized = await fetch(base + "/api/recordings?path=" + eventPath);
  assert.equal(unauthorized.status, 401, "index endpoint must require authorization");

  const indexed = await fetch(base + "/api/recordings?path=" + eventPath, {
    headers: { authorization: "Bearer " + token }
  });
  assert.equal(indexed.status, 200);
  const result = await indexed.json();
  assert.equal(result.ready, true);
  assert.match(result.playbackUrl, /\/recordings\/event-[a-f0-9]+\/2026-10-18\/sample\.mp4$/);

  const playback = await fetch(result.playbackUrl);
  assert.equal(playback.status, 200);
  assert.equal(await playback.text(), "fake-mp4-content");

  const traversal = await fetch(base + "/recordings/%2e%2e/package.json");
  assert.equal(traversal.status, 404);
  console.log("Recording index integration checks passed.");
} finally {
  child?.kill("SIGTERM");
  await rm(temp, { recursive: true, force: true });
}
