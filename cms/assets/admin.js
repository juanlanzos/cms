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
    schema: {}, content: {},
    sel: null,          /* info del elemento elegido (viene del marco) */
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
      if (Array.isArray(S.schema)) S.schema = {};
      if (Array.isArray(S.content)) S.content = {};
      frame.src = 'preview.php?page=' + encodeURIComponent(S.page) + '&mode=' + S.mode + '&t=' + Date.now();
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

  var btnUsers = document.getElementById('btnUsers');
  if (btnUsers) btnUsers.addEventListener('click', function () { S.view = S.view === 'users' ? 'main' : 'users'; render(); });

  /* ---------- mensajes del marco ---------- */

  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || !e.data.cms) return;
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

  function renderSuper() {
    var keys = Object.keys(S.schema);
    side.appendChild(h('div', { class: 'intro' }, [
      h('h2', { text: 'Definir qué se edita' }),
      h('p', { class: 'muted', html: 'Hacé clic en cualquier parte de la página. Después decidí si el admin de contenidos la puede cambiar y <b>qué</b> puede cambiar. Con <b>Alt + clic</b> la página funciona normal (menús, pestañas).' })
    ]));

    var sel = S.sel;
    if (sel) {
      var k = sel.k;
      var s = S.schema[k];
      var on = !!s;
      var type = s ? s.type : sel.type;
      var card = h('div', { class: 'card' });

      card.appendChild(h('div', { class: 'crumb' }, [
        h('span', { class: 'tag t-' + type, text: TYPE_NAMES[type] }),
        h('code', { text: '<' + sel.tag + '>' }),
        h('span', { class: 'muted', text: sel.text })
      ]));
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
          setDirty(true);
          render();
        } } }),
        h('span', { text: 'Se puede editar' })
      ]));

      if (on) {
        card.appendChild(h('label', { class: 'field' }, [
          h('span', { text: 'Nombre que va a ver el editor' }),
          h('input', { type: 'text', value: s.label, placeholder: 'Ej: Título principal', on: { input: function (e) { s.label = e.target.value; setDirty(true); } } })
        ]));

        if (sel.type === 'texto' || sel.type === 'bloque') {
          card.appendChild(h('label', { class: 'field' }, [
            h('span', { text: 'Tratarlo como' }),
            (function () {
              var sl = h('select', { on: { change: function (e) {
                s.type = e.target.value;
                s.props = S.types[s.type].defaults.slice();
                setDirty(true); render();
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
              setDirty(true);
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
    if (sel && S.schema[sel.k]) {
      var k = sel.k;
      var s = S.schema[k];
      var vals = S.content[k] || {};
      var card = h('div', { class: 'card' });
      card.appendChild(h('div', { class: 'crumb' }, [
        h('span', { class: 'tag t-' + s.type, text: TYPE_NAMES[s.type] }),
        h('b', { text: s.label || ('<' + s.tag + '>') })
      ]));

      s.props.forEach(function (p) {
        card.appendChild(field(p, k, vals, sel.now));
      });

      card.appendChild(h('button', { class: 'btn small ghost', on: { click: function () {
        if (!confirm('¿Volver esta parte a como era originalmente?')) return;
        delete S.content[k];
        tell({ cmd: 'apply', k: k, vals: {} });
        setDirty(true);
        render();
      } } }, ['↺ Volver al original']));
      side.appendChild(card);
    } else {
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
        frame.src = 'preview.php?page=' + encodeURIComponent(S.page) + '&mode=' + S.mode + '&t=' + Date.now();
        render();
      }).catch(function (e) { toast(e.message, true); });
    }));
  }

  /** Un campo del editor. Muestra el valor guardado o, si no hay, cómo está ahora. */
  function field(p, k, vals, now) {
    var cat = S.catalog[p];
    var has = Object.prototype.hasOwnProperty.call(vals, p);
    var cur = has ? vals[p] : (now ? now[p] : '');
    var wrap = h('div', { class: 'field' + (has ? ' changed' : '') }, [h('span', { text: cat.label })]);

    function set(v) {
      if (!S.content[k]) S.content[k] = {};
      S.content[k][p] = v;
      wrap.classList.add('changed');
      tell({ cmd: 'apply', k: k, vals: S.content[k] });
      setDirty(true);
    }
    function unset() {
      if (S.content[k]) { delete S.content[k][p]; if (!Object.keys(S.content[k]).length) delete S.content[k]; }
      tell({ cmd: 'apply', k: k, vals: S.content[k] || {} });
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
          h('input', { type: 'color', value: cur || '#000000', on: { input: function (e) { set(e.target.value); } } }),
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
