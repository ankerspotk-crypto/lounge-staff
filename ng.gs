/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ⚠️ 客の注意情報（NGキャスト／NGタイプ／NG行為／同フロアNG客）＋ 付け回しNG判定
 * ══════════════════════════════════════════════════════════════════════════════
 * 2026-08-19 ボス指示。「予約時に注意」「黒服が付け回しで注意」「システムがNGと判断したらアラート」。
 *
 * ⛔ボス確定の運用（AskUserQuestionで選択）
 *   ①NGキャストだけ完全ブロック。他（タイプ／行為／同フロアNG客）は⚠️警告して承知で通す
 *     ＝席定員超過と同じ流儀。現場を止めず、絶対の一線だけ守る。
 *   ②「同フロアNG客」の判定範囲＝フロア単位（2F/5F）。在席中でも来店予定でも警告。
 *   ③入力できるのは 黒服（軍師）／管理者（コンソール）／キャスト（ポータル）。
 *     ただしキャストは「自分が苦手なお客様」の申告だけ＝他人のNG情報は読ませない（下の castNg* API）。
 *
 * 置き場＝顧客マスタY3の JSON 列「注意情報」（末尾追加・非破壊）＝相性プロフィールと同じ流儀。
 * 既存のフリーテキスト列「NG行為」「NGスタッフ」は1バイトも書き換えない。構造化が未入力の時だけ種に使う。
 * 判定の正本はこのファイル＝フロントは表示係。別端末・直叩き・改ざんでも同じ結論になる。
 *
 * ⚠️このファイルは既存 Code.gs / KioskV2.gs に一切手を入れない独立ファイル。
 *   ただし次の3点だけ本体側に小改修が要る（別途適用済み）：
 *   (1) getKioskReservations に 📌次回対応メモ＋⚠️NG の注入（会員番号が無くても名前で必ず出す）
 *   (2) GUNSHI_API_FNS に本ファイルの公開関数を追加
 *   (3) kioskSaveNextVisitMemo のキャッシュ破棄キー（MEMFEEMAP_v1 は存在しない → 正しいキーへ）
 */

var CUST_NOTE_HEADER = '注意情報';
var CUSTNOTE_CACHE_KEY = 'CUSTNOTE_v1';
var CASTPROF_CACHE_KEY = 'CASTPROF_v1';

/* ── 語彙 ───────────────────────────────────────────────────────────────── */

// NG行為の語彙。自由文も許す＝現場の言葉を殺さない（サニタイズは字数と件数で縛る）
function ngActVocab_() {
  return ['下ネタ', 'ボディタッチ', 'タメ口', '説教・武勇伝', '無理に飲ませる', 'タバコ', '恋愛・彼氏の話',
          '仕事の詮索', '政治・宗教の話', '大声・騒ぐ', '写真撮影', '連絡先交換', '同伴の催促', 'ボトルの催促'];
}
// 客が苦手とするキャストのタイプ＝キャスト自己申告(相性プロフィール)と同一語彙＝そのまま噛み合う
function ngTypeVocab_() { var V = aishoVocab_(); return { look: V.look, chara: V.chara }; }

/* ── 照合キー ───────────────────────────────────────────────────────────── */
// 会員番号＝先頭ゼロ無視／氏名＝全角半角の空白を全部除去（normalizeName_ の内部スペース罠を回避）
function ngKeyNo_(s) { return String(s || '').replace(/[\s　]/g, '').replace(/^0+(?=\d)/, ''); }
function ngKeyName_(s) { return String(s || '').replace(/[\s　]/g, '').replace(/(様|さま|サマ)$/, ''); }

/* ── 顧客マスタY3の JSON 列「注意情報」 ─────────────────────────────────── */

function custMasterHeaderRow_(values) {
  for (var i = 0; i < Math.min(values.length, 6); i++) {
    if (values[i].some(function (c) { return String(c).replace(/\s/g, '').indexOf('カード記載名') !== -1; })) return i;
  }
  return -1;
}
// create時のみ末尾に列を足す。既存列は動かさない（Y3は和暦テキスト等が並ぶ＝列移動は事故）
function getCustNoteCol_(sheet, values, create) {
  var vals = values || sheet.getDataRange().getValues();
  var h = custMasterHeaderRow_(vals);
  if (h < 0) return -1;
  var headers = vals[h].map(function (c) { return String(c).replace(/\s/g, ''); });
  var idx = headers.indexOf(CUST_NOTE_HEADER);
  if (idx < 0 && create) { idx = vals[h].length; sheet.getRange(h + 1, idx + 1).setValue(CUST_NOTE_HEADER); }
  return idx;
}
function parseCustNote_(v) {
  var o = {};
  try { o = JSON.parse(String(v || '') || '{}'); } catch (e) { o = {}; }
  if (!o || typeof o !== 'object') o = {};
  var arr = function (x) { return Array.isArray(x) ? x.map(String) : []; };
  return {
    ngCasts: arr(o.ngCasts), ngTypes: arr(o.ngTypes), ngActs: arr(o.ngActs),
    ngCustomers: ngNormPersonList_(o.ngCustomers),
    memo: String(o.memo || ''), updatedBy: String(o.updatedBy || ''), updatedAt: String(o.updatedAt || '')
  };
}
function ngNormPersonList_(list) {
  return (Array.isArray(list) ? list : []).map(function (x) {
    if (!x) return null;
    if (typeof x === 'string') return { no: '', name: String(x) };
    return { no: String(x.no || ''), name: String(x.name || '') };
  }).filter(function (x) { return x && (x.no || x.name); });
}
function custNoteEmpty_(n) {
  return !(n.ngCasts.length || n.ngTypes.length || n.ngActs.length || n.ngCustomers.length || (n.memo && String(n.memo).trim()));
}
// 受信を濾す（未知タグ・重複・長文を落とす＝フロント改ざん耐性）
function sanitizeCustNote_(raw) {
  raw = (raw && typeof raw === 'object') ? raw : {};
  var T = ngTypeVocab_(), typeVocab = T.look.concat(T.chara);
  var uniq = function (list, max, len) {
    var seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (x) {
      x = String(x == null ? '' : x).trim().slice(0, len || 40);
      if (!x || seen[x]) return; seen[x] = 1; out.push(x);
    });
    return out.slice(0, max);
  };
  var pickVocab = function (list, allow) {
    var seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (x) {
      x = String(x); if (allow.indexOf(x) >= 0 && !seen[x]) { seen[x] = 1; out.push(x); }
    });
    return out;
  };
  return {
    ngCasts: uniq(raw.ngCasts, 30, 20),      // キャスト名＝名簿の実名。語彙で濾せないので字数と件数で縛る
    ngTypes: pickVocab(raw.ngTypes, typeVocab),
    ngActs: uniq(raw.ngActs, 30, 60),        // 語彙＋自由文
    ngCustomers: ngNormPersonList_(raw.ngCustomers).map(function (x) {
      return { no: x.no.trim().slice(0, 20), name: x.name.trim().slice(0, 40) };
    }).slice(0, 30),
    memo: String(raw.memo || '').slice(0, 1000)
  };
}
// 旧フリーテキスト列を配列に割る（読み取り専用の種。シートは書き換えない）
function ngSplitFreeText_(s) {
  return String(s || '').split(/[、,／\/・\n]+/).map(function (x) { return x.trim().slice(0, 60); }).filter(Boolean).slice(0, 30);
}

/* ── 索引（予約一覧に📌と⚠️を必ず出すための供給元）───────────────────── */

function getCustNoteMap_() {
  var c = CacheService.getScriptCache();
  var hit = c.get(CUSTNOTE_CACHE_KEY);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var m = getCustNoteMapRaw_();
  try { c.put(CUSTNOTE_CACHE_KEY, JSON.stringify(m), 90); } catch (e) {}
  return m;
}
function custNoteCacheClear_() {
  try { CacheService.getScriptCache().remove(CUSTNOTE_CACHE_KEY); } catch (e) {}
  try { CacheService.getScriptCache().remove('MEMFEEMAP_v3'); } catch (e) {} // 次回メモは会費マップにも相乗りしている
}
function getCustNoteMapRaw_() {
  var out = { byNo: {}, byName: {} };
  var sheet = getOrOpenSS_().getSheetByName(MASTER_TAB);
  if (!sheet) return out;
  var values = sheet.getDataRange().getValues();
  var h = custMasterHeaderRow_(values); if (h < 0) return out;
  var headers = values[h].map(function (c) { return String(c).replace(/\s/g, ''); });
  var idx = function (kw) { return headers.findIndex(function (x) { return x.indexOf(kw) !== -1; }); };
  var cNo = idx('会員番号'), cName = idx('氏名'), cCard = idx('カード記載名');
  var cMemo = idx('次回対応'), cNg = idx('NG行為'), cNgS = idx('NGスタッフ'), cTan = idx('担当');
  var cNote = headers.indexOf(CUST_NOTE_HEADER);
  for (var r = h + 1; r < values.length; r++) {
    var row = values[r];
    var no = cNo >= 0 ? String(row[cNo] || '').trim() : '';
    var name = cName >= 0 ? String(row[cName] || '').trim() : '';
    var card = cCard >= 0 ? String(row[cCard] || '').trim() : '';
    if (!no && !name && !card) continue;
    var memo = cMemo >= 0 ? String(row[cMemo] || '').trim() : '';
    var note = parseCustNote_(cNote >= 0 ? row[cNote] : '');
    var seeded = false;
    // 旧フリーテキストは「構造化が空のときだけ」種として合流（シートは書き換えない）
    if (!note.ngActs.length && cNg >= 0 && String(row[cNg] || '').trim()) { note.ngActs = ngSplitFreeText_(row[cNg]); seeded = true; }
    if (!note.ngCasts.length && cNgS >= 0 && String(row[cNgS] || '').trim()) { note.ngCasts = ngSplitFreeText_(row[cNgS]); seeded = true; }
    if (!memo && custNoteEmpty_(note)) continue; // 何も無い客は索引に載せない（マップを軽く保つ）
    var e = { no: no, name: name, card: card, tantou: cTan >= 0 ? String(row[cTan] || '').trim() : '',
              nextMemo: memo, note: note, seeded: seeded, row: r + 1 };
    var kn = ngKeyNo_(no); if (kn) out.byNo[kn] = e;
    [name, card].forEach(function (s) {
      var k = ngKeyName_(s); if (!k || k.length < 2) return;
      var prev = out.byName[k];
      // 同名別人が居たら名前突合そのものを捨てる（他人のNG情報を出す事故を絶対に起こさない）
      if (prev && !prev.ambiguous && ngKeyNo_(prev.no) !== ngKeyNo_(no)) { out.byName[k] = { ambiguous: true }; return; }
      if (!prev) out.byName[k] = e;
    });
  }
  return out;
}
// 会員番号優先→無ければ氏名/カード名。同名別人は引かない
function custNoteLookup_(map, no, name) {
  if (!map) return null;
  var kn = ngKeyNo_(no);
  if (kn && map.byNo[kn]) return map.byNo[kn];
  var k = ngKeyName_(name);
  if (k && map.byName[k] && !map.byName[k].ambiguous) return map.byName[k];
  return null;
}
// 予約カードに載せる軽い形（チップに要る分だけ。メモ本文は載せない）
function ngInfoForCard_(entry) {
  if (!entry) return null;
  var n = entry.note || {};
  if (custNoteEmpty_(n)) return null;
  return {
    ngCasts: n.ngCasts || [], ngTypes: n.ngTypes || [], ngActs: n.ngActs || [],
    ngCustomers: (n.ngCustomers || []).map(function (x) { return x.name || x.no; }),
    seeded: !!entry.seeded
  };
}

/* ── キャスト側プロフィール索引（タイプ判定＋キャストの「苦手な客」申告）── */

function ngCastProfileMap_() {
  var c = CacheService.getScriptCache();
  var hit = c.get(CASTPROF_CACHE_KEY);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var out = {};
  try {
    var sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
    if (sh) {
      var col = getCastProfileCol_(sh, false);
      if (col >= 0) {
        var rows = sh.getDataRange().getValues();
        for (var i = 1; i < rows.length; i++) {
          var nm = String(rows[i][1] || '').trim(); if (!nm) continue;
          // parseCastProfile_ は ngCustomers（苦手なお客様）も返す（2026-08-19にCode.gs側を拡張済み）
          var p = parseCastProfile_(rows[i][col]);
          out[ngKeyName_(nm)] = { name: nm, look: p.look || [], chara: p.chara || [], ngCustomers: p.ngCustomers || [] };
        }
      }
    }
  } catch (e) {}
  try { c.put(CASTPROF_CACHE_KEY, JSON.stringify(out), 300); } catch (e) {}
  return out;
}
function ngCastProfileCacheClear_() { try { CacheService.getScriptCache().remove(CASTPROF_CACHE_KEY); } catch (e) {} }

/* ── 判定エンジン（正本）───────────────────────────────────────────────── */

// 客 × キャスト。blocked=NGキャスト（完全ブロック）／warns=承知で通せる警告
function ngEvaluateCast_(entry, castName, profMap) {
  var out = { blocked: false, reasons: [], warns: [] };
  if (!entry || !castName) return out;
  var n = entry.note || {};
  var cn = ngKeyName_(castName);
  var who = ngCustLabel_(entry);
  (n.ngCasts || []).forEach(function (x) {
    if (ngKeyName_(x) && ngKeyName_(x) === cn) { out.blocked = true; out.reasons.push('⛔ ' + who + '様のNGキャスト＝' + castName); }
  });
  var prof = (profMap || {})[cn];
  if (prof && (n.ngTypes || []).length) {
    var tags = (prof.look || []).concat(prof.chara || []);
    var hit = (n.ngTypes || []).filter(function (t) { return tags.indexOf(t) >= 0; });
    if (hit.length) out.warns.push('⚠️ ' + who + '様が苦手なタイプ「' + hit.join('・') + '」に ' + castName + ' が該当');
  }
  // キャスト本人の申告（この客が苦手）＝警告どまり（止めるのは客都合のNGキャストだけ＝ボス確定）
  if (prof && (prof.ngCustomers || []).length && ngPersonHit_(prof.ngCustomers, entry)) {
    out.warns.push('⚠️ ' + castName + ' が苦手と申告しているお客様です（' + who + '様）');
  }
  if ((n.ngActs || []).length) out.warns.push('📋 ' + who + '様のNG行為：' + (n.ngActs || []).join('・'));
  return out;
}
function ngCustLabel_(entry) { return entry.name || entry.card || ('会員' + entry.no); }
// 人物リストに entry が含まれるか（会員番号→氏名/カード名の順で照合）
function ngPersonHit_(list, entry) {
  var tn = ngKeyNo_(entry.no), tm = ngKeyName_(entry.name), tc = ngKeyName_(entry.card);
  return (list || []).some(function (x) {
    var xn = ngKeyNo_(x.no), xm = ngKeyName_(x.name);
    if (xn && tn) return xn === tn;                        // 番号が両方あるなら番号が正
    return !!(xm && ((tm && xm === tm) || (tc && xm === tc)));
  });
}
// 客 × 客。同フロアに居合わせてはいけない相手か（片側だけの登録でも成立＝NGは相互）
function ngPairConflict_(a, b) {
  if (!a || !b) return false;
  return ngPersonHit_(((a.note || {}).ngCustomers) || [], b) || ngPersonHit_(((b.note || {}).ngCustomers) || [], a);
}

/* ── 席・フロアの現況（判定用の軽量読み。getSekiJokyouDataは重いので使わない）── */

// 席コード → その席に居る/来る客 [{no,name,when}]。RSRV_=在席、YRSRV_=来店前予約
function ngSeatCustomers_(seatCode, allProps) {
  var p = allProps || PropertiesService.getScriptProperties().getProperties();
  var out = [];
  var push = function (o, when) {
    if (!o) return;
    var name = String(o.customer || o.cust || '').trim();
    var no = String(o.memberId || o.member || '').trim();
    if (name || no) out.push({ no: no, name: name, when: when });
  };
  try { (parseRsrvVal_(p['RSRV_' + seatCode]) || []).forEach(function (o) { push(o, 'now'); }); } catch (e) {}
  try { var y = p['YRSRV_' + seatCode]; if (y) push(JSON.parse(y), 'soon'); } catch (e) {}
  return out;
}
// フロア → 今そのフロアに居る/来る客の索引エントリ配列
function ngFloorOccupants_(noteMap, allProps) {
  var p = allProps || PropertiesService.getScriptProperties().getProperties();
  var byFloor = {};
  ALL_SEATS.forEach(function (s) {
    if (s.type !== 'C' && s.type !== 'B') return; // 待機・黒服席は客が居ない
    ngSeatCustomers_(s.code, p).forEach(function (c) {
      var e = custNoteLookup_(noteMap, c.no, c.name);
      if (!byFloor[s.floor]) byFloor[s.floor] = [];
      byFloor[s.floor].push({ seat: s.code, seatLabel: s.label, when: c.when, no: c.no, name: c.name, entry: e });
    });
  });
  return byFloor;
}
// 同フロアNG客の衝突を全フロア分検出 → [{floor, a:{name,seatLabel}, b:{...}}]
function ngFloorConflicts_(noteMap, allProps) {
  var byFloor = ngFloorOccupants_(noteMap, allProps);
  var out = [];
  Object.keys(byFloor).forEach(function (f) {
    var list = byFloor[f];
    for (var i = 0; i < list.length; i++) {
      for (var j = i + 1; j < list.length; j++) {
        if (!list[i].entry || !list[j].entry) continue;
        if (list[i].seat === list[j].seat) continue; // 同卓は同席＝連れ。フロア衝突として鳴らさない
        if (ngPairConflict_(list[i].entry, list[j].entry)) {
          out.push({ floor: f,
                     a: { name: list[i].name || ngCustLabel_(list[i].entry), seat: list[i].seat, seatLabel: list[i].seatLabel, when: list[i].when },
                     b: { name: list[j].name || ngCustLabel_(list[j].entry), seat: list[j].seat, seatLabel: list[j].seatLabel, when: list[j].when } });
        }
      }
    }
  });
  return out;
}

/* ══ 公開API（軍師 GUNSHI_API_FNS 登録が要る）══════════════════════════ */

// 顧客1件の注意情報を読む（編集フォーム用）。語彙とキャスト名簿も一緒に返す＝フロントは選ぶだけ
function kioskGetCustomerNote(no, name) {
  try {
    var sheet = getOrOpenSS_().getSheetByName(MASTER_TAB);
    if (!sheet) return { ok: false, error: 'マスタなし' };
    var values = sheet.getDataRange().getValues();
    var h = custMasterHeaderRow_(values);
    if (h < 0) return { ok: false, error: '見出し行なし' };
    var headers = values[h].map(function (c) { return String(c).replace(/\s/g, ''); });
    var idx = function (kw) { return headers.findIndex(function (x) { return x.indexOf(kw) !== -1; }); };
    var cNo = idx('会員番号'), cCard = idx('カード記載名'), cName = idx('氏名');
    var cNote = headers.indexOf(CUST_NOTE_HEADER);
    var cNg = idx('NG行為'), cNgS = idx('NGスタッフ');
    var nq = ngKeyNo_(no), nmq = ngKeyName_(name);
    for (var r = h + 1; r < values.length; r++) {
      var row = values[r];
      var rno = cNo >= 0 ? ngKeyNo_(row[cNo]) : '';
      var rcard = cCard >= 0 ? ngKeyName_(row[cCard]) : '';
      var rname = cName >= 0 ? ngKeyName_(row[cName]) : '';
      if (!((nq && rno === nq) || (nmq && (rcard === nmq || rname === nmq)))) continue;
      var note = parseCustNote_(cNote >= 0 ? row[cNote] : '');
      var seed = { ng: cNg >= 0 ? String(row[cNg] || '').trim() : '', ngStaff: cNgS >= 0 ? String(row[cNgS] || '').trim() : '' };
      // 未入力なら旧フリーテキストを初期値として見せる（保存した時点で構造化に移る）
      if (!note.ngActs.length && seed.ng) note.ngActs = ngSplitFreeText_(seed.ng);
      if (!note.ngCasts.length && seed.ngStaff) note.ngCasts = ngSplitFreeText_(seed.ngStaff);
      return { ok: true, rowIdx: r + 1, note: note, vocab: { type: ngTypeVocab_(), act: ngActVocab_() },
               casts: ngRosterCastNames_(), legacy: seed };
    }
    return { ok: false, error: '該当なし' };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// 注意情報を保存（軍師／コンソール共通の本体）。列が無ければ末尾に作る
function kioskSaveCustomerNote(no, name, note, who) {
  try {
    var sheet = getOrOpenSS_().getSheetByName(MASTER_TAB);
    if (!sheet) return { ok: false, error: 'マスタなし' };
    var values = sheet.getDataRange().getValues();
    var h = custMasterHeaderRow_(values);
    if (h < 0) return { ok: false, error: '見出し行なし' };
    var headers = values[h].map(function (c) { return String(c).replace(/\s/g, ''); });
    var idx = function (kw) { return headers.findIndex(function (x) { return x.indexOf(kw) !== -1; }); };
    var cNo = idx('会員番号'), cCard = idx('カード記載名'), cName = idx('氏名');
    var cNote = getCustNoteCol_(sheet, values, true); // 無ければここで作る
    if (cNote < 0) return { ok: false, error: '注意情報列を作れません' };
    var clean = sanitizeCustNote_(note);
    clean.updatedBy = String(who || '').slice(0, 30);
    clean.updatedAt = fmtStamp_ ? fmtStamp_(new Date()) : Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
    var nq = ngKeyNo_(no), nmq = ngKeyName_(name);
    for (var r = h + 1; r < values.length; r++) {
      var row = values[r];
      var rno = cNo >= 0 ? ngKeyNo_(row[cNo]) : '';
      var rcard = cCard >= 0 ? ngKeyName_(row[cCard]) : '';
      var rname = cName >= 0 ? ngKeyName_(row[cName]) : '';
      if (!((nq && rno === nq) || (nmq && (rcard === nmq || rname === nmq)))) continue;
      sheet.getRange(r + 1, cNote + 1).setValue(custNoteEmpty_(clean) ? '' : JSON.stringify(clean));
      custNoteCacheClear_();
      return { ok: true, note: clean };
    }
    return { ok: false, error: '該当のお客様が見つかりません' };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// 名簿の在籍キャスト名（NGキャストを名前で選ばせるため。手打ちのブレを無くす）
function ngRosterCastNames_() {
  try {
    if (typeof getKioskCastNames === 'function') {
      var r = getKioskCastNames();
      if (Array.isArray(r)) return r;
      if (r && Array.isArray(r.names)) return r.names;
      if (r && Array.isArray(r.casts)) return r.casts;
    }
  } catch (e) {}
  return [];
}

/**
 * 付け回し前チェック（軍師フロントが「付ける」直前に必ず呼ぶ／backendも同じ判定で門を閉める）
 * @param seatCode 付け先の席コード（例 '5F-C3'）
 * @param castName 付けようとしているキャスト
 * @return { ok, blocked, reasons[], warns[], floorWarns[] }
 */
function gunshiNgCheckAssign(seatCode, castName) {
  try {
    var props = PropertiesService.getScriptProperties().getProperties();
    var noteMap = getCustNoteMap_();
    var profMap = ngCastProfileMap_();
    var res = { ok: true, blocked: false, reasons: [], warns: [], floorWarns: [] };
    ngSeatCustomers_(seatCode, props).forEach(function (c) {
      var e = custNoteLookup_(noteMap, c.no, c.name);
      if (!e) return;
      var r = ngEvaluateCast_(e, castName, profMap);
      if (r.blocked) { res.blocked = true; res.reasons = res.reasons.concat(r.reasons); }
      res.warns = res.warns.concat(r.warns);
    });
    // 同フロアNG客は席に客が居る限り常に効く（付け回しの度に黒服の目に入れる）
    var seat = ALL_SEATS.filter(function (s) { return s.code === seatCode; })[0];
    if (seat) {
      ngFloorConflicts_(noteMap, props).forEach(function (cf) {
        if (cf.floor !== seat.floor) return;
        res.floorWarns.push('🚷 ' + cf.floor + '同フロア：' + cf.a.name + '様（' + cf.a.seatLabel + '）と ' + cf.b.name + '様（' + cf.b.seatLabel + '）は同席NG');
      });
    }
    return res;
  } catch (e) { return { ok: false, error: String((e && e.message) || e), blocked: false, reasons: [], warns: [], floorWarns: [] }; }
}

/**
 * 店全体のNG盤面（軍師ホーム／ホール／予約一覧の⚠️の供給元）
 * @return { ok, conflicts[], seats{ seatCode: {blocked[],warns[]} }, at }
 */
function gunshiNgBoard() {
  try {
    var props = PropertiesService.getScriptProperties().getProperties();
    var noteMap = getCustNoteMap_();
    var profMap = ngCastProfileMap_();
    var conflicts = ngFloorConflicts_(noteMap, props);
    var seats = {};
    // 今の在席キャスト × その席の客 でNGが成立していないか（＝すでに起きている事故を炙り出す）
    var active = [];
    try { active = activeAtendouMemo_(todayStr()) || []; } catch (e) {}
    var castsBySeat = {};
    active.forEach(function (a) { if (!castsBySeat[a.code]) castsBySeat[a.code] = []; castsBySeat[a.code].push(a.cast || a.name); });
    Object.keys(castsBySeat).forEach(function (code) {
      var custs = ngSeatCustomers_(code, props);
      if (!custs.length) return;
      custs.forEach(function (c) {
        var e = custNoteLookup_(noteMap, c.no, c.name);
        if (!e) return;
        castsBySeat[code].forEach(function (cast) {
          if (!cast) return;
          var r = ngEvaluateCast_(e, cast, profMap);
          if (!r.blocked && !r.warns.length) return;
          if (!seats[code]) seats[code] = { blocked: [], warns: [] };
          if (r.blocked) seats[code].blocked = seats[code].blocked.concat(r.reasons);
          seats[code].warns = seats[code].warns.concat(r.warns);
        });
      });
    });
    return { ok: true, conflicts: conflicts, seats: seats,
             at: Utilities.formatDate(new Date(), TZ, 'HH:mm') };
  } catch (e) { return { ok: false, error: String((e && e.message) || e), conflicts: [], seats: {} }; }
}

/**
 * 予約フォーム用：この客をこの席・この担当で取ったときの注意（予約時に注意する、の実体）
 * @param memberId 会員番号 / customer 客名 / tableName 卓名（'2F カウンター1' 等の表記ゆれOK） / castNames 担当・同伴など
 */
function gunshiNgCheckReservation(memberId, customer, tableName, castNames) {
  try {
    var noteMap = getCustNoteMap_();
    var profMap = ngCastProfileMap_();
    var entry = custNoteLookup_(noteMap, memberId, customer);
    var res = { ok: true, blocked: false, reasons: [], warns: [], floorWarns: [], nextMemo: entry ? entry.nextMemo : '' };
    if (entry) {
      (Array.isArray(castNames) ? castNames : [castNames]).filter(Boolean).forEach(function (cast) {
        var r = ngEvaluateCast_(entry, cast, profMap);
        if (r.blocked) { res.blocked = true; res.reasons = res.reasons.concat(r.reasons); }
        res.warns = res.warns.concat(r.warns);
      });
      if (!castNames || !castNames.length) {
        var r0 = ngEvaluateCast_(entry, '', profMap); // 担当未定でもNG行為だけは出す
        res.warns = res.warns.concat(r0.warns);
      }
    }
    // 卓が決まっているなら、そのフロアに居る/来る客とのNG関係を見る
    var code = '';
    try { code = tableName ? (tableNameToSeatCode_(tableName) || '') : ''; } catch (e) {}
    var seat = code ? ALL_SEATS.filter(function (s) { return s.code === code; })[0] : null;
    if (seat && entry) {
      var props = PropertiesService.getScriptProperties().getProperties();
      var byFloor = ngFloorOccupants_(noteMap, props);
      (byFloor[seat.floor] || []).forEach(function (o) {
        if (!o.entry || o.seat === code) return;
        if (ngPairConflict_(entry, o.entry)) {
          res.floorWarns.push('🚷 ' + seat.floor + 'に ' + (o.name || ngCustLabel_(o.entry)) + '様（' + o.seatLabel + '）＝同席NGのお客様が居ます');
        }
      });
    }
    return res;
  } catch (e) { return { ok: false, error: String((e && e.message) || e), blocked: false, reasons: [], warns: [], floorWarns: [] }; }
}

/* ══ キャスト側（ポータル）の申告について ═════════════════════════════════
   キャストの「苦手なお客様」は**既存の相性プロフィール（castGetProfile/castSaveProfile）に相乗り**する。
   専用APIは作らない＝保存経路が2本あると、片方の保存でもう片方が消える事故になるため。
   Code.gs 側の parseCastProfile_ / sanitizeCastProfile_ / castProfileEmpty_ に ngCustomers を通してある。
   ⚠️キャストに見せるのは「自分が申告した客」だけ。客側の注意情報（NGキャスト等）は読ませない。 */
