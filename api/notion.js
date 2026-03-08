// Vercel Edge Function — Notion API Proxy
export const config = { runtime: "edge" };

function mapStatus(notionStatus) {
  if (!notionStatus) return "draft";
  const s = notionStatus.toLowerCase();
  if (s.includes("complet") || s.includes("posted") || s.includes("published")) return "posted";
  if (s.includes("schedul") || s.includes("ready")) return "ready";
  return "draft"; // content creating, in progress, etc
}

function reverseStatus(gridStatus) {
  if (gridStatus === "posted") return "Completed";
  if (gridStatus === "ready") return "scheduled";
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

  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, message: "Notion proxy is running ✦" }), {
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }

  try {
    const body = await req.text();
    if (!body) {
      return new Response(JSON.stringify({ ok: false, error: "Empty request body" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    const { token, databaseId, action, pages } = JSON.parse(body);

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

    // ── FETCH ─────────────────────────────────────────────────────────
    if (action === "fetch") {
      const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: "POST",
        headers: notionHeaders,
        body: JSON.stringify({ page_size: 100 }),
      });

      if (!res.ok) {
        const err = await res.json();
        return new Response(JSON.stringify({ ok: false, error: err.message || `Notion error ${res.status}` }), {
          status: res.status, headers: { ...cors, "Content-Type": "application/json" }
        });
      }

      const data = await res.json();
      const mapped = data.results.map(page => ({
        id: page.id,
        title:
          page.properties?.Name?.title?.[0]?.plain_text ||
          page.properties?.Title?.title?.[0]?.plain_text ||
          "Untitled",
        status: mapStatus(page.properties?.Status?.status?.name || page.properties?.Status?.select?.name),
        date:
          page.properties?.Date?.date?.start ||
          page.properties?.["Published Date"]?.date?.start ||
          page.properties?.["Published Da"]?.date?.start ||
          "",
        caption: page.properties?.Caption?.rich_text?.[0]?.plain_text || "",
        hashtags: page.properties?.Hashtags?.rich_text?.[0]?.plain_text || "",
        label: page.properties?.Label?.rich_text?.[0]?.plain_text || "",
        platform: page.properties?.["Platform(s)"]?.multi_select?.map(p => p.name).join(", ") || "",
      }));

      return new Response(JSON.stringify({ ok: true, pages: mapped }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // ── PUSH ──────────────────────────────────────────────────────────
    if (action === "push" && pages?.length) {
      let created = 0;
      for (const post of pages) {
        const props = {
          Name: { title: [{ text: { content: post.label || `Post ${post.position}` } }] },
          ...(post.postDate ? { Date: { date: { start: post.postDate } } } : {}),
          ...(post.caption ? { Caption: { rich_text: [{ text: { content: post.caption } }] } } : {}),
          ...(post.hashtags ? { Hashtags: { rich_text: [{ text: { content: post.hashtags } }] } } : {}),
        };

        // Only set Status if the property exists — use Notion's select type
        if (post.status) {
          props.Status = { status: { name: reverseStatus(post.status) } };
        }

        const res = await fetch("https://api.notion.com/v1/pages", {
          method: "POST",
          headers: notionHeaders,
          body: JSON.stringify({ parent: { database_id: databaseId }, properties: props }),
        });
        if (res.ok) created++;
      }
      return new Response(JSON.stringify({ ok: true, created }), {
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
