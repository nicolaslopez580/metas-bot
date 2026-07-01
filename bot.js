const { Telegraf, session, Scenes, Markup } = require('telegraf');
const fetch = require('node-fetch');

const BOT_TOKEN  = process.env.BOT_TOKEN;
const BOT_SECRET = process.env.BOT_SECRET;
const METAS_URL  = (process.env.METAS_URL || 'https://metas.misproyectospersonales.com').replace(/\/$/, '');

if (!BOT_TOKEN)  { console.error('BOT_TOKEN requerido');  process.exit(1); }
if (!BOT_SECRET) { console.error('BOT_SECRET requerido'); process.exit(1); }

// ── API helpers ───────────────────────────────────────────────

async function apiGet(path) {
  const res = await fetch(`${METAS_URL}/api/bot${path}`, {
    headers: { 'x-bot-secret': BOT_SECRET },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${METAS_URL}/api/bot${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bot-secret': BOT_SECRET },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Formatters ────────────────────────────────────────────────

function estadoEmoji(estado) {
  if (estado === 'completo') return '✅';
  if (estado === 'encamino') return '🟡';
  return '🔴';
}

function makeBar(progreso) {
  const filled = Math.round((progreso || 0) * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function pct(n) {
  return `${Math.round((n || 0) * 100)}%`;
}

function formatGoalLine(g, i) {
  const bar = makeBar(g.progreso);
  return `${i + 1}. ${estadoEmoji(g.estado)} *${escMd(g.descripcion)}*\n   ${bar} ${pct(g.progreso)} \\(${g.completado}/${g.objetivo}\\)`;
}

function escMd(text) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

// ── Bot setup ─────────────────────────────────────────────────

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// ── /start ────────────────────────────────────────────────────

bot.start(ctx => ctx.reply(
  '🎯 *Bot de Metas Tracker*\n\n' +
  '/resumen — resumen del año actual\n' +
  '/atrasadas — metas con menos del 50%\n' +
  '/encamino — metas entre 50\\-99%\n' +
  '/completas — metas al 100%\n' +
  '/habilidades — skills en aprendizaje\n' +
  '/registrar — registrar progreso en una meta',
  { parse_mode: 'MarkdownV2' }
));

// ── /resumen ──────────────────────────────────────────────────

bot.command('resumen', async ctx => {
  try {
    const { summary, goals } = await apiGet('/resumen');
    if (!summary) return ctx.reply('Sin datos para el año actual\\.');

    const year = new Date().getFullYear();
    const activas = goals.filter(g => g.year === year && g.estado !== 'completo').length;

    const msg = [
      `📊 *Resumen ${summary.year}*`,
      '',
      `✅ Completas:  *${summary.completos}* de ${summary.total}`,
      `🟡 En camino:  *${summary.encamino}*`,
      `🔴 Atrasadas:  *${summary.atrasados}*`,
      `📈 Promedio:   *${pct(summary.avgProgress)}*`,
      '',
      `_${activas} metas activas pendientes_`,
    ].join('\n');

    await ctx.reply(escMd(msg).replace(/\\\*/g, '*').replace(/\\\\n/g, '\n'), { parse_mode: 'MarkdownV2' });
  } catch (e) {
    ctx.reply(`❌ Error: ${escMd(e.message)}`, { parse_mode: 'MarkdownV2' });
  }
});

// ── Comando genérico para filtrar por estado ──────────────────

async function sendGoalsByEstado(ctx, estado, emoji, label) {
  try {
    const year = new Date().getFullYear();
    const { goals } = await apiGet('/resumen');
    const filtradas = goals.filter(g => g.year === year && g.estado === estado);

    if (!filtradas.length) {
      return ctx.reply(`No hay metas "${label}" actualmente\\.`, { parse_mode: 'MarkdownV2' });
    }

    const header = `${emoji} *${label} \\(${filtradas.length}\\)*\n\n`;
    const lines = filtradas.map((g, i) => formatGoalLine(g, i)).join('\n\n');

    // Telegram tiene límite de 4096 chars, truncar si hace falta
    const full = header + lines;
    if (full.length > 4000) {
      await ctx.reply(header + filtradas.slice(0, 8).map((g, i) => formatGoalLine(g, i)).join('\n\n') + `\n\n_\\.\\.\\. y ${filtradas.length - 8} más_`, { parse_mode: 'MarkdownV2' });
    } else {
      await ctx.reply(full, { parse_mode: 'MarkdownV2' });
    }
  } catch (e) {
    ctx.reply(`❌ Error: ${escMd(e.message)}`, { parse_mode: 'MarkdownV2' });
  }
}

bot.command('atrasadas', ctx => sendGoalsByEstado(ctx, 'atrasado', '🔴', 'Atrasadas'));
bot.command('encamino',  ctx => sendGoalsByEstado(ctx, 'encamino', '🟡', 'En camino'));
bot.command('completas', ctx => sendGoalsByEstado(ctx, 'completo', '✅', 'Completas'));

// ── /habilidades ──────────────────────────────────────────────

bot.command('habilidades', async ctx => {
  try {
    const items = await apiGet('/habilidades?estado=Aprendiendo');
    if (!items.length) return ctx.reply('No hay habilidades en aprendizaje actualmente\\.', { parse_mode: 'MarkdownV2' });

    const lines = items.slice(0, 10).map((h, i) =>
      `${i + 1}\\. 📚 *${escMd(h.nombre)}* \\(${escMd(h.categoria || 'Sin cat.')}\\)`
    ).join('\n');

    ctx.reply(`📚 *Aprendiendo ahora*\n\n${lines}`, { parse_mode: 'MarkdownV2' });
  } catch (e) {
    ctx.reply(`❌ Error: ${escMd(e.message)}`, { parse_mode: 'MarkdownV2' });
  }
});

// ── Wizard: /registrar ────────────────────────────────────────

const registrarWizard = new Scenes.WizardScene(
  'registrar',

  // Paso 1: mostrar metas activas
  async ctx => {
    try {
      const year = new Date().getFullYear();
      const { goals } = await apiGet('/resumen');
      const activas = goals.filter(g => g.year === year && g.estado !== 'completo');

      if (!activas.length) {
        await ctx.reply('No hay metas activas para registrar\\. ¡Todas completas! 🎉', { parse_mode: 'MarkdownV2' });
        return ctx.scene.leave();
      }

      ctx.session.regGoals = activas;
      const lines = activas.map((g, i) =>
        `${i + 1}\\. ${estadoEmoji(g.estado)} ${escMd(g.descripcion)}`
      ).join('\n');

      await ctx.reply(
        `*¿En qué meta registrás progreso?*\n\nEscribí el número:\n\n${lines}`,
        { parse_mode: 'MarkdownV2' }
      );
      return ctx.wizard.next();
    } catch (e) {
      await ctx.reply(`❌ Error: ${escMd(e.message)}`, { parse_mode: 'MarkdownV2' });
      return ctx.scene.leave();
    }
  },

  // Paso 2: usuario elige meta
  async ctx => {
    const text = (ctx.message?.text || '').trim();
    if (text === '/cancel') { await ctx.reply('Cancelado\\.', { parse_mode: 'MarkdownV2' }); return ctx.scene.leave(); }

    const idx = parseInt(text) - 1;
    const goals = ctx.session.regGoals || [];
    if (isNaN(idx) || idx < 0 || idx >= goals.length) {
      await ctx.reply('Número inválido\\. Escribí un número de la lista o /cancel para salir\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    const g = goals[idx];
    ctx.session.regMeta = g;
    await ctx.reply(
      `Meta: *${escMd(g.descripcion)}*\nActual: *${g.completado}* / ${g.objetivo}\n\n¿Cuánto completaste HOY? \\(número\\)`,
      { parse_mode: 'MarkdownV2' }
    );
    return ctx.wizard.next();
  },

  // Paso 3: usuario ingresa cantidad
  async ctx => {
    const text = (ctx.message?.text || '').trim();
    if (text === '/cancel') { await ctx.reply('Cancelado\\.', { parse_mode: 'MarkdownV2' }); return ctx.scene.leave(); }

    const completado = parseFloat(text);
    if (isNaN(completado) || completado < 0) {
      await ctx.reply('Valor inválido\\. Ingresá un número positivo o /cancel\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    ctx.session.regCompletado = completado;
    await ctx.reply(
      '¿Cuál es la fecha? \\(YYYY\\-MM\\-DD\\) o escribí *hoy*:',
      { parse_mode: 'MarkdownV2', ...Markup.keyboard([['hoy']]).oneTime().resize() }
    );
    return ctx.wizard.next();
  },

  // Paso 4: usuario ingresa fecha y se registra
  async ctx => {
    const text = (ctx.message?.text || '').trim();
    if (text === '/cancel') {
      await ctx.reply('Cancelado\\.', { parse_mode: 'MarkdownV2', ...Markup.removeKeyboard() });
      return ctx.scene.leave();
    }

    let fecha = text.toLowerCase() === 'hoy'
      ? new Date().toISOString().split('T')[0]
      : text;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      await ctx.reply('Formato inválido\\. Usá YYYY\\-MM\\-DD o escribí *hoy*\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    const meta      = ctx.session.regMeta;
    const completado = ctx.session.regCompletado;

    try {
      await apiPost('/registrar', { meta: meta.descripcion, completado, fecha });

      const nuevoTotal = meta.completado + completado;
      const nuevoPct   = meta.objetivo > 0 ? Math.round(nuevoTotal / meta.objetivo * 100) : 0;

      await ctx.reply(
        `✅ *Registrado\\!*\n\n📌 ${escMd(meta.descripcion)}\n➕ \\+${completado} el ${escMd(fecha)}\n📊 Total: ${nuevoTotal} / ${meta.objetivo} \\(${nuevoPct}%\\)`,
        { parse_mode: 'MarkdownV2', ...Markup.removeKeyboard() }
      );
    } catch (e) {
      await ctx.reply(
        `❌ Error al guardar: ${escMd(e.message)}`,
        { parse_mode: 'MarkdownV2', ...Markup.removeKeyboard() }
      );
    }

    return ctx.scene.leave();
  }
);

const stage = new Scenes.Stage([registrarWizard]);
bot.use(stage.middleware());
bot.command('registrar', ctx => ctx.scene.enter('registrar'));
bot.command('cancel', ctx => ctx.reply('Nada que cancelar\\.', { parse_mode: 'MarkdownV2' }));

// ── Error handler & launch ────────────────────────────────────

bot.catch((err, ctx) => {
  console.error(`[bot] Error en ${ctx.updateType}:`, err.message);
});

bot.launch({ dropPendingUpdates: true });
console.log('🎯 Metas bot iniciado — polling activo');

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));