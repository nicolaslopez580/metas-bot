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

module.exports = { getResumen, registrar, getHabilidades };