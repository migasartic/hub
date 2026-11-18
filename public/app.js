// Hub — page d'accueil des applis
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); }

// ---------- Accès au serveur ----------
let token = store.get('hubToken');
const backend = window.HUB_BACKEND || {
  async req(method, path, body) {
    let r;
    try { r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
    catch { throw new Error('Serveur injoignable'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Erreur ' + r.status);
    return j;
  },
  load() { return this.req('GET', '/api/hub'); },
  status() { return this.req('GET', '/api/status'); },
  unlock(pin) { return this.req('POST', '/api/unlock', { pin }); },
  admin(password) { return this.req('POST', '/api/admin', { password }); },
  save(hub) { return this.req('PUT', '/api/hub', hub); },
};
const setToken = (t) => { token = t; store.set('hubToken', t); backend.token = t; };
backend.token = token;

// ---------- Icônes ----------
const P = {
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" stroke="none"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  back: '<path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="m16 9-5 6M11 9l5 6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>', up: '<path d="m18 15-6-6-6 6"/>', down: '<path d="m6 9 6 6 6-6"/>',
};
const ic = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${P[n]}</svg>`;
const COLORS = ['#e5735f', '#e9a85a', '#d4b03c', '#5fb36f', '#3fb5a6', '#4f8fe0', '#7d6ee8', '#c46bb6', '#8a93a0'];
const autoColor = (name) => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
const initials = (name) => { const w = name.trim().split(/[\s\-_.]+/).filter(Boolean); return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)).toUpperCase(); };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 12);

// ---------- État ----------
const S = { hub: null, status: {}, editing: false, q: '' };

function tileIcon(t) {
  const i = t.icon || {};
  if (i.type === 'image' && i.value) return `<div class="ic img"><img src="${esc(i.value)}" alt=""></div>`;
  const bg = t.color || (i.type === 'emoji' ? '' : autoColor(t.name));
  if (i.type === 'emoji' && i.value) return `<div class="ic emoji" ${bg ? `style="background:${bg}"` : ''}>${esc(i.value)}</div>`;
  return `<div class="ic" style="background:${bg}">${esc(initials(t.name))}</div>`;
}
function tileHtml(t) {
  const st = S.status[t.id];
  const inner = `${t.private ? `<span class="lk" title="Privée">${ic('lock')}</span>` : ''}${st === null || st === undefined ? '' : `<span class="st ${st ? 'ok' : 'ko'}" title="${st ? 'En ligne' : 'Ne répond pas'}"></span>`}${tileIcon(t)}<div class="nm">${esc(t.name)}</div>`;
  return S.editing
    ? `<button class="tile" data-act="editTile" data-id="${esc(t.id)}">${inner}</button>`
    : `<a class="tile" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
}

function render() {
  const h = S.hub;
  if (!h) { $('#app').innerHTML = '<div class="empty">Chargement…</div>'; return; }
  document.title = h.title || 'Hub';
  const q = S.q.trim().toLowerCase();
  const tiles = h.tiles.filter(t => !q || t.name.toLowerCase().includes(q) || (t.url || '').toLowerCase().includes(q));
  const up = Object.values(S.status).filter(v => v === true).length;
  const sections = h.sections.map(s => {
    const list = tiles.filter(t => t.section === s.id);
    if (!list.length && !S.editing) return '';
    return `<section class="section"><div class="section-head"><h2>${esc(s.name)}</h2>${S.editing ? `<button class="sec-edit" data-act="editSection" data-id="${esc(s.id)}">${ic('edit')}Modifier</button>` : ''}</div>
      <div class="grid">${list.map(tileHtml).join('')}${S.editing ? `<button class="tile add" data-act="newTile" data-section="${esc(s.id)}">${ic('plus')}<div class="nm">Ajouter</div></button>` : ''}</div></section>`;
  }).join('');
  const scroll = window.scrollY;
  $('#app').innerHTML = `<div class="wrap ${S.editing ? 'editing' : ''}">
    <header class="head">
      <div class="brand"><div class="logo">${ic('bolt')}</div><div><h1>${esc(h.title)}</h1>${h.subtitle ? `<small>${esc(h.subtitle)}</small>` : ''}</div></div>
      <div class="head-actions">
        ${up ? `<span class="online"><i></i>${up} en ligne</span>` : ''}
        ${h.unlocked && !S.editing ? `<button class="pill" data-act="edit">${ic('edit')}<span>Edit</span></button>` : ''}
        <button class="pill icon ${h.unlocked ? 'on' : ''}" data-act="lock" aria-label="${h.unlocked ? 'Verrouiller' : 'Déverrouiller'}" title="${h.unlocked ? 'Verrouiller les applis privées' : 'Déverrouiller les applis privées'}">${ic(h.unlocked ? 'unlock' : 'lock')}</button>
      </div>
    </header>
    ${S.editing ? `<div class="edit-bar"><span>Mode édition</span><div class="btns"><button class="btn small" data-act="settings">${ic('gear')}Hub</button><button class="btn small primary" data-act="done">Terminer</button></div></div>` : ''}
    <div class="search">${ic('search')}<input id="q" type="search" placeholder="Rechercher une appli…" value="${esc(S.q)}" autocomplete="off"></div>
    ${sections || `<div class="empty">${q ? 'Aucune appli ne correspond.' : 'Aucune appli pour l\'instant.'}</div>`}
    ${S.editing ? `<div class="section"><button class="btn block" data-act="newSection">${ic('plus')}Nouvelle section</button></div>` : ''}
    <div class="foot">${h.unlocked ? 'Applis privées visibles sur cet appareil' : 'Applis publiques'}</div>
  </div>`;
  const qi = $('#q');
  qi.addEventListener('input', () => { S.q = qi.value; const pos = qi.selectionStart; render(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); });
  window.scrollTo(0, scroll);
}

async function load() {
  try {
    S.hub = await backend.load();
    if (token && !S.hub.unlocked) { setToken(null); }
    if (!S.hub.admin) S.editing = false;
  } catch (e) { toast(e.message); }
  render();
  refreshStatus();
}
async function refreshStatus() { try { S.status = await backend.status(); render(); } catch {} }
setInterval(refreshStatus, 60_000);
async function persist() {
  try { S.hub = await backend.save(S.hub); render(); refreshStatus(); }
  catch (e) { toast(e.message); await load(); }
}

// ---------- Feuilles ----------
let closeSheet = () => {};
function sheet(title, body, onMount) {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="overlay"><div class="sheet" role="dialog" aria-modal="true"><div class="sheet-head"><h3>${esc(title)}</h3><button class="x" data-close aria-label="Fermer">${ic('x')}</button></div><div class="sheet-body">${body}</div></div></div>`;
  const ov = root.firstElementChild;
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); closeSheet = () => {}; };
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  closeSheet = close;
  onMount?.(ov, close);
}

function pinSheet() {
  let code = '';
  sheet('Applis privées', `<div class="pin"><p>Entre le code à 4 chiffres</p><div class="dots">${'<i></i>'.repeat(4)}</div><div class="err"></div>
    <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-d="${n}">${n}</button>`).join('')}<span></span><button data-d="0">0</button><button class="ghost" data-del aria-label="Effacer">${ic('back')}</button></div></div>`,
  (ov, close) => {
    const dots = [...ov.querySelectorAll('.dots i')], err = $('.err', ov);
    let busy = false;
    const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < code.length));
    const press = async (d) => {
      if (busy) return;
      if (d === 'del') code = code.slice(0, -1); else if (code.length < 4) code += d;
      paint();
      if (code.length === 4) {
        busy = true;
        try {
          const j = await backend.unlock(code);
          setToken(j.token); S.hub = j; close(); render(); refreshStatus(); toast('Applis privées déverrouillées');
        } catch (e) {
          err.textContent = e.message; $('.dots', ov).classList.remove('shake'); void ov.offsetWidth; $('.dots', ov).classList.add('shake');
          setTimeout(() => { code = ''; paint(); busy = false; }, 350);
        }
      }
    };
    ov.addEventListener('click', (e) => { const b = e.target.closest('[data-d],[data-del]'); if (b) press(b.dataset.d ?? 'del'); });
    const onKey = (e) => { if (/^\d$/.test(e.key)) press(e.key); if (e.key === 'Backspace') press('del'); };
    document.addEventListener('keydown', onKey);
    const old = closeSheet; closeSheet = () => { document.removeEventListener('keydown', onKey); old(); };
  });
}

function adminSheet() {
  sheet('Mode édition', `<form class="fields" id="af"><div class="field"><label>Mot de passe administrateur</label><input type="password" name="pw" autocomplete="current-password" required></div><div class="err" style="color:var(--red);font-size:13.5px;min-height:18px"></div><button class="btn primary block">Déverrouiller l'édition</button><p style="font-size:12px;color:var(--text-3);margin:4px 0 0;line-height:1.4">Demandé une seule fois sur cet appareil. Le code à 4 chiffres ne suffit pas pour modifier le hub : comme la page est publique, ça évite qu'on change tes liens.</p></form>`,
  (ov, close) => {
    $('input', ov).focus();
    $('#af', ov).addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const j = await backend.admin(e.target.pw.value); setToken(j.token); S.hub = j; S.editing = true; close(); render(); }
      catch (x) { $('.err', ov).textContent = x.message; }
    });
  });
}

// Formulaire de tuile
function tileSheet(tile, sectionId) {
  const isNew = !tile;
  const t = tile ? structuredClone(tile) : { id: uid(), name: '', url: 'https://', section: sectionId || S.hub.sections[0]?.id, private: false, color: '', check: '', icon: { type: 'auto', value: '' } };
  let delArmed = false;
  const draw = (ov) => {
    $('.sheet-body', ov).innerHTML = `<div class="preview-tile"><div class="tile">${tileIcon({ ...t, name: t.name || 'Appli' })}<div class="nm">${esc(t.name || 'Appli')}</div></div></div>
    <div class="fields">
      <div class="field"><label>Nom</label><input data-k="name" value="${esc(t.name)}" placeholder="ex. Site de commandes" maxlength="40"></div>
      <div class="field"><label>Lien</label><input data-k="url" value="${esc(t.url)}" inputmode="url" autocapitalize="off" placeholder="https://commandes.xxxx.ts.net"><div class="help">L'adresse qui s'ouvre quand on touche la tuile.</div></div>
      <div class="field"><label>Section</label><select data-k="section">${S.hub.sections.map(s => `<option value="${esc(s.id)}" ${s.id === t.section ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div class="switch"><div><b>Appli privée</b><small>Visible seulement après le code à 4 chiffres</small></div><button class="toggle ${t.private ? 'on' : ''}" data-toggle aria-label="Privée"></button></div>
      <div class="field"><label>Icône</label><div class="seg">${[['auto', 'Initiales'], ['emoji', 'Emoji'], ['image', 'Image']].map(([v, l]) => `<button data-icon="${v}" class="${t.icon.type === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      ${t.icon.type === 'emoji' ? `<div class="field"><input data-emoji value="${esc(t.icon.value)}" placeholder="Colle un emoji, ex. 🛒" maxlength="8"></div>` : ''}
      ${t.icon.type === 'image' ? `<div class="field"><input type="file" accept="image/*" data-file><div class="help">Logo PNG, JPG ou SVG. Il est réduit automatiquement.</div></div>` : ''}
      ${t.icon.type !== 'image' ? `<div class="field"><label>Couleur</label><div class="colors"><button data-color="" class="${!t.color ? 'on' : ''}" style="background:conic-gradient(${COLORS.join(',')})" title="Automatique"></button>${COLORS.map(c => `<button data-color="${c}" class="${t.color === c ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div></div>` : ''}
      <div class="field"><label>Adresse de test (optionnel)</label><input data-k="check" value="${esc(t.check)}" autocapitalize="off" placeholder="Vide = teste le lien"><div class="help">Pour le voyant vert/rouge. Pour une appli privée, mets son adresse locale (ex. http://host.docker.internal:8123). Écris <b>off</b> pour ne pas afficher de voyant.</div></div>
      ${isNew ? '' : `<div class="move"><button class="btn small" data-move="-1">${ic('left')}Avant</button><button class="btn small" data-move="1">Après${ic('right')}</button></div>`}
    </div>
    <div class="actions">${isNew ? '' : `<button class="btn danger" data-del style="flex:0 0 auto">${ic('trash')}</button>`}<button class="btn primary" data-save>${isNew ? 'Ajouter' : 'Enregistrer'}</button></div>`;
  };
  sheet(isNew ? 'Nouvelle tuile' : 'Modifier la tuile', '', (ov, close) => {
    draw(ov);
    const sync = () => ov.querySelectorAll('[data-k]').forEach(el => { t[el.dataset.k] = el.value.trim(); });
    const prev = () => { const p = $('.preview-tile', ov); p.innerHTML = `<div class="tile">${tileIcon({ ...t, name: t.name || 'Appli' })}<div class="nm">${esc(t.name || 'Appli')}</div></div>`; };
    ov.addEventListener('input', (e) => { if (e.target.matches('[data-k]')) { sync(); prev(); } if (e.target.matches('[data-emoji]')) { t.icon.value = e.target.value.trim(); prev(); } });
    ov.addEventListener('change', async (e) => {
      if (e.target.matches('[data-k]')) sync();
      if (e.target.matches('[data-file]') && e.target.files[0]) {
        try { t.icon.value = await shrink(e.target.files[0]); prev(); } catch { toast('Image illisible'); }
      }
    });
    ov.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.matches('[data-toggle]')) { t.private = !t.private; b.classList.toggle('on', t.private); }
      if (b.dataset.icon) { sync(); t.icon = { type: b.dataset.icon, value: b.dataset.icon === t.icon.type ? t.icon.value : '' }; draw(ov); }
      if (b.dataset.color !== undefined) { sync(); t.color = b.dataset.color; draw(ov); }
      if (b.dataset.move) {
        const list = S.hub.tiles, i = list.findIndex(x => x.id === t.id);
        const same = list.map((x, k) => [x, k]).filter(([x]) => x.section === list[i].section).map(([, k]) => k);
        const pos = same.indexOf(i), j = same[pos + Number(b.dataset.move)];
        if (j === undefined) return toast('Déjà au bout');
        [list[i], list[j]] = [list[j], list[i]]; await persist(); toast('Déplacée');
      }
      if (b.matches('[data-del]')) {
        if (!delArmed) { delArmed = true; b.textContent = 'Confirmer'; b.style.flex = '1'; return; }
        S.hub.tiles = S.hub.tiles.filter(x => x.id !== t.id); close(); await persist(); toast('Tuile supprimée');
      }
      if (b.matches('[data-save]')) {
        sync();
        if (!t.name) return toast('Donne un nom à la tuile');
        if (!/^https?:\/\/.+/.test(t.url)) return toast('Le lien doit commencer par http:// ou https://');
        if (t.icon.type === 'image' && !t.icon.value) t.icon = { type: 'auto', value: '' };
        const i = S.hub.tiles.findIndex(x => x.id === t.id);
        if (i >= 0) S.hub.tiles[i] = t; else S.hub.tiles.push(t);
        close(); await persist(); toast(isNew ? 'Tuile ajoutée' : 'Enregistré');
      }
    });
  });
}

function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = 128, c = document.createElement('canvas');
      const r = Math.min(size / img.width, size / img.height, 1) || 1;
      c.width = Math.round((img.width || size) * r); c.height = Math.round((img.height || size) * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function sectionSheet(sec) {
  const isNew = !sec;
  const s = sec ? { ...sec } : { id: uid(), name: '' };
  const count = S.hub.tiles.filter(t => t.section === s.id).length;
  let delArmed = false;
  sheet(isNew ? 'Nouvelle section' : 'Modifier la section', `<div class="fields">
      <div class="field"><label>Nom</label><input data-name value="${esc(s.name)}" placeholder="ex. Maison, Réseau, Projets" maxlength="40"></div>
      ${isNew ? '' : `<div class="move"><button class="btn small" data-move="-1">${ic('up')}Monter</button><button class="btn small" data-move="1">${ic('down')}Descendre</button></div>`}
    </div>
    <div class="actions">${isNew ? '' : `<button class="btn danger" data-del style="flex:0 0 auto">${ic('trash')}</button>`}<button class="btn primary" data-save>${isNew ? 'Créer' : 'Enregistrer'}</button></div>`,
  (ov, close) => {
    $('[data-name]', ov).focus();
    ov.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.move) {
        const l = S.hub.sections, i = l.findIndex(x => x.id === s.id), j = i + Number(b.dataset.move);
        if (j < 0 || j >= l.length) return toast('Déjà au bout');
        [l[i], l[j]] = [l[j], l[i]]; await persist();
      }
      if (b.matches('[data-del]')) {
        if (S.hub.sections.length === 1) return toast('Il faut garder au moins une section');
        if (!delArmed) { delArmed = true; b.textContent = count ? `Supprimer avec ses ${count} tuile${count > 1 ? 's' : ''} ?` : 'Confirmer'; b.style.flex = '1'; return; }
        S.hub.sections = S.hub.sections.filter(x => x.id !== s.id); S.hub.tiles = S.hub.tiles.filter(t => t.section !== s.id);
        close(); await persist(); toast('Section supprimée');
      }
      if (b.matches('[data-save]')) {
        s.name = $('[data-name]', ov).value.trim();
        if (!s.name) return toast('Donne un nom à la section');
        const i = S.hub.sections.findIndex(x => x.id === s.id);
        if (i >= 0) S.hub.sections[i] = s; else S.hub.sections.push(s);
        close(); await persist();
      }
    });
  });
}

function settingsSheet() {
  sheet('Réglages du hub', `<div class="fields">
      <div class="field"><label>Titre</label><input data-k="title" value="${esc(S.hub.title)}" maxlength="40"></div>
      <div class="field"><label>Sous-titre</label><input data-k="subtitle" value="${esc(S.hub.subtitle)}" maxlength="40"></div>
      <p style="font-size:12.5px;color:var(--text-3);margin:0;line-height:1.5">Le code à 4 chiffres et le mot de passe d'édition se changent dans les variables Coolify (HUB_PIN, HUB_ADMIN_PASSWORD). Les appareils déjà déverrouillés devront alors retaper le nouveau code.</p>
    </div><div class="actions"><button class="btn primary" data-save>Enregistrer</button></div>`,
  (ov, close) => {
    $('[data-save]', ov).addEventListener('click', async () => {
      ov.querySelectorAll('[data-k]').forEach(el => { S.hub[el.dataset.k] = el.value.trim(); });
      close(); await persist(); toast('Enregistré');
    });
  });
}

// ---------- Actions ----------
const actions = {
  lock: () => {
    if (S.hub?.unlocked) { setToken(null); S.editing = false; load(); toast('Verrouillé'); }
    else pinSheet();
  },
  edit: () => { if (S.hub.admin) { S.editing = true; render(); } else adminSheet(); },
  done: () => { S.editing = false; render(); },
  settings: settingsSheet,
  newTile: (d) => tileSheet(null, d.section),
  editTile: (d) => tileSheet(S.hub.tiles.find(t => t.id === d.id)),
  newSection: () => sectionSheet(),
  editSection: (d) => sectionSheet(S.hub.sections.find(s => s.id === d.id)),
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  e.preventDefault();
  actions[el.dataset.act]?.(el.dataset);
});

load();
