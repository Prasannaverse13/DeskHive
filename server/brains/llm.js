// Two adapters, one shape. Every API brain speaks this neutral history:
//   { role: 'user', content }
//   { role: 'assistant', text, toolCalls: [{ id, name, args }] }
//   { role: 'tool', id, name, content }
// and every call returns { text, toolCalls, usage }.

const UA = 'DeskHive/0.2';

async function readError(res) {
  let body = '';
  try { body = await res.text(); } catch { /* */ }
  let msg = body;
  try { const j = JSON.parse(body); msg = j.error?.message || j.error?.type || j.message || body; } catch { /* */ }
  const hint = res.status === 401 ? ' (check the API key)' : res.status === 404 ? ' (check the model name or base URL)' : res.status === 429 ? ' (rate limited or out of credit)' : '';
  return new Error(`${res.status} ${String(msg).slice(0, 200)}${hint}`);
}

// ---------------------------------------------------------------- OpenAI compatible (OpenAI, Grok, Gemini, OpenRouter, Ollama, custom)
export async function openaiChat({ baseUrl, key, model, system, history, tools, signal, maxTokens = 2000, flavor = '' }) {
  if (!baseUrl) throw new Error('No base URL set for this brain');
  const messages = [{ role: 'system', content: system }];
  for (const h of history) {
    if (h.role === 'user') messages.push({ role: 'user', content: h.content });
    else if (h.role === 'assistant') {
      const m = { role: 'assistant', content: h.text || '' };
      if (h.toolCalls?.length) m.tool_calls = h.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } }));
      messages.push(m);
    } else if (h.role === 'tool') messages.push({ role: 'tool', tool_call_id: h.id, content: String(h.content) });
  }
  const body = { model, messages, max_tokens: maxTokens };
  // Meta Model API: newer token parameter, and keep reasoning light so agents answer fast.
  if (flavor === 'meta' || baseUrl.includes('api.meta.ai')) { delete body.max_tokens; body.max_completion_tokens = maxTokens; body.reasoning_effort = 'low'; }
  if (tools?.length) {
    body.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    body.tool_choice = 'auto';
  }
  const headers = { 'content-type': 'application/json', 'user-agent': UA };
  if (key) headers.authorization = `Bearer ${key}`;
  if (baseUrl.includes('openrouter.ai')) { headers['HTTP-Referer'] = 'https://github.com/deskhive'; headers['X-Title'] = 'DeskHive'; }
  let res = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal });
  // Some APIs reject a parameter: fix it and try again (newer models want max_completion_tokens).
  for (let fix = 0; fix < 2 && res.status === 400; fix++) {
    const err = await readError(res);
    if (/max_tokens/.test(err.message) && body.max_tokens) { delete body.max_tokens; body.max_completion_tokens = maxTokens; }
    else if (/reasoning_effort/.test(err.message) && body.reasoning_effort) delete body.reasoning_effort;
    else throw err;
    res = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal });
  }
  if (!res.ok) throw await readError(res);
  const j = await res.json();
  const msg = j.choices?.[0]?.message || {};
  const toolCalls = (msg.tool_calls || []).map((c, i) => {
    let args = {};
    try { args = typeof c.function?.arguments === 'string' ? JSON.parse(c.function.arguments || '{}') : (c.function?.arguments || {}); } catch { args = { _raw: c.function?.arguments }; }
    return { id: c.id || `call_${Date.now()}_${i}`, name: c.function?.name, args };
  });
  const text = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map(p => p.text || '').join('') : '';
  return { text: text || '', toolCalls, usage: j.usage || null };
}

// ---------------------------------------------------------------- Anthropic Messages API
export async function anthropicChat({ key, model, system, history, tools, signal, maxTokens = 2000, baseUrl = 'https://api.anthropic.com' }) {
  if (!key) throw new Error('No Anthropic API key set');
  const messages = [];
  const push = (role, block) => {
    const last = messages[messages.length - 1];
    if (last && last.role === role && Array.isArray(last.content)) last.content.push(block);
    else messages.push({ role, content: [block] });
  };
  for (const h of history) {
    if (h.role === 'user') push('user', { type: 'text', text: h.content });
    else if (h.role === 'assistant') {
      if (h.text) push('assistant', { type: 'text', text: h.text });
      for (const c of h.toolCalls || []) push('assistant', { type: 'tool_use', id: c.id, name: c.name, input: c.args || {} });
    } else if (h.role === 'tool') push('user', { type: 'tool_result', tool_use_id: h.id, content: String(h.content) });
  }
  const body = { model, system, messages, max_tokens: maxTokens };
  if (tools?.length) body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'user-agent': UA },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw await readError(res);
  const j = await res.json();
  let text = '';
  const toolCalls = [];
  for (const b of j.content || []) {
    if (b.type === 'text') text += b.text;
    else if (b.type === 'tool_use') toolCalls.push({ id: b.id, name: b.name, args: b.input || {} });
  }
  return { text, toolCalls, usage: j.usage || null };
}
