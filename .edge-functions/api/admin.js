/**
 * 管理后台 API，用于获取列表、删除、更新
 * 需要密码验证
 */
export async function onRequest({ request, env }) {
  // 1. 权限验证
  const authHeader = request.headers.get("X-Auth-Token");
  if (authHeader !== env.DASHBOARD_PWD) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action"); // list, update, delete
  
  try {
    // === 获取列表 ===
    if (action === "list") {
      const cursor = url.searchParams.get("cursor") || undefined;
      const limit = 20;
      // 这里的 list 方法返回结构 { keys: [{name: "key1"}, ...], list_complete: bool, cursor: "..." }
      // 注意：EdgeOne Pages 的 KV list 返回结构可能略有不同，以实际运行为准，通常包含 keys 数组
      const result = await env.BLOG_DB.list({ limit, cursor });
      
      // 批量获取值（KV list 只返回 key 名称，不返回 value，需要额外查询）
      // 为了性能，列表页可以只显示 key，或者并发查询 value
      const keys = result.keys;
      const dataWithValues = await Promise.all(keys.map(async (k) => {
        const val = await env.BLOG_DB.get(k.name);
        return { key: k.name, value: val };
      }));

      return new Response(JSON.stringify({
        data: dataWithValues,
        cursor: result.cursor,
        complete: result.list_complete
      }));
    }

    // === 更新/修改数据 ===
    if (action === "update" && request.method === "POST") {
      const body = await request.json(); // { key: "...", value: "..." }
      if (!body.key || !body.value) throw new Error("Missing key or value");
      
      await env.BLOG_DB.put(body.key, String(body.value));
      return new Response(JSON.stringify({ success: true }));
    }

    // === 删除数据 ===
    if (action === "delete" && request.method === "POST") {
      const body = await request.json(); // { key: "..." }
      if (!body.key) throw new Error("Missing key");
      
      await env.BLOG_DB.delete(body.key);
      return new Response(JSON.stringify({ success: true }));
    }

    return new Response("Invalid action", { status: 400 });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}