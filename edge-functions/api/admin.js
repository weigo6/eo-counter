/**
 * api/admin.js
 * - 支持高速统计遍历
 */
export async function onRequest({ request, env }) {
  const allowedOrigin = env.ALLOWED_ORIGIN || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token",
  };

  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = request.headers.get("X-Auth-Token");
    if (!env.DASHBOARD_PWD || authHeader !== env.DASHBOARD_PWD) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } 
      });
    }

    // 兼容不同的 DB 绑定方式
    let db;
    try { db = BLOG_DB; } catch (e) { db = env.BLOG_DB; } // @ts-ignore
    if (!db) throw new Error("KV Binding Failed");

    const url = new URL(request.url);
    const action = url.searchParams.get("action");
    
    // ============================
    // 动作: LIST (获取列表)
    // ============================
    if (action === "list") {
      const cursor = url.searchParams.get("cursor");
      const prefix = url.searchParams.get("prefix");
      const onlyKeys = url.searchParams.get("onlyKeys") === "true"; // [新增] 只返回Key模式
      
      // 如果是只统计Key，允许最大 limit 256，否则限制为 30 以免读取Value超时
      const maxLimit = onlyKeys ? 256 : 30;
      const userLimit = parseInt(url.searchParams.get("limit"));
      const limit = (userLimit && userLimit > 0 && userLimit <= 256) ? userLimit : 20;
      
      // 强制安全限制
      const safeLimit = Math.min(limit, maxLimit);

      const listOptions = { limit: safeLimit };
      if (cursor && cursor !== "null") listOptions.cursor = cursor;
      if (prefix) listOptions.prefix = prefix;

      // 调用 KV list
      const listResult = await db.list(listOptions);
      
      // [新增] 快速返回路径：如果只需要 Keys (用于统计总数)，直接返回，不查询 Value
      if (onlyKeys) {
        return new Response(JSON.stringify({
          data: listResult.keys || [], // 仅返回 Key 数组
          cursor: listResult.cursor,
          complete: listResult.complete
        }), {
          headers: { "Content-Type": "application/json", ...corsHeaders } 
        });
      }

      // 常规路径：查询 Value (用于列表显示)
      const keys = listResult.keys || [];
      const dataWithValues = await Promise.all(keys.map(async (k) => {
        try {
          const keyName = k.key || k.name;
          const val = await db.get(keyName);
          return { key: keyName, value: val };
        } catch (e) {
          return { key: k.key || "unknown", value: null };
        }
      }));

      return new Response(JSON.stringify({
        data: dataWithValues,
        cursor: listResult.cursor,
        complete: listResult.complete
      }), {
        headers: { "Content-Type": "application/json", ...corsHeaders } 
      });
    }

    // ... update 和 delete 代码保持不变 ...
    if (action === "update" && request.method === "POST") {
        const body = await request.json();
        await db.put(body.key, String(body.value));
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }
    if (action === "delete" && request.method === "POST") {
        const body = await request.json();
        await db.delete(body.key);
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: "Invalid Action" }), { status: 400, headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: "Server Error" }), { status: 500, headers: corsHeaders });
  }
}