#!/usr/bin/env node
/**
 * Qwen browser auth — HTTP-сервер + SSH-туннель.
 *
 * Запустите на сервере:
 *   node scripts/qwen_browser_auth.js
 *
 * Скрипт выведет SSH-команду и ссылку. Откройте страницу на своём ПК,
 * следуйте инструкциям — скопируйте токен из Qwen и вставьте в форму.
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

function buildHtml() {
  const tokenCode = `copy(localStorage.getItem('active_token'))`;
  const cookieCode = `copy(document.cookie)`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Qwen Auth</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#0f0f0f;color:#e0e0e0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
  .card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:14px;padding:32px;max-width:520px;width:100%}
  h1{font-size:1.25rem;color:#fff;margin-bottom:4px}
  .sub{color:#666;font-size:.8rem;margin-bottom:28px}
  .step{display:flex;gap:14px;margin-bottom:22px}
  .num{background:#222;border:1px solid #333;border-radius:50%;width:28px;height:28px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.75rem;color:#888;margin-top:2px}
  .step-body{flex:1}
  .step-body p{font-size:.875rem;line-height:1.5}
  .hint{color:#666;font-size:.75rem;margin-top:4px}
  a.qwen-link{display:inline-flex;align-items:center;gap:6px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:7px;padding:8px 14px;font-size:.825rem;margin-top:8px}
  a.qwen-link:hover{background:#2563eb}
  .code-block{display:flex;align-items:center;gap:8px;margin-top:8px}
  code{background:#111;border:1px solid #333;border-radius:6px;padding:8px 12px;font-size:.8rem;color:#a78bfa;font-family:monospace;flex:1;word-break:break-all}
  button.copy-btn{background:#333;border:1px solid #444;color:#ccc;border-radius:6px;padding:8px 12px;font-size:.75rem;cursor:pointer;white-space:nowrap}
  button.copy-btn:hover{background:#444}
  .divider{border:none;border-top:1px solid #222;margin:8px 0 22px}
  textarea{width:100%;background:#111;border:1px solid #333;border-radius:8px;color:#e0e0e0;font-family:monospace;font-size:.8rem;padding:10px 12px;resize:vertical;min-height:80px;margin-top:8px}
  textarea:focus{outline:none;border-color:#7c3aed}
  button.submit-btn{width:100%;background:#7c3aed;color:#fff;border:none;border-radius:8px;padding:12px;font-size:.9rem;cursor:pointer;margin-top:10px}
  button.submit-btn:hover{background:#6d28d9}
  button.submit-btn:disabled{background:#333;color:#666;cursor:not-allowed}
  .status{margin-top:16px;padding:12px 16px;border-radius:8px;font-size:.85rem;display:none}
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
      <p>Откройте Qwen и войдите в аккаунт:</p>
      <a class="qwen-link" href="https://chat.qwen.ai" target="_blank">Открыть chat.qwen.ai ↗</a>
    </div>
  </div>

  <div class="step">
    <div class="num">2</div>
    <div class="step-body">
      <p>Откройте консоль браузера (<strong>F12 → Console</strong>) и скопируйте токен:</p>
      <div class="code-block">
        <code id="tokenCode">${tokenCode}</code>
        <button class="copy-btn" onclick="copyField('tokenCode', this)">Скопировать</button>
      </div>
      <p style="font-size:.875rem;margin-top:12px">Вставьте токен:</p>
      <textarea id="tokenInput" placeholder="eyJ..."></textarea>
    </div>
  </div>

  <div class="step">
    <div class="num">3</div>
    <div class="step-body">
      <p>Там же в консоли скопируйте куки:</p>
      <div class="code-block">
        <code id="cookieCode">${cookieCode}</code>
        <button class="copy-btn" onclick="copyField('cookieCode', this)">Скопировать</button>
      </div>
      <p style="font-size:.875rem;margin-top:12px">Вставьте куки:</p>
      <textarea id="cookieInput" placeholder="acw_tc=...; ctoken=..."></textarea>
    </div>
  </div>

  <div class="step">
    <div class="num">4</div>
    <div class="step-body">
      <button class="submit-btn" onclick="submitToken()">Сохранить</button>
    </div>
  </div>

  <div class="divider"></div>
  <div id="status" class="status"></div>
</div>
<script>
function copyField(id, btn) {
  var text = document.getElementById(id).textContent;
  navigator.clipboard.writeText(text).then(function() {
    var orig = btn.textContent;
    btn.textContent = 'Скопировано!';
    setTimeout(function(){ btn.textContent = orig; }, 2000);
  });
}

function submitToken() {
  var token = document.getElementById('tokenInput').value.trim();
  var cookies = document.getElementById('cookieInput').value.trim();
  if (!token.startsWith('eyJ') || token.split('.').length !== 3) {
    showStatus('err', 'Неверный формат токена. Убедитесь, что скопировали правильно.');
    return;
  }
  var btn = document.querySelector('.submit-btn');
  btn.disabled = true;
  btn.textContent = 'Сохраняем...';
  fetch('/save', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({token: token, cookies: cookies})
  }).then(function(r){ return r.json(); }).then(function(d) {
    if (d.ok) {
      showStatus('ok', '✅ Сохранено! Аккаунт: ' + d.id + '. Можно закрыть вкладку.');
      btn.textContent = 'Сохранено';
    } else {
      showStatus('err', 'Ошибка: ' + (d.error || '?'));
      btn.disabled = false;
      btn.textContent = 'Сохранить';
    }
  }).catch(function(e) {
    showStatus('err', 'Ошибка соединения: ' + e.message);
    btn.disabled = false;
    btn.textContent = 'Сохранить';
  });
}

function showStatus(type, msg) {
  var s = document.getElementById('status');
  s.className = 'status ' + type;
  s.textContent = msg;
}
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

function saveToken(token, cookieString) {
  const p = decodeJwt(token);
  const id = p.sub || p.id || p.email || `acc_${Date.now()}`;

  fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
  const accountDir = path.join(ACCOUNTS_DIR, id);
  fs.mkdirSync(accountDir, { recursive: true });
  fs.writeFileSync(path.join(accountDir, 'token.txt'), token, 'utf8');

  if (cookieString) {
    const cookies = cookieString.split(';').map(pair => {
      const [name, ...rest] = pair.trim().split('=');
      return { name: name.trim(), value: rest.join('=').trim(), domain: 'chat.qwen.ai', path: '/' };
    }).filter(c => c.name);
    fs.writeFileSync(path.join(accountDir, 'cookies.json'), JSON.stringify(cookies, null, 2), 'utf8');
  }

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
  const html = buildHtml();

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

    if (req.method === 'POST' && req.url === '/save') {
      const body = await readBody(req);
      const token = String(body.token || '').trim();
      if (!token.startsWith('eyJ') || token.split('.').length !== 3) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid JWT' }));
        return;
      }
      try {
        const cookieString = String(body.cookies || '').trim();
        savedId = saveToken(token, cookieString);
        console.log(`\n[auth] ✅ Токен сохранён: ${TOKENS_FILE}`);
        console.log(`[auth] Аккаунт: ${savedId}`);
        if (cookieString) console.log(`[auth] Куки сохранены`);
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
    console.log('3. Следуйте инструкциям на странице.');
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
