/**
 * @author: kared
 * @create_date: 2025-05-10 21:15:59
 * @last_editors: kared
 * @last_edit_time: 2025-05-11 01:25:36
 * @description: This Cloudflare Worker script handles image generation.
 */

// import html template
import HTML from './index.html';

// Available models list
const AVAILABLE_MODELS = [
  {
    id: 'stable-diffusion-xl-base-1.0',
    name: 'Stable Diffusion XL Base 1.0',
    description: 'Stability AI SDXL 文生图模型',
    key: '@cf/stabilityai/stable-diffusion-xl-base-1.0',
    requiresImage: false
  },
  {
    id: 'flux-1-schnell',
    name: 'FLUX.1 [schnell]',
    description: '精确细节表现的高性能文生图模型',
    key: '@cf/black-forest-labs/flux-1-schnell',
    requiresImage: false
  },
  {
    id: 'dreamshaper-8-lcm',
    name: 'DreamShaper 8 LCM',
    description: '增强图像真实感的 SD 微调模型',
    key: '@cf/lykon/dreamshaper-8-lcm',
    requiresImage: false
  },
  {
    id: 'stable-diffusion-xl-lightning',
    name: 'Stable Diffusion XL Lightning',
    description: '更加高效的文生图模型',
    key: '@cf/bytedance/stable-diffusion-xl-lightning',
    requiresImage: false
  },
  {
    id: 'stable-diffusion-v1-5-img2img',
    name: 'Stable Diffusion v1.5 图生图',
    description: '将输入图像风格化或变换（需要提供图像URL）',
    key: '@cf/runwayml/stable-diffusion-v1-5-img2img',
    requiresImage: true
  },
  {
    id: 'stable-diffusion-v1-5-inpainting',
    name: 'Stable Diffusion v1.5 局部重绘',
    description: '根据遮罩对局部区域进行重绘（需要图像URL，可选遮罩URL）',
    key: '@cf/runwayml/stable-diffusion-v1-5-inpainting',
    requiresImage: true,
    requiresMask: true
  }
];

// Random prompts list (Chinese)
const RANDOM_PROMPTS = [
  '赛博朋克风城市夜景，霓虹灯雨夜街道，反光地面，强烈对比度，广角镜头，电影感',
  '清晨森林小径，阳光穿过树叶薄雾弥漫，柔和光线，高饱和度，超清细节',
  '水墨山水，远山近水小桥人家，留白构图，国画风格，淡雅色调',
  '可爱橘猫坐在窗台，落日与晚霞，暖色调，浅景深，柔焦',
  '科幻机甲战士，蓝色能量核心，强烈光影，硬边金属质感，战损细节',
  '复古胶片风人像，暖色调，轻微颗粒，高光溢出，自然肤色，50mm',
  '海边灯塔与星空，银河拱桥，长曝光，拍岸浪花，清冷色调',
  '蒸汽朋克飞船穿越云层，黄铜齿轮与管道，体积光，戏剧化天空',
  '古风少女立于竹林，微风拂过衣袂，侧光，国风写意，细腻材质',
  '极光下雪原与麋鹿，宁静辽阔，低饱和度，广角远景，细腻噪点控制',
];

// --- Simple language detection and translation helpers ---
const looksEnglish = (text) => {
  if (!text) return true;
  // If contains any non-ASCII, treat as non-English
  if (/[^\x00-\x7F]/.test(text)) return false;
  // ASCII-only: assume English to avoid over-translation
  return true;
};

async function translateToEnglishIfNeeded(text, env) {
  try {
    if (!text || looksEnglish(text)) return text;
    // Prefer model from env, else use a sensible default Llama Instruct
    const model = (env && env.AI_TRANSLATE_MODEL) || '@cf/meta/llama-3.1-8b-instruct';
    if (!env || !env.AI || typeof env.AI.run !== 'function') return text;
    const system = 'You are a professional translator. Translate the user text into natural, concise English. Output English translation only, no quotes, no explanations.';
    const user = `Translate into English:\n${text}`;
    const res = await env.AI.run(model, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.2,
    });
    // Cloudflare text models typically return { response: '...' } or similar
    if (res && typeof res === 'object') {
      const out = res.response || res.text || res.output || '';
      if (typeof out === 'string' && out.trim()) return out.trim();
      // Some models return choices
      if (Array.isArray(res.choices) && res.choices[0] && res.choices[0].message && res.choices[0].message.content) {
        const alt = String(res.choices[0].message.content || '').trim();
        if (alt) return alt;
      }
    } else if (typeof res === 'string' && res.trim()) {
      return res.trim();
    }
  } catch (_) {
    // ignore and fall back to original text
  }
  return text;
}

// Passwords for authentication
// demo: const PASSWORDS = ['P@ssw0rd']
const PASSWORDS = ['admin123']


export default {
  async fetch(request, env) {
    const originalHost = request.headers.get("host");

    // CORS Headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders
      });
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // process api requests
      if (path === '/api/models') {
        // get available models list
        return new Response(JSON.stringify(AVAILABLE_MODELS), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      } else if (path === '/api/prompts') {
        // get random prompts list
        return new Response(JSON.stringify(RANDOM_PROMPTS), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      } else if (path === '/api/config') {
        // expose minimal config to client
        return new Response(JSON.stringify({ require_password: PASSWORDS.length > 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } else if (path === '/api/auth/status') {
        // check auth status by cookie
        const cookieHeader = request.headers.get('cookie') || '';
        const authedByCookie = /(?:^|;\s*)auth=1(?:;|$)/.test(cookieHeader);
        const ok = PASSWORDS.length === 0 ? true : authedByCookie;
        return new Response(JSON.stringify({ authed: ok }), {
          status: ok ? 200 : 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } else if (path === '/api/auth' && request.method === 'POST') {
        // perform password authentication and set cookie
        const data = await request.json().catch(() => ({}));
        const ok = PASSWORDS.length === 0 ? true : (data && typeof data.password === 'string' && PASSWORDS.includes(data.password));
        if (!ok) {
          return new Response(JSON.stringify({ error: '密码错误' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        const cookie = `auth=1; Path=/; Max-Age=${7 * 24 * 3600}; HttpOnly; SameSite=Lax; Secure`;
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Set-Cookie': cookie }
        });
      } else if (request.method === 'POST') {
        // process POST request for image generation
        const data = await request.json();
        
        // Check if password is required and valid (Cookie or request body)
        const cookieHeader = request.headers.get('cookie') || '';
        const authedByCookie = /(?:^|;\s*)auth=1(?:;|$)/.test(cookieHeader);
        const authedByBody = data && typeof data.password === 'string' && PASSWORDS.includes(data.password);
        if (PASSWORDS.length > 0 && !(authedByCookie || authedByBody)) {
          return new Response(JSON.stringify({ error: '需要正确的访问密码' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        if ('prompt' in data && 'model' in data) {
          const selectedModel = AVAILABLE_MODELS.find(m => m.id === data.model);
          if (!selectedModel) {
            return new Response(JSON.stringify({ error: 'Model is invalid' }), { 
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          const model = selectedModel.key;
          let inputs = {};
          const fetchImageToBytes = async (url, label) => {
            const resp = await fetch(url);
            if (!resp.ok) {
              return { error: `${label}获取失败，HTTP ${resp.status}` };
            }
            const ct = resp.headers.get('content-type') || '';
            if (!ct.startsWith('image/')) {
              return { error: `${label}不是图片资源，content-type=${ct}` };
            }
            const cl = parseInt(resp.headers.get('content-length') || '0', 10);
            // 设定 10MB 上限，避免大文件触发内部错误
            if (cl && cl > 10 * 1024 * 1024) {
              return { error: `${label}体积过大(${(cl/1024/1024).toFixed(2)}MB)，请不超过10MB` };
            }
            const bytes = new Uint8Array(await resp.arrayBuffer());
            return { bytes, contentType: ct, size: bytes.length };
          };
          const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
          const sanitizeDimension = (val, def = 512) => {
            let v = typeof val === 'number' ? val : def;
            v = clamp(v, 256, 2048);
            // 四舍五入到最近的64倍数
            v = Math.round(v / 64) * 64;
            return v;
          };
          
          // Input parameter processing
          if (data.model === 'flux-1-schnell') {
            let steps = data.num_steps || 6;
            if (steps >= 8) steps = 8;
            else if (steps <= 4) steps = 4;
            
            // Only prompt and steps
            {
              const rawPrompt = data.prompt || 'cyberpunk cat';
              const promptEn = await translateToEnglishIfNeeded(rawPrompt, env);
              inputs = { prompt: promptEn, steps };
            }
          } else if (
            data.model === 'stable-diffusion-v1-5-img2img' ||
            data.model === 'stable-diffusion-v1-5-inpainting'
          ) {
            // 图生图 / 局部重绘需要图像URL
            if (!data.image_url) {
              return new Response(JSON.stringify({ error: '该模型需要提供 image_url 参数（输入图像 URL）' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }

            // 拉取输入图像/遮罩为二进制并校验
            const imageResult = await fetchImageToBytes(data.image_url, '输入图像');
            if (imageResult.error) {
              return new Response(JSON.stringify({ error: imageResult.error }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }

            let maskBytes = undefined;
            if (data.model === 'stable-diffusion-v1-5-inpainting') {
              if (!data.mask_url) {
                return new Response(JSON.stringify({ error: '该模型需要提供 mask_url 参数（遮罩图像 URL）' }), {
                  status: 400,
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
              const maskResult = await fetchImageToBytes(data.mask_url, '遮罩图像');
              if (maskResult.error) {
                return new Response(JSON.stringify({ error: maskResult.error }), {
                  status: 400,
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
              maskBytes = maskResult.bytes;
            }

            // 兼容一些模型对字段命名的要求：有的需要 mask_image
            {
              const rawPrompt = data.prompt || 'cyberpunk cat';
              const rawNeg = data.negative_prompt || '';
              const promptEn = await translateToEnglishIfNeeded(rawPrompt, env);
              const negativeEn = await translateToEnglishIfNeeded(rawNeg, env);
              inputs = {
                prompt: promptEn,
                negative_prompt: negativeEn,
              // 建议使用更小的分辨率，避免 3001 内部错误
                height: sanitizeDimension(parseInt(data.height, 10) || 512, 512),
                width: sanitizeDimension(parseInt(data.width, 10) || 512, 512),
                num_steps: clamp(parseInt(data.num_steps, 10) || 20, 1, 50),
                strength: clamp(parseFloat(data.strength ?? 0.8), 0.0, 1.0),
                guidance: clamp(parseFloat(data.guidance ?? 7.5), 0.0, 30.0),
                seed: data.seed || parseInt((Math.random() * 1024 * 1024).toString(), 10),
                image: [...imageResult.bytes],
                ...(maskBytes ? { mask: [...maskBytes], mask_image: [...maskBytes] } : {})
              };
            }
          } else {
            // Default input parameters
            {
              const rawPrompt = data.prompt || 'cyberpunk cat';
              const rawNeg = data.negative_prompt || '';
              const promptEn = await translateToEnglishIfNeeded(rawPrompt, env);
              const negativeEn = await translateToEnglishIfNeeded(rawNeg, env);
              inputs = {
                prompt: promptEn,
                negative_prompt: negativeEn,
                height: data.height || 1024,
                width: data.width || 1024,
                num_steps: data.num_steps || 20,
                strength: data.strength || 0.1,
                guidance: data.guidance || 7.5,
                seed: data.seed || parseInt((Math.random() * 1024 * 1024).toString(), 10),
              };
            }
          }

          console.log(`Generating image with ${model} and prompt: ${inputs.prompt.substring(0, 50)}...`);
          
          try {
            const numOutputs = clamp(parseInt(data.num_outputs, 10) || 1, 1, 8);
            const generateOnce = async (seedOffset = 0) => {
              const localInputs = { ...inputs };
              if (typeof localInputs.seed === 'number') localInputs.seed = localInputs.seed + seedOffset;
              const t0 = Date.now();
              const res = await env.AI.run(model, localInputs);
              const t1 = Date.now();
              return { res, seconds: (t1 - t0) / 1000 };
            };

            // helper: convert bytes to base64
            const bytesToBase64 = (bytes) => {
              let binary = '';
              const chunk = 0x8000;
              for (let i = 0; i < bytes.length; i += chunk) {
                const sub = bytes.subarray(i, i + chunk);
                binary += String.fromCharCode.apply(null, sub);
              }
              return btoa(binary);
            };

            if (numOutputs > 1) {
              const tasks = Array.from({ length: numOutputs }, (_, i) => generateOnce(i));
              const results = await Promise.all(tasks);
              const secondsAvg = results.reduce((s, r) => s + r.seconds, 0) / results.length;

              const images = [];
              for (const { res } of results) {
                if (data.model === 'flux-1-schnell') {
                  const json = typeof res === 'object' ? res : JSON.parse(res);
                  if (!json.image) throw new Error('Invalid response from FLUX: missing image');
                  images.push(`data:image/png;base64,${json.image}`);
                } else {
                  // binary bytes -> base64
                  let bytes;
                  if (res instanceof Uint8Array) bytes = res;
                  else if (res && typeof res === 'object' && typeof res.byteLength === 'number') bytes = new Uint8Array(res);
                  else bytes = new Uint8Array(await new Response(res).arrayBuffer());
                  images.push(`data:image/png;base64,${bytesToBase64(bytes)}`);
                }
              }

              return new Response(JSON.stringify({ images }), {
                headers: {
                  ...corsHeaders,
                  'Content-Type': 'application/json',
                  'X-Used-Model': selectedModel.id,
                  'X-Server-Seconds': secondsAvg.toFixed(3),
                }
              });
            }

            const { res: response, seconds: serverSeconds } = await generateOnce(0);
  
            // Processing the response of the flux-1-schnell model
            if (data.model === 'flux-1-schnell') {
              let jsonResponse;
  
              if (typeof response === 'object') {
                jsonResponse = response;
              } else {
                try {
                  jsonResponse = JSON.parse(response);
                } catch (e) {
                  console.error('Failed to parse JSON response:', e);
                  return new Response(JSON.stringify({ 
                    error: 'Failed to parse response',
                    details: e.message
                  }), { 
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                  });
                }
              }
  
              if (!jsonResponse.image) {
                return new Response(JSON.stringify({ 
                  error: 'Invalid response format',
                  details: 'Image data not found in response'
                }), { 
                  status: 500,
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
  
              try {
                // Convert from base64 to binary data
                const binaryString = atob(jsonResponse.image);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
  
                // Returns binary data in PNG format
                return new Response(bytes, {
                  headers: {
                    ...corsHeaders,
                    'content-type': 'image/png',
                    'X-Used-Model': selectedModel.id,
                    ...(inputs.seed ? { 'X-Seed': String(inputs.seed) } : {}),
                    'X-Image-Bytes': String(bytes.length),
                    'X-Server-Seconds': serverSeconds.toFixed(3),
                  },
                });
              } catch (e) {
                console.error('Failed to convert base64 to binary:', e);
                return new Response(JSON.stringify({ 
                  error: 'Failed to process image data',
                  details: e.message
                }), { 
                  status: 500,
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
            } else {
                // Return the response directly (binary)
                let imageByteSize = undefined;
                try {
                  if (response && typeof response === 'object') {
                    if (response instanceof Uint8Array) imageByteSize = response.length;
                    // ArrayBuffer has byteLength
                    if (typeof response.byteLength === 'number') imageByteSize = response.byteLength;
                  }
                } catch (_) {}

                return new Response(response, {
                  headers: {
                    ...corsHeaders,
                    'content-type': 'image/png',
                    'X-Used-Model': selectedModel.id,
                    ...(inputs.seed ? { 'X-Seed': String(inputs.seed) } : {}),
                    ...(imageByteSize ? { 'X-Image-Bytes': String(imageByteSize) } : {}),
                    'X-Server-Seconds': serverSeconds.toFixed(3),
                  },
                });
              }
            } catch (aiError) {
            console.error('AI generation error:', aiError);
            return new Response(JSON.stringify({ 
              error: 'Image generation failed',
              details: aiError && (aiError.message || aiError.toString()),
              model: selectedModel.id
            }), { 
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        } else {
          return new Response(JSON.stringify({ error: 'Missing required parameter: prompt or model' }), { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }
      } else if (path.endsWith('.html') || path === '/') {
        // redirect to index.html for HTML requests
        return new Response(HTML.replace(/{{host}}/g, originalHost), {
          status: 200,
          headers: {
            ...corsHeaders,
            "content-type": "text/html"
          }
        });
      } else {
        return new Response('Not Found', { status: 404 });
      }
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  },
};

