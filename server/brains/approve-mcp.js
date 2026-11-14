#!/usr/bin/env node
// A tiny MCP server that Claude Code calls when it needs permission for a tool.
// It asks the DeskHive server, which decides by the agent's autonomy and, for risky
// steps, raises the agent's hand in the office and waits for you to say yes or no.
//
// Claude Code starts it with: --mcp-config <file> --permission-prompt-tool mcp__deskhive__approve
// Env: DESKHIVE_URL, DESKHIVE_TOKEN, DESKHIVE_AGENT

const URL_BASE = process.env.DESKHIVE_URL || 'http://127.0.0.1:8080';
const TOKEN = process.env.DESKHIVE_TOKEN || '';
const AGENT = process.env.DESKHIVE_AGENT || '';

function send(msg) { process.stdout.write(`${JSON.stringify(msg)}\n`); }

const TOOL = {
  name: 'approve',
  description: 'Ask the DeskHive human whether a tool call may run.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_name: { type: 'string' },
      input: { type: 'object' },
      tool_use_id: { type: 'string' },
    },
    required: ['tool_name', 'input'],
  },
};

async function decide(args) {
  try {
    const res = await fetch(`${URL_BASE}/api/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, agent: AGENT, tool: args.tool_name, input: args.input || {} }),
    });
    const j = await res.json();
    if (j.behavior === 'allow') return { behavior: 'allow', updatedInput: args.input || {} };
    return { behavior: 'deny', message: j.message || 'The human said no.' };
  } catch (e) {
    return { behavior: 'deny', message: `DeskHive is not reachable (${e.message}).` };
  }
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'deskhive', version: '0.3.0' } } });
  }
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: [TOOL] } });
  if (method === 'tools/call') {
    if (params?.name !== 'approve') return send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'unknown tool' } });
    const decision = await decide(params.arguments || {});
    return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(decision) }] } });
  }
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (id !== undefined && id !== null) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `no method ${method}` } });
}

let buf = '';
process.stdin.on('data', d => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    handle(msg).catch(e => { if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } }); });
  }
});
process.stdin.on('end', () => process.exit(0));
