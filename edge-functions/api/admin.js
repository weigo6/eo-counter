/**
 * 管理后台 API
 */
export async function onRequest({ request, env }) {
  // 1. 权限验证
  const authHeader = request.headers.get("X-Auth-Token");
  // 环境变量通常还是在 env 中
  if (authHeader !== env.DASHBOARD_PWD) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  // === 获取全局 DB 对象 ===
  let db;
  try {
    // @ts-ignore
    db = BLOG_DB;
  } catch (e) {
    return new Response(JSON.stringify({ error: "KV Binding 'BLOG_DB' not found" }), { status: 500 });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  
  try {
    if (action === "list") {
      const cursor = url.searchParams.get("cursor") || undefined;
      const limit = 20;
      
      // 使用 db.list
      const result = await db.list({ limit, cursor });
      
      const keys = result.keys || []; // 确保 keys 存在
      const dataWithValues = await Promise.all(keys.map(async (k) => {
        const val = await db.get(k.name);
        return { key: k.name, value: val };
      }));

      return new Response(JSON.stringify({
        data: dataWithValues,
        cursor: result.cursor,
        complete: result.list_complete // 注意：字段名可能因 SDK 版本不同而异，EdgeOne文档是 list_complete 或 complete
      }));
    }

    if (action === "update" && request.method === "POST") {
      const body = await request.json();
      if (!body.key || body.value === undefined) throw new Error("Missing key or value");
      
      // 使用 db.put
      await db.put(body.key, String(body.value));
      return new Response(JSON.stringify({ success: true }));
    }

    if (action === "delete" && request.method === "POST") {
      const body = await request.json();
      if (!body.key) throw new Error("Missing key");
      
      // 使用 db.delete
      await db.delete(body.key);
      return new Response(JSON.stringify({ success: true }));
    }

    return new Response("Invalid action", { status: 400 });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}