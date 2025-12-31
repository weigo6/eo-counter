/**
 * api/visit.js
 * 处理博客前端的访问统计请求
 */
export async function onRequest({ request, env }) {
  // 1. 跨域配置
  const allowOrigin = env.ALLOWED_ORIGIN || "*";
  const corsHeaders = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // 2. 获取全局 KV 绑定
  // EdgeOne 允许直接访问绑定的全局变量，无需从 env 获取
  let db;
  try {
    /* global BLOG_DB */ // 声明全局变量以通过语法检查
    db = BLOG_DB;
  } catch (e) {
    return new Response(JSON.stringify({ error: "Global KV 'BLOG_DB' not found" }), {
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
    // === 关键：使用定制的编码函数 ===
    const pageKey = encodePageKey(targetPath);
    const siteKey = "site_total_pv";

    const [sitePvStr, pagePvStr] = await Promise.all([
      db.get(siteKey),
      db.get(pageKey)
    ]);

    const newSitePv = (Number(sitePvStr) || 0) + 1;
    const newPagePv = (Number(pagePvStr) || 0) + 1;

    // 写入数据
    await Promise.all([
      db.put(siteKey, String(newSitePv)),
      db.put(pageKey, String(newPagePv))
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
 * 核心编码函数
 * 目标：/college-study/STEM/传感器 -> _college_study_STEM_Base64(传感器)
 * 限制：Key 仅支持 [a-zA-Z0-9_:]
 */
function encodePageKey(path) {
  if (!path) return "root";
  
  // 1. 清理后缀和尾部斜杠
  let processed = path;
  if (processed.endsWith('.html')) processed = processed.slice(0, -5);
  if (processed.endsWith('/')) processed = processed.slice(0, -1);
  if (!processed.startsWith('/')) processed = '/' + processed;

  // 2. 分割路径
  const segments = processed.split('/').filter(Boolean);

  // 3. 处理每一段
  const encodedSegments = segments.map(seg => {
    // 检查是否仅包含允许的“常规”字符 (字母、数字)
    // 注意：连字符 '-' 也不在你的允许列表中，所以这里我们把它也视为需要处理的，或者转为下划线
    // 如果你希望保留英文单词间的连字符为可读，建议将其转为下划线
    if (/^[a-zA-Z0-9]+$/.test(seg)) {
      return seg;
    }
    
    // 如果包含连字符，替换为下划线保留可读性 (可选)
    if (/^[a-zA-Z0-9\-]+$/.test(seg)) {
      return seg.replace(/-/g, '_');
    }

    // 4. 中文或其他特殊字符：Base64 编码
    // 使用 UTF-8 转码
    const utf8Bytes = new TextEncoder().encode(seg);
    let b64 = btoa(String.fromCharCode(...utf8Bytes));
    
    // 5. Base64 清洗：替换 Key 不支持的字符 (+ / =)
    // 映射规则：+ -> :A, / -> :B, = -> (去掉)
    b64 = b64.replace(/\+/g, ':A').replace(/\//g, ':B').replace(/=/g, '');
    
    // 添加前缀标识以便解码（可选，但推荐，防止混淆）
    return `B64:${b64}`;
  });

  // 6. 用下划线连接
  return '_' + encodedSegments.join('_');
}