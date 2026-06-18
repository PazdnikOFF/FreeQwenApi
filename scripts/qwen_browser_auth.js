#!/usr/bin/env node
/**
 * Qwen browser auth — HTTP-сервер + SSH-туннель + букмарклет.
 *
 * Запустите на сервере:
 *   node scripts/qwen_browser_auth.js
 *
 * Скрипт выведет SSH-команду и ссылку. Откройте страницу, перетащите
 * кнопку в закладки, войдите в Qwen, кликните закладку — готово.
 *
 * ENV:
 *   QWEN_AUTH_PORT     — порт HTTP-сервера (default: 9336)
 *   QWEN_AUTH_TIMEOUT  — таймаут в секундах (default: 300)
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const port = Number(process.env.QWEN_AUTH_PORT || 9336);
const timeoutSec = Number(process.env.QWEN_AUTH_TIMEOUT || 300);

const SESSION_DIR = path.join(ROOT, 'session');
const ACCOUNTS_DIR = path.join(SESSION_DIR, 'accounts');
const TOKENS_FILE = path.join(SESSION_DIR, 'tokens.json');

function buildHtml(p) {
  const bookmarklet = `javascript:(function(){var t=localStorage.getItem('active_token');if(!t||!t.startsWith('eyJ')){alert('Токен не найден. Убедитесь, что вы вошли в аккаунт Qwen.');return;}fetch('http://localhost:${p}/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:t})}).then(function(r){return r.json();}).then(function(d){if(d.ok){alert('\\u2705 Токен сохранён! '+d.id);}else{alert('Ошибка: '+(d.error||'?'));}}).catch(function(e){alert('Ошибка соединения с localhost:${p} — '+e.message);});})();`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Qwen Auth</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#0f0f0f;color:#e0e0e0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
  .card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:14px;padding:32px;max-width:500px;width:100%}
  h1{font-size:1.25rem;color:#fff;margin-bottom:4px}
  .sub{color:#666;font-size:.8rem;margin-bottom:28px}
  .step{display:flex;gap:14px;margin-bottom:22px}
  .num{background:#222;border:1px solid #333;border-radius:50%;width:28px;height:28px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.75rem;color:#888;margin-top:1px}
  .step-body{flex:1}
  .step-body p{font-size:.875rem;line-height:1.5}
  .step-body .hint{color:#666;font-size:.75rem;margin-top:4px}
  a.qwen-link{display:inline-flex;align-items:center;gap:6px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:7px;padding:8px 14px;font-size:.825rem;margin-top:8px}
  a.qwen-link:hover{background:#2563eb}
  a.bookmarklet{display:inline-flex;align-items:center;gap:8px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:7px;padding:10px 16px;font-size:.875rem;cursor:grab;user-select:none;border:2px dashed #a78bfa;margin-top:8px}
  a.bookmarklet:hover{background:#6d28d9}
  .drag-hint{color:#a78bfa;font-size:.75rem;margin-top:6px}
  .divider{border:none;border-top:1px solid #222;margin:4px 0 22px}
  .status{margin-top:20px;padding:12px 16px;border-radius:8px;font-size:.85rem;display:none}
  .status.ok{background:#14532d;border:1px solid #16a34a;color:#86efac;display:block}
  .status.err{background:#450a0a;border:1px solid #dc2626;color:#fca5a5;display:block}
</style>
</head>
<body>
<div class="card">
  <h1>Qwen — авторизация</h1>
  <p class="sub">FreeQwenApi · t.me/forgetmeai</p>

  <div class="step">
    <div class="num">1</div>
    <div class="step-body">
      <p>Перетащите эту кнопку в <strong>панель закладок</strong> браузера:</p>
      <a class="bookmarklet" href="${bookmarklet}">📋 Qwen → сохранить токен</a>
      <p class="drag-hint">↑ Тащите в закладки, не кликайте здесь</p>
    </div>
  </div>

  <div class="step">
    <div class="num">2</div>
    <div class="step-body">
      <p>Откройте Qwen и войдите в аккаунт:</p>
      <a class="qwen-link" href="https://chat.qwen.ai" target="_blank">Открыть chat.qwen.ai ↗</a>
    </div>
  </div>

  <div class="step">
    <div class="num">3</div>
    <div class="step-body">
      <p>На странице <strong>chat.qwen.ai</strong> нажмите закладку <em>«Qwen → сохранить токен»</em>.</p>
      <p class="hint">Токен будет отправлен на сервер автоматически.</p>
    </div>
  </div>

  <div class="divider"></div>
  <div id="status" class="status"></div>
</div>
<script>
(function poll(){
  fetch('/status').then(r=>r.json()).then(d=>{
    if(d.done){
      var s=document.getElementById('status');
      s.className='status ok';
      s.textContent='✅ Токен сохранён! Аккаунт: '+d.id+'. Можно закрыть вкладку.';
    } else {
      setTimeout(poll, 2000);
    }
  }).catch(()=>setTimeout(poll,3000));
})();
</script>
</body>
</html>`;
}

function decodeJwt(token) {
  try {
    const [, payload] = token.split('.');
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch { return {}; }
}

function loadTokens() {
  if (!fs.existsSync(TOKENS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); }
  catch { return []; }
}

function saveToken(token) {
  const p = decodeJwt(token);
  const id = p.sub || p.id || p.email || `acc_${Date.now()}`;

  fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });

  const accountDir = path.join(ACCOUNTS_DIR, id);
  fs.mkdirSync(accountDir, { recursive: true });
  fs.writeFileSync(path.join(accountDir, 'token.txt'), token, 'utf8');

  const tokens = loadTokens();
  const existing = tokens.findIndex(t => t.id === id);
  const entry = { id, token, resetAt: null, invalid: false };
  if (existing !== -1) tokens[existing] = entry;
  else tokens.push(entry);

  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), 'utf8');
  return id;
}

function getServerHostname() {
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) return iface.address;
      }
    }
  } catch {}
  return os.hostname();
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return {}; }
}

async function main() {
  let savedId = null;
  const html = buildHtml(port);

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(savedId ? { done: true, id: savedId } : { done: false }));
      return;
    }

    if (req.method === 'POST' && req.url === '/save') {
      const body = await readBody(req);
      const token = String(body.token || '').trim();
      if (!token.startsWith('eyJ') || token.split('.').length !== 3) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid JWT' }));
        return;
      }
      try {
        savedId = saveToken(token);
        console.log(`\n[auth] ✅ Токен сохранён: ${TOKENS_FILE}`);
        console.log(`[auth] Аккаунт: ${savedId}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id: savedId }));
        setTimeout(() => { server.close(); process.exit(0); }, 3000);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

    res.writeHead(404); res.end();
  });

  server.listen(port, '127.0.0.1', () => {
    const hostname = getServerHostname();
    const sshUser = process.env.USER || 'user';
    console.log('\n======================================================');
    console.log('FreeQwenApi — Qwen авторизация');
    console.log('======================================================');
    console.log('\n1. Выполните на своём ПК (SSH-туннель):');
    console.log(`\n   ssh -L ${port}:localhost:${port} ${sshUser}@${hostname}\n`);
    console.log('2. Откройте в браузере на своём ПК:');
    console.log(`\n   http://localhost:${port}\n`);
    console.log('3. Перетащите кнопку в закладки → войдите в Qwen → кликните закладку.');
    console.log('======================================================');
    console.log(`Таймаут: ${timeoutSec}с. Ожидаю токен...\n`);
  });

  setTimeout(() => {
    if (!savedId) {
      console.error(`[auth] Таймаут ${timeoutSec}с. Токен не получен.`);
      server.close();
      process.exit(2);
    }
  }, timeoutSec * 1000);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('[auth] ОШИБКА:', e.message); process.exit(1); });
}
