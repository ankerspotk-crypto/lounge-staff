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
      for (let j = 0; j < this.nc; j++) row[this.c - 1 + j] = FakeSheet.coerce(vals[i][j]);  // ⛔appendRowと同じ＝日付に見える文字列はDate値になる
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
  /* ⚠️本物のGASは「シートの列数」と「値の入っている列数」が別物。列を足さずに
     getRange(…,numColumns) が列数を超えると落ちる＝そこを再現する */
  getMaxColumns() { return this._max || Math.max(26, this.getLastColumn()); }
  insertColumnsAfter(after, n) { this._max = this.getMaxColumns() + n; return this; }
  /* ⛔本物のSheetsは「日付に見える文字列」を書くと**Date値に変換して保存する**＝読み戻すと Date が返る。
     偽物が文字列のまま持っていると `String(セル値) === '2026-09-04'` が通ってしまい、
     **本番だけ落ちる比較を素通しさせる**（2026-09-05に実害＝二重会計の関所が効かず中島様の伝票が4重計上）。
     ここで本物と同じ変換をするのが、この種のバグをテストで捕まえる唯一の道。
     [[reference_sheet_date_tostring_trap]] */
  appendRow(v) { const c = v.map(FakeSheet.coerce); this.rows.push(c); this.log.push(['append', c.slice()]); return this; }
  /* ⚠️Dateは**vm(sandbox)側のコンストラクタ**で作る。ここでNodeのDateを使うと、被検体の中の
     `v instanceof Date`（Date=FakeDate）が false になり、**変換したつもりで何も再現できない**。
     backend.js が setDateCtor(FakeDate) で差し込む。 */
  static coerce(x) {
    if (typeof x !== 'string') return x;
    const D = FakeSheet._D || Date;
    if (/^\d{4}-\d{2}-\d{2}$/.test(x)) return new D(x + 'T00:00:00+09:00');
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}(:\d{2})?$/.test(x)) return new D(x.replace(' ', 'T') + '+09:00');
    return x;
  }
  deleteRow(n) { this.rows.splice(n - 1, 1); this.log.push(['delete', n]); return this; }
  setFrozenRows(n) { this.frozen = n; return this; }
  /* 行は無制限に伸びる偽物なので、行数の上限だけは素直に返す（本物の新規シートは1000行） */
  getMaxRows() { return Math.max(1000, this.rows.length); }
  insertRowsAfter() { return this; }
  getRange(r, c, nr, nc) {
    if (typeof c === 'undefined') throw new Error('getRange(a1) はこの偽物では未対応');
    if ((c - 1) + (nc === undefined ? 1 : nc) > this.getMaxColumns()) {
      throw new Error('範囲外：列が足りません（' + this.name + ' 最大' + this.getMaxColumns() + '列に ' + ((c - 1) + (nc || 1)) + '列目を要求）');
    }
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
      /* tryLock は「取れたか」を返す＝取れなかった時に握っていない扱いにできる。
         ⚠️取れなかったのに releaseLock を呼ぶと他人のロックを外す＝呼び側の finally は必ず取得済み判定で守ること */
      tryLock: () => { if (lock.held > 0) { lock.waits++; return false; } lock.waits++; lock.held++; lock.maxHeld = Math.max(lock.maxHeld, lock.held); return true; },
      releaseLock: () => { lock.held = Math.max(0, lock.held - 1); }
    })
  };
  const pad = (n, w) => String(n).padStart(w, '0');
  const Utilities = {
    formatDate: (d, tz, fmt) => {
      const x = new Date(d);
      const map = { yyyy: x.getFullYear(), MM: pad(x.getMonth() + 1, 2), dd: pad(x.getDate(), 2),
                    HH: pad(x.getHours(), 2), mm: pad(x.getMinutes(), 2), ss: pad(x.getSeconds(), 2) };
      /* ⚠️M/d（ゼロ埋めなし）はシフト表の見出しキーで使う＝MM|dd より後に置く（先に長い方を食わせる） */
      map.M = x.getMonth() + 1; map.d = x.getDate();
      return String(fmt).replace(/yyyy|MM|dd|HH|mm|ss|M|d/g, m => map[m]);
    },
    getUuid: () => 'uuid-' + (Utilities._n = (Utilities._n || 0) + 1),
    sleep: () => {}
  };
  const SpreadsheetApp = { openById: () => ss, getActiveSpreadsheet: () => ss, flush: () => {} };
  /* CacheService＝失効つきの短命メモ。共同経営者ビューのログイン失敗カウントで使う。
     ⚠️本物は失効を秒で数える＝テストから時計を進められるように clock を見る */
  const cache = {};
  const CacheService = {
    getScriptCache: () => ({
      get: k => { const e = cache[k]; if (!e) return null; if (clock.getTime() > e.exp) { delete cache[k]; return null; } return e.v; },
      put: (k, v, sec) => { cache[k] = { v: String(v), exp: clock.getTime() + (Number(sec) || 600) * 1000 }; },
      remove: k => { delete cache[k]; }
    })
  };

  return { ss, props, lock, cache, clock: () => clock, setNow: d => { clock = new Date(d); },
           setDateCtor: D => { FakeSheet._D = D; },   // vm側のDateを使わせる（instanceof Date を成立させる）
           PropertiesService, LockService, Utilities, SpreadsheetApp, CacheService, Session: { getActiveUser: () => ({ getEmail: () => 'test@example.com' }) } };
}
module.exports = { makeGas, FakeSS, FakeSheet, FakeRange };
