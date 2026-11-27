/* Tiendita — app de alta de productos, venta y etiquetas.
   Todo se guarda primero en el teléfono (localStorage) y se envía a la hoja de Google cuando hay señal. */
(() => {
'use strict';
const CAT = window.CATALOGO;
const CLASES = ['ROPA', 'MAQUILLAJE', 'PAPELERIA', 'HOGAR', 'ACCESORIOS', 'VARIOS'];
const SEXO = ['MUJER', 'HOMBRE', 'UNISEX', 'NIÑA', 'NIÑO', 'JUVENIL', 'NA'];
const ORIGEN = ['Centro', 'Canal del Norte', 'Agrícola', 'Pino Suarez', 'Chiconcuac', 'Aditivo'];
const PAGO = ['Efectivo', 'Tarjeta', 'Transferencia', 'Apartado'];
const WHO = {Edith: 20001, Vicente: 30001, 'Raúl': 40001, Otro: 50001};
const PROD_COLS = ['ID', 'Folio', 'SKU', 'Descripción', 'Clase', 'Tipo', 'Sexo', 'Talla / Unidad', 'Color', 'Origen', 'Consignatario', 'Fecha alta', 'Piezas compradas', 'Costo unitario', 'Precio venta', 'Capturista'];
const VENTA_COLS = ['ID', 'Ticket', 'Fecha', 'SKU', 'Piezas', 'Precio cobrado', 'Descuento', 'Devolución', 'Vendedora', 'Forma de pago', 'Notas', 'Dispositivo'];
const OTHER = '__otro';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const money = n => '$' + (Number(n) || 0).toLocaleString('es-MX', {minimumFractionDigits: 0, maximumFractionDigits: 2});
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const ini = s => (s || '').trim().charAt(0).toUpperCase();

/* ---------------- almacenamiento ---------------- */
const mem = {};
const get = (k, d) => { try { const v = localStorage.getItem('td_' + k); return v ? JSON.parse(v) : d; } catch (e) { return k in mem ? mem[k] : d; } };
const put = (k, v) => { try { localStorage.setItem('td_' + k, JSON.stringify(v)); } catch (e) { mem[k] = v; toast('No se pudo guardar en el teléfono. Exporta tus pendientes.'); } };

let cfg = get('cfg', {url: '', token: '', device: '', who: 'Edith', next: 20001, shop: 'La Esquinita de la Moda', vend: '', fmt: 'thermal'});
let cat = get('cat', {productos: [], vendedoras: [], consignatarios: [], maxFolio: {}, hora: null});
let out = get('out', []);           // [{kind:'productos'|'ventas', row}]
let ventas = get('ventas', []);     // historial local de ventas (30 días): row + sent
let altas = get('altas', []);       // productos capturados aquí: row + sent
let labels = get('labels', []);     // [{sku, n}]
let cart = get('cart', []);         // [{sku, desc, talla, precio, pz, desc$, unk}]
let draft = get('draft', {});
let pago = get('pago', 'Efectivo');
let st = get('st', {last: null, err: '', seq: 0, seqDay: ''});
if (!cfg.devId) { cfg.devId = 'D' + Math.random().toString(36).slice(2, 6); put('cfg', cfg); }

// limpia historial viejo
const cut = Date.now() - 30 * 864e5;
ventas = ventas.filter(v => !v.sent || new Date(v.Fecha).getTime() > cut);
altas = altas.filter(a => !a.sent || new Date(a['Fecha alta']).getTime() > cut);

/* ---------------- catálogo local ---------------- */
let index = new Map(), folios = new Set();
function rebuildIndex() {
  index = new Map(); folios = new Set();
  for (const p of cat.productos) index.set(p[0], {sku: p[0], desc: p[1], clase: p[2], tipo: p[3], talla: p[4], color: p[5], consig: p[6], precio: p[7], exist: p[8]});
  for (const a of altas) if (!index.has(a.SKU)) index.set(a.SKU, {sku: a.SKU, desc: a['Descripción'], clase: a.Clase, tipo: a.Tipo, talla: a['Talla / Unidad'], color: a.Color, consig: a.Consignatario, precio: a['Precio venta'], exist: a['Piezas compradas'], local: true});
  // descuenta ventas que aún no llegan a la hoja
  // descuenta ventas que el catálogo descargado todavía no incluye
  const catT = cat.fetchedAt || 0;
  for (const v of ventas) if (!v.sent || (v.sentAt || 0) > catT) { const p = index.get(v.SKU); if (p) p.exist -= v.Piezas; }
  for (const k of index.keys()) { const m = /^\d+/.exec(k); if (m) folios.add(+m[0]); }
}
const autoDesc = (t, c) => [t, c].filter(Boolean).join(' ');
const label = p => { const extra = p.desc && p.desc !== p.tipo && p.desc !== autoDesc(p.tipo, p.color) ? p.desc : ''; return [p.tipo || p.clase, p.color, extra].filter(Boolean).join(' · '); };
function search(q) {
  q = q.trim().toUpperCase(); if (q.length < 2) return [];
  const r = []; for (const p of index.values()) {
    if (p.sku.includes(q) || (p.desc || '').toUpperCase().includes(q) || (p.tipo || '').toUpperCase().includes(q)) { r.push(p); if (r.length > 30) break; }
  }
  return r.sort((a, b) => (b.exist > 0) - (a.exist > 0)).slice(0, 8);
}

/* ---------------- navegación ---------------- */
const VIEWS = [['vender', 'Vender'], ['corte', 'Corte'], ['alta', 'Alta'], ['etiquetas', 'Etiquetas'], ['envios', 'Envíos'], ['ajustes', 'Ajustes']];
let view = (location.hash || '').slice(1);
if (!VIEWS.some(v => v[0] === view)) view = 'vender';
function drawNav() {
  const html = VIEWS.map(([k, n]) => {
    let badge = '';
    if (k === 'etiquetas') { const c = labels.reduce((a, l) => a + l.n, 0); if (c) badge = `<span class="n">${c}</span>`; }
    if (k === 'envios' && out.length) badge = `<span class="n">${out.length}</span>`;
    return `<button type="button" data-nav="${k}" ${k === view ? 'aria-current="page"' : ''}>${n}${badge}</button>`;
  }).join('');
  document.querySelectorAll('nav.tabs').forEach(n => n.innerHTML = html);
  document.querySelectorAll('main>section').forEach(s => s.hidden = s.dataset.view !== view);
}
function go(v) { view = v; if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v); drawNav(); drawView(); if (v !== 'vender') stopCam(); window.scrollTo(0, 0); }
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWS.some(x => x[0] === v) && v !== view) go(v); });

function drawView() {
  if (view === 'vender') drawVenta();
  if (view === 'corte') drawCorte();
  if (view === 'alta') drawAlta();
  if (view === 'etiquetas') drawLabels();
  if (view === 'envios') drawEnvios();
  if (view === 'ajustes') drawAjustes();
  drawSync();
}

/* ---------------- diálogo y aviso ---------------- */
let dlgCb = null;
function ask(t, html, cb, okTxt) { $('dlgT').textContent = t; $('dlgP').innerHTML = html; $('dlgOk').textContent = okTxt || 'Sí'; dlgCb = cb; $('dlg').classList.add('on'); }
$('dlgOk').onclick = () => { const cb = dlgCb; if (cb && cb() === false) return; dlgCb = null; $('dlg').classList.remove('on'); };
$('dlgNo').onclick = () => { $('dlg').classList.remove('on'); dlgCb = null; };
let tt; function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 2800); }

/* =========================================================== VENDER */
function cartAdd(sku, fromCam) {
  sku = String(sku || '').trim().toUpperCase(); if (!sku) return;
  const p = index.get(sku);
  const ex = cart.find(l => l.sku === sku && !l.unk);
  if (p) {
    if (ex) ex.pz++; else cart.push({sku, d: label(p), talla: p.talla || '', precio: p.precio, lista: p.precio, pz: 1, dsc: 0, consig: p.consig || ''});
    const left = p.exist - cart.filter(l => l.sku === sku).reduce((a, l) => a + l.pz, 0);
    if (navigator.vibrate) navigator.vibrate(60);
    toast((fromCam ? 'Escaneado ' : 'Agregado ') + sku + (left < 0 ? ' · sin existencia registrada' : ''));
  } else {
    ask('SKU no está en el catálogo', `<p>No encuentro <b>${esc(sku)}</b> en este teléfono. Puede ser un producto que aún no se descarga. Puedes venderlo igual escribiendo el precio:</p><label for="unkP">Precio ($)</label><input id="unkP" type="number" inputmode="decimal"><label for="unkD" style="margin-top:8px">Qué es (opcional)</label><input id="unkD">`,
      () => { const pr = +$('unkP').value; if (!(pr > 0)) { toast('Escribe el precio'); return false; } cart.push({sku, d: $('unkD').value.trim() || 'Producto no encontrado', talla: '', precio: pr, lista: pr, pz: 1, dsc: 0, unk: true}); saveCart(); drawVenta(); }, 'Agregar');
    setTimeout(() => $('unkP') && $('unkP').focus(), 50);
    return;
  }
  saveCart(); drawVenta();
}
function saveCart() { put('cart', cart); }
const lineTotal = l => l.pz * l.precio - (l.dsc || 0);
function drawVenta() {
  const lines = cart.map((l, i) => {
    const p = index.get(l.sku);
    const left = p ? p.exist - cart.filter(x => x.sku === l.sku).reduce((a, x) => a + x.pz, 0) : null;
    return `<li><div><div class="t">${esc(l.d)}</div><div class="s">${esc(l.sku)}${l.talla ? ' · ' + esc(l.talla) : ''}${l.consig ? ' · consigna ' + esc(l.consig) : ''}</div>
      ${left !== null && left < 0 ? '<div class="warnline">Sin existencia registrada en el sistema</div>' : ''}${l.unk ? '<div class="warnline">No está en el catálogo</div>' : ''}</div>
      <div class="amt">${money(lineTotal(l))}</div>
      <div class="ctl"><div class="stepper"><button type="button" class="btn" data-q="${i}" data-d="-1" aria-label="Menos">−</button><input value="${l.pz}" data-pz="${i}" inputmode="numeric" aria-label="Piezas" style="width:52px"><button type="button" class="btn" data-q="${i}" data-d="1" aria-label="Más">+</button></div>
      <div><label for="pr${i}">Precio c/u</label><input id="pr${i}" data-pr="${i}" type="number" inputmode="decimal" value="${l.precio}"></div>
      <div><label for="ds${i}">Descuento $</label><input id="ds${i}" data-ds="${i}" type="number" inputmode="decimal" value="${l.dsc || ''}" placeholder="0"></div>
      <button type="button" class="btn ghost small" data-rm="${i}">Quitar</button></div></li>`;
  }).join('');
  $('cart').innerHTML = lines || '<li class="empty">Escanea una etiqueta o escribe el SKU para empezar.</li>';
  const tot = cart.reduce((a, l) => a + lineTotal(l), 0);
  $('cartTotal').textContent = money(tot);
  const vs = (cat.vendedoras && cat.vendedoras.length ? cat.vendedoras : ['Vendedora 1']);
  if (!$('vend').options.length || $('vend').dataset.k !== vs.join('|')) { $('vend').innerHTML = vs.map(v => `<option>${esc(v)}</option>`).join(''); $('vend').dataset.k = vs.join('|'); }
  $('vend').value = vs.includes(cfg.vend) ? cfg.vend : vs[0];
  $('pago').innerHTML = PAGO.map(p => `<button type="button" class="chip" data-pago="${p}" aria-pressed="${p === pago}">${p}</button>`).join('');
  const paid = +$('paid').value;
  $('change').textContent = paid > 0 && tot > 0 ? (paid >= tot ? 'Cambio: ' + money(paid - tot) : 'Falta: ' + money(tot - paid)) : '';
  $('cobrar').disabled = !cart.length;
  $('cobrar').textContent = cart.length ? 'Cobrar ' + money(tot) : 'Cobrar';
  // hoy
  const t = today(), hoy = ventas.filter(v => v.Fecha === t);
  const tickets = new Map();
  for (const v of hoy) { const k = v.Ticket; const x = tickets.get(k) || {n: 0, pz: 0, tot: 0, pago: v['Forma de pago'], sent: true, rows: []}; x.pz += v.Piezas; x.tot += v.Piezas * v['Precio cobrado'] - (v.Descuento || 0); x.sent = x.sent && v.sent; x.rows.push(v); tickets.set(k, x); }
  const total = [...tickets.values()].reduce((a, x) => a + x.tot, 0);
  const porPago = PAGO.map(p => [p, [...tickets.values()].filter(x => x.pago === p).reduce((a, x) => a + x.tot, 0)]).filter(x => x[1]);
  $('hoyFigs').innerHTML = [['Vendido hoy', money(total)], ['Tickets', tickets.size], ['Piezas', hoy.reduce((a, v) => a + v.Piezas, 0)], ...porPago.map(([p, v]) => [p, money(v)])]
    .map(([a, b]) => `<div><b>${esc(b)}</b><span>${esc(a)}</span></div>`).join('');
  $('hoyList').innerHTML = [...tickets.entries()].reverse().map(([k, x]) => `<li><div><div class="t">${esc(k.split('-').slice(-1)[0])} · ${money(x.tot)}</div><div class="s">${x.pz} pz · ${esc(x.pago)} · ${esc(x.rows.map(r => r.SKU).join(', '))}</div></div>
    <div class="n">${x.sent ? '<span class="badge ok">Enviado</span>' : '<span class="badge wait">Pendiente</span>'}</div>
    ${x.sent ? '' : `<div class="ops"><button type="button" class="btn small ghost" data-cancel="${esc(k)}">Cancelar ticket</button></div>`}</li>`).join('') || '<li class="empty">Todavía no hay ventas hoy.</li>';
}
function cobrar() {
  if (!cart.length) return;
  const t = today();
  if (st.seqDay !== t) { st.seqDay = t; st.seq = 0; }
  st.seq++; put('st', st);
  const dev = ((cfg.device || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || cfg.devId).toUpperCase();
  const ticket = `T-${dev}-${t.replace(/-/g, '').slice(2)}-${String(st.seq).padStart(3, '0')}`;
  const vend = $('vend').value; cfg.vend = vend; put('cfg', cfg);
  const rows = cart.map(l => ({ID: uid(), Ticket: ticket, Fecha: t, SKU: l.sku, Piezas: l.pz, 'Precio cobrado': l.precio, Descuento: l.dsc || '', 'Devolución': '',
    Vendedora: vend, 'Forma de pago': pago, Notas: l.unk ? 'No estaba en catálogo: ' + l.d : (l.precio !== l.lista ? 'Precio lista ' + l.lista : ''), Dispositivo: cfg.device || ''}));
  const hora = new Date().toTimeString().slice(0, 5);
  rows.forEach(r => { ventas.push({...r, sent: false, hora}); out.push({kind: 'ventas', row: r}); });
  const tot = cart.reduce((a, l) => a + lineTotal(l), 0);
  cart = []; $('paid').value = '';
  put('ventas', ventas); put('out', out); saveCart(); rebuildIndex();
  toast('Venta ' + ticket.split('-').slice(-1)[0] + ' por ' + money(tot) + ' guardada');
  drawNav(); drawVenta(); sync();
}
$('cobrar').onclick = () => {
  const tot = cart.reduce((a, l) => a + lineTotal(l), 0);
  ask('¿Cobrar ' + money(tot) + '?', `<p>${cart.length} producto(s) · ${esc(pago)} · ${esc($('vend').value)}</p>`, () => { cobrar(); }, 'Cobrar');
};
$('vaciar').onclick = () => { if (!cart.length) return toast('El ticket ya está vacío'); cart = []; $('paid').value = ''; saveCart(); drawVenta(); toast('Ticket vaciado'); };
$('paid').addEventListener('input', drawVenta);
$('vend').addEventListener('change', e => { cfg.vend = e.target.value; put('cfg', cfg); });
$('skuAdd').onclick = () => {
  const v = $('skuIn').value.trim().toUpperCase(); if (!v) return;
  const r = search(v);
  if (index.has(v)) cartAdd(v);
  else if (r.length === 1) cartAdd(r[0].sku);
  else if (r.length > 1) { suggest(v, $('sugg'), 'sel'); return toast('Hay varios; elige uno de la lista'); }
  else cartAdd(v);
  $('skuIn').value = ''; $('sugg').hidden = true;
};
$('skuIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('skuAdd').click(); } });
$('skuIn').addEventListener('input', e => suggest(e.target.value, $('sugg'), 'sel'));
function suggest(q, el, attr) {
  const r = search(q);
  el.hidden = !r.length;
  el.innerHTML = r.map(p => `<li><button type="button" data-${attr}="${esc(p.sku)}"><span><b>${esc(p.sku)}</b> ${esc(label(p))}${p.talla ? ' · ' + esc(p.talla) : ''}</span><span>${money(p.precio)} · ${p.exist} pz</span></button></li>`).join('');
}
// cámara
let cam = null, lastCode = '', lastAt = 0;
async function startCam() {
  if (!window.Html5Qrcode) { toast('El lector no cargó. Abre la app con internet una vez.'); return; }
  $('scanBox').hidden = false; $('camBtn').textContent = 'Detener cámara';
  try {
    const F = window.Html5QrcodeSupportedFormats;
    cam = new Html5Qrcode('reader', {formatsToSupport: [F.CODE_128, F.CODE_39, F.EAN_13, F.QR_CODE], verbose: false});
    await cam.start({facingMode: 'environment'}, {fps: 12, qrbox: (w, h) => ({width: Math.min(w * 0.9, 340), height: Math.min(h * 0.45, 140)})},
      code => { const now = Date.now(); if (code === lastCode && now - lastAt < 2500) return; lastCode = code; lastAt = now; cartAdd(code, true); }, () => {});
  } catch (e) { toast('No se pudo abrir la cámara: ' + (e.message || e)); stopCam(); }
}
async function stopCam() { if (cam) { try { await cam.stop(); cam.clear(); } catch (e) {} cam = null; } $('scanBox').hidden = true; $('camBtn').textContent = 'Escanear con cámara'; }
$('camBtn').onclick = () => cam ? stopCam() : startCam();
$('csvHoy').onclick = () => {
  const t = today(), hoy = ventas.filter(v => v.Fecha === t);
  if (!hoy.length) return toast('No hay ventas hoy');
  saveCsv(`ventas_${(cfg.device || 'app').replace(/\s+/g, '_')}_${t}.csv`, VENTA_COLS, hoy);
};


/* =========================================================== CORTE DE CAJA */
let fondos = get('fondos', {});       // {fecha: {fondo, conteo}}
let hj = null;                        // última consulta a la hoja
const fmtF = f => { const [y, m, d] = f.split('-'); return `${d}/${m}/${y}`; };
const tnum = t => String(t || '').split('-').slice(-1)[0];
function ticketsDe(rows) {
  const m = new Map();
  for (const v of rows) {
    const k = v.Ticket || v.ID;
    const x = m.get(k) || {ticket: k, hora: v.hora || '', vend: v.Vendedora || '', pago: v['Forma de pago'] || 'Sin forma', pz: 0, total: 0, sent: true, skus: []};
    x.pz += v.Piezas; x.total += v.Piezas * (+v['Precio cobrado'] || 0) - (+v.Descuento || 0) - (+v['Devolución'] || 0);
    x.sent = x.sent && v.sent; x.skus.push(v.SKU); m.set(k, x);
  }
  return [...m.values()];
}
function sumPago(ts) { const o = {}; for (const p of PAGO) o[p] = 0; for (const t of ts) o[t.pago] = (o[t.pago] || 0) + t.total; return o; }
function corteLocal() {
  const fecha = $('ctFecha').value || today(), vend = $('ctVend').value;
  const rows = ventas.filter(v => v.Fecha === fecha && (!vend || v.Vendedora === vend));
  const ts = ticketsDe(rows);
  const pago = sumPago(ts);
  const total = ts.reduce((a, t) => a + t.total, 0), pz = ts.reduce((a, t) => a + t.pz, 0);
  const f = fondos[fecha] || {};
  const fondo = +f.fondo || 0, conteo = f.conteo === '' || f.conteo == null ? null : +f.conteo;
  const esperado = fondo + (pago.Efectivo || 0);
  const pend = rows.filter(v => !v.sent).length;
  return {fecha, vend, ts, pago, total, pz, fondo, conteo, esperado, dif: conteo === null ? null : conteo - esperado, pend};
}
function difTxt(d) { if (d === null) return 'Falta contar el efectivo'; if (Math.abs(d) < 0.5) return 'Cuadra exacto'; return d > 0 ? 'Sobran ' + money(d) : 'Faltan ' + money(-d); }
function corteTexto(c) {
  const L = [`*Corte de caja · ${cfg.shop || 'Tiendita'}*`, `Fecha: ${fmtF(c.fecha)} · Dispositivo: ${cfg.device || cfg.devId}` + (c.vend ? ` · Vendedora: ${c.vend}` : ''),
    `Tickets: ${c.ts.length} · Piezas: ${c.pz}`, ...PAGO.map(p => `${p}: ${money(c.pago[p] || 0)}`), `*Total vendido: ${money(c.total)}*`, '',
    `Fondo inicial: ${money(c.fondo)}`, `Efectivo esperado en caja: ${money(c.esperado)}`, `Efectivo contado: ${c.conteo === null ? '(sin contar)' : money(c.conteo)}`, `*${difTxt(c.dif)}*`];
  if (c.pend) L.push('', `Ventas sin enviar a la hoja (sin internet): ${c.pend}`);
  if (c.ts.length) L.push('', 'Tickets: ' + c.ts.map(t => `${tnum(t.ticket)} ${money(t.total)} ${t.pago.slice(0, 3)}`).join(' · '));
  return L.join('\n');
}
function drawCorte() {
  if (!$('ctFecha').value) $('ctFecha').value = today();
  const fecha = $('ctFecha').value;
  const names = [...new Set([...(cat.vendedoras || []), ...ventas.filter(v => v.Fecha === fecha).map(v => v.Vendedora).filter(Boolean)])];
  const cur = $('ctVend').value;
  $('ctVend').innerHTML = '<option value="">Todas</option>' + names.map(n => `<option>${esc(n)}</option>`).join('');
  $('ctVend').value = names.includes(cur) ? cur : '';
  const c = corteLocal();
  if (document.activeElement !== $('ctFondo')) $('ctFondo').value = (fondos[fecha] || {}).fondo ?? '';
  if (document.activeElement !== $('ctConteo')) $('ctConteo').value = (fondos[fecha] || {}).conteo ?? '';
  $('ctFigs').innerHTML = [['Total vendido', money(c.total)], ['Tickets', c.ts.length], ['Piezas', c.pz]].map(([a, b]) => `<div><b>${esc(b)}</b><span>${a}</span></div>`).join('');
  $('ctPago').innerHTML = '<tr><th>Forma de pago</th><th>Tickets</th><th>Monto</th></tr>' +
    PAGO.map(p => `<tr><td>${p}</td><td>${c.ts.filter(t => t.pago === p).length}</td><td>${money(c.pago[p] || 0)}</td></tr>`).join('') +
    `<tr class="tot"><td>Total</td><td>${c.ts.length}</td><td>${money(c.total)}</td></tr>`;
  const cu = $('ctCuadre');
  cu.className = 'cuadre' + (c.dif === null ? '' : Math.abs(c.dif) < 0.5 ? ' ok' : ' bad');
  cu.innerHTML = `<div class="mut">Efectivo esperado en caja = fondo ${money(c.fondo)} + ventas en efectivo ${money(c.pago.Efectivo || 0)}</div><div class="big">${money(c.esperado)}</div><div style="font-weight:700;margin-top:4px">${esc(difTxt(c.dif))}</div>`;
  $('ctPend').textContent = c.pend ? `${c.pend} venta(s) de este día todavía no llegan a la hoja. Se envían solas al tener internet; el corte de este teléfono ya las incluye.` : '';
  const enHoja = hj && hj.fecha === fecha ? new Set(hj.tickets.map(t => t[0])) : null;
  $('ctList').innerHTML = c.ts.slice().reverse().map(t => {
    const badge = enHoja ? (enHoja.has(t.ticket) ? '<span class="badge ok">En la hoja</span>' : '<span class="badge wait">No está en la hoja</span>') : (t.sent ? '<span class="badge ok">Enviado</span>' : '<span class="badge wait">Pendiente</span>');
    return `<li><div><div class="t">${esc(tnum(t.ticket))}${t.hora ? ' · ' + esc(t.hora) : ''} · ${money(t.total)}</div><div class="s">${esc(t.pago)} · ${t.pz} pz · ${esc(t.vend || 'sin vendedora')} · ${esc(t.skus.join(', '))}</div></div><div class="n">${badge}</div></li>`;
  }).join('') || '<li class="empty">No hay ventas en este teléfono para esa fecha.</li>';
  $('ctWa').href = 'https://wa.me/?text=' + encodeURIComponent(corteTexto(c));
  drawHoja();
}
function saveFondo() { const f = $('ctFecha').value || today(); fondos[f] = {fondo: $('ctFondo').value, conteo: $('ctConteo').value}; put('fondos', fondos); drawCorte(); }
$('ctFondo').addEventListener('input', saveFondo);
$('ctConteo').addEventListener('input', saveFondo);
$('ctFecha').addEventListener('change', () => { drawCorte(); });
$('ctVend').addEventListener('change', drawCorte);
$('ctCopy').onclick = async () => { try { await navigator.clipboard.writeText(corteTexto(corteLocal())); toast('Corte copiado'); } catch (e) { toast('No se pudo copiar'); } };

async function consultarHoja() {
  if (!cfg.url) return go('ajustes');
  const fecha = $('ctFecha').value || today();
  $('hjMsg').textContent = 'Consultando…';
  try {
    const u = cfg.url + (cfg.url.includes('?') ? '&' : '?') + 'accion=corte&fecha=' + fecha + '&token=' + encodeURIComponent(cfg.token);
    const j = await (await fetch(u)).json();
    if (!j.ok) throw new Error(j.error || 'Error');
    hj = {fecha, tickets: j.tickets || [], at: new Date()};
    $('hjMsg').textContent = '';
  } catch (e) { hj = null; $('hjMsg').textContent = navigator.onLine ? 'No se pudo consultar: ' + (e.message || e) : 'Sin internet: la consulta a la hoja necesita conexión.'; }
  drawCorte();
}
function hojaResumen() {
  const vend = $('ctVend').value;
  // tickets: [ticket, dispositivo, vendedora, pago, piezas, total, recibido]
  const ts = hj.tickets.filter(t => !vend || t[2] === vend);
  const disp = new Map();
  for (const t of ts) { const d = t[1] || 'Sin dispositivo'; const x = disp.get(d) || {n: 0, total: 0, efe: 0, ult: ''}; x.n++; x.total += t[5]; if (t[3] === 'Efectivo') x.efe += t[5]; if (t[6] > x.ult) x.ult = t[6]; disp.set(d, x); }
  const pago = {}; for (const p of PAGO) pago[p] = 0; for (const t of ts) pago[t[3] || 'Sin forma'] = (pago[t[3] || 'Sin forma'] || 0) + t[5];
  return {ts, disp, pago, total: ts.reduce((a, t) => a + t[5], 0), pz: ts.reduce((a, t) => a + t[4], 0), ult: ts.reduce((a, t) => t[6] > a ? t[6] : a, '')};
}
function hojaTexto(r) {
  const L = [`*Según la hoja · ${fmtF(hj.fecha)}*` + ($('ctVend').value ? ` · ${$('ctVend').value}` : ''), `Consultado: ${hj.at.toTimeString().slice(0, 5)} · Última venta recibida: ${r.ult || '—'}`,
    `Tickets: ${r.ts.length} · Piezas: ${r.pz}`, ...PAGO.map(p => `${p}: ${money(r.pago[p] || 0)}`), `*Total en la hoja: ${money(r.total)}*`];
  for (const [d, x] of r.disp) L.push(`${d}: ${x.n} tickets · ${money(x.total)} (efectivo ${money(x.efe)})`);
  if (r.ts.length) L.push('', 'Tickets: ' + r.ts.map(t => `${tnum(t[0])} ${money(t[5])}`).join(' · '));
  return L.join('\n');
}
function drawHoja() {
  const o = $('hjOut');
  if (!hj || hj.fecha !== ($('ctFecha').value || today())) { o.innerHTML = ''; return; }
  const r = hojaResumen();
  const mine = ticketsDe(ventas.filter(v => v.Fecha === hj.fecha && (!$('ctVend').value || v.Vendedora === $('ctVend').value)));
  const enHoja = new Set(r.ts.map(t => t[0]));
  const faltan = mine.filter(t => !enHoja.has(t.ticket));
  o.innerHTML = `<div class="figs"><div><b>${money(r.total)}</b><span>Total en la hoja</span></div><div><b>${r.ts.length}</b><span>Tickets</span></div><div><b>${esc(r.ult || '—')}</b><span>Última recibida</span></div></div>
    <table class="tbl"><tr><th>Forma de pago</th><th>Monto</th></tr>${PAGO.map(p => `<tr><td>${p}</td><td>${money(r.pago[p] || 0)}</td></tr>`).join('')}<tr class="tot"><td>Total</td><td>${money(r.total)}</td></tr></table>
    <div class="scrollx" style="margin-top:12px"><table class="tbl"><tr><th>Dispositivo</th><th>Tickets</th><th>Total</th><th>Efectivo</th><th>Última</th></tr>
    ${[...r.disp].map(([d, x]) => `<tr><td>${esc(d)}</td><td>${x.n}</td><td>${money(x.total)}</td><td>${money(x.efe)}</td><td>${esc(x.ult)}</td></tr>`).join('') || '<tr><td colspan="5">No hay ventas en la hoja para esa fecha.</td></tr>'}</table></div>
    ${mine.length ? `<p class="${faltan.length ? 'warnline' : 'hint'}">${faltan.length ? 'De este teléfono faltan en la hoja: ' + esc(faltan.map(t => tnum(t.ticket)).join(', ')) + '. Se enviarán solos al tener internet.' : 'Todos los tickets de este teléfono ya están en la hoja.'}</p>` : ''}
    <div class="actions"><a class="btn main" href="https://wa.me/?text=${encodeURIComponent(hojaTexto(r))}" target="_blank" rel="noopener">Enviar por WhatsApp</a><button class="btn" type="button" id="hjCopy">Copiar texto</button></div>`;
  $('hjCopy').onclick = async () => { try { await navigator.clipboard.writeText(hojaTexto(r)); toast('Copiado'); } catch (e) { toast('No se pudo copiar'); } };
}
$('hjBtn').onclick = consultarHoja;

/* =========================================================== ALTA */
const dv = f => draft[f] === OTHER ? (draft['o' + f] || '').trim() : (draft[f] || '');
const skuOf = r => cfg.next + ini(r.clase) + ini(r.sexo) + ini(r.talla);
function chips(el, list, val, field, opts = {}) {
  const q = (opts.q || '').toLowerCase();
  const shown = list.filter(x => !q || x.toLowerCase().includes(q));
  let html = shown.map(x => `<button type="button" class="chip${opts.big ? ' big' : ''}" data-f="${field}" data-v="${esc(x)}" aria-pressed="${x === val}">${esc(x)}</button>`).join('');
  if (opts.other) html += `<button type="button" class="chip other" data-f="${field}" data-v="${OTHER}" aria-pressed="${val === OTHER}">Otro…</button>`;
  el.innerHTML = html || '<span class="hint">Sin resultados.</span>';
}
function altaRow() {
  const d = draft;
  return {clase: d.clase || '', tipo: dv('tipo'), sexo: d.sexo || 'NA', talla: dv('talla'), color: dv('color'), desc: (d.desc || '').trim(),
    origen: d.cons ? 'Consigna' : (d.origen || ''), consig: d.cons ? (d.consig || '') : '', fecha: d.fecha || today(),
    pzas: Math.max(0, parseInt(d.pzas) || 0), costo: d.costo === '' || d.costo == null ? '' : +d.costo, precio: +d.precio || 0};
}
function drawAlta() {
  const d = draft, cl = d.clase;
  if (!d.fecha) d.fecha = today(); if (!d.pzas) d.pzas = 1;
  chips($('cClase'), CLASES, cl, 'clase', {big: true});
  if (cl) {
    chips($('cTipo'), CAT.tipos[cl] || [], d.tipo, 'tipo', {q: $('qTipo').value, other: true});
    $('nTipo').textContent = (CAT.tipos[cl] || []).length + ' opciones';
    chips($('cTalla'), CAT.tallas[cl] || ['Pieza'], d.talla, 'talla', {other: true});
  } else { $('cTipo').innerHTML = '<span class="hint">Primero elige la clase.</span>'; $('cTalla').innerHTML = '<span class="hint">Primero elige la clase.</span>'; $('nTipo').textContent = ''; }
  $('oTipo').hidden = d.tipo !== OTHER; $('oTalla').hidden = d.talla !== OTHER; $('oColor').hidden = d.color !== OTHER;
  chips($('cSexo'), SEXO, d.sexo, 'sexo');
  chips($('cColor'), CAT.colores, d.color, 'color', {q: $('qColor').value, other: true});
  $('isCons').checked = !!d.cons; $('cOrigen').hidden = !!d.cons; $('cCons').hidden = !d.cons;
  chips($('cOrigen'), ORIGEN, d.origen, 'origen');
  const cons = (cat.consignatarios && cat.consignatarios.length ? cat.consignatarios : ['Edith', 'Vicente', 'Adrian', 'Externo']).filter(c => c !== 'Sin identificar');
  chips($('cCons'), cons, d.consig, 'consig');
  for (const k of ['desc', 'fecha', 'pzas', 'costo', 'precio', 'oTipo', 'oTalla', 'oColor']) if (document.activeElement !== $(k)) $(k).value = d[k] ?? '';
  const r = altaRow();
  $('tSku').textContent = cl ? (draft.editing || skuOf(r)) : '—';
  $('tDesc').textContent = cl ? [r.tipo || cl.toLowerCase(), r.color, d.desc].filter(Boolean).join(' · ') : 'Elige la clase para empezar';
  $('tTalla').textContent = r.talla || '—';
  $('tPrice').textContent = d.precio ? money(d.precio) : '$—';
  $('tCons').hidden = !d.cons;
  const mk = CAT.markup[cl], c = +d.costo, p = +d.precio;
  let h = '';
  if (!d.cons && c > 0 && mk) h = `Precio sugerido: ${money(Math.ceil(c * mk / 5) * 5)} (costo × ${mk}, lo típico en ${cl.toLowerCase()}).`;
  if (!d.cons && c > 0 && p > 0) h += ` Margen: ${Math.round((p - c) / p * 100)}%.`;
  if (d.cons) h = 'En consigna la tienda se queda con su porcentaje y el resto se le paga al dueño.';
  $('pHint').textContent = h;
  $('save').textContent = draft.editing ? 'Guardar cambios' : 'Guardar';
  $('saveSame').hidden = !!draft.editing;
  // lista
  const pend = altas.filter(a => !a.sent);
  $('altaFigs').innerHTML = [['Por enviar', pend.length], ['Piezas', pend.reduce((a, x) => a + x['Piezas compradas'], 0)], ['Inversión', money(pend.reduce((a, x) => a + x['Piezas compradas'] * (+x['Costo unitario'] || 0), 0))], ['Siguiente folio', cfg.next]]
    .map(([a, b]) => `<div><b>${esc(b)}</b><span>${a}</span></div>`).join('');
  $('altaList').innerHTML = altas.slice(-60).reverse().map(a => `<li><div><div class="t">${esc(a.SKU)}</div><div class="s">${esc([a.Tipo, a.Color, a['Talla / Unidad'], a['Descripción'] !== autoDesc(a.Tipo, a.Color) ? a['Descripción'] : ''].filter(Boolean).join(' · '))}${a.Consignatario ? ' · consigna ' + esc(a.Consignatario) : ''}</div></div>
    <div class="n">${a['Piezas compradas']} pz · ${money(a['Precio venta'])}<br>${a.sent ? '<span class="badge ok">Enviado</span>' : '<span class="badge wait">Pendiente</span>'}</div>
    ${a.sent ? '' : `<div class="ops"><button type="button" class="btn small" data-edit="${esc(a.ID)}">Editar</button><button type="button" class="btn small ghost" data-del="${esc(a.ID)}">Borrar</button></div>`}</li>`).join('') || '<li class="empty">Aún no hay productos capturados en este teléfono.</li>';
}
function check(r) {
  if (!r.clase) return 'Elige la clase.';
  if (!r.tipo) return 'Elige o escribe el tipo.';
  if (!r.talla) return 'Elige la talla o unidad.';
  if (!(r.pzas > 0)) return 'Las piezas deben ser al menos 1.';
  if (!(r.precio > 0)) return 'Falta el precio de venta.';
  if (draft.cons && !r.consig) return 'Elige de quién es la mercancía en consigna.';
  if (!draft.cons && !r.origen) return 'Elige dónde se compró.';
  if (!draft.cons && !(r.costo > 0)) return 'Falta el costo por pieza.';
  return '';
}
function toProdRow(r, folio, id) {
  return {ID: id, Folio: folio, SKU: folio + ini(r.clase) + ini(r.sexo) + ini(r.talla), 'Descripción': r.desc || [r.tipo, r.color].filter(Boolean).join(' '),
    Clase: r.clase, Tipo: r.tipo, Sexo: r.sexo, 'Talla / Unidad': r.talla, Color: r.color, Origen: r.origen, Consignatario: r.consig,
    'Fecha alta': r.fecha, 'Piezas compradas': r.pzas, 'Costo unitario': r.costo, 'Precio venta': r.precio, Capturista: cfg.who};
}
function saveAlta(keep) {
  const r = altaRow(), e = check(r);
  $('err').textContent = e; if (e) return;
  if (draft.editing) {
    const a = altas.find(x => x.ID === draft.editingId);
    const o = out.find(x => x.kind === 'productos' && x.row.ID === draft.editingId);
    if (!a || !o) { $('err').textContent = 'Este producto ya se envió; corrígelo en la hoja de Google.'; return; }
    const oldSku = a.SKU;
    const row = toProdRow(r, a.Folio, a.ID);
    Object.assign(a, row); o.row = row;
    const l = labels.find(x => x.sku === oldSku); if (l) { l.sku = row.SKU; l.n = row['Piezas compradas']; }
    toast('Cambios guardados');
  } else {
    let folio = cfg.next;
    while (folios.has(folio)) folio++;
    const row = toProdRow(r, folio, uid());
    altas.push({...row, sent: false}); out.push({kind: 'productos', row});
    labels.push({sku: row.SKU, n: row['Piezas compradas']});
    cfg.next = folio + 1;
    toast('Guardado ' + row.SKU + ' · ' + row['Piezas compradas'] + ' etiqueta(s) por imprimir');
  }
  const {fecha, origen, cons, consig} = draft;
  if (keep) { draft.talla = null; draft.oTalla = ''; draft.pzas = 1; }
  else { draft = {fecha, origen, cons, consig, pzas: 1}; $('qTipo').value = ''; $('qColor').value = ''; }
  put('altas', altas); put('out', out); put('labels', labels); put('cfg', cfg); put('draft', draft);
  rebuildIndex(); drawNav(); drawAlta(); sync();
  if (!keep) window.scrollTo(0, 0);
}
$('f').addEventListener('submit', e => { e.preventDefault(); saveAlta(false); });
$('saveSame').onclick = () => saveAlta(true);
$('clear').onclick = () => { draft = {fecha: today(), pzas: 1}; $('err').textContent = ''; put('draft', draft); drawAlta(); };
$('qTipo').addEventListener('input', drawAlta);
$('qColor').addEventListener('input', drawAlta);
for (const k of ['desc', 'fecha', 'pzas', 'costo', 'precio', 'oTipo', 'oTalla', 'oColor']) $(k).addEventListener('input', e => { draft[k] = e.target.value; put('draft', draft); drawAlta(); });
$('isCons').addEventListener('change', e => { draft.cons = e.target.checked; put('draft', draft); drawAlta(); });
$('pMinus').onclick = () => { draft.pzas = Math.max(1, (parseInt(draft.pzas) || 1) - 1); put('draft', draft); drawAlta(); };
$('pPlus').onclick = () => { draft.pzas = (parseInt(draft.pzas) || 0) + 1; put('draft', draft); drawAlta(); };

/* =========================================================== ETIQUETAS */
function lblHtml(p) {
  return `<div class="lbl"><div class="l1"><span>${esc(cfg.shop || '')}<br>${esc(p.talla ? (p.clase === 'ROPA' ? 'Talla ' : '') + p.talla : '')}</span><b>${money(p.precio)}</b></div>
    <div class="d">${esc(label(p))}</div><svg class="bc" data-code="${esc(p.sku)}"></svg></div>`;
}
function renderBarcodes(root) {
  if (!window.JsBarcode) return;
  root.querySelectorAll('svg.bc').forEach(s => { try { JsBarcode(s, s.dataset.code, {format: 'CODE128', width: 1.6, height: 34, fontSize: 13, margin: 0, textMargin: 1}); } catch (e) {} });
}
function drawLabels() {
  $('lblFmt').value = cfg.fmt || 'thermal';
  $('lblList').innerHTML = labels.map((l, i) => { const p = index.get(l.sku) || {sku: l.sku, precio: 0};
    return `<li><div><div class="t">${esc(l.sku)}</div><div class="s">${esc(label(p))}${p.talla ? ' · ' + esc(p.talla) : ''} · ${money(p.precio)}</div></div>
    <div class="n"><div class="stepper"><button type="button" class="btn" data-lq="${i}" data-d="-1" aria-label="Menos">−</button><input value="${l.n}" data-ln="${i}" inputmode="numeric" style="width:56px" aria-label="Cantidad"><button type="button" class="btn" data-lq="${i}" data-d="1" aria-label="Más">+</button></div></div>
    <div class="ops"><button type="button" class="btn small ghost" data-lrm="${i}">Quitar</button></div></li>`; }).join('') || '<li class="empty">No hay etiquetas por imprimir. Al dar de alta productos aparecen aquí.</li>';
  const n = labels.reduce((a, l) => a + l.n, 0);
  $('lblFigs').innerHTML = `<div><b>${n}</b><span>Etiquetas</span></div><div><b>${(cfg.fmt === 'sheet') ? Math.ceil(n / 30) : n}</b><span>${cfg.fmt === 'sheet' ? 'Hojas' : 'Etiquetas térmicas'}</span></div>`;
  const first = labels[0] && index.get(labels[0].sku);
  $('lblPrev').innerHTML = first ? lblHtml(first) : '<span class="hint">Sin etiquetas.</span>';
  renderBarcodes($('lblPrev'));
  $('printBtn').disabled = !n;
}
$('lblFmt').addEventListener('change', e => { cfg.fmt = e.target.value; put('cfg', cfg); drawLabels(); });
$('lblIn').addEventListener('input', e => suggest(e.target.value, $('lblSugg'), 'lsel'));
$('lblIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('lblAdd').click(); } });
$('lblAdd').onclick = () => { const v = $('lblIn').value.trim().toUpperCase(); const r = search(v); const sku = index.has(v) ? v : (r.length === 1 ? r[0].sku : ''); if (!sku) return toast('Elige un producto de la lista'); addLabel(sku); };
function addLabel(sku) { const l = labels.find(x => x.sku === sku); if (l) l.n++; else labels.push({sku, n: 1}); put('labels', labels); $('lblIn').value = ''; $('lblSugg').hidden = true; drawNav(); drawLabels(); }
$('lblClear').onclick = () => { if (!labels.length) return; ask('¿Vaciar la lista de etiquetas?', '<p>Úsalo después de imprimir. Los productos no se borran.</p>', () => { labels = []; put('labels', labels); drawNav(); drawLabels(); }); };
$('printBtn').onclick = () => {
  const pr = $('print'); const fmt = cfg.fmt || 'thermal';
  pr.className = fmt;
  const items = []; labels.forEach(l => { const p = index.get(l.sku); if (p) for (let i = 0; i < l.n; i++) items.push(p); });
  pr.innerHTML = items.map(lblHtml).join('');
  renderBarcodes(pr);
  let ps = document.getElementById('pageStyle'); if (!ps) { ps = document.createElement('style'); ps.id = 'pageStyle'; document.head.appendChild(ps); }
  ps.textContent = fmt === 'thermal' ? '@page{size:50mm 25mm;margin:0}' : '@page{size:letter;margin:.5in .19in}';
  setTimeout(() => {
    window.print();
    ask('¿Salieron bien las etiquetas?', '<p>Si sí, vacío la lista para no imprimirlas dos veces.</p>', () => { labels = []; put('labels', labels); drawNav(); drawLabels(); }, 'Sí, vaciar');
  }, 150);
};

/* =========================================================== ENVÍOS */
let syncing = false;
async function sync(force) {
  if (syncing || !cfg.url || !cfg.token) { drawSync(); return; }
  if (!navigator.onLine && !force) { drawSync(); return; }
  syncing = true; drawSync();
  try {
    while (out.length) {
      const batch = out.slice(0, 300);
      const body = {token: cfg.token, productos: batch.filter(x => x.kind === 'productos').map(x => x.row), ventas: batch.filter(x => x.kind === 'ventas').map(x => x.row)};
      const res = await fetch(cfg.url, {method: 'POST', body: JSON.stringify(body), headers: {'Content-Type': 'text/plain;charset=utf-8'}});
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'Error del servidor');
      const ok = new Set(j.aceptados || []);
      if (!ok.size) throw new Error('La hoja no aceptó los registros');
      out = out.filter(x => !ok.has(x.row.ID));
      const now = Date.now();
      for (const v of ventas) if (ok.has(v.ID)) { v.sent = true; v.sentAt = now; }
      for (const a of altas) if (ok.has(a.ID)) { a.sent = true; a.sentAt = now; }
      put('out', out); put('ventas', ventas); put('altas', altas);
    }
    const age = cat.fetchedAt ? Date.now() - cat.fetchedAt : Infinity;
    if (force === true || age > 10 * 60e3) await fetchCat(); // el catálogo solo se baja si tiene más de 10 min o si se pide
    st.last = new Date().toISOString(); st.err = ''; put('st', st);
  } catch (e) {
    st.err = navigator.onLine ? String(e.message || e) : 'Sin internet'; put('st', st);
  } finally {
    syncing = false; rebuildIndex(); drawNav(); drawView();
  }
}
async function fetchCat() {
  const u = cfg.url + (cfg.url.includes('?') ? '&' : '?') + 'accion=catalogo&token=' + encodeURIComponent(cfg.token);
  const res = await fetch(u); const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'No se pudo leer el catálogo');
  cat = {productos: j.productos || [], vendedoras: j.vendedoras || [], consignatarios: j.consignatarios || [], maxFolio: j.maxFolio || {}, hora: j.hora || new Date().toISOString(), fetchedAt: Date.now()};
  put('cat', cat);
  const base = Math.floor((WHO[cfg.who] || cfg.next) / 10000) * 10000;
  const mx = Number(cat.maxFolio[base] || 0);
  if (mx >= cfg.next) { cfg.next = mx + 1; put('cfg', cfg); }
}
function drawSync() {
  const dot = $('syncDot'), txt = $('syncTxt');
  if (!cfg.url) { dot.className = 'dot err'; txt.textContent = 'Sin conectar'; }
  else if (syncing) { dot.className = 'dot wait'; txt.textContent = 'Enviando…'; }
  else if (out.length) { dot.className = 'dot wait'; txt.textContent = out.length + ' por enviar'; }
  else if (st.err) { dot.className = 'dot err'; txt.textContent = st.err.slice(0, 24); }
  else { dot.className = 'dot ok'; txt.textContent = 'Al día'; }
  $('setupBanner').hidden = !!cfg.url;
}
function drawEnvios() {
  const nv = out.filter(x => x.kind === 'ventas').length, np = out.length - nv;
  const last = st.last ? new Date(st.last).toLocaleString('es-MX', {dateStyle: 'short', timeStyle: 'short'}) : 'nunca';
  const ch = cat.fetchedAt ? new Date(cat.fetchedAt).toLocaleString('es-MX', {dateStyle: 'short', timeStyle: 'short'}) : 'nunca';
  $('sendFigs').innerHTML = [['Ventas por enviar', nv], ['Productos por enviar', np], ['Último envío', last], ['Catálogo del', ch], ['Productos en catálogo', index.size]]
    .map(([a, b]) => `<div><b>${esc(b)}</b><span>${a}</span></div>`).join('');
  $('sendMsg').textContent = !cfg.url ? 'Configura la conexión en Ajustes.' : st.err ? 'Último intento: ' + st.err : (navigator.onLine ? 'Conectado.' : 'Sin internet: se enviará solo cuando vuelva la señal.');
  $('outList').innerHTML = out.slice(-80).reverse().map(x => `<li><div><div class="t">${x.kind === 'ventas' ? 'Venta' : 'Producto'} · ${esc(x.row.SKU)}</div><div class="s">${esc(x.kind === 'ventas' ? x.row.Ticket + ' · ' + x.row.Piezas + ' pz · ' + money(x.row['Precio cobrado']) : x.row['Descripción'])}</div></div><div class="n">${esc(x.row.Fecha || x.row['Fecha alta'])}</div></li>`).join('') || '<li class="empty">Nada pendiente.</li>';
}
$('sendNow').onclick = () => { if (!cfg.url) return go('ajustes'); sync('send'); };
$('catNow').onclick = () => { if (!cfg.url) return go('ajustes'); sync(true); };
$('syncBtn').onclick = () => go('envios');
$('csvPend').onclick = () => {
  const v = out.filter(x => x.kind === 'ventas').map(x => x.row), p = out.filter(x => x.kind === 'productos').map(x => x.row);
  if (!v.length && !p.length) return toast('No hay pendientes');
  const tag = (cfg.device || 'app').replace(/\s+/g, '_') + '_' + today();
  if (v.length) saveCsv('ventas_' + tag + '.csv', VENTA_COLS, v);
  if (p.length) setTimeout(() => saveCsv('productos_' + tag + '.csv', PROD_COLS, p), 600);
};
async function saveCsv(name, cols, rows) {
  const q = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const body = '﻿' + [cols.join(','), ...rows.map(r => cols.map(c => q(r[c])).join(','))].join('\r\n');
  const file = new File([body], name, {type: 'text/csv'});
  try { if (navigator.canShare && navigator.canShare({files: [file]})) { await navigator.share({files: [file], title: name}); return; } } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('CSV guardado: ' + name);
}

/* =========================================================== AJUSTES */
function drawAjustes() {
  $('cfUrl').value = cfg.url || ''; $('cfTok').value = cfg.token || ''; $('cfDev').value = cfg.device || '';
  $('cfWho').innerHTML = Object.keys(WHO).map(w => `<option>${esc(w)}</option>`).join(''); $('cfWho').value = cfg.who;
  $('cfFolio').value = cfg.next; $('cfShop').value = cfg.shop || '';
}
$('cfSave').onclick = async () => {
  cfg.url = $('cfUrl').value.trim(); cfg.token = $('cfTok').value.trim(); cfg.device = $('cfDev').value.trim(); put('cfg', cfg);
  if (!cfg.url) return;
  $('cfMsg').textContent = 'Probando…';
  try {
    const r = await fetch(cfg.url + (cfg.url.includes('?') ? '&' : '?') + 'accion=ping&token=' + encodeURIComponent(cfg.token));
    const j = await r.json();
    $('cfMsg').textContent = j.ok ? 'Conectado. Descargando catálogo…' : 'La hoja respondió: ' + (j.error || 'error');
    if (j.ok) { await sync(true); $('cfMsg').textContent = 'Conectado. Catálogo con ' + index.size + ' productos.'; }
  } catch (e) { $('cfMsg').textContent = 'No se pudo conectar: revisa la URL o la señal.'; }
};
$('cfLink').onclick = async () => {
  const data = btoa(unescape(encodeURIComponent(JSON.stringify({url: $('cfUrl').value.trim(), token: $('cfTok').value.trim()}))));
  const link = location.origin + location.pathname + '#cfg=' + data;
  try { await navigator.clipboard.writeText(link); toast('Enlace copiado. Mándalo por WhatsApp a quien vaya a usar la app.'); }
  catch (e) { ask('Enlace de configuración', `<p>Copia este enlace:</p><input value="${esc(link)}" readonly onclick="this.select()">`, () => {}, 'Listo'); }
};
$('cfApply').onclick = async () => {
  const m = $('cfPaste').value.trim().match(/#cfg=([A-Za-z0-9+/=]+)/);
  if (!m) return toast('Ese enlace no trae configuración');
  try {
    const o = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    if (!o.url) throw new Error();
    $('cfUrl').value = o.url; $('cfTok').value = o.token || ''; $('cfPaste').value = '';
    $('cfSave').click();
  } catch (e) { toast('Enlace de configuración inválido'); }
};
$('cfWho').addEventListener('change', e => {
  cfg.who = e.target.value;
  const base = WHO[cfg.who]; const k = Math.floor(base / 10000) * 10000;
  const used = Math.max(Number(cat.maxFolio[k] || 0), ...altas.map(a => a.Folio).filter(f => f >= base && f < base + 9999));
  cfg.next = used >= base ? used + 1 : base; put('cfg', cfg); drawAjustes();
});
$('cfFolio').addEventListener('change', e => { const n = parseInt(e.target.value); if (n > 0) { cfg.next = n; put('cfg', cfg); } });
$('cfShop').addEventListener('input', e => { cfg.shop = e.target.value; put('cfg', cfg); });
$('cfDev').addEventListener('change', e => { cfg.device = e.target.value.trim(); put('cfg', cfg); });

/* =========================================================== eventos globales */
document.addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b) return;
  const ds = b.dataset;
  if (ds.nav) return go(ds.nav);
  if (ds.f) {
    const f = ds.f, v = ds.v;
    draft[f] = draft[f] === v && f !== 'clase' ? null : v;
    if (f === 'clase') { draft.tipo = null; draft.talla = null; $('qTipo').value = ''; if (v !== 'ROPA' && !draft.sexo) draft.sexo = 'NA'; }
    put('draft', draft); drawAlta();
    if (v === OTHER) { const el = $('o' + f.charAt(0).toUpperCase() + f.slice(1)); if (el) el.focus(); }
    return;
  }
  if (ds.edit) {
    const a = altas.find(x => x.ID === ds.edit); if (!a) return;
    const inL = (l, v) => (l || []).includes(v);
    draft = {clase: a.Clase, sexo: a.Sexo, desc: a['Descripción'] === [a.Tipo, a.Color].filter(Boolean).join(' ') ? '' : a['Descripción'], fecha: a['Fecha alta'], pzas: a['Piezas compradas'],
      costo: a['Costo unitario'], precio: a['Precio venta'], cons: !!a.Consignatario, consig: a.Consignatario, origen: a.Consignatario ? null : a.Origen,
      tipo: inL(CAT.tipos[a.Clase], a.Tipo) ? a.Tipo : OTHER, oTipo: a.Tipo, talla: inL(CAT.tallas[a.Clase], a['Talla / Unidad']) ? a['Talla / Unidad'] : OTHER, oTalla: a['Talla / Unidad'],
      color: !a.Color ? null : inL(CAT.colores, a.Color) ? a.Color : OTHER, oColor: a.Color, editing: a.SKU, editingId: a.ID};
    put('draft', draft); drawAlta(); window.scrollTo(0, 0); toast('Editando ' + a.SKU); return;
  }
  if (ds.del) {
    const a = altas.find(x => x.ID === ds.del); if (!a) return;
    return ask('¿Borrar ' + a.SKU + '?', '<p>Se quita de este teléfono y de los pendientes de envío.</p>', () => {
      altas = altas.filter(x => x.ID !== a.ID); out = out.filter(x => x.row.ID !== a.ID); labels = labels.filter(l => l.sku !== a.SKU);
      put('altas', altas); put('out', out); put('labels', labels); rebuildIndex(); drawNav(); drawAlta();
    });
  }
  if (ds.sel) { cartAdd(ds.sel); $('skuIn').value = ''; $('sugg').hidden = true; return; }
  if (ds.lsel) return addLabel(ds.lsel);
  if (ds.q !== undefined) { const l = cart[+ds.q]; l.pz = Math.max(1, l.pz + (+ds.d)); saveCart(); drawVenta(); return; }
  if (ds.rm !== undefined) { cart.splice(+ds.rm, 1); saveCart(); drawVenta(); return; }
  if (ds.pago) { pago = ds.pago; put('pago', pago); drawVenta(); return; }
  if (ds.cancel) {
    const k = ds.cancel;
    return ask('¿Cancelar el ticket?', '<p>Se borra la venta de este teléfono y no se envía.</p>', () => {
      const ids = new Set(ventas.filter(v => v.Ticket === k && !v.sent).map(v => v.ID));
      ventas = ventas.filter(v => !ids.has(v.ID)); out = out.filter(x => !ids.has(x.row.ID));
      put('ventas', ventas); put('out', out); rebuildIndex(); drawNav(); drawVenta();
    });
  }
  if (ds.lq !== undefined) { const l = labels[+ds.lq]; l.n = Math.max(1, l.n + (+ds.d)); put('labels', labels); drawNav(); drawLabels(); return; }
  if (ds.lrm !== undefined) { labels.splice(+ds.lrm, 1); put('labels', labels); drawNav(); drawLabels(); return; }
});
document.addEventListener('change', ev => {
  const t = ev.target, d = t.dataset;
  if (d.pz !== undefined) { cart[+d.pz].pz = Math.max(1, parseInt(t.value) || 1); saveCart(); drawVenta(); }
  if (d.pr !== undefined) { cart[+d.pr].precio = Math.max(0, +t.value || 0); saveCart(); drawVenta(); }
  if (d.ds !== undefined) { cart[+d.ds].dsc = Math.max(0, +t.value || 0); saveCart(); drawVenta(); }
  if (d.ln !== undefined) { labels[+d.ln].n = Math.max(1, parseInt(t.value) || 1); put('labels', labels); drawNav(); drawLabels(); }
});
window.addEventListener('online', () => sync());
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
setInterval(() => { if (out.length) sync(); }, 60e3);

/* configuración por enlace (#cfg=...) */
function readCfgLink() {
  const m = location.hash.match(/^#cfg=(.+)$/); if (!m) return false;
  try { const o = JSON.parse(decodeURIComponent(escape(atob(m[1])))); if (o.url) { cfg.url = o.url; cfg.token = o.token || ''; put('cfg', cfg); toast('Conexión configurada'); view = 'ajustes'; } } catch (e) { toast('Enlace de configuración inválido'); }
  history.replaceState(null, '', location.pathname + '#' + view);
  return true;
}
readCfgLink();
window.addEventListener('hashchange', () => { if (readCfgLink()) { drawNav(); drawView(); sync(true); } });

const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
$('installBanner').hidden = !!standalone || !/iphone|ipad|android/i.test(navigator.userAgent);

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

rebuildIndex(); drawNav(); drawView(); sync();
})();
