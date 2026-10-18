'use strict';
// Pi Mobile: authenticated loopback HTTP bridge to Pi's JSONL RPC protocol.
// No dependencies beyond Node.js. Never bind to external interfaces.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PI_MOBILE_PORT || 8765);
const TOKEN_FILE = process.env.PI_MOBILE_TOKEN_FILE || path.join(os.homedir(), '.pi', 'agent', 'pi-mobile.token');
const WORKSPACE = process.env.PI_MOBILE_WORKSPACE || path.join(os.homedir(), 'projects');
const PI_BIN = process.env.PI_MOBILE_PI_BIN || 'pi';
const ALLOWED_COMMANDS = new Set(['prompt', 'abort', 'get_state', 'get_messages', 'get_available_models', 'set_model', 'new_session', 'get_commands', 'set_thinking_level']);

function getToken() {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true, mode: 0o700 });
  if (fs.existsSync(TOKEN_FILE)) {
    const old = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(old)) throw Error('Invalid token file: ' + TOKEN_FILE);
    fs.chmodSync(TOKEN_FILE, 0o600);
    return old;
  }
  const token = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(TOKEN_FILE, token + '\n', { mode: 0o600, flag: 'wx' });
  return token;
}
const token = getToken();
fs.mkdirSync(WORKSPACE, { recursive: true });
let processAlive = false;
let lastError = null;
let nextId = 0;
let pending = new Map();
const streams = new Set();
const proc = spawn(PI_BIN, ['--mode', 'rpc'], {
  cwd: WORKSPACE, env: process.env, stdio: ['pipe', 'pipe', 'pipe']
});

function sendSse(res, data) {
  if (res.destroyed || res.writableEnded) return;
  try { res.write('data: ' + JSON.stringify(data) + '\n\n'); } catch { streams.delete(res); }
}
function broadcast(data) { for (const stream of streams) sendSse(stream, data); }
let stdoutBuf = '';
proc.stdout.setEncoding('utf8');
proc.stdout.on('data', chunk => {
  stdoutBuf += chunk;
  let i;
  while ((i = stdoutBuf.indexOf('\n')) >= 0) {
    const line = stdoutBuf.slice(0, i).replace(/\r$/, '');
    stdoutBuf = stdoutBuf.slice(i + 1);
    if (!line) continue;
    let frame;
    try { frame = JSON.parse(line); } catch { broadcast({type:'bridge_error',message:'Invalid JSON from Pi'}); continue; }
    if (frame.type === 'response' && frame.id && pending.has(frame.id)) {
      const p = pending.get(frame.id);
      pending.delete(frame.id); clearTimeout(p.timer); p.resolve(frame);
    } else if (frame.type !== 'response') broadcast(frame);
  }
  if (stdoutBuf.length > 2 * 1024 * 1024) stdoutBuf = '';
});
proc.stderr.setEncoding('utf8');
proc.stderr.on('data', chunk => { console.error('[pi]', chunk.slice(0, 1500).trimEnd()); });
proc.on('spawn', () => { processAlive = true; console.log('Pi RPC started. Workspace:', WORKSPACE); });
proc.on('error', e => { lastError = e.message; broadcast({type:'bridge_error',message:lastError}); });
proc.on('exit', (code, signal) => {
  processAlive = false;
  lastError = `Pi exited (code=${code}, signal=${signal})`;
  for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error(lastError)); }
  pending.clear(); broadcast({type:'bridge_error',message:lastError});
});

function sendRpc(command) {
  return new Promise((resolve, reject) => {
    if (!processAlive || !proc.stdin.writable) return reject(Error(lastError || 'Pi RPC unavailable'));
    const id = 'mobile-' + (++nextId);
    const timer = setTimeout(() => { pending.delete(id); reject(Error('Pi RPC timeout')); }, 30000);
    pending.set(id, {resolve,reject,timer});
    proc.stdin.write(JSON.stringify({...command, id}) + '\n', 'utf8', error => {
      if (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  });
}
function json(res, status, data) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}
function authorized(req) {
  const bearer = req.headers.authorization || '';
  const provided = bearer.startsWith('Bearer ') ? bearer.slice(7) : '';
  if (provided.length !== token.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(token));
}
const server = http.createServer(async (req,res) => {
  res.setHeader('X-Frame-Options', 'DENY');
  // Reject rebinding and browser cross-origin access; companion WebView uses this exact origin.
  if (req.headers.host !== `${HOST}:${PORT}`) return json(res, 403, {error:'Host rejected'});
  const origin = req.headers.origin;
  if (origin && origin !== `http://${HOST}:${PORT}`) return json(res, 403, {error:'Origin rejected'});
  res.setHeader('Access-Control-Allow-Origin', `http://${HOST}:${PORT}`);
  res.setHeader('Vary','Origin');
  if (req.method === 'OPTIONS') return json(res, 403, {error:'Cross-origin requests disabled'});
  if (req.method === 'GET' && req.url === '/health') return json(res, 200, {ok:true, piRunning:processAlive, error:lastError});
  if (!authorized(req)) return json(res, 401, {error:'Token inválido. Confira no Termux.'});
  if (req.headers['x-pi-mobile'] !== '1') return json(res, 403, {error:'Missing client header'});
  if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, {'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
    streams.add(res); sendSse(res, {type:'bridge_connected'});
    const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 20000);
    req.on('close', () => { clearInterval(ping); streams.delete(res); });
    return;
  }
  if (req.method !== 'POST' || req.url !== '/rpc') return json(res,404,{error:'Not found'});
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res,415,{error:'JSON required'});
  let body='';
  try {
    for await (const chunk of req) {
      body += chunk.toString('utf8');
      if (body.length > 64 * 1024) return json(res,413,{error:'Payload too large'});
    }
    const command = JSON.parse(body);
    if (!command || !ALLOWED_COMMANDS.has(command.type)) return json(res,400,{error:'Unsupported RPC command'});
    if (command.type === 'prompt' && (typeof command.message !== 'string' || !command.message.trim() || command.message.length > 40000)) return json(res,400,{error:'Invalid prompt'});
    if (command.type === 'set_model' && (typeof command.provider !== 'string' || typeof command.modelId !== 'string')) return json(res,400,{error:'Invalid model'});
    const result = await sendRpc(command);
    return json(res,result.success === false ? 400 : 200,result);
  } catch(e) { return json(res,503,{error:e.message}); }
});
server.listen(PORT, HOST, () => {
  console.log(`Pi Mobile on http://${HOST}:${PORT}`);
  console.log(`Your app access token: ${token}`);
  console.log(`To re-open token: cat ${TOKEN_FILE}`);
});
function shutdown() { server.close(); proc.stdin.end(); setTimeout(()=>proc.kill('SIGTERM'),3000).unref(); }
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);
