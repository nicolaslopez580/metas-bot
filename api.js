'use strict';
require('dotenv').config();
const fetch = require('node-fetch');

const BASE    = (process.env.METAS_URL || 'https://metas.misproyectospersonales.com').replace(/\/$/, '');
const SECRET  = process.env.BOT_SECRET;
const headers = { 'Content-Type': 'application/json', 'x-bot-secret': SECRET };

async function getResumen(año) {
  const year = año || new Date().getFullYear();
  const r = await fetch(`${BASE}/api/bot/resumen?año=${year}`, { headers, timeout: 15000 });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

async function registrar(meta, completado, fecha) {
  const r = await fetch(`${BASE}/api/bot/registrar`, {
    method: 'POST', headers,
    body: JSON.stringify({ meta, completado, fecha }),
    timeout: 10000,
  });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

async function getHabilidades(estado) {
  const qs = estado ? `?estado=${encodeURIComponent(estado)}` : '';
  const r = await fetch(`${BASE}/api/bot/habilidades${qs}`, { headers, timeout: 10000 });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

async function getHabitos() {
  const r = await fetch(`${BASE}/api/bot/habitos`, { headers, timeout: 10000 });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

async function checkHabito(ref, valor, fecha) {
  const r = await fetch(`${BASE}/api/bot/habitos/check`, {
    method: 'POST', headers,
    body: JSON.stringify({ ref, valor, fecha }),
    timeout: 10000,
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `API ${r.status}`);
  return body;
}

// Devuelve { status, body } sin tirar en 404/409: el caller muestra los `candidatos`.
async function call(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, { headers, timeout: 15000, ...opts });
  const body = await r.json().catch(() => ({}));
  if (r.status >= 500 || r.status === 401) throw new Error(body.error || `API ${r.status}`);
  return { status: r.status, body };
}

const getMeta        = q => call(`/api/bot/meta?q=${encodeURIComponent(q)}`);
const getFaltantes   = () => call('/api/bot/faltantes');
const registrarLibre = (texto, fecha) => call('/api/bot/registrar-libre', {
  method: 'POST', body: JSON.stringify({ texto, fecha }),
});

module.exports = { getResumen, registrar, getHabilidades, getHabitos, checkHabito, getMeta, getFaltantes, registrarLibre };