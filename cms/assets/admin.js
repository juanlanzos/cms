/**
 * Panel del CMS (la ventana de afuera).
 *
 * Dos modos:
 *  - "super"  (Definir qué se edita): el admin principal hace clic en una
 *              parte y decide si se puede editar y qué propiedades.
 *  - "editor" (Editar contenido): se hace clic en una parte habilitada y se
 *              cambian sus valores. Guardar = publicar.
 */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var CSRF = app.getAttribute('data-csrf');
  var frame = document.getElementById('frame');
  var side = document.getElementById('side');
  var pageSel = document.getElementById('pageSel');

  var S = {
    user: null, pages: {}, catalog: {}, types: {}, site: '/',
    page: '', mode: 'editor',
    schema: {}, content: {}, lists: {},
    sel: null,          /* info del elemento elegido (viene del marco) */
    device: 'd',        /* d = compu, m = celular */
    reselect: null,     /* que volver a elegir cuando recarga la vista previa */
    dirty: false,
    view: 'main'        /* main | users */
  };

  var TYPE_NAMES = { texto: 'Texto', enlace: 'Botón / link', imagen: 'Imagen', bloque: 'Bloque / sección' };

  /* ---------- utilidades ---------- */

  function api(action, data) {
    var body = Object.assign({ action: action, csrf: CSRF, page: S.page }, data || {});
    return fetch('api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (r) { if (!r.ok) throw new Error(r.error || 'Error'); return r.data; });
  }

  function upload(file) {
    var fd = new FormData();
    fd.append('action', 'upload');
    fd.append('csrf', CSRF);
    fd.append('file', file);
    return fetch('api.php', { method: 'POST', body: fd, credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (r) { if (!r.ok) throw new Error(r.error); return r.data.url; });
  }

  function toast(msg, bad) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = 'toast'; }, 2600);
  }

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (a) {
      if (a === 'on') Object.keys(attrs.on).forEach(function (ev) { el.addEventListener(ev, attrs.on[ev]); });
      else if (a === 'text') el.textContent = attrs.text;
      else if (a === 'html') el.innerHTML = attrs.html;
      else if (attrs[a] !== false && attrs[a] !== null && attrs[a] !== undefined) el.setAttribute(a, attrs[a] === true ? '' : attrs[a]);
    });
    (kids || []).forEach(function (k) { if (k) el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); });
    return el;
  }

  var STYLE = ['color', 'fondo', 'fondo_imagen', 'tamano_letra', 'peso', 'alineacion', 'ancho', 'alto',
               'filtro', 'opacidad', 'redondeo', 'margen', 'relleno', 'visible'];

  /** "2.0.1@k3f" -> "2.0.1": la configuracion es la misma para un bloque y sus copias. */
  function base(k) { return String(k || '').replace(/@.*$/, ''); }

  /**
   * Recarga la vista previa mandando los cambios todavia sin guardar,
   * asi se ven tal cual van a quedar (por ejemplo, un bloque duplicado).
   */
  function refresh(reselect) {
    S.reselect = reselect || null;
    var f = h('form', { method: 'post', action: 'preview.php', target: 'frame', style: 'display:none' }, [
      h('input', { type: 'hidden', name: 'csrf', value: CSRF }),
      h('input', { type: 'hidden', name: 'page', value: S.page }),
      h('input', { type: 'hidden', name: 'mode', value: S.mode }),
      h('input', { type: 'hidden', name: 'content', value: JSON.stringify(S.content) })
    ]);
    document.body.appendChild(f);
    f.submit();
    f.remove();
  }

  function tell(msg) { if (frame.contentWindow) frame.contentWindow.postMessage(Object.assign({ cms: 1 }, msg), location.origin); }

  function setDirty(v) {
    S.dirty = v;
    var b = document.getElementById('btnSave');
    if (b) b.disabled = !v;
  }

  window.addEventListener('beforeunload', function (e) { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- arranque ---------- */

  function boot() {
    api('state').then(function (d) {
      S.user = d.user; S.catalog = d.catalog; S.types = d.types; S.site = d.site;
      S.mode = d.user.role === 'super' ? 'super' : 'editor';
      fillPages(d.pages);
    }).catch(function (e) { toast(e.message, true); });
  }

  function fillPages(pages) {
    S.pages = pages || {};
    pageSel.innerHTML = '';
    var keys = Object.keys(S.pages);
    if (!keys.length) {
      pageSel.appendChild(h('option', { text: 'No hay páginas: tocá "Escanear sitio"' }));
      side.innerHTML = '';
      side.appendChild(h('div', { class: 'empty' }, [h('p', { text: 'Todavía no hay páginas escaneadas.' })]));
      return;
    }
    keys.forEach(function (k) {
      pageSel.appendChild(h('option', { value: k, text: S.pages[k].title + '  (' + k + ')' }));
    });
    if (!S.pages[S.page]) S.page = keys[0];
    pageSel.value = S.page;
    loadPage();
  }

  pageSel.addEventListener('change', function () {
    if (S.dirty && !confirm('Hay cambios sin guardar. ¿Salir igual?')) { pageSel.value = S.page; return; }
    S.page = pageSel.value;
    loadPage();
  });

  function loadPage() {
    setDirty(false);
    S.sel = null;
    S.view = 'main';
    document.getElementById('btnView').href = S.site + S.page;
    api('page').then(function (d) {
      S.schema = d.schema || {};
      S.content = d.content || {};
      S.lists = d.lists || {};
      if (Array.isArray(S.schema)) S.schema = {};
      if (Array.isArray(S.content)) S.content = {};
      if (Array.isArray(S.lists)) S.lists = {};
      refresh();
      render();
    }).catch(function (e) { toast(e.message, true); });
  }

  /* ---------- botones de arriba (solo admin principal) ---------- */

  var btnScan = document.getElementById('btnScan');
  if (btnScan) btnScan.addEventListener('click', function () {
    btnScan.disabled = true;
    btnScan.textContent = 'Escaneando…';
    api('scan').then(function (d) {
      var r = d.report;
      toast('Listo: ' + r.nuevas.length + ' nuevas, ' + r.actualizadas.length + ' actualizadas, ' + r.sin_cambios.length + ' sin cambios');
      fillPages(d.pages);
    }).catch(function (e) { toast(e.message, true); })
      .then(function () { btnScan.disabled = false; btnScan.textContent = 'Escanear sitio'; });
  });

  var seg = document.getElementById('modeSeg');
  if (seg) seg.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || b.getAttribute('data-mode') === S.mode) return;
    if (S.dirty && !confirm('Hay cambios sin guardar. ¿Cambiar de modo igual?')) return;
    S.mode = b.getAttribute('data-mode');
    Array.prototype.forEach.call(seg.children, function (x) { x.classList.toggle('on', x === b); });
    loadPage();
  });

  var devSeg = document.getElementById('devSeg');
  devSeg.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || b.getAttribute('data-dev') === S.device) return;
    S.device = b.getAttribute('data-dev');
    Array.prototype.forEach.call(devSeg.children, function (x) { x.classList.toggle('on', x === b); });
    document.querySelector('.stage').classList.toggle('mobile', S.device === 'm');
    /* con otro ancho cambian las medidas: se vuelve a leer lo elegido */
    if (S.sel) setTimeout(function () { tell({ cmd: 'select', k: S.sel.k, tell: true }); }, 350);
    else render();
  });

  var btnUsers = document.getElementById('btnUsers');
  if (btnUsers) btnUsers.addEventListener('click', function () { S.view = S.view === 'users' ? 'main' : 'users'; render(); });

  /* ---------- mensajes del marco ---------- */

  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || !e.data.cms) return;
    if (e.data.type === 'ready' && S.reselect) {
      tell({ cmd: 'select', k: S.reselect, tell: true, scroll: true });
      S.reselect = null;
    }
    if (e.data.type === 'pick') {
      S.sel = e.data.info;
      S.view = 'main';
      render();
    }
  });

  /* ---------- panel lateral ---------- */

  function render() {
    side.innerHTML = '';
    if (S.view === 'users') return renderUsers();
    if (S.mode === 'super') renderSuper(); else renderEditor();
  }

  function saveBar(label, fn) {
    return h('div', { class: 'savebar' }, [
      h('button', { class: 'btn primary', id: 'btnSave', disabled: !S.dirty, on: { click: fn } }, [label])
    ]);
  }

  function partList(title, keys, emptyMsg) {
    var box = h('div', { class: 'parts' }, [h('h3', { text: title })]);
    if (!keys.length) { box.appendChild(h('p', { class: 'muted', text: emptyMsg })); return box; }
    keys.sort(function (a, b) {
      var x = a.split('.').map(Number), y = b.split('.').map(Number);
      for (var i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); }
      return 0;
    }).forEach(function (k) {
      var s = S.schema[k];
      box.appendChild(h('button', { class: 'part', on: { click: function () { tell({ cmd: 'select', k: k, tell: true, scroll: true }); } } }, [
        h('span', { class: 'tag t-' + s.type, text: TYPE_NAMES[s.type] || s.type }),
        h('span', { text: s.label || ('<' + s.tag + '>') })
      ]));
    });
    return box;
  }

  /* ===== Admin principal: definir qué se edita ===== */

  /**
   * Las partes "hermanas" de otra dentro de una lista: el mismo titulo en
   * cada tarjeta, por ejemplo. Lo que se define en una vale para todas.
   */
  function siblingsOf(k) {
    var out = [];
    Object.keys(S.lists).forEach(function (L) {
      if (k.indexOf(L + '.') !== 0) return;
      var rest = k.slice(L.length + 1).split('.');
      var mine = rest.shift();
      var tail = rest.length ? '.' + rest.join('.') : '';
      S.lists[L].forEach(function (it) { if (String(it.src) !== mine) out.push(L + '.' + it.src + tail); });
    });
    return out;
  }

  function changed(k) {
    siblingsOf(k).forEach(function (o) {
      if (S.schema[k]) S.schema[o] = JSON.parse(JSON.stringify(S.schema[k]));
      else delete S.schema[o];
      tell({ cmd: 'mark', k: o, on: !!S.schema[k] });
    });
    setDirty(true);
  }

  function renderSuper() {
    var keys = Object.keys(S.schema);
    side.appendChild(h('div', { class: 'intro' }, [
      h('h2', { text: 'Definir qué se edita' }),
      h('p', { class: 'muted', html: 'Hacé clic en cualquier parte de la página. Después decidí si el admin de contenidos la puede cambiar y <b>qué</b> puede cambiar. Con <b>Alt + clic</b> la página funciona normal (menús, pestañas).' })
    ]));

    var sel = S.sel;
    if (sel) {
      var k = base(sel.k);
      var s = S.schema[k];
      var on = !!s;
      var type = s ? s.type : sel.type;
      var card = h('div', { class: 'card' });

      card.appendChild(h('div', { class: 'crumb' }, [
        h('span', { class: 'tag t-' + type, text: TYPE_NAMES[type] }),
        h('code', { text: '<' + sel.tag + '>' }),
        h('span', { class: 'muted', text: sel.text })
      ]));
      var sibs = siblingsOf(k).length;
      if (sibs) card.appendChild(h('p', { class: 'devnote', text: '🔁 Está dentro de una lista: lo que definas acá se aplica igual en los ' + (sibs + 1) + ' bloques.' }));
      if (sel.chain.length) {
        card.appendChild(h('button', { class: 'btn small', on: { click: function () { tell({ cmd: 'select', k: sel.chain[0].k, tell: true }); } } },
          ['↑ Elegir lo que lo contiene (<' + sel.chain[0].tag + '>)']));
      }

      card.appendChild(h('label', { class: 'switch' }, [
        h('input', { type: 'checkbox', checked: on, on: { change: function (e) {
          if (e.target.checked) {
            S.schema[k] = { label: sel.text.slice(0, 40), type: type, tag: sel.tag, props: S.types[type].defaults.slice() };
          } else {
            delete S.schema[k];
          }
          tell({ cmd: 'mark', k: k, on: e.target.checked });
          changed(k);
          render();
        } } }),
        h('span', { text: 'Se puede editar' })
      ]));

      if (on) {
        card.appendChild(h('label', { class: 'field' }, [
          h('span', { text: 'Nombre que va a ver el editor' }),
          h('input', { type: 'text', value: s.label, placeholder: 'Ej: Título principal', on: { input: function (e) { s.label = e.target.value; changed(k); } } })
        ]));

        if (sel.type === 'texto' || sel.type === 'bloque') {
          card.appendChild(h('label', { class: 'field' }, [
            h('span', { text: 'Tratarlo como' }),
            (function () {
              var sl = h('select', { on: { change: function (e) {
                s.type = e.target.value;
                s.props = S.types[s.type].defaults.slice();
                changed(k); render();
              } } });
              ['texto', 'bloque'].forEach(function (t) { sl.appendChild(h('option', { value: t, text: TYPE_NAMES[t], selected: s.type === t })); });
              return sl;
            })()
          ]));
        }

        var grid = h('div', { class: 'props' }, [h('h4', { text: '¿Qué se puede cambiar?' })]);
        S.types[s.type].props.forEach(function (p) {
          grid.appendChild(h('label', { class: 'chk' }, [
            h('input', { type: 'checkbox', checked: s.props.indexOf(p) >= 0, on: { change: function (e) {
              if (e.target.checked) { if (s.props.indexOf(p) < 0) s.props.push(p); }
              else s.props = s.props.filter(function (x) { return x !== p; });
              changed(k);
            } } }),
            h('span', { text: S.catalog[p].label })
          ]));
        });
        card.appendChild(grid);
      }
      side.appendChild(card);
    } else {
      side.appendChild(h('div', { class: 'card hint' }, [h('p', { text: '👆 Elegí una parte de la página para empezar.' })]));
    }

    side.appendChild(partList('Partes editables en esta página (' + keys.length + ')', keys, 'Todavía ninguna.'));
    side.appendChild(saveBar('Guardar', function () {
      var bad = Object.keys(S.schema).filter(function (k) { return !S.schema[k].props.length; });
      if (bad.length) { toast('Hay partes habilitadas sin ninguna propiedad tildada', true); return; }
      api('save_schema', { schema: S.schema }).then(function (d) {
        S.schema = Array.isArray(d.schema) ? {} : d.schema;
        S.lists = Array.isArray(d.lists) ? {} : (d.lists || {});
        setDirty(false);
        toast('Guardado ✔');
        render();
      }).catch(function (e) { toast(e.message, true); });
    }));
  }

  /* ===== Admin de contenidos: editar ===== */

  function renderEditor() {
    var keys = Object.keys(S.schema);
    side.appendChild(h('div', { class: 'intro' }, [
      h('h2', { text: 'Editar contenido' }),
      h('p', { class: 'muted', html: 'Hacé clic en una parte <span class="green">marcada en verde</span>. Los cambios se ven al instante; se publican al tocar <b>Guardar y publicar</b>.' })
    ]));

    var sel = S.sel;
    if (sel && S.schema[base(sel.k)]) {
      var k = sel.k;
      var s = S.schema[base(k)];
      var vals = S.content[k] || {};
      var card = h('div', { class: 'card' });
      card.appendChild(h('div', { class: 'crumb' }, [
        h('span', { class: 'tag t-' + s.type, text: TYPE_NAMES[s.type] }),
        h('b', { text: s.label || ('<' + s.tag + '>') }),
        k.indexOf('@') > 0 ? h('span', { class: 'muted', text: '(copia)' }) : null
      ]));
      if (S.device === 'm') card.appendChild(h('p', { class: 'devnote', text: '📱 Estás editando la versión celular: los colores, tamaños y espacios que cambies acá solo se aplican en celular.' }));

      s.props.forEach(function (p) {
        card.appendChild(field(p, k, vals, sel.now));
      });

      card.appendChild(h('button', { class: 'btn small ghost', on: { click: function () {
        if (!confirm('¿Volver esta parte a como era originalmente?')) return;
        var items = S.content[k] && S.content[k]._items;
        delete S.content[k];
        if (items) S.content[k] = { _items: items }; /* el orden de la lista no se toca */
        tell({ cmd: 'apply', k: k, vals: {}, content: S.content, schema: S.schema });
        setDirty(true);
        render();
      } } }, ['↺ Volver al original']));
      side.appendChild(card);
    }
    if (sel && sel.item && S.schema[sel.item.list] && S.schema[sel.item.list].props.indexOf('lista') >= 0) {
      side.appendChild(itemCard(sel.item));
    }
    if (!(sel && (S.schema[base(sel.k)] || sel.item))) {
      side.appendChild(h('div', { class: 'card hint' }, [h('p', { text: keys.length ? '👆 Elegí una parte marcada en verde.' : 'El admin principal todavía no habilitó partes en esta página.' })]));
    }

    side.appendChild(partList('Lo que podés editar acá (' + keys.length + ')', keys, 'Nada habilitado todavía.'));
    side.appendChild(saveBar('Guardar y publicar', function () {
      tell({ cmd: 'select', k: null });
      api('save_content', { content: S.content }).then(function (d) {
        S.content = Array.isArray(d.content) ? {} : d.content;
        setDirty(false);
        toast('Publicado ✔');
        S.sel = null;
        refresh();
        render();
      }).catch(function (e) { toast(e.message, true); });
    }));
  }

  /** Un campo del editor. Muestra el valor guardado o, si no hay, cómo está ahora. */
  function field(p, k, vals, now) {
    var cat = S.catalog[p];
    if (cat.kind === 'list') return listManager(k);
    var mobile = S.device === 'm' && STYLE.indexOf(p) >= 0;
    var bag = mobile ? (vals['@m'] || {}) : vals;
    var has = Object.prototype.hasOwnProperty.call(bag, p);
    var cur = has ? bag[p] : (now ? now[p] : '');
    var label = cat.label + (mobile ? ' · 📱' : (S.device === 'm' ? ' (igual en celular y compu)' : ''));
    var wrap = h('div', { class: 'field' + (has ? ' changed' : '') }, [h('span', { text: label })]);

    function target() {
      if (!S.content[k]) S.content[k] = {};
      if (!mobile) return S.content[k];
      if (!S.content[k]['@m']) S.content[k]['@m'] = {};
      return S.content[k]['@m'];
    }
    function tidy() {
      var c = S.content[k];
      if (!c) return;
      if (c['@m'] && !Object.keys(c['@m']).length) delete c['@m'];
      if (!Object.keys(c).length) delete S.content[k];
    }
    function set(v) {
      target()[p] = v;
      wrap.classList.add('changed');
      tell({ cmd: 'apply', k: k, vals: S.content[k], content: S.content, schema: S.schema });
      setDirty(true);
    }
    function unset() {
      delete target()[p];
      tidy();
      tell({ cmd: 'apply', k: k, vals: S.content[k] || {}, content: S.content, schema: S.schema });
      setDirty(true);
      render();
    }
    var reset = has ? h('button', { class: 'link', title: 'Volver a como estaba', on: { click: unset } }, ['quitar']) : null;

    switch (cat.kind) {
      case 'textarea':
        wrap.appendChild(h('textarea', { rows: 3, on: { input: function (e) { set(e.target.value); } } }, [String(cur || '')]));
        break;
      case 'text':
        wrap.appendChild(h('input', { type: 'text', value: cur || '', on: { input: function (e) { set(e.target.value); } } }));
        break;
      case 'size':
        wrap.appendChild(h('input', { type: 'text', value: has ? cur : '', placeholder: 'Ej: 300px, 50%, auto', on: { change: function (e) { set(e.target.value.trim()); } } }));
        break;
      case 'color':
        wrap.appendChild(h('div', { class: 'row' }, [
          h('input', { type: 'color', value: cur || '#ffffff', on: { input: function (e) { set(e.target.value); } } }),
          cur ? null : h('small', { class: 'muted', text: 'sin color propio' }),
          reset
        ]));
        reset = null;
        break;
      case 'range':
        var num = h('b', { text: (cur === '' ? '—' : cur) + cat.unit });
        wrap.appendChild(h('div', { class: 'row' }, [
          h('input', { type: 'range', min: cat.min, max: cat.max, value: cur === '' ? cat.min : cur, on: { input: function (e) { num.textContent = e.target.value + cat.unit; set(Number(e.target.value)); } } }),
          num
        ]));
        break;
      case 'select':
        var sl = h('select', { on: { change: function (e) { set(e.target.value); } } });
        Object.keys(cat.options).forEach(function (o) { sl.appendChild(h('option', { value: o, text: cat.options[o], selected: String(cur || '') === o })); });
        wrap.appendChild(sl);
        break;
      case 'toggle':
        wrap.appendChild(h('label', { class: 'chk' }, [
          h('input', { type: 'checkbox', checked: cur !== false, on: { change: function (e) { set(e.target.checked); } } }),
          h('span', { text: 'Sí, mostrar' })
        ]));
        break;
      case 'box':
        var b = Object.assign({ t: '', r: '', b: '', l: '' }, cur || {});
        var boxv = has ? Object.assign({}, b) : { t: '', r: '', b: '', l: '' };
        var g = h('div', { class: 'box4' });
        [['t', 'Arriba'], ['r', 'Derecha'], ['b', 'Abajo'], ['l', 'Izquierda']].forEach(function (sd) {
          g.appendChild(h('label', {}, [h('small', { text: sd[1] }), h('input', { type: 'number', value: has ? b[sd[0]] : '', placeholder: String(b[sd[0]]), on: { input: function (e) {
            boxv[sd[0]] = e.target.value === '' ? '' : Number(e.target.value);
            set(Object.assign({}, boxv));
          } } })]));
        });
        wrap.appendChild(g);
        wrap.appendChild(h('small', { class: 'muted', text: 'En píxeles. Vacío = como está.' }));
        break;
      case 'image':
        var thumb = h('img', { class: 'thumb', src: cur || '', alt: '' });
        var url = h('input', { type: 'text', value: has ? cur : '', placeholder: 'Pegá una URL o subí una foto', on: { change: function (e) { thumb.src = e.target.value; set(e.target.value.trim()); } } });
        var file = h('input', { type: 'file', accept: 'image/*', on: { change: function (e) {
          var f = e.target.files[0];
          if (!f) return;
          toast('Subiendo…');
          upload(f).then(function (u) { url.value = u; thumb.src = u; set(u); toast('Imagen lista ✔'); })
            .catch(function (er) { toast(er.message, true); });
        } } });
        wrap.appendChild(thumb);
        wrap.appendChild(h('label', { class: 'btn small upload' }, ['📷 Subir foto', file]));
        wrap.appendChild(url);
        break;
    }
    if (reset) wrap.appendChild(reset);
    return wrap;
  }

  /* ===== Listas de bloques ===== */

  function items(L) {
    var it = (S.content[L] && S.content[L]._items) || S.lists[L] || [];
    return JSON.parse(JSON.stringify(it));
  }

  function newId() { return 'c' + Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(0, 6); }

  /** Recorre las partes guardadas que pertenecen a un bloque de la lista. */
  function eachKeyOf(L, it, fn) {
    var pre = L + '.' + it.src;
    Object.keys(S.content).forEach(function (k) {
      var m = k.match(/^([\d.]+)(?:@([a-z0-9]+))?$/);
      if (!m || (m[2] || '') !== (it.id || '')) return;
      if (m[1] === pre || m[1].indexOf(pre + '.') === 0) fn(k, m[1]);
    });
  }

  function itemOp(L, pos, op) {
    var arr = items(L);
    var it = arr[pos];
    if (!it) return;
    if (op === 'up') { if (pos === 0) return; arr.splice(pos - 1, 0, arr.splice(pos, 1)[0]); }
    else if (op === 'down') { if (pos >= arr.length - 1) return; arr.splice(pos + 1, 0, arr.splice(pos, 1)[0]); }
    else if (op === 'dup') {
      var id = newId();
      arr.splice(pos + 1, 0, { src: it.src, id: id });
      /* la copia arranca con los mismos textos y fotos que el original */
      eachKeyOf(L, it, function (k, b) { S.content[b + '@' + id] = JSON.parse(JSON.stringify(S.content[k])); });
    } else if (op === 'del') {
      if (arr.length < 2) { toast('Tiene que quedar al menos un bloque', true); return; }
      if (!confirm('¿Borrar este bloque?')) return;
      arr.splice(pos, 1);
      if (it.id) eachKeyOf(L, it, function (k) { delete S.content[k]; });
    } else return;
    if (!S.content[L]) S.content[L] = {};
    S.content[L]._items = arr;
    setDirty(true);
    S.sel = null;
    render();
    refresh(L);
  }

  function itemButtons(L, pos, total) {
    return h('div', { class: 'itembtns' }, [
      h('button', { class: 'btn small', title: 'Subir', disabled: pos === 0, on: { click: function () { itemOp(L, pos, 'up'); } } }, ['↑']),
      h('button', { class: 'btn small', title: 'Bajar', disabled: pos >= total - 1, on: { click: function () { itemOp(L, pos, 'down'); } } }, ['↓']),
      h('button', { class: 'btn small', title: 'Duplicar', on: { click: function () { itemOp(L, pos, 'dup'); } } }, ['⧉ Duplicar']),
      h('button', { class: 'btn small danger', title: 'Borrar', disabled: total < 2, on: { click: function () { itemOp(L, pos, 'del'); } } }, ['🗑'])
    ]);
  }

  /** Cuando se elige algo que esta dentro de un bloque de una lista. */
  function itemCard(item) {
    var total = items(item.list).length;
    return h('div', { class: 'card listcard' }, [
      h('h4', { text: 'Este bloque es parte de una lista (' + (item.pos + 1) + ' de ' + total + ')' }),
      h('p', { class: 'muted', text: item.text || '' }),
      itemButtons(item.list, item.pos, total)
    ]);
  }

  /** El contenedor de la lista: todos sus bloques con sus botones. */
  function listManager(L) {
    var arr = items(L);
    var box = h('div', { class: 'field' }, [h('span', { text: 'Bloques de la lista (' + arr.length + ')' })]);
    arr.forEach(function (it, pos) {
      box.appendChild(h('div', { class: 'itemrow' }, [
        h('span', { text: 'Bloque ' + (pos + 1) + (it.id ? ' (copia)' : '') }),
        itemButtons(L, pos, arr.length)
      ]));
    });
    box.appendChild(h('small', { class: 'muted', text: 'Para cambiar el texto o la foto de un bloque, hacé clic adentro de él en la página.' }));
    return box;
  }

  /* ===== Usuarios ===== */

  function renderUsers() {
    side.appendChild(h('div', { class: 'intro' }, [
      h('h2', { text: 'Usuarios' }),
      h('p', { class: 'muted', html: '<b>Admin principal</b>: define qué se edita y crea usuarios.<br><b>Admin de contenidos</b>: solo cambia lo habilitado.' })
    ]));
    var list = h('div', { class: 'card' }, [h('p', { class: 'muted', text: 'Cargando…' })]);
    side.appendChild(list);
    api('users').then(function (users) {
      list.innerHTML = '';
      users.forEach(function (u) {
        list.appendChild(h('div', { class: 'urow' }, [
          h('b', { text: u.username }),
          h('span', { class: 'muted', text: u.role === 'super' ? 'Admin principal' : 'Admin de contenidos' }),
          u.username === S.user.username ? null : h('button', { class: 'link', on: { click: function () {
            if (!confirm('¿Borrar a ' + u.username + '?')) return;
            api('delete_user', { username: u.username }).then(function () { toast('Borrado'); render(); }).catch(function (e) { toast(e.message, true); });
          } } }, ['borrar'])
        ]));
      });
    });

    var nu = h('input', { type: 'text', placeholder: 'usuario' });
    var np = h('input', { type: 'password', placeholder: 'contraseña (8 o más)' });
    var nr = h('select', {}, [h('option', { value: 'editor', text: 'Admin de contenidos' }), h('option', { value: 'super', text: 'Admin principal' })]);
    side.appendChild(h('div', { class: 'card' }, [
      h('h4', { text: 'Agregar usuario' }), nu, np, nr,
      h('button', { class: 'btn primary', on: { click: function () {
        api('add_user', { username: nu.value, password: np.value, role: nr.value })
          .then(function () { toast('Usuario creado ✔'); render(); })
          .catch(function (e) { toast(e.message, true); });
      } } }, ['Crear'])
    ]));
    side.appendChild(h('button', { class: 'btn', on: { click: function () { S.view = 'main'; render(); } } }, ['← Volver al editor']));
  }

  boot();
})();
