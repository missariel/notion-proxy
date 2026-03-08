// Vercel Edge Function — Notion API Proxy
export const config = { runtime: "edge" };

export default async function handler(req) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Private-Network": "true",
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

    if (action === "fetch") {
      const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: "POST",
        headers: notionHeaders,
        body: JSON.stringify({ page_size: 100, sorts: [{ property: "Date", direction: "ascending" }] }),
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
        title: page.properties?.Name?.title?.[0]?.plain_text || page.properties?.Title?.title?.[0]?.plain_text || "Untitled",
        status: page.properties?.Status?.select?.name || "Draft",
        date: page.properties?.Date?.date?.start || "",
        caption: page.properties?.Caption?.rich_text?.[0]?.plain_text || "",
        hashtags: page.properties?.Hashtags?.rich_text?.[0]?.plain_text || "",
        label: page.properties?.Label?.rich_text?.[0]?.plain_text || "",
      }));

      return new Response(JSON.stringify({ ok: true, pages: mapped }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

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
