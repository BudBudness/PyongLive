interface Env {
  DB: D1Database;
  ASSETS: R2Bucket;
  CF_ACCOUNT_ID: string;
  CF_STREAM_API_TOKEN: string;
  ADMIN_API_TOKEN: string;
  STREAM_CUSTOMER_CODE: string;
  MEDIA_PROVIDER?: string;
  MEDIAMTX_RTMP_BASE_URL?: string;
  MEDIAMTX_HLS_BASE_URL?: string;
  MEDIAMTX_PUBLISH_USERNAME?: string;
  MEDIAMTX_PUBLISH_PASSWORD?: string;
  MEDIAMTX_RECORDING_INDEX_URL?: string;
  MEDIAMTX_RECORDING_INDEX_TOKEN?: string;
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
  replay_uid: string | null;
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
    playbackUrl: event.playback_url,
    playerUrl: event.playback_url?.replace("/manifest/video.m3u8", "/iframe") ?? null
  };
}

function requireAdmin(request: Request, env: Env): Response | null {
  const authorization = request.headers.get("authorization") ?? "";
  // Secrets copied from terminals or dashboards may contain trailing CR/LF.
  // Normalize only surrounding whitespace; never alter the token's interior.
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const expected = env.ADMIN_API_TOKEN?.trim() ?? "";
  if (!expected || !supplied || supplied !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }
  return null;
}

async function readEvent(env: Env, id: string): Promise<EventRecord | null> {
  return env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventRecord>();
}

function createMediaMTXInput(env: Env, eventId: string) {
  const rtmpBase = env.MEDIAMTX_RTMP_BASE_URL?.trim().replace(/\/$/, "");
  const hlsBase = env.MEDIAMTX_HLS_BASE_URL?.trim().replace(/\/$/, "");
  const username = env.MEDIAMTX_PUBLISH_USERNAME?.trim();
  const password = env.MEDIAMTX_PUBLISH_PASSWORD;
  if (!rtmpBase || !hlsBase || !username || !password) {
    throw new Error("MediaMTX provider is selected but its RTMP/HLS URLs or publish credentials are missing");
  }
  // Unique unguessable path per event; the shared publish credential is only returned
  // by this admin-protected endpoint and must never be sent to viewers.
  const path = "event-" + eventId.replace(/-/g, "") + "-" + crypto.randomUUID().replace(/-/g, "");
  const encodedUser = encodeURIComponent(username);
  const encodedPassword = encodeURIComponent(password);
  return {
    uid: "mediamtx:" + path,
    ingestUrl: rtmpBase.replace("://", "://" + encodedUser + ":" + encodedPassword + "@") + "/" + path,
    streamKey: "",
    playbackUrl: hlsBase + "/" + path
  };
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

async function resolveReplay(env: Env, event: EventRecord) {
  if (event.stream_uid?.startsWith("mediamtx:")) {
    const indexUrl = env.MEDIAMTX_RECORDING_INDEX_URL?.trim().replace(/\/$/, "");
    const indexToken = env.MEDIAMTX_RECORDING_INDEX_TOKEN?.trim();
    if (!indexUrl || !indexToken) {
      return { ready: false as const, reason: "recording_index_not_configured" as const };
    }
    const path = event.stream_uid.slice("mediamtx:".length);
    const endpoint = new URL(indexUrl + "/api/recordings");
    endpoint.searchParams.set("path", path);
    const response = await fetch(endpoint, {
      headers: { authorization: "Bearer " + indexToken }
    });
    const payload = await response.json() as {
      ready?: boolean;
      file?: string;
      playbackUrl?: string;
    };
    if (response.status === 404 || !payload.ready || !payload.file || !payload.playbackUrl) {
      return { ready: false as const, reason: "processing" as const };
    }
    if (!response.ok) throw new Error("Could not query MediaMTX recording index");
    await env.DB.prepare(
      "UPDATE events SET replay_uid = ?, playback_url = ? WHERE id = ?"
    ).bind("mediamtx:" + path + "/" + payload.file, payload.playbackUrl, event.id).run();
    return { ready: true as const, replayUid: "mediamtx:" + path + "/" + payload.file, playbackUrl: payload.playbackUrl };
  }
  if (!event.stream_uid || !env.CF_ACCOUNT_ID || !env.CF_STREAM_API_TOKEN) {
    return { ready: false as const, reason: "not_configured" };
  }

  const endpoint = "https://api.cloudflare.com/client/v4/accounts/" +
    encodeURIComponent(env.CF_ACCOUNT_ID) + "/stream/live_inputs/" +
    encodeURIComponent(event.stream_uid) + "/videos";

  const response = await fetch(endpoint, {
    headers: { authorization: "Bearer " + env.CF_STREAM_API_TOKEN }
  });
  const payload = await response.json() as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: Array<{
      uid?: string;
      readyToStream?: boolean;
      status?: { state?: string };
      created?: string;
    }>;
  };

  if (!response.ok || !payload.success) {
    throw new Error("Could not query Cloudflare Stream recordings");
  }

  const recordings = (payload.result ?? [])
    .filter((video) => video.uid && video.readyToStream && video.status?.state === "ready")
    .sort((a, b) => Date.parse(b.created ?? "") - Date.parse(a.created ?? ""));

  const recording = recordings[0];
  if (!recording?.uid) return { ready: false as const, reason: "processing" as const };

  const playbackUrl = env.STREAM_CUSTOMER_CODE
    ? "https://customer-" + env.STREAM_CUSTOMER_CODE +
      ".cloudflarestream.com/" + recording.uid + "/manifest/video.m3u8"
    : null;

  await env.DB.prepare(
    "UPDATE events SET replay_uid = ?, playback_url = ? WHERE id = ?"
  ).bind(recording.uid, playbackUrl, event.id).run();

  return { ready: true as const, replayUid: recording.uid, playbackUrl };
}

const appHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#101010">
<title>PyongLive — The world, live.</title>
<style>
:root{color-scheme:dark;--bg:#101010;--panel:#1a1a1a;--muted:#aaa;--line:#333;--accent:#e8ff65}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#f6f6f6;font:16px/1.5 system-ui,-apple-system,sans-serif}
header{padding:28px max(20px,calc((100vw - 1080px)/2));border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:18px;align-items:center}
.brand{font-size:22px;font-weight:800;letter-spacing:-.04em}.tag{color:var(--muted);font-size:13px}
main{max-width:1080px;margin:auto;padding:28px 20px 64px}.hero{padding:28px 0 32px}.eyebrow{text-transform:uppercase;letter-spacing:.16em;color:var(--accent);font-size:12px;font-weight:700}
h1{font-size:clamp(32px,6vw,58px);line-height:1.03;letter-spacing:-.055em;max-width:680px;margin:12px 0}
p{color:var(--muted)}h2{font-size:22px;letter-spacing:-.03em}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}
.card,.admin,.player{border:1px solid var(--line);background:var(--panel);border-radius:14px;padding:18px;min-width:0}
.card h3{margin:0 0 8px;font-size:19px}.status{display:inline-block;border:1px solid var(--line);border-radius:100px;padding:3px 9px;font-size:11px;text-transform:uppercase;letter-spacing:.08em}
button{border:0;border-radius:8px;padding:10px 14px;background:var(--accent);color:#111;font-weight:750;cursor:pointer;margin:5px 6px 0 0}
button.secondary{background:#303030;color:white;border:1px solid #454545}button:disabled{opacity:.45;cursor:not-allowed}
input,textarea{width:100%;background:#111;color:white;border:1px solid #444;border-radius:8px;padding:11px;margin:5px 0 12px;font:inherit}
label{font-size:13px;color:#ccc}small,.muted{color:var(--muted)}.player{margin:24px 0}.player iframe{width:100%;aspect-ratio:16/9;border:0;border-radius:8px;background:#050505}
.hidden{display:none!important}.ingest{white-space:pre-wrap;overflow-wrap:anywhere;background:#101010;padding:12px;border-radius:8px;font-size:13px}
footer{border-top:1px solid var(--line);padding:22px;text-align:center;color:var(--muted);font-size:12px}
</style>
</head>
<body>
<header><div><div class="brand">PyongLive</div><div class="tag">The world, live.</div></div><span class="status">Early access</span></header>
<main>
<section class="hero"><div class="eyebrow">Live events · Replays</div><h1>Be there, wherever you are.</h1><p>Watch live broadcasts and catch up on recordings when they are ready.</p></section>
<section id="player" class="player hidden"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><h2 id="player-title">Now playing</h2><button class="secondary" id="close-player">Close</button></div><iframe id="player-frame" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;" allowfullscreen></iframe><p id="player-note"></p></section>
<section><h2>Events</h2><div id="events" class="grid"><p>Loading events…</p></div></section>
<section class="admin" style="margin-top:32px"><h2>Creator controls</h2><p>Create events and manage broadcasts. Admin access is required; keep your token private.</p>
<label for="admin-token">Admin API token</label><input id="admin-token" type="password" autocomplete="off" placeholder="Enter token for this session">
<form id="create-form"><label for="title">Event title</label><input id="title" required minlength="3" maxlength="160" placeholder="Event title"><label for="description">Description</label><textarea id="description" rows="2" maxlength="5000" placeholder="What is this event about?"></textarea><label for="scheduled">Scheduled time (optional)</label><input id="scheduled" type="datetime-local"><button type="submit">Create event</button></form>
<div id="admin-message" role="status" class="muted"></div><div id="ingest-panel" class="hidden"><h3>Broadcast ingest details</h3><p>Enter these into your streaming software. Never share the stream key publicly.</p><div id="ingest-details" class="ingest"></div><button id="copy-ingest" class="secondary">Copy details</button></div>
</section>
</main><footer>PyongLive · A product of Pyong Recordz Ltd.</footer>
<script>
const el=id=>document.getElementById(id);
let lastIngest="";
const token=()=>el("admin-token").value.trim();
async function api(path,options={}){const headers={"content-type":"application/json",...(options.headers||{})};if(options.admin)headers.authorization="Bearer "+token();const response=await fetch(path,{...options,headers});const data=await response.json().catch(()=>({error:"Invalid server response"}));if(!response.ok)throw new Error(data.error||"Request failed ("+response.status+")");return data}
function make(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n}
async function loadEvents(){const root=el("events");try{const data=await api("/api/events");root.replaceChildren();if(!data.events.length){root.append(make("p","muted","No events yet. Create the first event in Creator controls."));return}
for(const event of data.events){const card=make("article","card");card.append(make("span","status",event.status));card.append(make("h3","",event.title));if(event.description)card.append(make("p","",event.description));if(event.scheduledAt)card.append(make("small","", "Scheduled: "+new Date(event.scheduledAt).toLocaleString()));const actions=make("div","");
if(event.status==="scheduled"){const start=make("button","","Start broadcast");start.onclick=()=>startEvent(event.id);actions.append(start)}
if(event.status==="live"){const watch=make("button","","Watch live");watch.onclick=()=>watchEvent(event);actions.append(watch);const end=make("button","secondary","End broadcast");end.onclick=()=>endEvent(event.id);actions.append(end)}
if(event.status==="ended"){const replay=make("button","","Check replay");replay.onclick=()=>checkReplay(event.id,event.title);actions.append(replay)}
card.append(actions);root.append(card)}
}catch(error){root.replaceChildren(make("p","muted","Could not load events: "+error.message))}}
async function createEvent(e){e.preventDefault();el("admin-message").textContent="";try{const body={title:el("title").value,description:el("description").value||null,scheduledAt:el("scheduled").value?new Date(el("scheduled").value).toISOString():null};await api("/api/events",{method:"POST",admin:true,body:JSON.stringify(body)});el("create-form").reset();el("admin-message").textContent="Event created.";await loadEvents()}catch(error){el("admin-message").textContent=error.message}}
async function startEvent(id){try{const data=await api("/api/events/"+id+"/start",{method:"POST",admin:true});lastIngest="RTMPS URL: "+(data.ingest.url||"not provided")+"\nStream key: "+(data.ingest.streamKey||"not provided")+"\nPlayback: "+(data.playbackUrl||"configure STREAM_CUSTOMER_CODE");el("ingest-details").textContent=lastIngest;el("ingest-panel").classList.remove("hidden");el("admin-message").textContent="Live input created. Start streaming using the ingest details.";await loadEvents()}catch(error){el("admin-message").textContent=error.message}}
async function endEvent(id){if(!confirm("End this event? Stop the encoder first, then confirm."))return;try{await api("/api/events/"+id+"/end",{method:"POST",admin:true});el("admin-message").textContent="Event ended. Recording may take a short time to become available.";await loadEvents()}catch(error){el("admin-message").textContent=error.message}}
function watchEvent(event){if(!event.playerUrl){el("player-note").textContent="Playback is not configured. Set STREAM_CUSTOMER_CODE in the Worker environment.";return}el("player-title").textContent=event.title;el("player-frame").src=event.playerUrl;el("player-note").textContent=event.status==="live"?"Live broadcast":"Replay";el("player").classList.remove("hidden");el("player").scrollIntoView({behavior:"smooth"})}
async function checkReplay(id,title){try{const data=await api("/api/events/"+id+"/replay");if(data.status==="ready"){watchEvent({title,playerUrl:data.playerUrl,status:"ended"})}else{el("admin-message").textContent="Replay is still processing. Try again shortly."}}catch(error){el("admin-message").textContent=error.message}}
el("create-form").addEventListener("submit",createEvent);el("close-player").onclick=()=>{el("player-frame").src="";el("player").classList.add("hidden")};el("copy-ingest").onclick=async()=>{try{await navigator.clipboard.writeText(lastIngest);el("admin-message").textContent="Ingest details copied."}catch{el("admin-message").textContent="Copy unavailable; select the ingest details manually."}};
loadEvents();setInterval(loadEvents,15000);
</script></body></html>`;

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

  if (request.method === "GET" && path === "/") {
    return new Response(appHtml, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }

  if (request.method === "GET" && path === "/health") {
    return json({ ok: true, service: "pyonglive-api", version: "0.1.0" });
  }

  if (request.method === "GET" && path === "/api/events") {
    const result = await env.DB.prepare(
      "SELECT * FROM events ORDER BY CASE WHEN status = 'live' THEN 0 WHEN status = 'scheduled' THEN 1 ELSE 2 END, scheduled_at ASC, created_at DESC LIMIT 100"
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
    const scheduledAt = typeof body.scheduledAt === "string" && body.scheduledAt.trim() ? body.scheduledAt.trim() : null;
    if (title.length < 3 || title.length > 160) return json({ error: "title must contain 3–160 characters" }, 400);
    if (description && description.length > 5000) return json({ error: "description must be 5000 characters or fewer" }, 400);
    if (scheduledAt && Number.isNaN(Date.parse(scheduledAt))) return json({ error: "scheduledAt must be a valid date/time string" }, 400);

    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO events (id, title, description, status, scheduled_at, created_at) VALUES (?, ?, ?, 'scheduled', ?, ?)"
    ).bind(id, title, description, scheduledAt, new Date().toISOString()).run();
    const event = await readEvent(env, id);
    return json({ event: event ? publicEvent(event) : null }, 201);
  }

  const replayMatch = path.match(/^\/api\/events\/([0-9a-f-]+)\/replay$/i);
  if (request.method === "GET" && replayMatch) {
    const event = await readEvent(env, replayMatch[1]);
    if (!event) return json({ error: "Event not found" }, 404);
    if (event.status !== "ended") return json({ error: "Replay is available after the event ends" }, 409);
    if (event.replay_uid) {
      return json({
        status: "ready",
        replayUid: event.replay_uid,
        playbackUrl: event.playback_url,
        playerUrl: event.playback_url?.replace("/manifest/video.m3u8", "/iframe") ?? null
      });
    }
    try {
      const replay = await resolveReplay(env, event);
      if (!replay.ready) return json({ status: "processing", message: replay.reason === "recording_index_not_configured" ? "MediaMTX is recording locally, but recording index settings are not configured." : "Recording is not ready yet" }, 202);
      return json({
        status: "ready",
        replayUid: replay.replayUid,
        playbackUrl: replay.playbackUrl,
        playerUrl: replay.playbackUrl?.replace("/manifest/video.m3u8", "/iframe") ?? null
      });
    } catch {
      return json({ error: "Could not check recording status. Verify Cloudflare Stream read permissions." }, 502);
    }
  }

  const match = path.match(/^\/api\/events\/([0-9a-f-]+)(?:\/(start|end))?$/i);
  if (match) {
    const id = match[1];
    const action = match[2];
    const event = await readEvent(env, id);
    if (!event) return json({ error: "Event not found" }, 404);

    if (request.method === "GET" && !action) return json({ event: publicEvent(event) });
    if (request.method !== "POST" || !action) return json({ error: "Method not allowed" }, 405);

    const denied = requireAdmin(request, env);
    if (denied) return denied;

    if (action === "start") {
      if (event.status === "ended") return json({ error: "Ended events cannot be restarted" }, 409);
      if (event.status === "live" && event.stream_uid) return json({ error: "Event is already live" }, 409);
      const provider = (env.MEDIA_PROVIDER ?? "cloudflare").trim().toLowerCase();
      if (provider !== "cloudflare" && provider !== "mediamtx") return json({ error: "MEDIA_PROVIDER must be cloudflare or mediamtx" }, 500);
      if (provider === "cloudflare" && (!env.CF_ACCOUNT_ID || !env.CF_STREAM_API_TOKEN)) return json({ error: "Cloudflare Stream credentials are not configured" }, 503);
      if (provider === "mediamtx" && (!env.MEDIAMTX_RTMP_BASE_URL || !env.MEDIAMTX_HLS_BASE_URL || !env.MEDIAMTX_PUBLISH_USERNAME || !env.MEDIAMTX_PUBLISH_PASSWORD)) return json({ error: "MediaMTX is selected but required MediaMTX environment variables are not configured" }, 503);

      let liveInput: Awaited<ReturnType<typeof createLiveInput>> | ReturnType<typeof createMediaMTXInput>;
      try {
        liveInput = provider === "mediamtx"
          ? createMediaMTXInput(env, id)
          : await createLiveInput(env, event.title);
      } catch {
        return json({ error: provider === "mediamtx" ? "Unable to prepare MediaMTX ingest. Verify the MediaMTX URLs and credentials." : "Unable to create the live input. Check Cloudflare Stream configuration and permissions." }, 502);
      }

      const playbackUrl = "playbackUrl" in liveInput
        ? liveInput.playbackUrl
        : env.STREAM_CUSTOMER_CODE
          ? "https://customer-" + env.STREAM_CUSTOMER_CODE + ".cloudflarestream.com/" + liveInput.uid + "/manifest/video.m3u8"
          : null;
      await env.DB.prepare(
        "UPDATE events SET status = 'live', started_at = ?, stream_uid = ?, playback_url = ? WHERE id = ?"
      ).bind(new Date().toISOString(), liveInput.uid, playbackUrl, id).run();

      return json({
        eventId: id,
        status: "live",
        provider,
        ingest: { url: liveInput.ingestUrl, streamKey: liveInput.streamKey },
        playbackUrl,
        note: "Keep the stream key private."
      });
    }

    if (action === "end") {
      if (event.status !== "live") return json({ error: "Only live events can be ended" }, 409);
      await env.DB.prepare("UPDATE events SET status = 'ended', ended_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), id).run();
      return json({ eventId: id, status: "ended", playbackUrl: event.playback_url, replayStatus: "processing" });
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
