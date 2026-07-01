'use strict';

function parseAmount(raw) {
  let str = String(raw).trim().replace(/[$\s]/g, '').replace(/,/g, '.');
  if (/\d+\.?\d*k$/i.test(str)) {
    const num = parseFloat(str.replace(/k$/i, ''));
    return isNaN(num) ? null : Math.round(num * 1000);
  }
  const parts = str.split('.');
  let num;
  if (parts.length === 2 && parts[1].length === 3) {
    num = parseFloat(parts[0] + parts[1]);
  } else {
    num = parseFloat(str);
  }
  return (isNaN(num) || num <= 0) ? null : num;
}

function parseDate(raw) {
  const s = String(raw).trim().toLowerCase();
  const today = new Date();
  if (s === 'hoy' || s === 'today') return toISO(today);
  if (s === 'ayer' || s === 'yesterday') {
    const d = new Date(today); d.setDate(d.getDate() - 1); return toISO(d);
  }
  const m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : today.getFullYear();
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayISO() { return toISO(new Date()); }

module.exports = { parseAmount, parseDate, todayISO };
