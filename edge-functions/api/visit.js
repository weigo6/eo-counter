/**
 * 处理博客前端的访问统计请求
 * 路径: /api/visit?url=...
 */
export async function onRequest({ request, env }) {
  // 1. 跨域配置
  // 普通环境变量通常仍在 env 对象中，如果没有，可尝试直接使用 ALLOWED_ORIGIN
  const allowOrigin = env.ALLOWED_ORIGIN || "*";
  
  const corsHeaders = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // === 2. 关键修正：检查全局 KV 绑定 ===
  // 注意：KV 绑定 "BLOG_DB" 通常直接作为全局变量注入，而不是在 env 中
  let db;
  try {
    // 尝试访问全局变量 BLOG_DB
    // @ts-ignore (忽略 TypeScript 对全局变量的检查)
    db = BLOG_DB; 
  } catch (e) {
    // 捕获 ReferenceError: BLOG_DB is not defined
    console.error("致命错误: 全局变量 BLOG_DB 未定义。请检查 KV 绑定名称是否为 'BLOG_DB'。");
    return new Response(JSON.stringify({ 
      error: "Server Configuration Error: KV Binding 'BLOG_DB' not found." 
    }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  const urlObj = new URL(request.url);
  const targetPath = urlObj.searchParams.get("url");

  if (!targetPath) {
    return new Response(JSON.stringify({ error: "Missing url param" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  try {
    const pageKey = encodeKey(targetPath);
    const siteKey = "site_total_pv";

    // 3. 使用 db (即全局 BLOG_DB) 进行读写
    const [sitePvStr, pagePvStr] = await Promise.all([
      db.get(siteKey),
      db.get(pageKey)
    ]);

    const newSitePv = (parseInt(sitePvStr) || 0) + 1;
    const newPagePv = (parseInt(pagePvStr) || 0) + 1;

    await Promise.all([
      db.put(siteKey, String(newSitePv)),
      db.put(pageKey, String(newPagePv))
    ]);

    return new Response(JSON.stringify({ total: newSitePv, page: newPagePv }), {
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });

  } catch (err) {
    console.error(`KV 操作失败: ${err.message}`);
    return new Response(JSON.stringify({ error: `Internal Error: ${err.message}` }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
}

/**
 * 核心转码函数 (TextEncoder 版本)
 */
function encodeKey(path) {
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  let processed = path.replace(/[/\.]/g, '_');
  return processed.replace(/[^a-zA-Z0-9_:]+/g, (match) => {
    const bytes = new TextEncoder().encode(match);
    const binString = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    const b64 = btoa(binString);
    return 'B_' + b64.replace(/\+/g, ':A').replace(/\//g, ':B').replace(/=/g, '');
  });
}