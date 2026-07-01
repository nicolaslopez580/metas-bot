'use strict';
const { getResumen, registrar: apiRegistrar, getHabilidades } = require('./api');
const { parseAmount, todayISO } = require('./parse');

// ── Formatters ─────────────────────────────────────────────────────────────
function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function b(t)   { return `<b>${esc(t)}</b>`; }
function it(t)  { return `<i>${esc(t)}</i>`; }
function makeBar(p) { const f = Math.round((p || 0) * 10); return '█'.repeat(f) + '░'.repeat(10 - f); }
function pct(n) { return `${Math.round((n || 0) * 100)}%`; }
function estadoEmoji(e) { return e === 'completo' ? '✅' : e === 'encamino' ? '🟡' : '🔴'; }

const SEP = '──────────────────';

// ── Fuzzy match de meta ────────────────────────────────────────────────────
const STOPWORDS = new Set(['con', 'que', 'los', 'las', 'del', 'para', 'como', 'voy', 'cuanto',
  'llevas', 'llevo', 'una', 'por', 'mis', 'mis', 'meta', 'metas', 'como', 'estoy', 'estamos']);

function normalize(str) {
  return str.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function matchMeta(query, goals) {
  const qWords = normalize(query);
  if (!qWords.length) return null;
  let best = null, bestScore = 0;
  for (const g of goals) {
    const gWords = normalize(g.descripcion);
    const overlap = qWords.filter(w => gWords.some(gw => gw.includes(w) || w.includes(gw))).length;
    if (overlap > bestScore) { bestScore = overlap; best = g; }
  }
  return bestScore > 0 ? best : null;
}

// ── Handlers ───────────────────────────────────────────────────────────────

// 1. Registrar inline: "registrá 10 en running"
async function handleRegistrarInline(text) {
  const m = text.match(/(?:registr[aá]|anot[aá]|sum[aá]|a[ñn]ad[ií]|guard[aá])\s+([0-9.,k]+)\s+(?:en|a|para|de)\s+(.+)/i);
  if (!m) return { text: `No entendí. Probá: ${it('"registrá 10 en running"')}` };

  const cantidad = parseAmount(m[1]);
  const query    = m[2].trim();
  if (!cantidad) return { text: `Cantidad inválida: ${esc(m[1])}` };

  const { goals } = await getResumen();
  const meta = matchMeta(query, goals.filter(g => g.year === new Date().getFullYear()));
  if (!meta) return { text: `No encontré una meta que coincida con "${esc(query)}".\nProbá /registrar para verlas todas.` };

  await apiRegistrar(meta.descripcion, cantidad, todayISO());
  const nuevo     = meta.completado + cantidad;
  const nuevoPct  = meta.objetivo > 0 ? Math.round(nuevo / meta.objetivo * 100) : 0;

  return {
    text: [
      `✅ ${b('Registrado!')}`,
      '',
      `📌 ${esc(meta.descripcion)}`,
      `➕ +${cantidad} hoy`,
      `📊 Total: ${b(`${nuevo} / ${meta.objetivo}`)} (${nuevoPct}%)`,
    ].join('\n'),
    addRecent: meta.descripcion,
  };
}

// 2. Proyección / fecha estimada: "cuándo termino running"
async function handleFechaEstimada(text) {
  const { goals } = await getResumen();
  const year = new Date().getFullYear();
  const activas = goals.filter(g => g.year === year && g.estado !== 'completo');

  const query = text
    .replace(/\b(cu[aá]ndo\s*(termino|llego|llegar|complet[oó]|cumplo|lo\s*alcanzo)|fecha\s*(estimada)?|en\s*cu[aá]nto\s*tiempo|tiempo\s*restante)\b/gi, '')
    .trim();

  const meta = matchMeta(query || text, activas);
  if (!meta) return { text: `Escribí con más detalle qué meta querés proyectar.\nEj: ${it('"cuándo termino running"')}` };

  const { velocidadDiaria, alcanzable, ritmoNecesario, expectedProgress, gap } = meta;
  const bar = makeBar(meta.progreso);

  if (!velocidadDiaria || velocidadDiaria <= 0) {
    return { text: `📌 ${b(esc(meta.descripcion))}\n${bar} ${pct(meta.progreso)}\n\n${it('No hay suficientes registros para proyectar.')}` };
  }

  const restante = meta.objetivo - meta.completado;
  const diasNecesarios = velocidadDiaria > 0 ? Math.ceil(restante / velocidadDiaria) : null;
  let fechaEstimada = null;
  if (diasNecesarios) {
    const d = new Date();
    d.setDate(d.getDate() + diasNecesarios);
    fechaEstimada = d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  const lines = [
    `📅 ${b('Proyección:')} ${esc(meta.descripcion)}`,
    `${bar} ${b(pct(meta.progreso))}`,
    `Completado: ${meta.completado} / ${meta.objetivo}`,
    '',
    `⚡ Ritmo actual: ${velocidadDiaria} por día`,
    `📦 Restante: ${restante}`,
  ];
  if (fechaEstimada) lines.push(`🗓 Fecha estimada: ${b(fechaEstimada)}`);
  if (alcanzable !== null) lines.push(alcanzable ? it('✅ Alcanzable este año al ritmo actual') : it('⚠️ Difícil de alcanzar a este ritmo'));
  if (ritmoNecesario && velocidadDiaria) {
    const diff = ritmoNecesario - velocidadDiaria;
    if (diff > 0.1) lines.push(it(`Necesitás +${diff.toFixed(1)} por día para llegar a fin de año.`));
  }
  if (gap !== null && expectedProgress !== null) {
    const gapLabel = gap >= 0 ? `+${pct(gap)} adelantado` : `${pct(Math.abs(gap))} atrasado`;
    lines.push(`\nEsperado al día de hoy: ${pct(expectedProgress)} → ${it(gapLabel)}`);
  }

  return { text: lines.join('\n') };
}

// 3. Meta específica: "cómo voy con running"
async function handleMetaEspecifica(text) {
  const { goals } = await getResumen();
  const year = new Date().getFullYear();

  const query = text
    .replace(/\b(c[oó]mo\s+(voy|estoy|vamos)\s*(con|en)?|cu[aá]nto\s+llevo\s*(en|con)?|progreso\s+(de|en)|estado\s+de|detalle\s+de|ver\s+meta|c[oó]mo\s+estoy\s*(con|en)?)\b/gi, '')
    .trim();

  const meta = matchMeta(query || text, goals.filter(g => g.year === year));
  if (!meta) return { text: `No encontré esa meta. Usá /resumen para ver todas.` };

  const { velocidadDiaria, diasRestantes, alcanzable, gap, expectedProgress } = meta;
  const bar = makeBar(meta.progreso);

  const lines = [
    `${estadoEmoji(meta.estado)} ${b(esc(meta.descripcion))}`,
    SEP,
    `${bar} ${b(pct(meta.progreso))}`,
    `Completado: ${b(String(meta.completado))} / ${meta.objetivo}`,
    meta.ultimoRegistro ? `Último registro: ${it(meta.ultimoRegistro)}` : null,
    '',
  ].filter(v => v !== null);

  if (expectedProgress !== null && gap !== null) {
    const gapLabel = gap >= 0 ? `+${pct(gap)} adelantado` : `${pct(Math.abs(gap))} atrasado`;
    lines.push(`Esperado hoy: ${pct(expectedProgress)} → ${it(gapLabel)}`);
  }
  if (velocidadDiaria) lines.push(`Ritmo: ${velocidadDiaria} por día`);
  if (diasRestantes != null) lines.push(`Días restantes del año: ${diasRestantes}`);
  if (alcanzable !== null) lines.push(alcanzable ? it('✅ Alcanzable este año') : it('⚠️ Difícil al ritmo actual'));

  return { text: lines.join('\n') };
}

// 4. Por categoría/pilar: "metas de salud"
async function handlePorCategoria(text) {
  const { goals } = await getResumen();
  const year = new Date().getFullYear();
  const activas = goals.filter(g => g.year === year);

  const query = text
    .replace(/\b(metas?\s+de|pilar\s*(de)?|categor[ií]a\s*(de)?|grupo\s*(de)?)\b/gi, '')
    .trim();

  const matches = activas.filter(g => {
    const cat   = (g.categoria || '').toLowerCase();
    const pilar = (g.pilar || '').toLowerCase();
    const q     = query.toLowerCase();
    return cat.includes(q) || pilar.includes(q) ||
      normalize(g.descripcion).some(w => normalize(query).includes(w));
  });

  if (!matches.length) {
    const cats = [...new Set(activas.map(g => g.categoria).filter(Boolean))];
    return { text: `No encontré metas en "${esc(query)}".\n\nCategorías: ${cats.map(esc).join(', ')}` };
  }

  const completas = matches.filter(g => g.estado === 'completo').length;
  const avg = matches.reduce((s, g) => s + g.progreso, 0) / matches.length;
  const lines = [
    `📂 ${b(esc(query))} — ${matches.length} metas`,
    `Promedio: ${b(pct(avg))} | Completas: ${completas}/${matches.length}`,
    '',
  ];
  matches.forEach(g => lines.push(`${estadoEmoji(g.estado)} ${esc(g.descripcion)} — ${pct(g.progreso)}`));

  return { text: lines.join('\n') };
}

// 5. Ranking: "top metas"
async function handleRanking(text) {
  const { goals } = await getResumen();
  const year = new Date().getFullYear();
  const sorted = goals
    .filter(g => g.year === year)
    .sort((a, b) => b.progreso - a.progreso);

  if (!sorted.length) return { text: 'No hay metas para rankear.' };

  const medals = ['🥇', '🥈', '🥉'];
  const lines = [`🏆 ${b(`Ranking ${year}`)}\n`];
  sorted.slice(0, 8).forEach((g, i) => {
    const medal = medals[i] || `${i + 1}.`;
    lines.push(`${medal} ${esc(g.descripcion)}\n   ${makeBar(g.progreso)} ${b(pct(g.progreso))}`);
  });

  return { text: lines.join('\n') };
}

// 6. Atrasadas (desde texto)
async function handleAtrasadasNL(text) {
  const { goals, summary } = await getResumen();
  const year = new Date().getFullYear();
  const atrasadas = goals
    .filter(g => g.year === year && g.estado === 'atrasado')
    .sort((a, b) => a.progreso - b.progreso);

  if (!atrasadas.length) return { text: `✅ No hay metas atrasadas. ¡Todo bien!` };

  const lines = [`🔴 ${b(`Atrasadas (${atrasadas.length}/${summary.total})`)}\n`];
  atrasadas.slice(0, 7).forEach(g => {
    const gapStr = g.expectedProgress != null ? it(` gap: ${pct(g.progreso - g.expectedProgress)}`) : '';
    lines.push(`${esc(g.descripcion)}\n${makeBar(g.progreso)} ${pct(g.progreso)}${gapStr}`);
  });
  if (atrasadas.length > 7) lines.push(it(`\n+${atrasadas.length - 7} más`));

  return { text: lines.join('\n') };
}

// 7. Habilidades (desde texto)
async function handleHabilidadesNL(text) {
  const items = await getHabilidades('Aprendiendo');
  if (!items.length) return { text: 'No hay habilidades en aprendizaje actualmente.' };

  const lines = [`📚 ${b('Aprendiendo ahora')}\n`];
  items.slice(0, 10).forEach((h, i) => {
    lines.push(`${i + 1}. ${b(esc(h.nombre))} ${it(`(${esc(h.categoria || 'Sin cat.')})`)}`);
  });

  return { text: lines.join('\n') };
}

// 8. Resumen general (catch-all)
async function handleResumenNL(text) {
  const { summary, goals } = await getResumen();
  if (!summary) return { text: 'Sin datos para el año actual.' };

  const year = new Date().getFullYear();
  const atrasadas = goals.filter(g => g.year === year && g.estado === 'atrasado')
    .sort((a, b) => a.progreso - b.progreso).slice(0, 3);
  const encamino = goals.filter(g => g.year === year && g.estado === 'encamino')
    .sort((a, b) => b.progreso - a.progreso).slice(0, 3);

  const avgBar = makeBar(summary.avgProgress);
  const lines = [
    `📊 ${b(`Resumen ${summary.year}`)}`,
    `${avgBar} ${b(pct(summary.avgProgress))} promedio`,
    SEP,
    `✅ Completas: ${b(String(summary.completos))} / ${summary.total}`,
    `🟡 En camino: ${b(String(summary.encamino))}`,
    `🔴 Atrasadas: ${b(String(summary.atrasados))}`,
  ];

  if (encamino.length) {
    lines.push(`\n🟡 ${b('Más cerca de completar:')}`);
    encamino.forEach(g => lines.push(`  • ${esc(g.descripcion)} — ${pct(g.progreso)}`));
  }
  if (atrasadas.length) {
    lines.push(`\n🔴 ${b('Más urgentes:')}`);
    atrasadas.forEach(g => lines.push(`  • ${esc(g.descripcion)} — ${pct(g.progreso)}`));
  }

  return { text: lines.join('\n') };
}

// ── INTENTS (primer match gana — más específico primero) ──────────────────
const INTENTS = [
  { test: t => /\b(registr[aá]|anot[aá]|sum[aá]|a[ñn]ad[ií]|guard[aá])\b/i.test(t) && /\ben\b/i.test(t),
    handle: handleRegistrarInline },

  { test: t => /\b(cu[aá]ndo\s*(termino|llego|complet|cumplo)|fecha\s*estimada|en\s*cu[aá]nto\s*tiempo|tiempo\s*restante)\b/i.test(t),
    handle: handleFechaEstimada },

  { test: t => /\b(c[oó]mo\s+(voy|estoy)\s*(con|en)|cu[aá]nto\s+llevo\s*(en|con)?|progreso\s+(de|en)|detalle\s+de)\b/i.test(t),
    handle: handleMetaEspecifica },

  { test: t => /\b(metas?\s+de|pilar|categor[ií]a)\b/i.test(t),
    handle: handlePorCategoria },

  { test: t => /\b(top\s+metas?|mejor(es)?\s+(desempe[ñn]o|performance)|ranking|podio)\b/i.test(t),
    handle: handleRanking },

  { test: t => /\b(atrasad[ao]s?|pendiente[s]?|qu[eé]\s+(me\s+)?falta|voy\s+mal|d[eé]ficit)\b/i.test(t),
    handle: handleAtrasadasNL },

  { test: t => /\b(habilidad(es)?|aprendiendo|aprend[eé]|skill[s]?|qu[eé]\s+aprendo|estudio)\b/i.test(t),
    handle: handleHabilidadesNL },

  { test: t => /\b(resumen|overview|c[oó]mo\s+(voy|ando)|estado\s+general|panorama|situaci[oó]n|metas?\s+del\s+a[ñn]o)\b/i.test(t),
    handle: handleResumenNL },
];

// ── Entry point ────────────────────────────────────────────────────────────
async function tryHandleQuery(ctx, text, addRecentFn) {
  for (const { test, handle } of INTENTS) {
    if (!test(text)) continue;
    try {
      const result = await handle(text);
      await ctx.reply(result.text, { parse_mode: 'HTML' });
      if (result.addRecent && addRecentFn) addRecentFn(result.addRecent);
    } catch (e) {
      await ctx.reply(`⚠️ Error: ${esc(e.message)}`, { parse_mode: 'HTML' });
    }
    return true;
  }
  return false;
}

module.exports = { tryHandleQuery };