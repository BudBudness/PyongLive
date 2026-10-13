interface Env {
  DB: D1Database;
  ASSETS: R2Bucket;
  CF_ACCOUNT_ID: string;
  CF_STREAM_API_TOKEN: string;
  ADMIN_API_TOKEN: string;
  STREAM_CUSTOMER_CODE: string;
}

type EventStatus = "scheduled" | "live" | "ended";

interface EventRecord {
  id: string;
  title: string;
  description: string | null;
  status: EventStatus;
  scheduled_at: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  stream_uid: string | null;
  playback_url: string | null;
}

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers });
}

function publicEvent(event: EventRecord) {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    status: event.status,
    scheduledAt: event.scheduled_at,
    createdAt: event.created_at,
    startedAt: event.started_at,
    endedAt: event.ended_at,
    playbackUrl: event.playback_url
  };
}

function requireAdmin(request: Request, env: Env): Response | null {
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!env.ADMIN_API_TOKEN || !supplied || supplied !== env.ADMIN_API_TOKEN) {
    return json({ error: "Unauthorized" }, 401);
  }
  return null;
}

async function readEvent(env: Env, id: string): Promise<EventRecord | null> {
  return env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventRecord>();
}

async function createLiveInput(env: Env, title: string) {
  const endpoint = "https://api.cloudflare.com/client/v4/accounts/" +
    encodeURIComponent(env.CF_ACCOUNT_ID) + "/stream/live_inputs";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: "Bearer " + env.CF_STREAM_API_TOKEN,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      meta: { name: title },
      recording: { mode: "automatic", requireSignedURLs: false }
    })
  });

  const payload = await response.json() as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: { uid?: string; rtmps?: { url?: string; streamKey?: string } };
  };

  if (!response.ok || !payload.success || !payload.result?.uid) {
    throw new Error(
      payload.errors?.map((item) => item.message).filter(Boolean).join("; ") ||
      "Cloudflare Stream could not create a live input"
    );
  }

  return {
    uid: payload.result.uid,
    ingestUrl: payload.result.rtmps?.url ?? null,
    streamKey: payload.result.rtmps?.streamKey ?? null
  };
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, authorization",
        "access-control-max-age": "86400"
      }
    });
  }

  if (request.method === "GET" && path === "/health") {
    return json({ ok: true, service: "pyonglive-api", version: "0.1.0" });
  }

  if (request.method === "GET" && path === "/api/events") {
    const result = await env.DB.prepare(
      "SELECT * FROM events WHERE status IN ('scheduled', 'live') " +
      "ORDER BY CASE WHEN status = 'live' THEN 0 ELSE 1 END, scheduled_at ASC LIMIT 100"
    ).all<EventRecord>();
    return json({ events: (result.results ?? []).map(publicEvent) });
  }

  if (request.method === "POST" && path === "/api/events") {
    const denied = requireAdmin(request, env);
    if (denied) return denied;

    let body: { title?: unknown; description?: unknown; scheduledAt?: unknown };
    try {
      body = await request.json() as typeof body;
    } catch {
      return json({ error: "Request body must be valid JSON" }, 400);
    }

    const title = typeof body.title === "string" ? body.title.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : null;
    const scheduledAt = typeof body.scheduledAt === "string" && body.scheduledAt.trim()
      ? body.scheduledAt.trim()
      : null;

    if (title.length < 3 || title.length > 160) {
      return json({ error: "title must contain 3–160 characters" }, 400);
    }
    if (description && description.length > 5000) {
      return json({ error: "description must be 5000 characters or fewer" }, 400);
    }
    if (scheduledAt && Number.isNaN(Date.parse(scheduledAt))) {
      return json({ error: "scheduledAt must be a valid date/time string" }, 400);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO events (id, title, description, status, scheduled_at, created_at) " +
      "VALUES (?, ?, ?, 'scheduled', ?, ?)"
    ).bind(id, title, description, scheduledAt, new Date().toISOString()).run();

    const event = await readEvent(env, id);
    return json({ event: event ? publicEvent(event) : null }, 201);
  }

  const match = path.match(/^\/api\/events\/([0-9a-f-]+)(?:\/(start|end))?$/i);
  if (match) {
    const id = match[1];
    const action = match[2];
    const event = await readEvent(env, id);
    if (!event) return json({ error: "Event not found" }, 404);

    if (request.method === "GET" && !action) {
      return json({ event: publicEvent(event) });
    }
    if (request.method !== "POST" || !action) {
      return json({ error: "Method not allowed" }, 405);
    }

    const denied = requireAdmin(request, env);
    if (denied) return denied;

    if (action === "start") {
      if (event.status === "ended") {
        return json({ error: "Ended events cannot be restarted" }, 409);
      }
      if (event.status === "live" && event.stream_uid) {
        return json({ error: "Event is already live" }, 409);
      }
      if (!env.CF_ACCOUNT_ID || !env.CF_STREAM_API_TOKEN) {
        return json({ error: "Cloudflare Stream credentials are not configured" }, 503);
      }

      let liveInput: Awaited<ReturnType<typeof createLiveInput>>;
      try {
        liveInput = await createLiveInput(env, event.title);
      } catch {
        return json({
          error: "Unable to create the live input. Check Cloudflare Stream configuration and permissions."
        }, 502);
      }

      const playbackUrl = env.STREAM_CUSTOMER_CODE
        ? "https://customer-" + env.STREAM_CUSTOMER_CODE +
          ".cloudflarestream.com/" + liveInput.uid + "/manifest/video.m3u8"
        : null;

      await env.DB.prepare(
        "UPDATE events SET status = 'live', started_at = ?, stream_uid = ?, playback_url = ? WHERE id = ?"
      ).bind(new Date().toISOString(), liveInput.uid, playbackUrl, id).run();

      return json({
        eventId: id,
        status: "live",
        ingest: { url: liveInput.ingestUrl, streamKey: liveInput.streamKey },
        playbackUrl,
        note: "Keep the stream key private. Verify recording and replay availability after the broadcast."
      });
    }

    if (action === "end") {
      if (event.status !== "live") {
        return json({ error: "Only live events can be ended" }, 409);
      }
      await env.DB.prepare(
        "UPDATE events SET status = 'ended', ended_at = ? WHERE id = ?"
      ).bind(new Date().toISOString(), id).run();
      return json({
        eventId: id,
        status: "ended",
        playbackUrl: event.playback_url,
        note: "Recording processing and replay playback still require end-to-end verification."
      });
    }
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch {
      return json({ error: "Internal server error" }, 500);
    }
  }
};
