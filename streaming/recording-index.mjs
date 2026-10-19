import { createReadStream } from "node:fs";
import { readdir, stat, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve(process.env.RECORDINGS_DIR || "/recordings");
const token = process.env.INDEX_TOKEN || "";
const publicBase = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
const port = Number(process.env.PORT || 8090);

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

function safePath(parts) {
  const target = path.resolve(root, ...parts);
  return target === root || target.startsWith(root + path.sep) ? target : null;
}

async function listFiles(dir) {
  const items = await readdir(dir, { withFileTypes: true });
  const found = [];
  for (const item of items) {
    if (item.isSymbolicLink()) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) found.push(...await listFiles(full));
    else if (/\.(mp4|mkv|ts)$/i.test(item.name)) {
      const info = await stat(full);
      if (info.isFile() && info.size > 0) found.push({ full, name: item.name, mtime: info.mtimeMs });
    }
  }
  return found;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });

    if (url.pathname === "/health") return send(res, 200, { ok: true, service: "pyonglive-recording-index" });

    if (url.pathname === "/api/recordings") {
      const auth = req.headers.authorization || "";
      if (!token || auth !== "Bearer " + token) return send(res, 401, { error: "Unauthorized" });
      const eventPath = url.searchParams.get("path") || "";
      if (!/^event-[a-f0-9]{32}-[a-f0-9]{32}$/i.test(eventPath)) return send(res, 400, { error: "Invalid recording path" });
      const dir = safePath([eventPath]);
      if (!dir) return send(res, 400, { error: "Invalid path" });
      let files;
      try { files = await listFiles(dir); } catch (error) {
        if (error?.code === "ENOENT") return send(res, 404, { ready: false });
        throw error;
      }
      files.sort((a, b) => b.mtime - a.mtime);
      const latest = files[0];
      if (!latest) return send(res, 404, { ready: false });
      const realRoot = await realpath(root);
      const realFile = await realpath(latest.full);
      if (!realFile.startsWith(realRoot + path.sep)) return send(res, 400, { error: "Invalid file path" });
      const relative = path.relative(root, realFile).split(path.sep).map(encodeURIComponent).join("/");
      const playbackUrl = publicBase ? publicBase + "/recordings/" + relative : "";
      if (!playbackUrl) return send(res, 503, { error: "PUBLIC_BASE_URL is not configured" });
      return send(res, 200, { ready: true, file: path.relative(dir, realFile).split(path.sep).map(encodeURIComponent).join("/"), playbackUrl });
    }

    if (url.pathname.startsWith("/recordings/")) {
      const encoded = url.pathname.slice("/recordings/".length).split("/");
      let parts;
      try { parts = encoded.map(decodeURIComponent); } catch { return send(res, 400, { error: "Invalid path encoding" }); }
      const file = safePath(parts);
      if (!file || file === root) return send(res, 404, { error: "Not found" });
      let actual;
      try { actual = await realpath(file); } catch { return send(res, 404, { error: "Not found" }); }
      const realRoot = await realpath(root);
      if (!actual.startsWith(realRoot + path.sep)) return send(res, 404, { error: "Not found" });
      const info = await stat(actual);
      if (!info.isFile()) return send(res, 404, { error: "Not found" });
      const ext = path.extname(actual).toLowerCase();
      const type = ext === ".mp4" ? "video/mp4" : ext === ".mkv" ? "video/x-matroska" : "video/mp2t";
      const range = req.headers.range;
      let start = 0;
      let end = info.size - 1;
      let status = 200;
      if (range) {
        const match = /^bytes=(\\d*)-(\\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) {
          res.writeHead(416, { "content-range": "bytes */" + info.size, "cache-control": "no-store" });
          res.end();
          return;
        }
        if (!match[1]) {
          const suffixLength = Number(match[2]);
          start = Math.max(info.size - suffixLength, 0);
        } else {
          start = Number(match[1]);
          if (match[2]) end = Math.min(Number(match[2]), info.size - 1);
        }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
          res.writeHead(416, { "content-range": "bytes */" + info.size, "cache-control": "no-store" });
          res.end();
          return;
        }
        status = 206;
      }
      const responseHeaders = {
        "content-type": type,
        "content-length": end - start + 1,
        "accept-ranges": "bytes",
        "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff"
      };
      if (status === 206) responseHeaders["content-range"] = "bytes " + start + "-" + end + "/" + info.size;
      res.writeHead(status, responseHeaders);
      createReadStream(actual, { start, end }).pipe(res);
      return;
    }
    return send(res, 404, { error: "Not found" });
  } catch {
    return send(res, 500, { error: "Internal server error" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log("PyongLive recording index listening on port " + port);
});
