/* ==========================================================================
   Blueprint — renderização e interação (documentação; sem rede, sem dependências)
   ========================================================================== */
(function () {
'use strict';
var D = document;
function $(s, r) { return (r || D).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || D).querySelectorAll(s)); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function norm(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { if (v == null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch (e) {} }

var SCREENS = window.SCREENS || [], RF = window.RF || [], FLOWS = window.FLOWS || [], STATES = window.STATES || [],
    OPEN = window.OPEN || [], PERM = window.PERM || [], SCOPE = window.SCOPE || [], PROFILES = window.PROFILES || [],
    MODULES = window.MODULES || [];

var ST_LABEL = {A:'Aprovado', P:'Proposto', V:'Precisa validar', U:'Decisão pendente', R:'Rejeitado', K:'Conhecido (docs)', S:'Spike necessário', D:'RF rascunho'};
var ST_ORDER = ['A','P','V','U','S','K','R','D'];
function badge(code, label) { return '<span class="badge st-' + code + '">' + esc(label || ST_LABEL[code] || code) + '</span>'; }
var PROF_NAME = {}; PROFILES.forEach(function (p) { PROF_NAME[p.c] = p.n; });

/* ---------- ID → âncora ---------- */
var OPEN_IDS = {}; OPEN.forEach(function (o) { OPEN_IDS[o.id] = true; });
var SCREEN_IDS = {}; SCREENS.forEach(function (s) { SCREEN_IDS[s.id] = true; });
var RF_IDS = {}; RF.forEach(function (r) { RF_IDS[r[0]] = true; });
var SM_ANCHOR = {}; STATES.forEach(function (s) { SM_ANCHOR[s.id] = s.a; });
var FL_IDS = {}; FLOWS.forEach(function (f) { FL_IDS[f.id] = true; });
var MK_ANCHOR = {}, MK_NUM = {};
function indexMockups() {
  $$('figure.mock-fig').forEach(function (f) {
    var idEl = $('.mock-id', f); if (!idEl) return;
    var n = idEl.textContent.trim(); MK_ANCHOR[n] = f.id; MK_NUM[f.id] = n;
  });
}
var ID_RE = /\b(RF-[A-Z]{2,3}-\d{1,2}|MK-\d{2}|FL-\d{2}|SM-\d|BP-\d{2}|SEC-\d{2}|PAR-\d{2}|[WCAM]-\d{2}|R\d{2}|V-\d{2}|U-0\d|Q-0\d|S\d(?:\.\d)?|P-\d{2}|(?:AUTH|SYNC|DATA|STACK|MOB|SNK|OPS|GOV|ARCH)-\d)\b/g;
function anchorFor(id) {
  if (RF_IDS[id]) return 'rf-' + id;
  if (MK_ANCHOR[id]) return MK_ANCHOR[id];
  if (FL_IDS[id]) return id.toLowerCase();
  if (SM_ANCHOR[id]) return SM_ANCHOR[id];
  if (SCREEN_IDS[id]) return 'scr-' + id;
  if (OPEN_IDS[id]) return 'od-' + id;
  if (/^S\d/.test(id)) return 's30';
  return null;
}
function linkRefs(text) {
  return esc(text).replace(ID_RE, function (m) {
    var a = anchorFor(m);
    return a ? '<a class="idl" href="#' + a + '">' + m + '</a>' : '<span class="idl">' + m + '</span>';
  });
}

/* ---------- Reverse index RF → telas ---------- */
var RF_SCREENS = {};
SCREENS.forEach(function (s) {
  var ids = String(s.rf || '').match(/RF-[A-Z]{2,3}-\d{1,2}/g) || [];
  ids.forEach(function (id) { (RF_SCREENS[id] = RF_SCREENS[id] || []).push(s.id); });
});

/* ---------- Módulos ---------- */
function renderModules() {
  var el = $('#module-cards'); if (!el) return;
  el.innerHTML = MODULES.map(function (m) {
    var rfs = RF.filter(function (r) { return r[0].indexOf('RF-' + m.c + '-') === 0; });
    var scr = {}; rfs.forEach(function (r) { (RF_SCREENS[r[0]] || []).forEach(function (s) { scr[s] = 1; }); });
    return '<div class="card"><div class="card-h"><strong>' + esc(m.n) + '</strong><span class="ref">' + esc(m.c) + '</span></div>' +
      '<p class="small">' + esc(m.d) + '</p>' +
      '<dl class="kv small"><dt>Fase</dt><dd>' + esc(m.ph) + '</dd><dt>Requisitos</dt><dd><a href="#rfm-' + m.c + '">' + rfs.length + ' RF</a></dd><dt>Telas</dt><dd>' + Object.keys(scr).length + '</dd></dl>' +
      '<div class="chips">' + m.st.map(function (x) { return badge(x[0], x[1]); }).join('') + '</div></div>';
  }).join('');
}

/* ---------- Catálogo RF ---------- */
function renderRF() {
  var el = $('#rf-catalog'); if (!el) return;
  el.innerHTML = MODULES.map(function (m) {
    var rfs = RF.filter(function (r) { return r[0].indexOf('RF-' + m.c + '-') === 0; });
    var covered = rfs.filter(function (r) { return RF_SCREENS[r[0]]; }).length;
    return '<details class="collapse" id="rfm-' + m.c + '"><summary><span class="ref">' + m.c + '</span> ' + esc(m.n) +
      '<span class="sum-meta"><span class="tag">' + esc(m.ph) + '</span><span class="tag">' + rfs.length + ' RF · ' + covered + ' com tela</span></span></summary>' +
      '<div class="body"><div class="table-wrap"><table class="t compact"><thead><tr><th>Requisito</th><th>Fase</th><th>Função</th><th>Telas</th></tr></thead><tbody>' +
      rfs.map(function (r) {
        var s = RF_SCREENS[r[0]] || [];
        return '<tr id="rf-' + r[0] + '"><td class="nowrap"><span class="ref">' + r[0] + '</span></td><td class="nowrap">' + esc(r[1]) + '</td><td>' + linkRefs(r[2]) + '</td><td>' +
          (s.length ? s.map(function (id) { return '<a class="idl" href="#scr-' + id + '">' + id + '</a>'; }).join(' ') : '<span class="muted small">sem tela</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div></details>';
  }).join('');
}

/* ---------- Matriz de permissões ---------- */
function permCell(v) {
  if (v === 'y') return '<span class="v yes" aria-hidden="true">✔</span><span class="sr-only">permitido</span>';
  if (v === 'n') return '<span class="v no" aria-hidden="true">—</span><span class="sr-only">não permitido</span>';
  if (v === 'x') return '<span class="v deny" aria-hidden="true">✖</span><span class="sr-only">proibido</span>';
  if (v === '?') return '<span class="v cond">?</span><span class="sr-only">não definido</span>';
  return '<span class="cond">' + esc(v) + '</span>';
}
function renderPerm() {
  var el = $('#perm-matrix'); if (!el) return;
  var head = '<thead><tr><th>Permissão de ação</th>' + PROFILES.map(function (p) { return '<th class="c">' + esc(p.n) + '</th>'; }).join('') + '</tr></thead>';
  var body = PERM.map(function (row) {
    return '<tr><td><b>' + esc(row.cap) + '</b><div>' + badge(row.st) + '</div>' + (row.nt ? '<div class="small muted">' + linkRefs(row.nt) + '</div>' : '') + '</td>' +
      PROFILES.map(function (p) {
        var cs = (row.cs && row.cs[p.c]) || null, v = row.v[p.c];
        var cls = 'cell' + (cs === 'A' ? ' a' : '') + (cs === 'U' || v === '?' ? ' u' : '');
        var mk = cs === 'A' ? '<span class="mk a">aprovado</span>' : (cs === 'U' || v === '?') ? '<span class="mk u">pendente</span>' : (cs === 'P' ? '<span class="mk p">proposto</span>' : '');
        return '<td class="' + cls + '">' + permCell(v) + mk + '</td>';
      }).join('') + '</tr>';
  }).join('');
  el.innerHTML = '<div class="table-wrap"><table class="t pm compact"><caption>Permissões de ação — padrão da spec §8.2 (rascunho) com status por linha e por célula</caption>' + head + '<tbody>' + body + '</tbody></table></div>';
}
function renderScope() {
  var el = $('#scope-matrix'); if (!el) return;
  var head = '<thead><tr><th>Recurso</th>' + PROFILES.map(function (p) { return '<th class="c">' + esc(p.n) + '</th>'; }).join('') + '<th>Nota</th></tr></thead>';
  var body = SCOPE.map(function (row) {
    return '<tr><td><b>' + esc(row.res) + '</b></td>' + PROFILES.map(function (p) {
      var raw = row.v[p.c] || '?', parts = raw.split('|'), v = parts[0], note = parts[1];
      if (v === '?') return '<td class="cell u"><span class="v cond">?</span><span class="mk u">pendente</span>' + (note ? '<span class="small muted" style="display:block">' + linkRefs(note) + '</span>' : '') + '</td>';
      return '<td class="cell"><span class="scope ' + v + '">' + (v === 'proprio' ? 'próprio' : v) + '</span>' + (note ? '<span class="small muted" style="display:block">' + linkRefs(note) + '</span>' : '') + '</td>';
    }).join('') + '<td class="small">' + linkRefs(row.nt || '') + '</td></tr>';
  }).join('');
  el.innerHTML = '<div class="table-wrap"><table class="t pm compact"><caption>Escopo de dados por recurso — ' + 'PROPOSTO (D11 por perfil; AUTH-4 por permissão)</caption>' + head + '<tbody>' + body + '</tbody></table></div>';
}

/* ---------- Catálogo de telas ---------- */
var GRP = {web:'Web', crm:'CRM', ia:'IA', mobile:'Mobile'};
var DEF = {
  web: {offline:'Somente online (web não opera offline — P-07)', sync:'Lê a API; dados Sankhya vêm do espelho com a hora da última sincronização', loading:'Skeleton de tabela/cartões', empty:'Estado vazio com orientação e ação primária quando permitida', error:'Mensagem acionável + Tentar novamente; id de correlação; detalhes só no log', denied:'403 sem revelar dados; servidor decide (P-21)'},
  mobile: {offline:'Funciona offline com dados locais da última sincronização', sync:'Lê SQLite local criptografado; gravações viram comandos na outbox local', loading:'Leitura local instantânea; indicador só em ações de rede', empty:'Estado vazio com dica e data da última sincronização', error:'Erro local explicado; comandos rejeitados aparecem na fila de sync', denied:'Dados fora do escopo nunca chegam ao aparelho (P-21); tela informa ausência de permissão'}
};
var FIELDS = [['id','ID da tela'],['name','Nome'],['ph','Fase'],['plat','Plataforma'],['prof','Perfis com acesso'],['purpose','Objetivo'],['info','Informações principais'],['fields','Campos'],['filters','Filtros'],['cols','Colunas'],['actions','Ações'],['perms','Permissões'],['rules','Regras de negócio'],['offline','Online / offline'],['sync','Sincronização'],['loading','Estado: carregando'],['empty','Estado: vazio'],['error','Estado: erro'],['denied','Estado: permissão negada'],['audit','Eventos de auditoria'],['ents','Entidades relacionadas'],['rf','Requisitos RF'],['st','Status de decisão'],['mock','Mockup']];
function screenField(s, key) {
  var dflt = DEF[s.grp === 'mobile' ? 'mobile' : 'web'];
  var v = s[key];
  if (key === 'prof') return (v || []).map(function (c) { return esc(PROF_NAME[c] || c); }).join(' · ') || '—';
  if (key === 'st') return '<div class="st-rows">' + (v || []).map(function (x) { return '<div>' + badge(x[0]) + '<span>' + linkRefs(x[1]) + '</span></div>'; }).join('') + '</div>';
  if (key === 'mock') {
    if (!v) return '<span class="muted">Sem mockup nesta versão</span>';
    return '<a href="#' + esc(v) + '">' + esc(MK_NUM[v] || v) + ' — ver mockup</a>';
  }
  if (key === 'id') return '<span class="ref">' + esc(v) + '</span>';
  if ((v == null || v === '') && dflt[key]) return '<span class="dflt">' + linkRefs(dflt[key]) + ' <em>(padrão da plataforma)</em></span>';
  return linkRefs(v == null || v === '' ? '—' : v);
}
function renderScreens() {
  var el = $('#screens'); if (!el) return;
  var counts = {};
  var html = ['web','crm','ia','mobile'].map(function (g) {
    var list = SCREENS.filter(function (s) { return s.grp === g; });
    counts[g] = list.length;
    return '<div class="grp-h" data-grp-h="' + g + '"><h3>' + GRP[g] + '</h3><span class="tag" data-grp-count="' + g + '">' + list.length + ' telas</span></div>' +
      list.map(function (s) {
        var codes = {}; (s.st || []).forEach(function (x) { codes[x[0]] = 1; });
        var sum = ST_ORDER.filter(function (c) { return codes[c]; }).map(function (c) { return badge(c); }).join('');
        return '<details class="scr" id="scr-' + esc(s.id) + '" data-grp="' + g + '"><summary><span class="sid">' + esc(s.id) + '</span><span><span class="sn">' + esc(s.name) + '</span> <span class="muted small">· ' + esc(s.plat) + ' · ' + esc(s.ph) + '</span></span><span class="sm2">' + sum + (s.mock ? '<span class="tag">mockup</span>' : '') + '</span></summary>' +
          '<div class="sbody"><div class="sgrid">' + FIELDS.map(function (f) { return '<div class="k">' + f[1] + '</div><div>' + screenField(s, f[0]) + '</div>'; }).join('') + '</div></div></details>';
      }).join('');
  }).join('');
  el.innerHTML = html;
  var pc = $('#scr-counts');
  if (pc) pc.innerHTML = ['web','crm','ia','mobile'].map(function (g) { return '<div class="kpi"><div class="v">' + counts[g] + '</div><div class="l">telas ' + GRP[g] + '</div></div>'; }).join('');
  var ids = ['scrQ','scrGrp','scrPh','scrProf','scrSt','scrMock'];
  ids.forEach(function (id) { var c = D.getElementById(id); if (c) c.addEventListener(c.type === 'checkbox' || c.tagName === 'SELECT' ? 'change' : 'input', filterScreens); });
  var sp = $('#scrProf'); if (sp) sp.innerHTML = '<option value="">Todos</option>' + PROFILES.map(function (p) { return '<option value="' + p.c + '">' + esc(p.n) + '</option>'; }).join('');
  filterScreens();
}
function filterScreens() {
  var q = norm(($('#scrQ') || {}).value), g = ($('#scrGrp') || {}).value, ph = ($('#scrPh') || {}).value,
      pf = ($('#scrProf') || {}).value, st = ($('#scrSt') || {}).value, mk = ($('#scrMock') || {}).checked;
  var shown = 0, per = {web:0, crm:0, ia:0, mobile:0};
  SCREENS.forEach(function (s) {
    var el = D.getElementById('scr-' + s.id); if (!el) return;
    if (!el._txt) el._txt = norm(el.textContent);
    var ok = (!g || s.grp === g) && (!ph || String(s.ph).indexOf(ph) >= 0) && (!pf || (s.prof || []).indexOf(pf) >= 0) &&
      (!st || (s.st || []).some(function (x) { return x[0] === st; })) && (!mk || !!s.mock) &&
      (!q || q.split(/\s+/).every(function (t) { return el._txt.indexOf(t) >= 0; }));
    el.classList.toggle('fh', !ok);
    if (ok) { shown++; per[s.grp]++; }
  });
  Object.keys(per).forEach(function (k) {
    var h = $('[data-grp-h="' + k + '"]'); if (h) h.classList.toggle('fh', per[k] === 0);
    var c = $('[data-grp-count="' + k + '"]'); if (c) c.textContent = per[k] + ' telas';
  });
  var cnt = $('#scrCount'); if (cnt) cnt.textContent = shown + ' de ' + SCREENS.length + ' telas';
}

/* ---------- Fluxos ---------- */
var KIND = {s:'start', n:'', d:'decision', e:'end', x:'error', w:'wait'};
var KIND_LABEL = {s:'Início', n:'Passo', d:'Decisão', e:'Fim', x:'Erro / exceção', w:'Espera'};
function renderFlows() {
  var el = $('#flows'); if (!el) return;
  var idx = $('#flow-index');
  if (idx) idx.innerHTML = FLOWS.map(function (f) { return '<a href="#' + f.id.toLowerCase() + '"><b>' + f.id + '</b>' + esc(f.t) + '</a>'; }).join('');
  el.innerHTML = FLOWS.map(function (f) {
    var n = f.lanes.length, laneIx = {};
    f.lanes.forEach(function (l, i) { laneIx[l[0]] = i; });
    var cells = [], row = 1;
    f.lanes.forEach(function (l, i) {
      cells.push('<div class="lane-h' + (i === n - 1 ? ' last' : '') + '" style="grid-row:1;grid-column:' + (i + 1) + '">' + esc(l[1]) + '</div>');
    });
    row = 2;
    var total = f.steps.length * 2;
    f.lanes.forEach(function (l, i) {
      cells.push('<div class="lane-bg' + (i === n - 1 ? ' last' : '') + '" aria-hidden="true" style="grid-row:2 / ' + (2 + total) + ';grid-column:' + (i + 1) + '"></div>');
    });
    f.steps.forEach(function (s, k) {
      var li = laneIx[s.l]; if (li == null) li = 0;
      var laneName = f.lanes[li][1];
      cells.push('<div class="lane-cell" style="grid-row:' + row + ';grid-column:' + (li + 1) + '"><div class="fnode ' + (KIND[s.k] || '') + '"><span class="no" aria-hidden="true">' + (k + 1) + '</span>' +
        '<span class="sr-only">Passo ' + (k + 1) + ', ' + KIND_LABEL[s.k] + ', raia ' + esc(laneName) + ': </span>' + linkRefs(s.t) +
        (s.o ? '<span class="out">' + linkRefs(s.o) + '</span>' : '') +
        (s.s ? '<span class="fb">' + s.s.map(function (x) { return badge(x[0], x[1]); }).join('') + '</span>' : '') + '</div></div>');
      row++;
      var nx = f.steps[k + 1];
      if (nx) {
        var lj = laneIx[nx.l]; if (lj == null) lj = 0;
        if (lj === li) {
          cells.push('<div class="conn" aria-hidden="true" style="grid-row:' + row + ';grid-column:' + (li + 1) + '"><span class="vs" style="left:50%"></span><span class="tip" style="left:50%"></span></div>');
        } else {
          var lo = Math.min(li, lj), hi = Math.max(li, lj), span = hi - lo + 1;
          var sx = (li - lo + 0.5) / span * 100, ex = (lj - lo + 0.5) / span * 100;
          cells.push('<div class="conn" aria-hidden="true" style="grid-row:' + row + ';grid-column:' + (lo + 1) + ' / ' + (hi + 2) + '">' +
            '<span class="v1" style="left:' + sx + '%"></span><span class="h" style="left:' + Math.min(sx, ex) + '%;width:' + Math.abs(ex - sx) + '%"></span>' +
            '<span class="v2" style="left:' + ex + '%"></span><span class="tip" style="left:' + ex + '%"></span></div>');
        }
        row++;
      }
    });
    var minW = Math.max(720, n * 170);
    return '<article class="flow" id="' + f.id.toLowerCase() + '"><div class="flow-h"><span class="fid">' + f.id + '</span><h3>' + esc(f.t) + '</h3><span class="tag">' + esc(f.ph) + '</span><div class="meta">' +
      f.st.map(function (x) { return badge(x[0], x[1]); }).join('') + '</div></div>' +
      '<div class="flow-scroll" tabindex="0" role="region" aria-label="Fluxo ' + f.id + ' — ' + esc(f.t) + ' (rolável)"><div class="lanes" style="grid-template-columns:repeat(' + n + ',minmax(150px,1fr));min-width:' + minW + 'px">' + cells.join('') + '</div></div>' +
      '<div class="flow-foot"><span><b>Requisitos:</b> ' + linkRefs(f.rf) + '</span><span><b>Telas:</b> ' + linkRefs(f.scr) + '</span><span><b>Seção:</b> <a href="#' + f.sec + '">' + esc(sectionTitle(f.sec)) + '</a></span></div></article>';
  }).join('');
}
function sectionTitle(id) { var s = D.getElementById(id); return s ? ((s.getAttribute('data-num') || '') + ' — ' + s.getAttribute('data-title')) : id; }

/* ---------- Máquinas de estado ---------- */
var CW = 196, CH = 100, BW = 160, BH = 46, PAD = 22;
function renderStates() {
  var el = $('#states'); if (!el) return;
  var idx = $('#state-index');
  if (idx) idx.innerHTML = STATES.map(function (m) { return '<a href="#' + m.a + '"><b>' + m.id + '</b>' + esc(m.t) + '</a>'; }).join('');
  el.innerHTML = STATES.map(function (m) {
    var W = m.cols * CW - (CW - BW) + PAD * 2, H = m.rows * CH - (CH - BH) + PAD * 2;
    var pos = {};
    m.nodes.forEach(function (nd) { pos[nd.id] = {x: PAD + nd.c * CW + BW / 2, y: PAD + nd.r * CH + BH / 2}; });
    var mid = m.id.replace(/\W/g, '');
    var defs = '<defs>' + ['n','pend','bad'].map(function (k) {
      var col = k === 'pend' ? 'var(--warn)' : k === 'bad' ? 'var(--danger)' : 'var(--text-3)';
      return '<marker id="arw-' + mid + '-' + k + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style="fill:' + col + '"/></marker>';
    }).join('') + '</defs>';
    var paths = [], labels = [];
    m.edges.forEach(function (e) {
      var a = pos[e.f], b = pos[e.t]; if (!a || !b) return;
      var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / len, ny = dx / len, bend = e.b || 0;
      var cx = (a.x + b.x) / 2 + nx * bend, cy = (a.y + b.y) / 2 + ny * bend;
      var s = clip(a, cx, cy), t = clip(b, cx, cy);
      var k = e.k === 'pend' ? 'pend' : e.k === 'bad' ? 'bad' : 'n';
      var d = bend ? ('M' + r1(s.x) + ',' + r1(s.y) + ' Q' + r1(cx) + ',' + r1(cy) + ' ' + r1(t.x) + ',' + r1(t.y)) : ('M' + r1(s.x) + ',' + r1(s.y) + ' L' + r1(t.x) + ',' + r1(t.y));
      paths.push('<g class="e' + (e.k ? ' ' + e.k : '') + (e.k === 'pend' ? ' dash' : '') + '"><path d="' + d + '" marker-end="url(#arw-' + mid + '-' + k + ')"/></g>');
      if (e.l) {
        var lx = bend ? 0.25 * s.x + 0.5 * cx + 0.25 * t.x : (s.x + t.x) / 2, ly = bend ? 0.25 * s.y + 0.5 * cy + 0.25 * t.y : (s.y + t.y) / 2;
        var w = e.l.length * 5.7 + 10;
        if (!bend && Math.abs(dy) < 8 && Math.abs(dx) < CW * 1.5) ly = a.y - BH / 2 - 10;
        else if (!bend && Math.abs(dx) < 8) lx = a.x + w / 2 + 6;
        lx += e.ox || 0; ly += e.oy || 0;
        labels.push('<g class="e"><rect x="' + r1(lx - w / 2) + '" y="' + r1(ly - 8) + '" width="' + r1(w) + '" height="15" rx="2"/><text x="' + r1(lx) + '" y="' + r1(ly + 3.5) + '" text-anchor="middle">' + esc(e.l) + '</text></g>');
      }
    });
    var nodes = m.nodes.map(function (nd) {
      var p = pos[nd.id], fs = nd.l.length > 18 ? 11 : 12;
      return '<g class="n ' + (nd.k || '') + '"><rect x="' + (p.x - BW / 2) + '" y="' + (p.y - BH / 2) + '" width="' + BW + '" height="' + BH + '" rx="' + (nd.k === 'initial' ? 10 : 4) + '"/>' +
        '<text x="' + p.x + '" y="' + (p.y + (nd.sub ? -3 : 4)) + '" text-anchor="middle" style="font-size:' + fs + 'px">' + esc(nd.l) + '</text>' +
        (nd.sub ? '<text class="sub" x="' + p.x + '" y="' + (p.y + 12) + '" text-anchor="middle">' + esc(nd.sub) + '</text>' : '') + '</g>';
    }).join('');
    var desc = m.nodes.map(function (n) { return n.l; }).join(', ');
    return '<article class="sm" id="' + m.a + '"><div class="flow-h"><span class="fid">' + m.id + '</span><h3>' + esc(m.t) + '</h3><div class="meta">' +
      m.st.map(function (x) { return badge(x[0], x[1]); }).join('') + '</div></div>' +
      '<div class="sm-scroll" tabindex="0" role="region" aria-label="Máquina de estados ' + m.id + ' (rolável)"><svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" style="max-width:100%;height:auto" role="img" aria-labelledby="t-' + mid + '"><title id="t-' + mid + '">Máquina de estados ' + esc(m.t) + ': ' + esc(desc) + '</title>' + defs + paths.join('') + nodes + labels.join('') + '</svg></div>' +
      '<div class="sm-legend"><span><i class="sw initial"></i>inicial</span><span><i class="sw final"></i>final / sucesso</span><span><i class="sw bad"></i>erro / negativo</span><span><i class="sw pend"></i>pendente de decisão ou spike</span><span><i class="sw prop"></i>nome proposto neste blueprint</span><span>seta tracejada: implícita, proposta ou não especificada</span></div>' +
      '<details class="collapse" style="margin:0;border-width:1px 0 0;border-radius:0"><summary>Tabela de transições (' + m.tx.length + ')</summary><div class="body"><div class="table-wrap"><table class="t compact"><thead><tr><th>Transição</th><th>Gatilho / regra</th><th>Status</th></tr></thead><tbody>' +
      m.tx.map(function (t) { return '<tr><td class="nowrap"><code>' + esc(t[0]) + '</code></td><td>' + linkRefs(t[1]) + '</td><td>' + badge(t[2]) + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="small">Seção relacionada: <a href="#' + m.sec + '">' + esc(sectionTitle(m.sec)) + '</a></p></div></details></article>';
  }).join('');
}
function r1(v) { return Math.round(v * 10) / 10; }
function clip(p, tx, ty) {
  var dx = tx - p.x, dy = ty - p.y, hw = BW / 2 + 3, hh = BH / 2 + 3;
  var t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  if (!isFinite(t)) t = 0;
  return {x: p.x + dx * t, y: p.y + dy * t};
}

/* ---------- Decisões em aberto ---------- */
function renderOpen() {
  var el = $('#open-decisions'); if (!el) return;
  var cats = []; OPEN.forEach(function (o) { if (cats.indexOf(o.cat) < 0) cats.push(o.cat); });
  var byStatus = {}; OPEN.forEach(function (o) { byStatus[o.st] = (byStatus[o.st] || 0) + 1; });
  var sum = $('#open-summary');
  if (sum) sum.innerHTML = '<span class="tag"><b>' + OPEN.length + '</b> itens em aberto</span>' + ST_ORDER.filter(function (c) { return byStatus[c]; }).map(function (c) { return badge(c, ST_LABEL[c] + ' · ' + byStatus[c]); }).join('');
  el.innerHTML = '<div class="filterbar" role="group" aria-label="Filtros das decisões em aberto">' +
    '<label>Buscar<input id="odQ" type="search" placeholder="ID, tema, recomendação…"></label>' +
    '<label>Categoria<select id="odCat"><option value="">Todas</option>' + cats.map(function (c) { var n = OPEN.filter(function (o) { return o.cat === c; }).length; return '<option value="' + esc(c) + '">' + esc(c) + ' (' + n + ')</option>'; }).join('') + '</select></label>' +
    '<label>Status<select id="odSt"><option value="">Todos</option>' + ST_ORDER.filter(function (c) { return byStatus[c]; }).map(function (c) { return '<option value="' + c + '">' + ST_LABEL[c] + '</option>'; }).join('') + '</select></label>' +
    '<span class="count" id="odCount" aria-live="polite"></span></div>' +
    '<div class="table-wrap"><table class="t compact"><thead><tr><th>ID</th><th>Tema</th><th>Status</th><th>Recomendação / proposta atual</th><th>Necessário antes de</th><th>Seção</th></tr></thead><tbody>' +
    cats.map(function (c) {
      var rows = OPEN.filter(function (o) { return o.cat === c; });
      return '<tr class="od-cat-row" data-cat="' + esc(c) + '"><td colspan="6" class="od-cat" style="background:var(--surface-3)">' + esc(c) + ' <span class="muted small">(' + rows.length + ')</span></td></tr>' +
        rows.map(function (o) {
          return '<tr id="od-' + esc(o.id) + '" data-cat="' + esc(o.cat) + '" data-st="' + o.st + '"><td class="nowrap"><span class="ref">' + esc(o.id) + '</span></td><td><b>' + esc(o.t) + '</b></td><td>' + badge(o.st) + '</td><td>' + linkRefs(o.rec) + '</td><td>' + linkRefs(o.blk) + '</td><td class="nowrap"><a href="#' + o.sec + '">' + esc((D.getElementById(o.sec) || {getAttribute: function () { return o.sec; }}).getAttribute('data-num') || o.sec) + '</a></td></tr>';
        }).join('');
    }).join('') + '</tbody></table></div>';
  ['odQ','odCat','odSt'].forEach(function (id) { var c = D.getElementById(id); c.addEventListener(c.tagName === 'SELECT' ? 'change' : 'input', filterOpen); });
  filterOpen();
}
function filterOpen() {
  var q = norm($('#odQ').value), cat = $('#odCat').value, st = $('#odSt').value, shown = 0, perCat = {};
  OPEN.forEach(function (o) {
    var tr = D.getElementById('od-' + o.id); if (!tr) return;
    if (!tr._txt) tr._txt = norm(tr.textContent + ' ' + o.cat);
    var ok = (!cat || o.cat === cat) && (!st || o.st === st) && (!q || q.split(/\s+/).every(function (t) { return tr._txt.indexOf(t) >= 0; }));
    tr.classList.toggle('fh', !ok);
    if (ok) { shown++; perCat[o.cat] = 1; }
  });
  $$('tr.od-cat-row').forEach(function (tr) { tr.classList.toggle('fh', !perCat[tr.getAttribute('data-cat')]); });
  $('#odCount').textContent = shown + ' de ' + OPEN.length + ' itens';
}

/* ---------- Mockups: índice ---------- */
function renderMockIndex() {
  var el = $('#mock-index'); if (!el) return;
  el.innerHTML = $$('figure.mock-fig').map(function (f) {
    var n = MK_NUM[f.id] || '', t = $('.mock-cap strong', f);
    return '<a href="#' + f.id + '"><b>' + esc(n) + '</b><span>' + esc(t ? t.textContent : f.id) + '</span></a>';
  }).join('');
}

/* ---------- Refs estáticas → links (fora dos desenhos de mockup) ---------- */
function linkStaticRefs() {
  $$('span.ref').forEach(function (sp) {
    if (sp.closest('.mock-scroll, .phone')) return;
    var id = sp.textContent.trim(), a = anchorFor(id);
    if (!a || !D.getElementById(a)) return;
    var link = D.createElement('a'); link.className = sp.className; link.href = '#' + a; link.textContent = id;
    sp.parentNode.replaceChild(link, sp);
  });
}

/* ---------- Navegação ---------- */
var sections = [], navLinks = [];
function buildNav() {
  var nav = $('#nav'); sections = $$('section.doc-section');
  var html = '', group = null;
  sections.forEach(function (s) {
    var g = s.getAttribute('data-group');
    if (g !== group) { html += (group !== null ? '</div>' : '') + '<div class="nav-g"><div class="nav-group">' + esc(g) + '</div>'; group = g; }
    html += '<a href="#' + s.id + '" data-sec="' + s.id + '"><span class="n">' + esc(s.getAttribute('data-num')) + '</span><span class="tt">' + esc(s.getAttribute('data-title')) + '</span></a>';
  });
  nav.innerHTML = html + '</div>';
  navLinks = $$('a', nav);
  updateCount(sections.length, false);
}
function updateCount(n, filtered) { var c = $('#navCount'); if (c) c.textContent = filtered ? (n + ' de ' + sections.length + ' seções') : (sections.length + ' seções · Draft v0.1'); }

var index = [];
function buildIndex() { index = sections.map(function (s) { return norm(s.getAttribute('data-title') + ' ' + (s.getAttribute('data-kw') || '') + ' ' + s.textContent); }); }
function runSearch() {
  var q = norm($('#q').value).trim(), toks = q ? q.split(/\s+/) : [], hide = $('#filterContent').checked, n = 0;
  sections.forEach(function (s, i) {
    var ok = !toks.length || toks.every(function (t) { return index[i].indexOf(t) >= 0; });
    if (ok) n++;
    var link = navLinks[i];
    link.classList.toggle('hide', !ok);
    var tt = $('.tt', link), title = s.getAttribute('data-title');
    tt.innerHTML = markTitle(title, toks);
    s.classList.toggle('hidden-by-filter', hide && !ok);
  });
  $$('.nav-g').forEach(function (g) { g.classList.toggle('fh', !$$('a:not(.hide)', g).length); });
  $$('.part-title').forEach(function (p) {
    var el = p.nextElementSibling, any = false;
    while (el && !el.classList.contains('part-title')) { if (el.matches('section.doc-section') && !el.classList.contains('hidden-by-filter')) any = true; el = el.nextElementSibling; }
    p.classList.toggle('fh', !any);
  });
  updateCount(n, toks.length > 0);
}
function markTitle(title, toks) {
  if (!toks.length) return esc(title);
  var nt = norm(title), marks = [];
  toks.forEach(function (t) { var i = nt.indexOf(t); if (i >= 0) marks.push([i, i + t.length]); });
  if (!marks.length) return esc(title);
  marks.sort(function (a, b) { return a[0] - b[0]; });
  var out = '', pos = 0;
  marks.forEach(function (m) { if (m[0] < pos) return; out += esc(title.slice(pos, m[0])) + '<mark>' + esc(title.slice(m[0], m[1])) + '</mark>'; pos = m[1]; });
  return out + esc(title.slice(pos));
}

/* ---------- Seção ativa ---------- */
function watchActive() {
  if (!('IntersectionObserver' in window)) return;
  var current = null, sidebar = $('#sidebar');
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      var id = en.target.id; if (id === current) return; current = id;
      navLinks.forEach(function (a) {
        var on = a.getAttribute('data-sec') === id;
        if (on) { a.setAttribute('aria-current', 'true'); if (!D.body.classList.contains('nav-open') && sidebar.offsetParent !== null) { var top = a.offsetTop - sidebar.clientHeight / 2; if (a.offsetTop < sidebar.scrollTop + 40 || a.offsetTop > sidebar.scrollTop + sidebar.clientHeight - 40) sidebar.scrollTop = Math.max(0, top); } }
        else a.removeAttribute('aria-current');
      });
    });
  }, {rootMargin: '-30% 0px -65% 0px'});
  sections.forEach(function (s) { io.observe(s); });
}

/* ---------- Abrir <details> ancestrais ao navegar ---------- */
function openAncestors(el) { var p = el; while (p) { if (p.tagName === 'DETAILS') p.open = true; p = p.parentElement; } }
function revealHash(hash, scroll) {
  if (!hash || hash.length < 2) return;
  var t = D.getElementById(decodeURIComponent(hash.slice(1))); if (!t) return;
  var sec = t.closest('section.doc-section'); if (sec) sec.classList.remove('hidden-by-filter');
  if (t.classList.contains('fh')) t.classList.remove('fh');
  openAncestors(t);
  if (scroll) t.scrollIntoView();
}

/* ---------- Tema ---------- */
var THEMES = ['auto', 'light', 'dark'], THEME_LBL = {auto:'auto', light:'claro', dark:'escuro'};
function applyTheme(t) {
  if (t === 'light' || t === 'dark') D.documentElement.setAttribute('data-theme', t); else D.documentElement.removeAttribute('data-theme');
  var l = $('#themeLbl'); if (l) l.textContent = 'Tema: ' + THEME_LBL[t];
  var b = $('#themeBtn'); if (b) b.setAttribute('aria-label', 'Tema atual: ' + THEME_LBL[t] + '. Alternar tema');
}

/* ---------- Inicialização ---------- */
function init() {
  var theme = lsGet('sf-blueprint-theme'); if (THEMES.indexOf(theme) < 0) theme = 'auto';
  applyTheme(theme);
  $('#themeBtn').addEventListener('click', function () {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]; applyTheme(theme); lsSet('sf-blueprint-theme', theme === 'auto' ? null : theme);
  });
  $('#printBtn').addEventListener('click', function () { window.print(); });

  indexMockups();
  renderModules(); renderRF(); renderPerm(); renderScope(); renderScreens(); renderFlows(); renderStates(); renderOpen(); renderMockIndex();
  linkStaticRefs();
  buildNav(); buildIndex(); watchActive();

  var stats = {screens: SCREENS.length, mockups: $$('figure.mock-fig').length, flows: FLOWS.length, states: STATES.length, open: OPEN.length, rf: RF.length};
  $$('[data-stat]').forEach(function (e) { var k = e.getAttribute('data-stat'); if (stats[k] != null) e.textContent = stats[k]; });

  var q = $('#q'), timer;
  q.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(runSearch, 120); });
  q.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { q.value = ''; runSearch(); }
    if (e.key === 'Enter') { e.preventDefault(); runSearch(); var first = navLinks.filter(function (a) { return !a.classList.contains('hide'); })[0]; if (first) { closeNav(); location.hash = first.getAttribute('href'); } }
  });
  $('#filterContent').addEventListener('change', runSearch);
  D.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (e.key === '/' && tag !== 'input' && tag !== 'textarea' && tag !== 'select' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); q.focus(); q.select(); }
    if (e.key === 'Escape' && D.body.classList.contains('nav-open')) { closeNav(); $('#menuBtn').focus(); }
  });

  var menu = $('#menuBtn');
  menu.addEventListener('click', function () {
    var open = !D.body.classList.contains('nav-open');
    D.body.classList.toggle('nav-open', open); menu.setAttribute('aria-expanded', String(open));
    if (open) { var f = navLinks.filter(function (a) { return !a.classList.contains('hide'); })[0]; if (f) setTimeout(function () { f.focus(); }, 30); }
  });
  $('#scrim').addEventListener('click', closeNav);
  $('#nav').addEventListener('click', function (e) { if (e.target.closest('a')) closeNav(); });

  $('#expandAll').addEventListener('click', function () { $$('details').forEach(function (d) { d.open = true; }); });
  $('#collapseAll').addEventListener('click', function () { $$('details').forEach(function (d) { d.open = false; }); });

  D.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]'); if (!a) return;
    revealHash(a.getAttribute('href'), false);
  }, true);
  window.addEventListener('hashchange', function () { revealHash(location.hash, true); });
  if (location.hash) revealHash(location.hash, true);

  var openState = null;
  window.addEventListener('beforeprint', function () {
    openState = $$('details').map(function (d) { return d.open; });
    $$('details').forEach(function (d) { d.open = true; });
  });
  window.addEventListener('afterprint', function () {
    if (!openState) return; $$('details').forEach(function (d, i) { d.open = !!openState[i]; }); openState = null;
  });
}
function closeNav() { D.body.classList.remove('nav-open'); var m = $('#menuBtn'); if (m) m.setAttribute('aria-expanded', 'false'); }

if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', init); else init();
})();

