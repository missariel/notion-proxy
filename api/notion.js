// Vercel Edge Function — Notion API Proxy
// Deploy this to Vercel to bypass CORS restrictions
// Then update the Grid Studio artifact to call YOUR_VERCEL_URL/api/notion

export const config = { runtime: "edge" };

export default async function handler(req) {
  // Allow requests from anywhere (including Claude artifacts)
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    const { token, databaseId, action, pages } = await req.json();

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

    // ── FETCH: query database ─────────────────────────────────────────
    if (action === "fetch") {
      const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: "POST",
        headers: notionHeaders,
        body: JSON.stringify({ page_size: 100, sorts: [{ property: "Date", direction: "ascending" }] }),
      });

      if (!res.ok) {
        const err = await res.json();
        return new Response(JSON.stringify({ ok: false, error: err.message || "Notion API error" }), {
          status: res.status, headers: { ...cors, "Content-Type": "application/json" }
        });
      }

      const data = await res.json();
      const mapped = data.results.map(page => ({
        id: page.id,
        title: page.properties?.Name?.title?.[0]?.plain_text || page.properties?.["Post Name"]?.title?.[0]?.plain_text || "Untitled",
        status: page.properties?.Status?.select?.name || "draft",
        date: page.properties?.Date?.date?.start || "",
        caption: page.properties?.Caption?.rich_text?.[0]?.plain_text || "",
        hashtags: page.properties?.Hashtags?.rich_text?.[0]?.plain_text || "",
        label: page.properties?.Label?.rich_text?.[0]?.plain_text || "",
      }));

      return new Response(JSON.stringify({ ok: true, pages: mapped }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // ── PUSH: create pages ────────────────────────────────────────────
    if (action === "push" && pages?.length) {
      let created = 0;
      for (const post of pages) {
        const res = await fetch("https://api.notion.com/v1/pages", {
          method: "POST",
          headers: notionHeaders,
          body: JSON.stringify({
            parent: { database_id: databaseId },
            properties: {
              Name: { title: [{ text: { content: post.label || `Post ${post.position}` } }] },
              Status: { select: { name: post.status === "ready" ? "Ready" : post.status === "posted" ? "Posted" : "Draft" } },
              ...(post.postDate ? { Date: { date: { start: post.postDate } } } : {}),
              Caption: { rich_text: [{ text: { content: post.caption || "" } }] },
              Hashtags: { rich_text: [{ text: { content: post.hashtags || "" } }] },
            },
          }),
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
