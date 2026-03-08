// Vercel Edge Function — Notion API Proxy
export const config = { runtime: "edge" };

function mapStatus(s) {
  if (!s) return "draft";
  const l = s.toLowerCase();
  if (l.includes("complet") || l.includes("posted") || l.includes("published")) return "posted";
  if (l.includes("schedul") || l.includes("ready")) return "ready";
  return "draft";
}

function reverseStatus(s) {
  if (s === "posted") return "Completed";
  if (s === "ready") return "scheduled";
  return "content creating";
}

export default async function handler(req) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  // ── GET: pass token, dbId, action as query params ─────────────────
  // e.g. /api/notion?action=fetch&token=xxx&databaseId=yyy
  if (req.method === "GET") {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    const databaseId = url.searchParams.get("databaseId");
    const action = url.searchParams.get("action");

    if (!token || !databaseId || !action) {
      return new Response(JSON.stringify({ ok: true, message: "Notion proxy is running ✦" }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    return await handleAction({ token, databaseId, action }, cors);
  }

  // ── POST ──────────────────────────────────────────────────────────
  if (req.method === "POST") {
    try {
      const body = await req.text();
      if (!body) return new Response(JSON.stringify({ ok: false, error: "Empty body" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" }
      });
      const payload = JSON.parse(body);
      return await handleAction(payload, cors);
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: err.message }), {
        status: 500, headers: { ...cors, "Content-Type": "application/json" }
      });
    }
  }
}

async function handleAction({ token, databaseId, action, pages }, cors) {
  if (!token || !databaseId) {
    return new Response(JSON.stringify({ ok: false, error: "Missing token or databaseId" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" }
    });
  }

  const notionHeaders = {
    "Authorization": `Bearer ${token}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
  };

  try {
    if (action === "fetch") {
      const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: "POST",
        headers: notionHeaders,
        body: JSON.stringify({ page_size: 100 }),
      });

      const rawText = await res.text();
      if (!res.ok) {
        return new Response(JSON.stringify({ ok: false, error: `Notion ${res.status}: ${rawText}` }), {
          headers: { ...cors, "Content-Type": "application/json" }
        });
      }

      const data = JSON.parse(rawText);
      const mapped = data.results.map(page => ({
        id: page.id,
        title:
          page.properties?.Name?.title?.[0]?.plain_text ||
          page.properties?.Title?.title?.[0]?.plain_text ||
          "Untitled",
        status: mapStatus(
          page.properties?.Status?.status?.name ||
          page.properties?.Status?.select?.name || ""
        ),
        date: page.properties?.Date?.date?.start || "",
        caption: page.properties?.Caption?.rich_text?.[0]?.plain_text || "",
        hashtags: page.properties?.Hashtags?.rich_text?.[0]?.plain_text || "",
        label: page.properties?.["Planning Status"]?.status?.name ||
               page.properties?.["Planning Status"]?.select?.name || "",
        platform: page.properties?.["Platform(s)"]?.multi_select?.map(p => p.name).join(", ") || "",
      }));

      return new Response(JSON.stringify({ ok: true, pages: mapped }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (action === "push" && pages?.length) {
      let created = 0;
      const errors = [];
      for (const post of pages) {
        const props = {
          Name: { title: [{ text: { content: post.label || `Post ${post.position}` } }] },
          ...(post.postDate ? { Date: { date: { start: post.postDate } } } : {}),
          ...(post.caption ? { Caption: { rich_text: [{ text: { content: post.caption } }] } } : {}),
          ...(post.hashtags ? { Hashtags: { rich_text: [{ text: { content: post.hashtags } }] } } : {}),
          ...(post.status ? { Status: { select: { name: reverseStatus(post.status) } } } : {}),
        };
        const res = await fetch("https://api.notion.com/v1/pages", {
          method: "POST",
          headers: notionHeaders,
          body: JSON.stringify({ parent: { database_id: databaseId }, properties: props }),
        });
        if (res.ok) created++;
        else errors.push(await res.text());
      }
      return new Response(JSON.stringify({ ok: true, created, errors }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ ok: false, error: "Unknown action" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" }
    });
  }
}
