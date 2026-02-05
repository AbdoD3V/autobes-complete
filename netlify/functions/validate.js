const fetch = (...args) => import('node-fetch').then(({default: fetch})=>fetch(...args));

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const HF_API_KEY = process.env.HF_API_KEY;
  const HF_MODEL = process.env.HF_MODEL || 'gpt2';
  if(!HF_API_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'HF_API_KEY not configured on Netlify env' }) };

  let body;
  try { body = JSON.parse(event.body); } catch(e) { return { statusCode:400, body: 'invalid json' }; }
  const { text, field } = body;
  if(!text) return { statusCode:400, body: 'missing text' };

  // build arabic prompt instructing a strict validator to respond with JSON
  const prompt = `تحقق بدقة مما إذا كانت الكلمة التالية صحيحة كـ"${field}" باللغة العربية. أعطِ إجابة بصيغة JSON فقط مع الحقول: ok (true/false), reason (نص بالعربية إذا خاطئ), suggestions (قائمة اقتراحات إن وجدت). كن صارمًا.

الكلمة: "${text}"

استجب فقط بJSON.`;

  try{
    const hfResp = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${HF_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: prompt, parameters:{ max_new_tokens: 150, temperature:0.2 } })
    });

    if(!hfResp.ok){
      const txt = await hfResp.text();
      return { statusCode: 502, body: JSON.stringify({ ok:false, reason:'hf error', detail: txt }) };
    }

    const json = await hfResp.json();
    // model output shape varies; try to extract generated text
    let gen = '';
    if(Array.isArray(json) && json[0] && typeof json[0].generated_text === 'string') gen = json[0].generated_text;
    else if(json.generated_text) gen = json.generated_text;
    else if(Array.isArray(json) && json[0] && json[0].error) return { statusCode:502, body: JSON.stringify({ ok:false, reason: json[0].error }) };
    else if(typeof json === 'string') gen = json;

    // try to extract JSON from generated text
    const firstBrace = gen.indexOf('{');
    const lastBrace = gen.lastIndexOf('}');
    if(firstBrace!==-1 && lastBrace!==-1 && lastBrace>firstBrace){
      const candidate = gen.slice(firstBrace, lastBrace+1);
      try{
        const parsed = JSON.parse(candidate);
        return { statusCode:200, body: JSON.stringify(parsed) };
      }catch(err){
        // continue to suggestions fallback
      }
    }

    // If model didn't return parsable JSON, try a second focused call asking only for suggestions
    try{
      const prompt2 = `اقترح قائمة قصيرة (3-6) كلمات عربية صحيحة ومماثلة للكلمة التالية، بدون شرح، أعطِ الاستجابة كـJSON بالصيغة {"suggestions": ["..", ".."]} فقط.\n\nالكلمة: "${text}"`;
      const hf2 = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${HF_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: prompt2, parameters:{ max_new_tokens: 80, temperature:0.2 } })
      });
      const j2 = await hf2.json();
      let gen2 = '';
      if(Array.isArray(j2) && j2[0] && typeof j2[0].generated_text === 'string') gen2 = j2[0].generated_text;
      else if(j2.generated_text) gen2 = j2.generated_text;
      else gen2 = typeof j2 === 'string' ? j2 : '';

      const fb1 = gen2.indexOf('{');
      const fb2 = gen2.lastIndexOf('}');
      if(fb1!==-1 && fb2!==-1 && fb2>fb1){
        const candidate2 = gen2.slice(fb1, fb2+1);
        try{
          const parsed2 = JSON.parse(candidate2);
          // respond with suggestions but mark ok as false so client can prompt user to correct
          return { statusCode:200, body: JSON.stringify({ ok:false, reason:'اقتراحات بديلة', suggestions: parsed2.suggestions||[] }) };
        }catch(err){ /* continue to heuristic */ }
      }
    }catch(e){ /* ignore suggestions failure and fall back */ }

    // fallback heuristic: accept if word length>1 and contains arabic letters; no suggestions
    const arabicRegex = /[\u0600-\u06FF]/;
    const ok = text.length>1 && arabicRegex.test(text);
    const result = { ok, reason: ok? 'مقبول (تحقق احتياطي)': 'لا يبدو كلمة عربية صحيحة', suggestions: [] };
    return { statusCode:200, body: JSON.stringify(result) };

  }catch(err){
    return { statusCode:500, body: JSON.stringify({ ok:false, reason: 'internal error', detail: String(err) }) };
  }
};
