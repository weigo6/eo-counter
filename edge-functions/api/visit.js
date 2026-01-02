/**
 * api/visit.js
 * 博客访问统计 - 生产环境版 (同步写入模式)
 * 
 * 功能：
 * 1. 接收页面 URL 参数
 * 2. 对 URL 进行安全编码作为 KV Key
 * 3. 读取并累加 PV (Page View)
 */

export async function onRequest(context) {
  // 1. 安全检查
  if (!context) {
    return new Response("Error: Context is missing", { status: 500 });
  }

  const { request, env } = context;

  // === 2. 跨域 (CORS) 配置 ===
  const allowedOrigin = env.ALLOWED_ORIGIN || "";
  
  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // 处理预检请求 (Browser Preflight)
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // === 3. 获取 KV 数据库 ===
    // 优先尝试全局绑定 BLOG_DB，失败则尝试 env.BLOG_DB
    let db;
    try {
      // @ts-ignore
      db = BLOG_DB; 
    } catch (e) {
      db = env.BLOG_DB;
    }

    if (!db) {
      console.error("Configuration Error: KV 'BLOG_DB' not found.");
      return new Response(JSON.stringify({ error: "Server Configuration Error" }), { 
        status: 500, headers: corsHeaders 
      });
    }

    // === 4. 参数解析与校验 ===
    const urlObj = new URL(request.url);
    const targetPath = urlObj.searchParams.get("url");

    if (!targetPath) {
      return new Response(JSON.stringify({ error: "Missing 'url' parameter" }), { 
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } 
      });
    }

    // === 5. 核心业务逻辑 ===
    // 生成 Key
    const pageKey = encodePageKey(targetPath);
    const siteKey = "site_total_pv";

    // 读取当前数值
    const [sitePvStr, pagePvStr] = await Promise.all([
      db.get(siteKey),
      db.get(pageKey)
    ]);

    // 计算新数值
    const newSitePv = (Number(sitePvStr) || 0) + 1;
    const newPagePv = (Number(pagePvStr) || 0) + 1;

    // === 6. 同步写入 (Await 模式) ===
    // 因为环境不支持 waitUntil，必须等待写入完成后再返回
    // 如果写入失败，会抛出异常进入 catch 块，返回 500，保证数据一致性
    await Promise.all([
      db.put(siteKey, String(newSitePv)),
      db.put(pageKey, String(newPagePv))
    ]);

    // === 7. 返回响应 ===
    return new Response(JSON.stringify({ total: newSitePv, page: newPagePv }), {
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });

  } catch (err) {
    console.error("Runtime Error:", err);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), { 
      status: 500, 
      headers: { "Content-Type": "application/json", ...corsHeaders } 
    });
  }
}

/**
 * 辅助函数：将 URL 路径编码为合法的 KV Key
 */
function encodePageKey(path) {
  if (!path) return "root";
  
  let processed = path;
  // 清理后缀和多余斜杠
  if (processed.endsWith('.html')) processed = processed.slice(0, -5);
  if (processed.length > 1 && processed.endsWith('/')) processed = processed.slice(0, -1);
  if (!processed.startsWith('/')) processed = '/' + processed;

  const segments = processed.split('/').filter(Boolean);

  const encodedSegments = segments.map(seg => {
    // 策略修改：只有纯数字字母才保持明文
    // 包含连字符(-)的片段现在会进入下方的 Base64 编码流程，从而保证数据可逆
    if (/^[a-zA-Z0-9]+$/.test(seg)) return seg;

    // === 删除或注释掉下面这行造成 Bug 的代码 ===
    // if (/^[a-zA-Z0-9\-]+$/.test(seg)) return seg.replace(/-/g, '_'); 

    // 兼容性处理：获取 TextEncoder
    const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
    
    // 降级回退 (只保留纯数字字母，防止报错，虽然正常环境都有 TextEncoder)
    if (!encoder) return seg.replace(/[^a-zA-Z0-9]/g, '');

    const utf8Bytes = encoder.encode(seg);
    let b64 = btoa(String.fromCharCode(...utf8Bytes));
    
    // Base64 字符清洗 (替换 + / =)
    b64 = b64.replace(/\+/g, ':A').replace(/\//g, ':B').replace(/=/g, '');
    
    return `B64:${b64}`;
  });

  return '_' + encodedSegments.join('_');
}