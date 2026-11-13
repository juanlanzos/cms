/**
 * Corre DENTRO de la pagina que se esta editando (en el marco del panel).
 * Hace tres cosas:
 *   1. Marca las partes al pasar el mouse.
 *   2. Al hacer clic, le cuenta al panel que parte se eligio y como es.
 *   3. Cuando el panel cambia un valor, lo muestra al instante.
 */
(function () {
  'use strict';

  var me = document.currentScript;
  var mode = me ? me.getAttribute('data-mode') : 'editor';
  var MOBILE_MAX = 767;
  var selected = null;
  var originals = {};
  var clean = false;

  document.documentElement.classList.add('cms-ed', 'cms-ed-' + mode);

  function send(msg) { window.parent.postMessage(Object.assign({ cms: 1 }, msg), location.origin); }
  function byK(k) { return document.querySelector('[data-cms-k="' + k + '"]'); }
  function base(k) { return String(k).replace(/@.*$/, ''); }

  /* ---------- leer como es un elemento ---------- */

  function hex(c) {
    var m = (c || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
    if (!m) return '';
    if (m[4] !== undefined && parseFloat(m[4]) < 0.5) return '';
    return '#' + [m[1], m[2], m[3]].map(function (x) { return ('0' + parseInt(x, 10).toString(16)).slice(-2); }).join('');
  }
  function px(v) { var n = parseFloat(v); return isNaN(n) ? '' : Math.round(n); }

  function snippet(el) {
    var t = (el.innerText || el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
    if (!t) { var im = el.querySelector && el.querySelector('img[alt]'); if (im) t = im.getAttribute('alt'); }
    return t.length > 50 ? t.slice(0, 50) + '…' : t;
  }

  function info(el) {
    var cs = getComputedStyle(el);
    var tag = el.tagName.toLowerCase();
    var img = tag === 'img' ? el : (tag === 'picture' ? el.querySelector('img') : null);
    var bg = cs.backgroundImage && cs.backgroundImage !== 'none' ? (cs.backgroundImage.match(/url\(["']?(.*?)["']?\)/) || [])[1] || '' : '';
    var chain = [];
    var p = el.parentElement;
    while (p && chain.length < 6) {
      if (p.hasAttribute('data-cms-k')) chain.push({ k: p.getAttribute('data-cms-k'), tag: p.tagName.toLowerCase(), text: snippet(p) });
      p = p.parentElement;
    }
    /* si esta dentro de un bloque de una lista, cual */
    var it = el.closest('[data-cms-item]');
    var item = it ? { list: it.getAttribute('data-cms-list'), pos: parseInt(it.getAttribute('data-cms-item'), 10), text: snippet(it) } : null;
    return {
      k: el.getAttribute('data-cms-k'),
      type: el.getAttribute('data-cms-t'),
      tag: tag,
      text: snippet(el),
      chain: chain,
      item: item,
      now: {
        texto: tag === 'img' ? '' : (el.innerText || '').replace(/\n{3,}/g, '\n\n').trim(),
        enlace: el.getAttribute('href') || '',
        imagen: img ? (img.currentSrc || img.getAttribute('src') || '') : '',
        alt: img ? (img.getAttribute('alt') || '') : '',
        fondo_imagen: bg,
        color: hex(cs.color),
        fondo: hex(cs.backgroundColor),
        tamano_letra: px(cs.fontSize),
        peso: '',
        alineacion: '',
        ancho: '',
        alto: '',
        filtro: '',
        opacidad: Math.round(parseFloat(cs.opacity) * 100),
        redondeo: px(cs.borderTopLeftRadius),
        margen: { t: px(cs.marginTop), r: px(cs.marginRight), b: px(cs.marginBottom), l: px(cs.marginLeft) },
        relleno: { t: px(cs.paddingTop), r: px(cs.paddingRight), b: px(cs.paddingBottom), l: px(cs.paddingLeft) },
        visible: cs.display !== 'none'
      }
    };
  }

  /* ---------- seleccionar ---------- */

  function select(el, tell) {
    if (selected) selected.removeAttribute('data-cms-sel');
    selected = el;
    if (!el) { if (tell) send({ type: 'pick', info: null }); return; }
    el.setAttribute('data-cms-sel', '1');
    if (tell) send({ type: 'pick', info: info(el) });
  }

  document.addEventListener('click', function (e) {
    if (clean) {
      /* sin marcas la pagina funciona normal, pero los links no sacan al marco */
      var a = e.target.closest ? e.target.closest('a[href]') : null;
      if (a && !/^#/.test(a.getAttribute('href'))) e.preventDefault();
      return;
    }
    if (e.altKey) return; /* con Alt la pagina funciona normal (pestañas, menus) */
    e.preventDefault();
    e.stopPropagation();
    var el = e.target.closest ? e.target.closest('[data-cms-k]') : null;

    /* Si lo que se toco no es editable (un velo encima de una foto, por
       ejemplo) se busca una parte editable debajo del puntero. */
    if (!el || (mode === 'editor' && !el.hasAttribute('data-cms-on'))) {
      var pila = document.elementsFromPoint(e.clientX, e.clientY);
      el = null;
      for (var i = 0; i < pila.length; i++) {
        if (pila[i].hasAttribute && pila[i].hasAttribute('data-cms-k') && (mode === 'super' || pila[i].hasAttribute('data-cms-on'))) { el = pila[i]; break; }
      }
    }
    select(el, true);
  }, true);

  /* Formularios y enlaces no deben sacar al marco de la pagina */
  document.addEventListener('submit', function (e) { e.preventDefault(); }, true);

  /* ---------- estilos en vivo (igual que cms_css en PHP) ---------- */

  var STYLE = ['color', 'fondo', 'fondo_imagen', 'tamano_letra', 'peso', 'alineacion', 'ancho', 'alto',
               'filtro', 'opacidad', 'redondeo', 'margen', 'relleno', 'visible'];

  function pick(v, allowed) {
    var o = {};
    Object.keys(v || {}).forEach(function (p) { if (allowed.indexOf(p) >= 0) o[p] = v[p]; });
    return o;
  }

  function css(v, hiddenDesktop) {
    var c = [];
    var set = function (x) { return x !== undefined && x !== null && x !== ''; };
    if (v.color) c.push('color:' + v.color);
    if (v.fondo) c.push('background-color:' + v.fondo);
    if (v.fondo_imagen) { c.push("background-image:url('" + String(v.fondo_imagen).replace(/['"()\\<>]/g, '') + "')", 'background-size:cover', 'background-position:center'); }
    if (set(v.tamano_letra)) c.push('font-size:' + parseFloat(v.tamano_letra) + 'px');
    if (v.peso) c.push('font-weight:' + v.peso);
    if (v.alineacion) c.push('text-align:' + v.alineacion);
    if (v.ancho) c.push('width:' + v.ancho);
    if (v.alto) c.push('height:' + v.alto, 'object-fit:cover');
    if (v.filtro) c.push('filter:' + v.filtro);
    if (set(v.opacidad)) c.push('opacity:' + (parseFloat(v.opacidad) / 100));
    if (set(v.redondeo)) c.push('border-radius:' + parseFloat(v.redondeo) + 'px');
    [['margen', 'margin'], ['relleno', 'padding']].forEach(function (p) {
      var b = v[p[0]];
      if (!b) return;
      [['t', 'top'], ['r', 'right'], ['b', 'bottom'], ['l', 'left']].forEach(function (s) {
        if (set(b[s[0]])) c.push(p[1] + '-' + s[1] + ':' + parseInt(b[s[0]], 10) + 'px');
      });
    });
    if (v.visible === false) c.push('display:none');
    else if (v.visible === true && hiddenDesktop) c.push('display:revert');
    return c.length ? c.join(' !important;') + ' !important' : '';
  }

  /** Rehace toda la hoja de estilos con lo que tiene el panel ahora. */
  function restyle(content, schema) {
    var d = [], m = [];
    Object.keys(content || {}).forEach(function (k) {
      var s = schema[base(k)];
      if (!s) return;
      var allowed = s.props.filter(function (p) { return STYLE.indexOf(p) >= 0; });
      var dv = pick(content[k], allowed);
      var mv = pick(content[k]['@m'], allowed);
      var sel = '[data-cms-k="' + k + '"]';
      var a = css(dv), b = css(mv, dv.visible === false);
      if (a) d.push(sel + '{' + a + '}');
      if (b) m.push(sel + '{' + b + '}');
    });
    var st = document.getElementById('cms-css');
    if (!st) { st = document.createElement('style'); st.id = 'cms-css'; document.head.appendChild(st); }
    st.textContent = d.join('\n') + (m.length ? '\n@media (max-width: ' + MOBILE_MAX + 'px) {\n' + m.join('\n') + '\n}' : '');
  }

  /* ---------- texto, link e imagen en vivo ---------- */

  function apply(k, v) {
    var el = byK(k);
    if (!el) return;
    v = v || {};
    var tag = el.tagName.toLowerCase();
    var img = tag === 'img' ? el : el.querySelector('img');
    var o = originals[k];
    if (!o) {
      o = originals[k] = {
        html: el.innerHTML,
        href: el.getAttribute('href'),
        src: img ? img.getAttribute('src') : null,
        srcset: img ? img.getAttribute('srcset') : null,
        alt: img ? img.getAttribute('alt') : null
      };
    }
    /* volver a como estaba al cargar y aplicar todo de nuevo */
    if (tag !== 'img') el.innerHTML = o.html;
    if (o.href !== null) el.setAttribute('href', o.href);
    img = tag === 'img' ? el : el.querySelector('img');
    if (img && o.src !== null) { img.setAttribute('src', o.src); if (o.srcset) img.setAttribute('srcset', o.srcset); if (o.alt !== null) img.setAttribute('alt', o.alt); }

    if (v.texto && tag !== 'img') {
      el.textContent = '';
      String(v.texto).split('\n').forEach(function (line, i) {
        if (i) el.appendChild(document.createElement('br'));
        el.appendChild(document.createTextNode(line));
      });
    }
    if (v.enlace && tag === 'a') el.setAttribute('href', v.enlace);
    if (v.imagen && img) { img.setAttribute('src', v.imagen); img.removeAttribute('srcset'); }
    if (v.alt && img) img.setAttribute('alt', v.alt);
  }

  /* ---------- ordenes del panel ---------- */

  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || !e.data.cms) return;
    var d = e.data;
    if (d.cmd === 'apply') { apply(d.k, d.vals); restyle(d.content, d.schema); }
    if (d.cmd === 'restyle') restyle(d.content, d.schema);
    if (d.cmd === 'clean') {
      clean = !!d.on;
      document.documentElement.classList.toggle('cms-ed', !clean);
      if (selected) { if (clean) selected.removeAttribute('data-cms-sel'); else selected.setAttribute('data-cms-sel', '1'); }
    }
    if (d.cmd === 'select') {
      var el = d.k ? byK(d.k) : null;
      select(el, !!d.tell);
      if (el && d.scroll) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (d.cmd === 'mark') {
      Array.prototype.forEach.call(document.querySelectorAll('[data-cms-k]'), function (m) {
        if (base(m.getAttribute('data-cms-k')) !== d.k) return;
        if (d.on) m.setAttribute('data-cms-on', '1'); else m.removeAttribute('data-cms-on');
      });
    }
  });

  send({ type: 'ready', mode: mode });
})();
