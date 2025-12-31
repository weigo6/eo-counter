/**
 * 处理博客前端的访问统计请求
 * 路径: /api/visit?url=...
 */
export async function onRequest({ request, env }) {
  // === 1. 从环境变量获取允许的域名 ===
  // 如果没设置环境变量，默认回退到 "*" (不安全，仅用于测试)
  const allowOrigin = env.ALLOWED_ORIGIN || "*";

  const corsHeaders = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // 处理预检请求
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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
    // 生成 Key
    const pageKey = encodeKey(targetPath);
    const siteKey = "site_total_pv";

    // 读写逻辑不变
    const [sitePvStr, pagePvStr] = await Promise.all([
      env.BLOG_DB.get(siteKey),
      env.BLOG_DB.get(pageKey)
    ]);

    const newSitePv = (parseInt(sitePvStr) || 0) + 1;
    const newPagePv = (parseInt(pagePvStr) || 0) + 1;

    await Promise.all([
      env.BLOG_DB.put(siteKey, String(newSitePv)),
      env.BLOG_DB.put(pageKey, String(newPagePv))
    ]);

    return new Response(JSON.stringify({ total: newSitePv, page: newPagePv }), {
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
}

/**
 * 核心转码函数 (现代化版本)
 * 移除 unescape，使用 TextEncoder
 */
function encodeKey(path) {
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  // 1. 将常规分隔符换成下划线
  let processed = path.replace(/[/\.]/g, '_');

  // 2. 正则匹配非法字符（非字母数字下划线冒号）
  return processed.replace(/[^a-zA-Z0-9_:]+/g, (match) => {
    
    // === 关键修改：使用 TextEncoder 替代 unescape ===
    // 1. 将 UTF-8 字符串转为 Uint8Array 字节流
    const bytes = new TextEncoder().encode(match);
    
    // 2. 将字节流转为二进制字符串 (btoa 需要这种格式)
    // 使用 Array.from 避免大数组导致栈溢出
    const binString = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    
    // 3. 转 Base64
    const b64 = btoa(binString);

    // 4. 清洗 Base64 中的非法 KV 字符 (+, /, =)
    return 'B_' + b64.replace(/\+/g, ':A').replace(/\//g, ':B').replace(/=/g, '');
  });
}