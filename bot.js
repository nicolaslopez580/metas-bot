'use strict';
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Telegraf, Markup } = require('telegraf');
const { getResumen, getHabilidades } = require('./api');
const { parseAmount, parseDate, todayISO } = require('./parse');
const { tryHandleQuery } = require('./query');
const { registrar: apiRegistrar } = require('./api');

const ALLOWED = process.env.ALLOWED_CHAT_ID;
const bot     = new Telegraf(process.env.BOT_TOKEN);

// ── Sessions persistence ──────────────────────────────────────────────────
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
let sessions = {};
try { sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); } catch (_) {}
for (const id of Object.keys(sessions)) {
  if (sessions[id]?.step) { sessions[id].step = null; sessions[id].data = {}; }
}
function saveSessions() {
  try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions)); } catch (_) {}
}

// ── Recientes ─────────────────────────────────────────────────────────────
const RECENTS_FILE = path.join(__dirname, 'recents.json');
let recents = [];
try { recents = JSON.parse(fs.readFileSync(RECENTS_FILE, 'utf8')); } catch (_) {}
function saveRecents() {
  try { fs.writeFileSync(RECENTS_FILE, JSON.stringify(recents)); } catch (_) {}
}
function addRecent(nombre) {
  recents = [nombre, ...recents.filter(r => r !== nombre)].slice(0, 5);
  saveRecents();
}

// ── Wizard state ──────────────────────────────────────────────────────────
const WIZARD_TIMEOUT = 5 * 60 * 1000;

function sess(id) {
  if (!sessions[id]) sessions[id] = { step: null, data: {}, goals: [], lastActivity: 0 };
  return sessions[id];
}
function reset(id) {
  sessions[id] = { step: null, data: {}, goals: [], lastActivity: 0 };
  saveSessions();
}
function checkTimeout(id) {
  const s = sessions[id];
  if (!s?.step) return false;
  if (Date.now() - s.lastActivity > WIZARD_TIMEOUT) { reset(id); return true; }
  return false;
}

// ── Helpers ───────────────────────────────────────────────────────────────
function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function b(t)   { return `<b>${esc(t)}</b>`; }
function it(t)  { return `<i>${esc(t)}</i>`; }
function makeBar(p) { const f = Math.round((p || 0) * 10); return '█'.repeat(f) + '░'.repeat(10 - f); }
function pct(n) { return `${Math.round((n || 0) * 100)}%`; }
function estadoEmoji(e) { return e === 'completo' ? '✅' : e === 'encamino' ? '🟡' : '🔴'; }

// ── Guard ─────────────────────────────────────────────────────────────────
bot.use(async (ctx, next) => {
  if (ALLOWED && String(ctx.chat?.id) !== ALLOWED) return;
  await next();
});

// ── /start ────────────────────────────────────────────────────────────────
bot.start(ctx => ctx.reply(
  `🎯 ${b('Metas Tracker Bot')}\n\n` +
  '/resumen — estado del año\n' +
  '/atrasadas — metas &lt;50%\n' +
  '/encamino — metas 50–99%\n' +
  '/completas — al 100%\n' +
  '/habilidades — aprendiendo ahora\n' +
  '/registrar — registrar progreso\n\n' +
  it('También podés escribir en lenguaje natural:\n"cómo voy con running", "cuándo termino meditación", "registrá 10 en running"'),
  { parse_mode: 'HTML' }
));

// ── Comandos de consulta ──────────────────────────────────────────────────

bot.command('resumen', async ctx => {
  try {
    const { summary, goals } = await getResumen();
    if (!summary) return ctx.reply('Sin datos para el año actual.');
    const year    = new Date().getFullYear();
    const activas = goals.filter(g => g.year === year && g.estado !== 'completo').length;
    const avgBar  = makeBar(summary.avgProgress);
    ctx.reply([
      `📊 ${b(`Resumen ${summary.year}`)}`,
      `${avgBar} ${b(pct(summary.avgProgress))} promedio`,
      '',
      `✅ Completas: ${b(String(summary.completos))} / ${summary.total}`,
      `🟡 En camino: ${b(String(summary.encamino))}`,
      `🔴 Atrasadas: ${b(String(summary.atrasados))}`,
      '',
      it(`${activas} metas activas pendientes`),
    ].join('\n'), { parse_mode: 'HTML' });
  } catch (e) { ctx.reply(`❌ ${esc(e.message)}`, { parse_mode: 'HTML' }); }
});

async function sendByEstado(ctx, estado, emoji, label) {
  try {
    const year = new Date().getFullYear();
    const { goals } = await getResumen();
    const lista = goals.filter(g => g.year === year && g.estado === estado);
    if (!lista.length) return ctx.reply(`No hay metas "${label}" ahora.`);

    const lines = [`${emoji} ${b(`${label} (${lista.length})`)}\n`];
    lista.forEach(g => {
      lines.push(`${estadoEmoji(g.estado)} ${b(esc(g.descripcion))}\n${makeBar(g.progreso)} ${pct(g.progreso)} (${g.completado}/${g.objetivo})`);
    });
    const full = lines.join('\n');
    ctx.reply(full.length > 4000 ? full.slice(0, 3990) + '\n…' : full, { parse_mode: 'HTML' });
  } catch (e) { ctx.reply(`❌ ${esc(e.message)}`, { parse_mode: 'HTML' }); }
}

bot.command('atrasadas', ctx => sendByEstado(ctx, 'atrasado', '🔴', 'Atrasadas'));
bot.command('encamino',  ctx => sendByEstado(ctx, 'encamino', '🟡', 'En camino'));
bot.command('completas', ctx => sendByEstado(ctx, 'completo', '✅', 'Completas'));

bot.command('habilidades', async ctx => {
  try {
    const items = await getHabilidades('Aprendiendo');
    if (!items.length) return ctx.reply('No hay habilidades en aprendizaje actualmente.');
    const lines = [`📚 ${b('Aprendiendo ahora')}\n`];
    items.slice(0, 10).forEach((h, i) => {
      lines.push(`${i + 1}. ${b(esc(h.nombre))} ${it(`(${esc(h.categoria || 'Sin cat.')})`)}`);
    });
    ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  } catch (e) { ctx.reply(`❌ ${esc(e.message)}`, { parse_mode: 'HTML' }); }
});

// ── Wizard: /registrar ────────────────────────────────────────────────────

function buildMetasKeyboard(goals) {
  // Recientes primero
  const recentGoals = goals.filter(g => recents.includes(g.descripcion));
  const otherGoals  = goals.filter(g => !recents.includes(g.descripcion));
  const ordered     = [...recentGoals, ...otherGoals];

  const rows = ordered.map((g, i) => {
    const prefix = recents.includes(g.descripcion) ? '⚡ ' : '';
    const label  = prefix + estadoEmoji(g.estado) + ' ' + g.descripcion.slice(0, 28) + (g.descripcion.length > 28 ? '…' : '');
    return [Markup.button.callback(label, `rm_${i}`)];
  });
  rows.push([Markup.button.callback('❌ Cancelar', 'rm_cancel')]);
  return { keyboard: Markup.inlineKeyboard(rows), ordered };
}

async function startWizard(ctx) {
  const id = ctx.chat.id;
  if (checkTimeout(id)) { /* timeout ya limpiado */ }
  try {
    const year = new Date().getFullYear();
    const { goals } = await getResumen();
    const activas = goals.filter(g => g.year === year && g.estado !== 'completo');
    if (!activas.length) return ctx.reply('No hay metas activas. ¡Todas completas! 🎉');

    const { keyboard, ordered } = buildMetasKeyboard(activas);
    const s = sess(id);
    s.goals        = ordered;
    s.step         = 'meta';
    s.lastActivity = Date.now();
    saveSessions();

    ctx.reply(`📌 ${b('¿En qué meta registrás progreso?')}\n${it('Tocá una opción:')}`,
      { parse_mode: 'HTML', ...keyboard });
  } catch (e) { ctx.reply(`❌ ${esc(e.message)}`, { parse_mode: 'HTML' }); }
}

bot.command('registrar', startWizard);
bot.command('r', startWizard);
bot.command('cancel', ctx => {
  const id = ctx.chat.id;
  if (sess(id).step) { reset(id); return ctx.reply('Cancelado.'); }
  return ctx.reply('Nada que cancelar.');
});

// ── Callbacks del wizard ──────────────────────────────────────────────────

bot.action(/^rm_(\d+)$/, async ctx => {
  const id  = ctx.chat.id;
  const idx = parseInt(ctx.match[1]);
  const s   = sess(id);

  if (checkTimeout(id)) {
    await ctx.answerCbQuery('⏱ Sesión expirada.');
    return ctx.editMessageText('⏱ Sesión expirada. Usá /registrar de nuevo.');
  }
  if (s.step !== 'meta' || !s.goals[idx]) return ctx.answerCbQuery('Ya no válido.');

  s.data.meta    = s.goals[idx];
  s.step         = 'cantidad';
  s.lastActivity = Date.now();
  saveSessions();
  await ctx.answerCbQuery();
  ctx.editMessageText(
    `📌 ${b(esc(s.data.meta.descripcion))}\n` +
    `📊 Actual: ${s.data.meta.completado} / ${s.data.meta.objetivo} ${it(`(${pct(s.data.meta.progreso)})`)}\n\n` +
    `¿Cuánto completaste? ${it('(escribí el número)')}`,
    { parse_mode: 'HTML' }
  );
});

bot.action('rm_fecha_hoy', async ctx => {
  await ctx.answerCbQuery();
  await handleFechaElegida(ctx, todayISO());
});

bot.action('rm_fecha_ayer', async ctx => {
  await ctx.answerCbQuery();
  const d = new Date(); d.setDate(d.getDate() - 1);
  await handleFechaElegida(ctx,
    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
});

bot.action('rm_fecha_otra', async ctx => {
  const id = ctx.chat.id;
  const s  = sess(id);
  s.step   = 'fecha_manual';
  s.lastActivity = Date.now();
  saveSessions();
  await ctx.answerCbQuery();
  ctx.editMessageText('📅 Escribí la fecha: <i>DD/MM o DD/MM/AAAA</i>', { parse_mode: 'HTML' });
});

bot.action('rm_cancel', async ctx => {
  reset(ctx.chat.id);
  await ctx.answerCbQuery('Cancelado.');
  ctx.editMessageText('Cancelado.');
});

async function handleFechaElegida(ctx, fecha) {
  const id = ctx.chat.id;
  const s  = sess(id);
  if (!s.data.meta || s.data.cantidad == null) return;

  try {
    await apiRegistrar(s.data.meta.descripcion, s.data.cantidad, fecha);
    addRecent(s.data.meta.descripcion);
    const nuevo    = s.data.meta.completado + s.data.cantidad;
    const nuevoPct = s.data.meta.objetivo > 0 ? Math.round(nuevo / s.data.meta.objetivo * 100) : 0;
    ctx.editMessageText(
      `✅ ${b('Registrado!')}\n\n` +
      `📌 ${esc(s.data.meta.descripcion)}\n` +
      `➕ +${s.data.cantidad} el ${it(fecha)}\n` +
      `📊 Total: ${b(`${nuevo} / ${s.data.meta.objetivo}`)} (${nuevoPct}%)`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    ctx.editMessageText(`❌ Error al guardar: ${esc(e.message)}`, { parse_mode: 'HTML' });
  }
  reset(id);
}

// ── Text handler ──────────────────────────────────────────────────────────

bot.on('text', async ctx => {
  const id   = ctx.chat.id;
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;

  const s = sess(id);

  if (checkTimeout(id)) {
    return ctx.reply('⏱ Sesión expirada. Usá /registrar de nuevo.');
  }

  // ── Wizard activo ─────────────────────────────────────────
  if (s.step === 'cantidad') {
    const cantidad = parseAmount(text);
    if (!cantidad) return ctx.reply('Número inválido. Escribí un valor (ej: 10, 1.5k, 500).');
    s.data.cantidad = cantidad;
    s.step          = 'fecha';
    s.lastActivity  = Date.now();
    saveSessions();
    return ctx.reply(
      `💾 Cantidad: ${b(String(cantidad))}\n\n📅 ¿Cuál es la fecha?`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([
        [Markup.button.callback('📅 Hoy', 'rm_fecha_hoy'), Markup.button.callback('⬅️ Ayer', 'rm_fecha_ayer')],
        [Markup.button.callback('✏️ Otra fecha', 'rm_fecha_otra')],
        [Markup.button.callback('❌ Cancelar', 'rm_cancel')],
      ]) }
    );
  }

  if (s.step === 'fecha_manual') {
    const fecha = parseDate(text);
    if (!fecha) return ctx.reply('Formato inválido. Usá DD/MM o DD/MM/AAAA.');
    s.step = 'fecha';
    saveSessions();
    return handleFechaElegida(ctx, fecha);
  }

  // ── Lenguaje natural ──────────────────────────────────────
  const handled = await tryHandleQuery(ctx, text, addRecent);
  if (!handled) {
    ctx.reply(
      'No entendí eso. Probá:\n' +
      '• /registrar — registrar progreso con botones\n' +
      '• "cómo voy con running"\n' +
      '• "registrá 10 en meditación"\n' +
      '• "cuándo termino lectura"\n' +
      '• /resumen — estado general'
    );
  }
});

// ── Error handler & launch ────────────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`[bot] Error en ${ctx.updateType}:`, err.message);
});

bot.launch({ dropPendingUpdates: true });
console.log('🎯 Metas bot iniciado — polling activo');

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));