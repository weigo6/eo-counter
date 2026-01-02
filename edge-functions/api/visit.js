/**
 * api/visit.js
 * 博客访问统计 - 最终生产版
 * 
 * 功能：
 * 1. 严格的跨域/来源检查 (支持本地调试模式)
 * 2. PV 读取与累加
 * 3. 同步写入 KV
 */

export async function onRequest(context) {
  // 1. 上下文检查
  if (!context) {
    return new Response("Error: Context is missing", { status: 500 });
  }

  const { request, env } = context;

  // === 2. 获取配置与请求来源 ===
  // 环境变量中配置允许的域名。
  // 生产环境示例: "https://yourblog.com"
  // 本地测试示例: "*"
  const allowedOrigin = env.ALLOWED_ORIGIN || ""; 
  
  // 获取请求来源 (Origin 用于跨域 Fetch, Referer 用于直接页面请求)
  const requestOrigin = request.headers.get("Origin") || request.headers.get("Referer") || "";

  // === 3. 鉴权逻辑 (核心修改) ===
  let isUnauthorized = false;

  if (allowedOrigin === "*") {
    // 调试模式：允许所有来源 (包括 localhost)
    isUnauthorized = false;
  } else {
    // 生产模式：严格检查
    // A. 如果配置了域名，但请求来源不包含该域名 -> 拒绝
    if (allowedOrigin && !requestOrigin.includes(allowedOrigin)) {
      isUnauthorized = true;
    }
    // B. 显式拒绝 localhost/127.0.0.1，防止环境变量未配置时的泄露
    if (requestOrigin.includes("localhost") || requestOrigin.includes("127.0.0.1")) {
      isUnauthorized = true;
    }
  }

  // 拦截非法请求
  if (isUnauthorized) {
    console.warn(`[Blocked] Unauthorized request from: ${requestOrigin}`);
    return new Response(JSON.stringify({ error: "Forbidden: Unauthorized Origin" }), {
      status: 403,
      headers: { "Content-Type": "application/json" }
    });
  }

  // === 4. CORS 头配置 ===
  const corsHeaders = {
    // 如果是调试模式(*)，允许任意域；否则只允许配置的域或当前请求域
    "Access-Control-Allow-Origin": allowedOrigin === "*" ? "*" : (allowedOrigin || requestOrigin),
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // 处理预检请求 (Browser Preflight)
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // === 5. 获取 KV 数据库 ===
    // 兼容多种绑定方式 (Pages Function 全局绑定 vs Worker env 绑定)
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

    // === 6. 参数解析 ===
    const urlObj = new URL(request.url);
    const targetPath = urlObj.searchParams.get("url");

    if (!targetPath) {
      return new Response(JSON.stringify({ error: "Missing 'url' parameter" }), { 
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } 
      });
    }

    // === 7. 核心业务逻辑 (读 -> 加 -> 写) ===
    const pageKey = encodePageKey(targetPath);
    const siteKey = "site_total_pv";

    // 7.1 读取当前值 (并行)
    const [sitePvStr, pagePvStr] = await Promise.all([
      db.get(siteKey),
      db.get(pageKey)
    ]);

    // 7.2 计算新值
    const newSitePv = (Number(sitePvStr) || 0) + 1;
    const newPagePv = (Number(pagePvStr) || 0) + 1;

    // 7.3 写入数据库 (并行且等待完成)
    await Promise.all([
      db.put(siteKey, String(newSitePv)),
      db.put(pageKey, String(newPagePv))
    ]);

    // === 8. 返回成功响应 ===
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
 * 策略：纯数字字母保留，特殊字符转 Base64，防止 Key 包含非法字符
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
    // 纯数字字母直接使用，可读性更好
    if (/^[a-zA-Z0-9]+$/.test(seg)) return seg;

    // 获取 TextEncoder
    const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
    
    // 极端环境降级 (通常不会触发)
    if (!encoder) return seg.replace(/[^a-zA-Z0-9]/g, '');

    // 转换为 Base64
    const utf8Bytes = encoder.encode(seg);
    let b64 = btoa(String.fromCharCode(...utf8Bytes));
    
    // Base64 字符清洗 (KV Key 不允许 /, +, =)
    b64 = b64.replace(/\+/g, ':A').replace(/\//g, ':B').replace(/=/g, '');
    
    return `B64:${b64}`;
  });

  return '_' + encodedSegments.join('_');
}