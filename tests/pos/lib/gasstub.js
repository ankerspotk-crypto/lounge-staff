'use strict';
/* ============================================================================
   GASの偽物（SpreadsheetApp / PropertiesService / LockService / Utilities）
   ----------------------------------------------------------------------------
   ⚠️狙いは「本番のシートに一切触らずに backend の**実物のコード**を走らせる」こと。
     テスト環境シート(_TEST)ですら触らない＝Nodeの中だけで完結する。
   ⚠️時刻は固定できる（nowStamp_ を差し替える）＝結果が日によって変わるテストにしない。
============================================================================ */

class FakeRange {
  constructor(sheet, row, col, nr, nc) { this.s = sheet; this.r = row; this.c = col; this.nr = nr; this.nc = nc; }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const src = this.s.rows[this.r - 1 + i] || [];
      const line = [];
      for (let j = 0; j < this.nc; j++) line.push(src[this.c - 1 + j] === undefined ? '' : src[this.c - 1 + j]);
      out.push(line);
    }
    return out;
  }
  setValues(vals) {
    if (!Array.isArray(vals) || vals.length !== this.nr) throw new Error('setValues: 行数が範囲と違う ' + vals.length + '≠' + this.nr);
    for (let i = 0; i < this.nr; i++) {
      if (vals[i].length !== this.nc) throw new Error('setValues: 列数が範囲と違う ' + vals[i].length + '≠' + this.nc);
      const ri = this.r - 1 + i;
      while (this.s.rows.length <= ri) this.s.rows.push([]);
      const row = this.s.rows[ri];
      for (let j = 0; j < this.nc; j++) row[this.c - 1 + j] = vals[i][j];
    }
    return this;
  }
  getValue() { return this.getValues()[0][0]; }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormat() { return this; } setFontWeight() { return this; } setBackground() { return this; }
}

class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; this.frozen = 0; this.log = []; }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((a, r) => Math.max(a, r.length), 0); }
  appendRow(v) { this.rows.push(v.slice()); this.log.push(['append', v.slice()]); return this; }
  deleteRow(n) { this.rows.splice(n - 1, 1); this.log.push(['delete', n]); return this; }
  setFrozenRows(n) { this.frozen = n; return this; }
  getRange(r, c, nr, nc) {
    if (typeof c === 'undefined') throw new Error('getRange(a1) はこの偽物では未対応');
    return new FakeRange(this, r, c, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc);
  }
  getDataRange() { return new FakeRange(this, 1, 1, Math.max(1, this.rows.length), Math.max(1, this.getLastColumn())); }
  /* テスト側の便利メソッド（本物には無い） */
  dump() { return this.rows.map(r => r.slice()); }
}

class FakeSS {
  constructor() { this.sheets = {}; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { this.sheets[n] = new FakeSheet(n); return this.sheets[n]; }
  getSheets() { return Object.keys(this.sheets).map(k => this.sheets[k]); }
  /* テスト側の便利メソッド */
  seed(name, rows) { const sh = this.sheets[name] || this.insertSheet(name); sh.rows = rows.map(r => r.slice()); return sh; }
  names() { return Object.keys(this.sheets); }
}

function makeGas(opts) {
  opts = opts || {};
  const ss = new FakeSS();
  const props = Object.assign({}, opts.props || {});
  let clock = opts.now ? new Date(opts.now) : new Date('2026-08-27T22:15:00+09:00');
  const lock = { held: 0, maxHeld: 0, waits: 0 };

  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: k => { delete props[k]; },
      getProperties: () => Object.assign({}, props)
    })
  };
  const LockService = {
    getScriptLock: () => ({
      waitLock: () => { lock.waits++; lock.held++; lock.maxHeld = Math.max(lock.maxHeld, lock.held); if (lock.held > 1) throw new Error('ロックが二重に取られた'); },
      releaseLock: () => { lock.held = Math.max(0, lock.held - 1); }
    })
  };
  const pad = (n, w) => String(n).padStart(w, '0');
  const Utilities = {
    formatDate: (d, tz, fmt) => {
      const x = new Date(d);
      const map = { yyyy: x.getFullYear(), MM: pad(x.getMonth() + 1, 2), dd: pad(x.getDate(), 2),
                    HH: pad(x.getHours(), 2), mm: pad(x.getMinutes(), 2), ss: pad(x.getSeconds(), 2) };
      return String(fmt).replace(/yyyy|MM|dd|HH|mm|ss/g, m => map[m]);
    },
    getUuid: () => 'uuid-' + (Utilities._n = (Utilities._n || 0) + 1),
    sleep: () => {}
  };
  const SpreadsheetApp = { openById: () => ss, getActiveSpreadsheet: () => ss, flush: () => {} };

  return { ss, props, lock, clock: () => clock, setNow: d => { clock = new Date(d); },
           PropertiesService, LockService, Utilities, SpreadsheetApp, Session: { getActiveUser: () => ({ getEmail: () => 'test@example.com' }) } };
}
module.exports = { makeGas, FakeSS, FakeSheet, FakeRange };
