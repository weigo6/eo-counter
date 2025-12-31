/**
 * api/admin.js
 * 管理后台 API
 */
export async function onRequest({ request, env }) {
  const authHeader = request.headers.get("X-Auth-Token");
  // 环境变量 DASHBOARD_PWD 仍在 env 中
  if (authHeader !== env.DASHBOARD_PWD) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  // 使用全局 BLOG_DB
  let db;
  try {
    /* global BLOG_DB */
    db = BLOG_DB;
  } catch (e) {
    return new Response(JSON.stringify({ error: "Global KV 'BLOG_DB' not found" }), { status: 500 });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  
  try {
    if (action === "list") {
      const cursor = url.searchParams.get("cursor") || undefined;
      const limit = 20;
      
      // 获取列表
      const result = await db.list({ limit, cursor });
      const keys = result.keys || [];
      
      // 获取值并进行解码
      const dataWithValues = await Promise.all(keys.map(async (k) => {
        const val = await db.get(k.key);
        
        // === 还原 URL ===
        let originalUrl = k.key;
        try {
            originalUrl = decodePageKey(k.key);
        } catch(e) {
            // 解码失败则保留原 Key
        }

        return { 
            key: k.key,          // 原始 Key (用于删除/更新操作)
            url: originalUrl,    // 解码后的 URL (用于展示)
            value: val 
        };
      }));

      return new Response(JSON.stringify({
        data: dataWithValues,
        cursor: result.cursor,
        complete: result.complete
      }));
    }
    
    // delete 和 update 保持原样，操作的是 raw key
    if (action === "delete" && request.method === "POST") {
        const body = await request.json();
        await db.delete(body.key);
        return new Response(JSON.stringify({ success: true }));
    }
    
    if (action === "update" && request.method === "POST") {
        const body = await request.json();
        await db.put(body.key, String(body.value));
        return new Response(JSON.stringify({ success: true }));
    }

    return new Response("Invalid action", { status: 400 });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

/**
 * 解码函数：将 KV Key 还原为可读 URL
 * 输入: _college_study_STEM_B64:5Lyg5oSf5Zmo
 * 输出: /college-study/STEM/传感器
 */
function decodePageKey(key) {
    if (key === "site_total_pv") return "全站总访问量";
    
    // 去掉开头的 _
    if (key.startsWith('_')) key = key.substring(1);
    
    const segments = key.split('_');
    
    const decodedSegments = segments.map(seg => {
        // 检查是否是 Base64 标记段
        if (seg.startsWith('B64:')) {
            let b64 = seg.substring(4); // 去掉 B64:
            
            // 还原 Base64 特殊字符
            // :A -> +, :B -> /
            b64 = b64.replace(/:A/g, '+').replace(/:B/g, '/');
            
            // 补全 padding (=)
            while (b64.length % 4 !== 0) {
                b64 += '=';
            }
            
            try {
                // Base64 -> UTF-8 String
                const binString = atob(b64);
                const bytes = Uint8Array.from(binString, c => c.charCodeAt(0));
                return new TextDecoder().decode(bytes);
            } catch (e) {
                return seg; // 解码失败返回原串
            }
        }
        
        // 普通英文段，如果有需要可以把 _ 还原回 - (视你的需求而定，这里不做不可逆的假设)
        return seg;
    });
    
    return '/' + decodedSegments.join('/');
}