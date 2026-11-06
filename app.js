/* Minha Horta — app de monitoramento de hortaliças e mudas
   Roda 100% no navegador (offline-first). Dados ficam no aparelho (IndexedDB)
   e podem ir para a nuvem (GitHub Gist) quando houver internet. */
'use strict';

const VERSAO = '1.0.0';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const DIA = 864e5;
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* =================== ARMAZENAMENTO =================== */
const idb = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('minha-horta', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { this._db = r.result; res(r.result); };
      r.onerror = () => rej(r.error);
    });
  },
  async get(k) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const q = db.transaction('kv').objectStore('kv').get(k);
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
  },
  async set(k, v) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(v, k);
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
  }
};

const estadoPadrao = () => ({
  versao: 1, plantios: [], leituras: [], culturasCustom: [], chat: [], wiki: {}, clima: null, atualizadoEm: null
});
let state = estadoPadrao();

const cfgPadrao = () => ({
  nome: '',
  local: null, // {nome, lat, lon}
  ia: { provedor: 'gemini', chave: '', modelo: '', baseUrl: '' },
  gist: { token: '', id: '', auto: true, ultimo: null, pendente: false },
  sensor: { url: '', intervalo: 0, plantioId: '' },
  tema: {}
});
let cfg = cfgPadrao();

function carregarCfg() {
  try { const c = JSON.parse(localStorage.getItem('horta-config') || '{}'); cfg = deepMerge(cfgPadrao(), c); } catch { cfg = cfgPadrao(); }
}
function salvarCfg() { try { localStorage.setItem('horta-config', JSON.stringify(cfg)); } catch {} }
function deepMerge(a, b) {
  for (const k in b) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') a[k] = deepMerge(a[k], b[k]);
    else a[k] = b[k];
  }
  return a;
}
async function carregarEstado() {
  try {
    const s = await idb.get('state');
    if (s) state = Object.assign(estadoPadrao(), s);
  } catch {
    try { const s = JSON.parse(localStorage.getItem('horta-state') || 'null'); if (s) state = Object.assign(estadoPadrao(), s); } catch {}
  }
}
let backupTimer = null;
async function salvar() {
  state.atualizadoEm = new Date().toISOString();
  try { await idb.set('state', state); }
  catch { try { localStorage.setItem('horta-state', JSON.stringify(state)); } catch { toast('⚠ Sem espaço para salvar. Faça um backup e apague fotos antigas.'); } }
  if (cfg.gist.token && cfg.gist.auto) {
    cfg.gist.pendente = true; salvarCfg();
    clearTimeout(backupTimer);
    backupTimer = setTimeout(() => { if (navigator.onLine) gistBackup(true).catch(() => {}); }, 20000);
  }
}

/* =================== UTILIDADES DE DATA =================== */
const pad = (n) => String(n).padStart(2, '0');
function paraInputLocal(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function inicioDia(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function diasDesde(iso, ref = new Date()) { return Math.round((inicioDia(ref) - inicioDia(new Date(iso))) / DIA); }
function fmtData(iso, hora = true) {
  const d = new Date(iso); if (isNaN(d)) return '—';
  const s = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
  return hora ? `${s} ${pad(d.getHours())}:${pad(d.getMinutes())}` : s;
}
function periodo(iso) { const hr = new Date(iso).getHours(); return hr < 12 ? 'manhã' : hr < 18 ? 'tarde' : 'noite'; }
function plural(n, s, p) { return `${n} ${n === 1 ? s : (p || s + 's')}`; }
function saudacao() { const hr = new Date().getHours(); return hr < 12 ? 'Bom dia' : hr < 18 ? 'Boa tarde' : 'Boa noite'; }

/* =================== CULTURAS / ANÁLISE =================== */
function todasCulturas() { return [...window.CATALOGO, ...state.culturasCustom]; }
function cultura(p) {
  return todasCulturas().find((c) => c.id === p.cultura) || {
    id: 'outro', nome: p.nome || 'Planta', e: '🌱', tipo: 'Outro', germ: [5, 14], alvo: 60, alvoLabel: 'colheita', rega: 1, luz: '—', temp: null, ph: null, umid: null, dica: ''
  };
}
function nomePlantio(p) { const c = cultura(p); return (p.nome || c.nome) + (p.variedade ? ` · ${p.variedade}` : ''); }
const ev = (p, tipo) => (p.eventos || []).filter((e) => e.tipo === tipo).sort((a, b) => new Date(a.data) - new Date(b.data));
function ultimaLeitura(pid, horas = 12) {
  const lim = Date.now() - horas * 3600e3;
  return state.leituras.filter((l) => (!pid || l.plantioId === pid) && new Date(l.data) >= lim).sort((a, b) => new Date(b.data) - new Date(a.data))[0];
}

function analisar(p) {
  const c = cultura(p);
  const dia = diasDesde(p.data);
  const precisaGerm = p.metodo !== 'muda';
  const germEv = ev(p, 'germinou')[0];
  const germinou = !precisaGerm || !!germEv;
  const germDia = germEv ? diasDesde(p.data, new Date(germEv.data)) : null;
  const regas = ev(p, 'rega');
  const ultRega = regas.length ? regas[regas.length - 1].data : p.data;
  const diasSemRega = diasDesde(ultRega);
  const regaFalta = c.rega - diasSemRega;
  const alvoFalta = c.alvo - dia;
  const progresso = Math.max(0, Math.min(100, Math.round((dia / c.alvo) * 100)));
  const ativo = (p.status || 'ativo') === 'ativo';
  const palavraGerm = p.metodo === 'estaca' ? 'enraizar' : 'germinar';

  let fase, chip;
  if (p.status === 'colhido') { fase = 'Finalizado'; chip = 'gray'; }
  else if (p.status === 'perdido') { fase = 'Perdido'; chip = 'bad'; }
  else if (!germinou) {
    if (dia > c.germ[1]) { fase = `Atrasado p/ ${palavraGerm}`; chip = 'bad'; }
    else if (dia >= c.germ[0]) { fase = `Janela p/ ${palavraGerm}`; chip = 'warn'; }
    else { fase = p.metodo === 'estaca' ? 'Enraizando' : 'Germinando'; chip = 'blue'; }
  } else if (alvoFalta <= 0) { fase = `Pronto: ${c.alvoLabel}`; chip = ''; }
  else if (alvoFalta <= 7) { fase = 'Quase pronto'; chip = ''; }
  else { fase = 'Crescendo'; chip = ''; }

  const acoes = [];
  if (ativo) {
    const nome = p.nome || c.nome;
    const leit = ultimaLeitura(p.id);
    // Rega
    let precisaRegar = regaFalta <= 0;
    let subRega = diasSemRega === 0 ? 'Última rega hoje' : `Última rega há ${plural(diasSemRega, 'dia')}`;
    if (leit && leit.umidadeSolo != null && c.umid && new Date(leit.data) > new Date(ultRega)) {
      if (leit.umidadeSolo >= c.umid[0]) { precisaRegar = false; }
      else { precisaRegar = true; subRega = `Sensor: solo com ${leit.umidadeSolo}% (ideal ${c.umid[0]}–${c.umid[1]}%)`; }
    }
    if (precisaRegar) acoes.push({ pri: 1, tipo: 'agua', e: '💧', titulo: `Regar ${nome}`, sub: subRega, pid: p.id, botao: 'rega' });
    // Germinação
    if (!germinou) {
      if (dia > c.germ[1]) acoes.push({ pri: 0, tipo: 'alta', e: '⏰', titulo: `${nome}: ${palavraGerm} está atrasado`, sub: `Esperado até o dia ${c.germ[1]} e já é o dia ${dia}. Confira umidade, profundidade e temperatura. Se brotou, marque.`, pid: p.id, botao: 'germinou' });
      else if (dia >= c.germ[0]) acoes.push({ pri: 2, tipo: 'media', e: '👀', titulo: `${nome}: olhe se já ${p.metodo === 'estaca' ? 'enraizou' : 'brotou'}`, sub: `Está na janela normal (dia ${c.germ[0]} a ${c.germ[1]}).`, pid: p.id, botao: 'germinou' });
      else acoes.push({ pri: 4, tipo: 'baixa', e: '🌰', titulo: `${nome}: deve ${palavraGerm} em ${c.germ[0] - dia}–${c.germ[1] - dia} dias`, sub: 'Mantenha o substrato úmido, sem encharcar.', pid: p.id });
    }
    // Meta
    if (germinou) {
      if (alvoFalta <= 0) acoes.push({ pri: 2, tipo: 'media', e: '🧺', titulo: `${nome}: pronto para ${c.alvoLabel}`, sub: `Referência: ~${c.alvo} dias. Hoje é o dia ${dia}.`, pid: p.id, botao: 'colheita' });
      else if (alvoFalta <= 7) acoes.push({ pri: 3, tipo: 'baixa', e: '📅', titulo: `${nome}: ${c.alvoLabel} em ~${plural(alvoFalta, 'dia')}`, sub: 'Vá observando o tamanho e a cor.', pid: p.id });
    }
    // Sensores fora da faixa
    if (leit) {
      if (leit.ph != null && c.ph && (leit.ph < c.ph[0] - 0.2 || leit.ph > c.ph[1] + 0.2))
        acoes.push({ pri: 0, tipo: 'alta', e: '🧪', titulo: `${nome}: pH ${leit.ph} fora do ideal`, sub: `Ideal ${c.ph[0]}–${c.ph[1]}. ${leit.ph < c.ph[0] ? 'Solo ácido: um pouco de calcário ou cinza ajuda.' : 'Solo alcalino: matéria orgânica (húmus) ajuda a baixar.'}`, pid: p.id });
      if (leit.temp != null && c.temp && (leit.temp > c.temp[1] + 2 || leit.temp < c.temp[0] - 2))
        acoes.push({ pri: 1, tipo: 'media', e: '🌡️', titulo: `${nome}: ${leit.temp}°C no ambiente`, sub: `Ideal ${c.temp[0]}–${c.temp[1]}°C. ${leit.temp > c.temp[1] ? 'Afaste do sol do meio-dia ou melhore a ventilação.' : 'Leve para perto da janela no período de sol.'}`, pid: p.id });
    }
    // Praga recente
    const praga = ev(p, 'praga').pop();
    if (praga && diasDesde(praga.data) <= 3) acoes.push({ pri: 1, tipo: 'media', e: '🐛', titulo: `${nome}: reveja a praga anotada`, sub: praga.nota || 'Confira folhas por baixo e caule.', pid: p.id });
  }
  return { c, dia, germinou, germDia, precisaGerm, regaFalta, diasSemRega, alvoFalta, progresso, fase, chip, acoes, ativo };
}

function acoesClima() {
  const cl = state.clima; if (!cl || !cl.dias || !cl.dias[0]) return [];
  const d = cl.dias[0]; const out = [];
  if (d.max >= 32) out.push({ pri: 1, tipo: 'media', e: '🔥', titulo: `Calor forte hoje (${Math.round(d.max)}°C)`, sub: 'Vasos perto da janela secam rápido: confira o solo no fim da tarde e proteja folhosas do sol do meio-dia.' });
  if (d.uv >= 9) out.push({ pri: 3, tipo: 'baixa', e: '🕶️', titulo: `Sol muito forte (UV ${Math.round(d.uv)})`, sub: 'Mudas recém-nascidas na janela podem queimar entre 11h e 15h.' });
  if (d.chuva >= 70) out.push({ pri: 3, tipo: 'baixa', e: '🌧️', titulo: `Chuva provável hoje (${d.chuva}%)`, sub: 'Dia escuro = menos luz. Se tiver luz de cultivo, deixe ligada mais tempo.' });
  if (cl.atual && cl.atual.umid < 40) out.push({ pri: 3, tipo: 'baixa', e: '💨', titulo: `Ar seco (${cl.atual.umid}% de umidade)`, sub: 'Borrife água em volta dos vasos (não nas folhas ao sol).' });
  return out;
}

/* =================== CLIMA (Open-Meteo, sem chave) =================== */
const WMO = (c) => c === 0 ? ['☀️', 'Céu limpo'] : c <= 2 ? ['⛅', 'Parcialmente nublado'] : c === 3 ? ['☁️', 'Nublado'] : c <= 48 ? ['🌫️', 'Neblina'] : c <= 57 ? ['🌦️', 'Garoa'] : c <= 67 ? ['🌧️', 'Chuva'] : c <= 77 ? ['❄️', 'Neve'] : c <= 82 ? ['🌦️', 'Pancadas de chuva'] : ['⛈️', 'Trovoadas'];
async function atualizarClima(forcar = false) {
  const loc = cfg.local; if (!loc) return null;
  const cl = state.clima;
  if (!navigator.onLine) return cl;
  if (!forcar && cl && cl.lat === loc.lat && Date.now() - cl.ts < 30 * 60e3) return cl;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,relative_humidity_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset&timezone=auto&forecast_days=7`;
  const r = await fetch(url); if (!r.ok) throw new Error('Clima indisponível');
  const j = await r.json();
  state.clima = {
    ts: Date.now(), lat: loc.lat, lon: loc.lon,
    atual: { temp: j.current.temperature_2m, umid: j.current.relative_humidity_2m, code: j.current.weather_code },
    dias: j.daily.time.map((t, i) => ({ data: t, max: j.daily.temperature_2m_max[i], min: j.daily.temperature_2m_min[i], chuva: j.daily.precipitation_probability_max[i] ?? 0, uv: j.daily.uv_index_max[i] ?? 0, code: j.daily.weather_code[i], nascer: j.daily.sunrise[i], por: j.daily.sunset[i] }))
  };
  await salvar();
  return state.clima;
}
async function buscarCidade(nome) {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(nome)}&count=6&language=pt&format=json`);
  const j = await r.json(); return j.results || [];
}

/* =================== WIKIPÉDIA (saber mais) =================== */
async function wikiResumo(termo) {
  const chave = norm(termo);
  if (state.wiki[chave]) return state.wiki[chave];
  if (!navigator.onLine) return null;
  const sum = async (t) => { const r = await fetch(`https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`); if (!r.ok) return null; const j = await r.json(); return j.type === 'disambiguation' ? null : j; };
  let j = await sum(termo);
  if (!j) {
    const r = await fetch(`https://pt.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(termo + ' planta')}&format=json&origin=*&srlimit=1`);
    const s = await r.json(); const t = s?.query?.search?.[0]?.title; if (t) j = await sum(t);
  }
  if (!j) return null;
  const out = { titulo: j.title, texto: j.extract, img: j.thumbnail?.source || '', url: j.content_urls?.mobile?.page || '' };
  state.wiki[chave] = out; salvar();
  return out;
}

/* =================== FOTOS =================== */
function comprimirFoto(file, max = 900, q = 0.72) {
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url); res(cv.toDataURL('image/jpeg', q));
    };
    img.onerror = rej; img.src = url;
  });
}

/* =================== UI BÁSICA =================== */
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), ms); }
function abrirModal(html, mount) { const m = $('#modal'); m.innerHTML = `<div class="sheet">${html}</div>`; m.hidden = false; mount && mount(m); }
function fecharModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') fecharModal(); });
function atualizarRede() { const n = $('#net'); const on = navigator.onLine; n.textContent = on ? 'online' : 'offline'; n.classList.toggle('off', !on); }
function baixar(nome, conteudo, tipo = 'application/json') { const b = new Blob([conteudo], { type: tipo }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nome; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }

function aplicarTema() {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(cfg.tema || {})) if (v) root.style.setProperty('--' + k, v);
  const meta = $('meta[name=theme-color]'); if (meta) meta.content = getComputedStyle(root).getPropertyValue('--primary').trim() || '#2f8f4e';
}

/* =================== VIEWS =================== */
function cardAcao(a) {
  const btns = { rega: 'Reguei ✓', germinou: 'Brotou ✓', colheita: 'Colhi ✓' };
  return `<div class="action ${a.tipo}">
    <div class="ico">${a.e}</div>
    <div class="txt"><b>${h(a.titulo)}</b><small>${h(a.sub || '')}</small></div>
    ${a.botao ? `<button class="btn sm soft" data-act="evento-rapido" data-pid="${a.pid}" data-tipo="${a.botao}">${btns[a.botao]}</button>` : a.pid ? `<a class="btn sm" href="#/p/${a.pid}">Ver</a>` : ''}
  </div>`;
}
function cardPlantio(p) {
  const a = analisar(p); const c = a.c;
  return `<a class="card plant" href="#/p/${p.id}">
    <div class="emoji">${p.foto ? `<img src="${p.foto}" alt="">` : c.e}</div>
    <div class="info">
      <b>${h(nomePlantio(p))}</b>
      <div class="row wrap small"><span class="chip ${a.chip}">${h(a.fase)}</span><span class="muted">Dia ${a.dia} · ${h(p.local || 'sem local')}</span></div>
      ${a.ativo ? `<div class="progress" title="${a.progresso}% até ${h(c.alvoLabel)}"><i style="width:${a.progresso}%"></i></div>` : ''}
    </div>
  </a>`;
}

function viewInicio() {
  const ativos = state.plantios.filter((p) => (p.status || 'ativo') === 'ativo');
  const todasAcoes = [...ativos.flatMap((p) => analisar(p).acoes), ...acoesClima()].sort((a, b) => a.pri - b.pri);
  const urgentes = todasAcoes.filter((a) => a.pri <= 2);
  const regas = todasAcoes.filter((a) => a.botao === 'rega').length;
  const comGerm = state.plantios.filter((p) => p.metodo !== 'muda');
  const germOk = comGerm.filter((p) => ev(p, 'germinou').length).length;
  const prox = ativos.map((p) => analisar(p)).filter((a) => a.germinou && a.alvoFalta > 0).sort((x, y) => x.alvoFalta - y.alvoFalta)[0];
  const cl = state.clima;

  let resumo;
  if (!ativos.length) resumo = 'Cadastre seu primeiro plantio para eu começar a acompanhar.';
  else if (!urgentes.length) resumo = 'Tudo em dia por hoje. 🌿';
  else resumo = [regas ? plural(regas, 'rega') : '', urgentes.length - regas > 0 ? plural(urgentes.length - regas, 'coisa', 'coisas') + ' para conferir' : ''].filter(Boolean).join(' e ') + ' hoje.';

  return `
  <section class="card hero">
    <p class="muted small" style="margin:0">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
    <h1>${saudacao()}${cfg.nome ? ', ' + h(cfg.nome) : ''}!</h1>
    <p style="margin:6px 0 0">${h(resumo)}</p>
    ${cl && cl.atual ? `<p class="muted small" style="margin:8px 0 0">${WMO(cl.atual.code)[0]} ${Math.round(cl.atual.temp)}°C agora em ${h(cfg.local?.nome || '')} · máx ${Math.round(cl.dias[0].max)}° · chuva ${cl.dias[0].chuva}%</p>` : `<p class="small" style="margin:8px 0 0"><a href="#/clima" style="color:#fff">☀️ Definir minha cidade para ver o clima</a></p>`}
  </section>

  <section class="tiles" style="margin-top:12px">
    <div class="tile"><b>${ativos.length}</b><span>plantios ativos</span></div>
    <div class="tile"><b>${comGerm.length ? Math.round((germOk / comGerm.length) * 100) + '%' : '—'}</b><span>germinação</span></div>
    <div class="tile"><b>${prox ? prox.alvoFalta + 'd' : '—'}</b><span>${prox ? 'p/ ' + h(prox.c.alvoLabel.split(' ')[0]) + ' (' + h(prox.c.nome.split(' ')[0]) + ')' : 'próxima meta'}</span></div>
  </section>

  ${todasAcoes.length ? `<section class="section"><h2>O que fazer hoje</h2><div class="card">${todasAcoes.slice(0, 8).map(cardAcao).join('')}</div></section>` : ''}

  <section class="section">
    <div class="row between" style="margin-bottom:10px"><h2>Seus plantios</h2><a href="#/plantios" class="small">ver todos</a></div>
    ${ativos.length ? ativos.slice(0, 6).map(cardPlantio).join('') : `<div class="card empty"><span class="e">🪴</span>Nenhum plantio ainda.<br><br><a class="btn primary" href="#/novo">Cadastrar primeiro plantio</a></div>`}
  </section>`;
}

let filtroPlantios = 'ativo';
function viewPlantios() {
  const lista = state.plantios
    .filter((p) => filtroPlantios === 'todos' || (filtroPlantios === 'ativo' ? (p.status || 'ativo') === 'ativo' : (p.status || 'ativo') !== 'ativo'))
    .sort((a, b) => new Date(b.data) - new Date(a.data));
  return {
    html: `
    <div class="row between"><h1>Plantios</h1><a class="btn primary sm" href="#/novo">+ Novo</a></div>
    <div class="seg" style="margin:14px 0">
      ${[['ativo', 'Ativos'], ['fim', 'Finalizados'], ['todos', 'Todos']].map(([k, l]) => `<button data-act="filtro" data-f="${k}" class="${filtroPlantios === k ? 'on' : ''}">${l}</button>`).join('')}
    </div>
    <input type="search" id="busca" placeholder="Buscar por nome, local, variedade…">
    <div id="lista" style="margin-top:12px">${lista.length ? lista.map(cardPlantio).join('') : `<div class="empty"><span class="e">🌾</span>Nada por aqui.</div>`}</div>`,
    mount() {
      $('#busca').addEventListener('input', (e) => {
        const q = norm(e.target.value);
        $('#lista').innerHTML = lista.filter((p) => norm([nomePlantio(p), p.local, p.recipiente, p.notas].join(' ')).includes(q)).map(cardPlantio).join('') || `<div class="empty">Nada encontrado.</div>`;
      });
    }
  };
}

function viewForm(id) {
  const ed = id ? state.plantios.find((p) => p.id === id) : null;
  const p = ed || { cultura: '', metodo: 'semente', data: paraInputLocal(), local: '', recipiente: 'Vaso', quantidade: '', substrato: '', notas: '', variedade: '', nome: '', sensorId: '' };
  const culturas = todasCulturas();
  return {
    html: `
    <h1>${ed ? 'Editar plantio' : 'Novo plantio'}</h1>
    <p class="muted">${ed ? 'Ajuste as informações.' : 'Conte o que você está plantando. Só a planta e a data são obrigatórias.'}</p>
    <form id="fPlantio" class="card" autocomplete="off">
      <span class="small muted" style="font-weight:600">1. O que você está plantando?</span>
      <div class="picker" style="margin-top:8px">
        ${culturas.map((c) => `<button type="button" class="pick ${p.cultura === c.id ? 'sel' : ''}" data-cult="${c.id}"><span class="e">${c.e}</span>${h(c.nome)}</button>`).join('')}
        <button type="button" class="pick ${p.cultura === 'outro' ? 'sel' : ''}" data-cult="outro"><span class="e">➕</span>Outra</button>
      </div>
      <input type="hidden" name="cultura" value="${h(p.cultura)}">
      <div id="boxOutro" ${p.cultura === 'outro' ? '' : 'hidden'}>
        <label class="field"><span>Nome da planta</span><input type="text" name="nome" value="${h(p.nome)}" placeholder="Ex.: Agrião"></label>
        <div class="grid2">
          <label class="field"><span>Germina em (dias, mín–máx)</span><input type="text" name="g" placeholder="5-10"></label>
          <label class="field"><span>Meta em (dias)</span><input type="number" name="alvo" placeholder="60"></label>
        </div>
        <label class="field"><span>Regar a cada (dias)</span><input type="number" name="rega" placeholder="1"></label>
        <p class="small muted">Não sabe? Deixe em branco — uso valores médios e você pode perguntar ao Assistente.</p>
      </div>
      <div id="dicaCult" class="small muted" style="margin-top:10px"></div>

      <label class="field"><span>Variedade (opcional)</span><input type="text" name="variedade" value="${h(p.variedade)}" placeholder="Ex.: Crespa, Americana, Roxa…"></label>

      <label class="field"><span>2. Como?</span></label>
      <div class="seg" id="segMetodo">
        ${[['semente', '🌰 Semente'], ['muda', '🪴 Muda'], ['estaca', '✂️ Estaca']].map(([k, l]) => `<button type="button" data-m="${k}" class="${p.metodo === k ? 'on' : ''}">${l}</button>`).join('')}
      </div>
      <input type="hidden" name="metodo" value="${h(p.metodo)}">

      <label class="field"><span>3. Quando? (data e horário aproximado)</span><input type="datetime-local" name="data" value="${h(p.data)}" required></label>
      <div class="quick">
        <button type="button" class="btn sm soft" data-q="agora">Agora</button>
        <button type="button" class="btn sm" data-q="manha">Hoje de manhã</button>
        <button type="button" class="btn sm" data-q="tarde">Hoje à tarde</button>
        <button type="button" class="btn sm" data-q="ontem">Ontem</button>
      </div>

      <label class="field"><span>4. Onde?</span><input type="text" name="local" list="locais" value="${h(p.local)}" placeholder="Ex.: Janela da cozinha"></label>
      <datalist id="locais">${[...new Set(['Janela da sala', 'Janela da cozinha', 'Varanda', 'Mini estufa', 'Quintal coberto', 'Bancada com luz de cultivo', ...state.plantios.map((x) => x.local).filter(Boolean)])].map((l) => `<option value="${h(l)}">`).join('')}</datalist>
      <div class="grid2">
        <label class="field"><span>Recipiente</span>
          <select name="recipiente">${['Vaso', 'Bandeja de mudas', 'Copinho', 'Garrafa PET', 'Jardineira', 'Canteiro', 'Hidroponia'].map((r) => `<option ${p.recipiente === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
        <label class="field"><span>Quantidade</span><input type="number" name="quantidade" min="0" value="${h(p.quantidade)}" placeholder="sementes/mudas"></label>
      </div>
      <label class="field"><span>Substrato / adubo</span><input type="text" name="substrato" value="${h(p.substrato)}" placeholder="Ex.: terra vegetal + húmus 2:1"></label>
      <label class="field"><span>Observações</span><textarea name="notas" placeholder="Origem da semente, profundidade, molho prévio…">${h(p.notas)}</textarea></label>
      <label class="field"><span>Foto (opcional)</span><input type="file" name="foto" accept="image/*" capture="environment"></label>
      <label class="field"><span>ID do sensor (para o futuro)</span><input type="text" name="sensorId" value="${h(p.sensorId)}" placeholder="Ex.: esp32-vaso1"></label>
      <div class="row" style="margin-top:18px">
        <a class="btn" href="${ed ? '#/p/' + ed.id : '#/'}">Cancelar</a>
        <button class="btn primary grow" type="submit">${ed ? 'Salvar alterações' : 'Salvar plantio'}</button>
      </div>
    </form>`,
    mount() {
      const f = $('#fPlantio');
      const mostraDica = () => {
        const id = f.cultura.value; const c = culturas.find((x) => x.id === id);
        $('#dicaCult').innerHTML = c ? `<b>${c.e} ${h(c.nome)}:</b> germina em ${c.germ[0]}–${c.germ[1]} dias · ${h(c.alvoLabel)} em ~${c.alvo} dias · regar a cada ${plural(c.rega, 'dia')} · luz ${h(c.luz)}.<br>💡 ${h(c.dica || '')}` : '';
      };
      mostraDica();
      $$('.pick', f).forEach((b) => b.onclick = () => {
        $$('.pick', f).forEach((x) => x.classList.remove('sel')); b.classList.add('sel');
        f.cultura.value = b.dataset.cult; $('#boxOutro').hidden = b.dataset.cult !== 'outro'; mostraDica();
      });
      $$('#segMetodo button').forEach((b) => b.onclick = () => { $$('#segMetodo button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); f.metodo.value = b.dataset.m; });
      $$('[data-q]', f).forEach((b) => b.onclick = () => {
        const d = new Date();
        if (b.dataset.q === 'manha') d.setHours(7, 0); if (b.dataset.q === 'tarde') d.setHours(16, 0);
        if (b.dataset.q === 'ontem') { d.setDate(d.getDate() - 1); d.setHours(8, 0); }
        f.data.value = paraInputLocal(d);
      });
      f.onsubmit = async (e) => {
        e.preventDefault();
        if (!f.cultura.value) { toast('Escolha a planta (ou "Outra").'); return; }
        if (f.cultura.value === 'outro' && !f.nome.value.trim()) { toast('Digite o nome da planta.'); return; }
        let culturaId = f.cultura.value;
        if (culturaId === 'outro') {
          const nome = f.nome.value.trim();
          let cc = state.culturasCustom.find((c) => norm(c.nome) === norm(nome));
          if (!cc) {
            const g = (f.g.value.match(/\d+/g) || []).map(Number);
            cc = { id: 'c-' + uid(), nome, e: '🌱', tipo: 'Personalizada', germ: [g[0] || 5, g[1] || g[0] || 14], alvo: Number(f.alvo.value) || 60, alvoLabel: 'colheita', rega: Number(f.rega.value) || 1, luz: '—', temp: null, ph: null, umid: null, dica: '' };
            state.culturasCustom.push(cc);
          }
          culturaId = cc.id;
        }
        const dados = {
          cultura: culturaId, nome: '', variedade: f.variedade.value.trim(), metodo: f.metodo.value, data: f.data.value,
          local: f.local.value.trim(), recipiente: f.recipiente.value, quantidade: f.quantidade.value, substrato: f.substrato.value.trim(),
          notas: f.notas.value.trim(), sensorId: f.sensorId.value.trim()
        };
        if (f.foto.files[0]) dados.foto = await comprimirFoto(f.foto.files[0]);
        let alvo;
        if (ed) { Object.assign(ed, dados); alvo = ed; }
        else { alvo = { id: uid(), status: 'ativo', eventos: [], criadoEm: new Date().toISOString(), ...dados }; state.plantios.push(alvo); }
        await salvar(); toast(ed ? 'Plantio atualizado ✓' : 'Plantio cadastrado 🌱'); location.hash = '#/p/' + alvo.id;
      };
    }
  };
}

function viewDetalhe(id) {
  const p = state.plantios.find((x) => x.id === id);
  if (!p) return `<div class="empty"><span class="e">🤷</span>Plantio não encontrado.<br><br><a href="#/plantios">Voltar</a></div>`;
  const a = analisar(p); const c = a.c;
  const eventos = [...(p.eventos || [])].sort((x, y) => new Date(y.data) - new Date(x.data));
  const leits = state.leituras.filter((l) => l.plantioId === p.id).sort((x, y) => new Date(y.data) - new Date(x.data));
  const l0 = leits[0];
  const regasN = ev(p, 'rega').length;
  const colheitas = ev(p, 'colheita');
  const germTxt = !a.precisaGerm ? 'muda (não se aplica)' : a.germDia != null ? `no dia ${a.germDia} ${a.germDia < c.germ[0] ? '(rápido! 🚀)' : a.germDia <= c.germ[1] ? '(no prazo ✓)' : '(demorou)'}` : 'ainda não';
  return {
    html: `
    <div class="row between"><a href="#/plantios" class="small">← Plantios</a>
      <div class="row"><a class="btn sm" href="#/editar/${p.id}">Editar</a></div></div>
    ${p.foto ? `<div class="photo-hero" style="margin-top:12px"><img src="${p.foto}" alt=""></div>` : ''}
    <section class="card" style="margin-top:12px">
      <div class="row"><span style="font-size:2.2rem">${c.e}</span>
        <div class="grow"><h1>${h(nomePlantio(p))}</h1><div class="row wrap small"><span class="chip ${a.chip}">${h(a.fase)}</span><span class="muted">${h(p.metodo)} · ${h(p.local || 'sem local')}</span></div></div></div>
      ${a.ativo ? `<div style="margin-top:14px"><div class="row between small"><span>Dia <b>${a.dia}</b></span><span class="muted">${a.alvoFalta > 0 ? `faltam ~${a.alvoFalta} dias p/ ${h(c.alvoLabel)}` : h(c.alvoLabel) + ' 🎉'}</span></div><div class="progress"><i style="width:${a.progresso}%"></i></div></div>` : ''}
      ${a.acoes.length ? `<div style="margin-top:14px">${a.acoes.map(cardAcao).join('')}</div>` : ''}
    </section>

    <section class="section"><h2>Registrar agora</h2>
      <div class="events-btns">${Object.entries(window.EVENTOS).map(([k, v]) => `<button data-act="novo-evento" data-pid="${p.id}" data-tipo="${k}"><span>${v.e}</span>${v.nome.split('/')[0]}</button>`).join('')}</div>
    </section>

    <section class="section"><h2>Resumo</h2>
      <div class="facts">
        <div class="fact"><small>Plantado em</small><b>${fmtData(p.data)} (${periodo(p.data)})</b></div>
        <div class="fact"><small>Germinou</small><b>${germTxt}</b></div>
        <div class="fact"><small>Regas registradas</small><b>${regasN} · última há ${plural(a.diasSemRega, 'dia')}</b></div>
        <div class="fact"><small>Colheitas</small><b>${colheitas.length}${colheitas.some((x) => x.valor) ? ' · ' + colheitas.reduce((s, x) => s + (Number(x.valor) || 0), 0) + ' g' : ''}</b></div>
        <div class="fact"><small>Rega ideal</small><b>a cada ${plural(c.rega, 'dia')}</b></div>
        <div class="fact"><small>Luz</small><b>${h(c.luz)}</b></div>
        <div class="fact"><small>Temperatura ideal</small><b>${c.temp ? `${c.temp[0]}–${c.temp[1]}°C` : '—'}</b></div>
        <div class="fact"><small>pH ideal</small><b>${c.ph ? `${c.ph[0]}–${c.ph[1]}` : '—'}</b></div>
        <div class="fact"><small>Recipiente</small><b>${h(p.recipiente || '—')}${p.quantidade ? ' · ' + h(p.quantidade) + ' un.' : ''}</b></div>
      </div>
      ${c.dica ? `<p class="small" style="margin-top:10px">💡 ${h(c.dica)}</p>` : ''}
      ${p.substrato ? `<p class="small muted">Substrato: ${h(p.substrato)}</p>` : ''}
      ${p.notas ? `<p class="small muted">Notas: ${h(p.notas)}</p>` : ''}
    </section>

    <section class="section"><h2>Sensores</h2>
      <div class="card">${l0 ? `<div class="row wrap small">
        ${l0.umidadeSolo != null ? `<span class="chip blue">💧 Solo ${l0.umidadeSolo}%</span>` : ''}
        ${l0.ph != null ? `<span class="chip">🧪 pH ${l0.ph}</span>` : ''}
        ${l0.temp != null ? `<span class="chip warn">🌡️ ${l0.temp}°C</span>` : ''}
        ${l0.umidadeAr != null ? `<span class="chip blue">💨 Ar ${l0.umidadeAr}%</span>` : ''}
        ${l0.luz != null ? `<span class="chip warn">☀️ Luz ${l0.luz}</span>` : ''}
        </div><p class="small muted" style="margin:8px 0 0">Última leitura: ${fmtData(l0.data)} (${l0.origem}) · ${leits.length} leituras</p>`
        : `<p class="small muted" style="margin:0">Sem leituras ainda. Quando os sensores chegarem, elas aparecem aqui — por enquanto você pode lançar à mão.</p>`}
        <button class="btn sm soft" style="margin-top:10px" data-act="leitura-manual" data-pid="${p.id}">+ Lançar leitura</button>
      </div>
    </section>

    <section class="section"><h2>Diário</h2>
      <div class="card">${eventos.length ? `<div class="timeline">${eventos.map((e) => `
        <div class="tl-item"><div class="row between"><b>${window.EVENTOS[e.tipo]?.e || '•'} ${h(window.EVENTOS[e.tipo]?.nome || e.tipo)}</b>
          <button class="tl-del" data-act="del-evento" data-pid="${p.id}" data-eid="${e.id}" title="Apagar">✕</button></div>
          <div class="small muted">${fmtData(e.data)} · dia ${diasDesde(p.data, new Date(e.data))}${e.valor ? ' · ' + h(e.valor) + (e.tipo === 'colheita' ? ' g' : e.tipo === 'rega' ? ' ml' : '') : ''}</div>
          ${e.nota ? `<div class="small">${h(e.nota)}</div>` : ''}${e.foto ? `<img src="${e.foto}" alt="">` : ''}</div>`).join('')}
        <div class="tl-item"><b>🌰 Plantio</b><div class="small muted">${fmtData(p.data)} · dia 0</div></div></div>`
        : `<p class="small muted" style="margin:0">Nada registrado ainda. Use os botões acima (rega, germinou, foto…).</p>`}
      </div>
    </section>

    <section class="section"><h2>Saber mais</h2>
      <div class="card" id="wikiBox"><button class="btn sm" data-act="wiki" data-termo="${h(c.nome.replace(/\s*\(.*\)/, ''))}">🔎 Buscar informações na internet</button></div>
      <a class="btn soft block" style="margin-top:10px" href="#/assistente?p=${p.id}">💬 Perguntar ao assistente sobre este plantio</a>
    </section>

    <section class="section"><h2>Situação</h2>
      <div class="seg">${[['ativo', 'Ativo'], ['colhido', 'Finalizado'], ['perdido', 'Perdido']].map(([k, l]) => `<button data-act="status" data-pid="${p.id}" data-s="${k}" class="${(p.status || 'ativo') === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <button class="btn danger block" style="margin-top:14px" data-act="del-plantio" data-pid="${p.id}">Apagar plantio</button>
    </section>`,
    mount() { const cached = state.wiki[norm(c.nome.replace(/\s*\(.*\)/, ''))]; if (cached) mostrarWiki(cached); }
  };
}
function mostrarWiki(w) {
  const box = $('#wikiBox'); if (!box) return;
  box.innerHTML = w ? `${w.img ? `<img class="wiki-img" src="${h(w.img)}" alt="">` : ''}<b>${h(w.titulo)}</b><p class="small">${h(w.texto)}</p>${w.url ? `<a class="small" href="${h(w.url)}" target="_blank" rel="noopener">Ler na Wikipédia ↗</a>` : ''}<div style="clear:both"></div>` : '<p class="small muted">Não encontrei nada. Tente o assistente.</p>';
}

function sheetEvento(pid, tipo) {
  const p = state.plantios.find((x) => x.id === pid); const E = window.EVENTOS[tipo];
  const rotuloValor = tipo === 'colheita' ? 'Quanto colheu (gramas)' : tipo === 'rega' ? 'Quantidade de água (ml, opcional)' : tipo === 'adubacao' ? 'Produto / dose' : null;
  abrirModal(`
    <h2>${E.e} ${E.nome}</h2><p class="muted small">${h(nomePlantio(p))}</p>
    <form id="fEv">
      <label class="field"><span>Quando</span><input type="datetime-local" name="data" value="${paraInputLocal()}" required></label>
      ${rotuloValor ? `<label class="field"><span>${rotuloValor}</span><input type="text" name="valor" inputmode="${tipo === 'adubacao' ? 'text' : 'decimal'}"></label>` : ''}
      <label class="field"><span>Anotação</span><textarea name="nota" placeholder="${tipo === 'praga' ? 'O que viu? Onde? (ex.: pulgão embaixo das folhas)' : 'Opcional'}"></textarea></label>
      <label class="field"><span>Foto</span><input type="file" name="foto" accept="image/*" capture="environment"></label>
      <div class="row" style="margin-top:16px"><button type="button" class="btn" data-act="fechar">Cancelar</button><button class="btn primary grow">Registrar</button></div>
    </form>`, (m) => {
    $('#fEv', m).onsubmit = async (e) => {
      e.preventDefault(); const f = e.target;
      const evt = { id: uid(), tipo, data: f.data.value, nota: f.nota.value.trim(), valor: f.valor ? f.valor.value.trim() : '' };
      if (f.foto.files[0]) evt.foto = await comprimirFoto(f.foto.files[0]);
      p.eventos.push(evt);
      if (tipo === 'perda') p.status = 'perdido';
      await salvar(); fecharModal(); toast(`${E.e} ${E.nome} ✓`); render();
    };
  });
}

function sheetLeitura(pid) {
  abrirModal(`
    <h2>📟 Lançar leitura</h2><p class="muted small">Do medidor, sensor ou estimativa. Deixe em branco o que não mediu.</p>
    <form id="fL">
      <label class="field"><span>Plantio</span><select name="pid"><option value="">(ambiente geral)</option>${state.plantios.filter((p) => (p.status || 'ativo') === 'ativo').map((p) => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${h(nomePlantio(p))}</option>`).join('')}</select></label>
      <div class="grid2">
        <label class="field"><span>Umidade do solo (%)</span><input type="number" step="any" name="umidadeSolo"></label>
        <label class="field"><span>pH</span><input type="number" step="0.1" name="ph"></label>
        <label class="field"><span>Temperatura (°C)</span><input type="number" step="0.1" name="temp"></label>
        <label class="field"><span>Umidade do ar (%)</span><input type="number" step="any" name="umidadeAr"></label>
      </div>
      <label class="field"><span>Luz (% ou lux)</span><input type="number" step="any" name="luz"></label>
      <div class="row" style="margin-top:16px"><button type="button" class="btn" data-act="fechar">Cancelar</button><button class="btn primary grow">Salvar</button></div>
    </form>`, (m) => {
    $('#fL', m).onsubmit = async (e) => {
      e.preventDefault(); const f = e.target; const num = (v) => v === '' ? null : Number(v);
      const l = { id: uid(), data: new Date().toISOString(), plantioId: f.pid.value, umidadeSolo: num(f.umidadeSolo.value), ph: num(f.ph.value), temp: num(f.temp.value), umidadeAr: num(f.umidadeAr.value), luz: num(f.luz.value), origem: 'manual' };
      if ([l.umidadeSolo, l.ph, l.temp, l.umidadeAr, l.luz].every((v) => v == null)) { toast('Preencha pelo menos um valor.'); return; }
      state.leituras.push(l); await salvar(); fecharModal(); toast('Leitura salva ✓'); render();
    };
  });
}

/* ---------- DADOS ---------- */
let modoDados = 'simples';
function estatisticas() {
  const porCult = {};
  for (const p of state.plantios) {
    const a = analisar(p); const k = a.c.id;
    const g = porCult[k] || (porCult[k] = { c: a.c, n: 0, ativos: 0, germDias: [], semGerm: 0, perdidos: 0, colheitas: 0, gramas: 0, diasColheita: [], regas: 0 });
    g.n++; if (a.ativo) g.ativos++;
    if (a.precisaGerm) { if (a.germDia != null) g.germDias.push(a.germDia); else if (a.dia > a.c.germ[1]) g.semGerm++; }
    if (p.status === 'perdido') g.perdidos++;
    const col = ev(p, 'colheita'); g.colheitas += col.length; g.gramas += col.reduce((s, x) => s + (Number(x.valor) || 0), 0);
    if (col[0]) g.diasColheita.push(diasDesde(p.data, new Date(col[0].data)));
    g.regas += ev(p, 'rega').length;
  }
  return Object.values(porCult);
}
const media = (arr) => arr.length ? Math.round((arr.reduce((s, x) => s + x, 0) / arr.length) * 10) / 10 : null;

function frasesCultura(g) {
  const c = g.c; const out = [];
  const mg = media(g.germDias);
  if (mg != null) {
    const veredito = mg < c.germ[0] ? 'mais rápido que a referência 🚀' : mg <= c.germ[1] ? 'dentro do esperado ✓' : 'mais lento que a referência — vale rever umidade/temperatura';
    out.push(`germinou em média em <b>${mg} dias</b> (ref. ${c.germ[0]}–${c.germ[1]}): ${veredito}`);
  } else out.push('ainda sem germinação registrada');
  if (g.semGerm) out.push(`<b>${plural(g.semGerm, 'plantio')}</b> passou do prazo sem germinar`);
  const mc = media(g.diasColheita);
  if (g.colheitas) out.push(`${plural(g.colheitas, 'colheita')}${g.gramas ? ` (${g.gramas} g)` : ''}${mc != null ? `, a 1ª em ~${mc} dias (ref. ${c.alvo})` : ''}`);
  if (g.perdidos) out.push(`${plural(g.perdidos, 'perda')}`);
  return out;
}

function svgBarras(grupos) {
  const linhas = grupos.filter((g) => g.germDias.length);
  if (!linhas.length) return '<p class="small muted">O gráfico aparece quando você marcar "Germinou" em algum plantio.</p>';
  const max = Math.max(...linhas.map((g) => Math.max(media(g.germDias), g.c.germ[1]))) * 1.1;
  const W = 320, L = 92, rowH = 34, H = linhas.length * rowH + 10; const esc = (v) => ((W - L - 30) * v) / max;
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Dias para germinar: real x referência">
    ${linhas.map((g, i) => { const y = i * rowH + 6; const m = media(g.germDias); return `
      <text x="0" y="${y + 15}" font-size="11" fill="var(--text)">${h(g.c.e + ' ' + g.c.nome.split(' ')[0])}</text>
      <rect x="${L + esc(g.c.germ[0])}" y="${y}" width="${Math.max(2, esc(g.c.germ[1] - g.c.germ[0]))}" height="22" rx="5" fill="var(--primary-soft)"/>
      <rect x="${L}" y="${y + 7}" width="${Math.max(2, esc(m))}" height="8" rx="4" fill="var(--primary)"/>
      <text x="${L + esc(m) + 5}" y="${y + 15}" font-size="10.5" fill="var(--muted)">${m}d</text>`; }).join('')}
  </svg><div class="legend"><span><i style="background:var(--primary)"></i>real (média)</span><span><i style="background:var(--primary-soft)"></i>faixa de referência</span></div></div>`;
}

function svgLinhas(leits, campos) {
  if (leits.length < 2) return '<p class="small muted">O gráfico aparece com 2 ou mais leituras de sensor.</p>';
  const W = 320, H = 140, P = 24; const t0 = new Date(leits[0].data).getTime(), t1 = new Date(leits[leits.length - 1].data).getTime() || t0 + 1;
  const vals = campos.flatMap(([k]) => leits.map((l) => l[k]).filter((v) => v != null)); if (!vals.length) return '';
  const mn = Math.min(...vals), mx = Math.max(...vals) || 1; const sx = (t) => P + ((W - 2 * P) * (t - t0)) / (t1 - t0 || 1); const sy = (v) => H - P - ((H - 2 * P) * (v - mn)) / (mx - mn || 1);
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}">
    <line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="var(--line)"/>
    <text x="2" y="${P}" font-size="9" fill="var(--muted)">${Math.round(mx)}</text><text x="2" y="${H - P}" font-size="9" fill="var(--muted)">${Math.round(mn)}</text>
    ${campos.map(([k, , cor]) => { const pts = leits.filter((l) => l[k] != null).map((l) => `${sx(new Date(l.data).getTime()).toFixed(1)},${sy(l[k]).toFixed(1)}`).join(' '); return pts ? `<polyline points="${pts}" fill="none" stroke="${cor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : ''; }).join('')}
  </svg><div class="legend">${campos.map(([, n, cor]) => `<span><i style="background:${cor}"></i>${n}</span>`).join('')}</div></div>`;
}

function viewDados() {
  const grupos = estatisticas();
  const total = state.plantios.length;
  const ativos = state.plantios.filter((p) => (p.status || 'ativo') === 'ativo').length;
  const comGerm = state.plantios.filter((p) => p.metodo !== 'muda');
  const germOk = comGerm.filter((p) => ev(p, 'germinou').length).length;
  const colheitas = state.plantios.reduce((s, p) => s + ev(p, 'colheita').length, 0);
  const seg = `<div class="seg" style="margin:14px 0">${[['simples', '⚡ Simples'], ['detalhado', '🔬 Detalhado']].map(([k, l]) => `<button data-act="modo-dados" data-m="${k}" class="${modoDados === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  if (!total) return `<h1>Dados</h1>${seg}<div class="card empty"><span class="e">📊</span>Seus dados aparecem aqui depois do primeiro plantio.</div>`;

  if (modoDados === 'simples') {
    const destaques = [];
    const rapidos = grupos.filter((g) => g.germDias.length).sort((a, b) => media(a.germDias) / a.c.germ[1] - media(b.germDias) / b.c.germ[1]);
    if (rapidos[0]) destaques.push(`🏆 Melhor desempenho na germinação: <b>${h(rapidos[0].c.nome)}</b>.`);
    const problemas = grupos.filter((g) => g.semGerm || g.perdidos);
    if (problemas.length) destaques.push(`⚠ Atenção com: <b>${problemas.map((g) => h(g.c.nome)).join(', ')}</b> (atraso ou perda).`);
    const regasTot = grupos.reduce((s, g) => s + g.regas, 0);
    if (regasTot) destaques.push(`💧 ${plural(regasTot, 'rega registrada', 'regas registradas')} no total.`);
    return `<h1>Dados</h1>${seg}
      <section class="tiles"><div class="tile"><b>${total}</b><span>plantios</span></div><div class="tile"><b>${ativos}</b><span>ativos</span></div>
      <div class="tile"><b>${comGerm.length ? Math.round((germOk / comGerm.length) * 100) + '%' : '—'}</b><span>germinaram</span></div><div class="tile"><b>${colheitas}</b><span>colheitas</span></div></section>
      ${destaques.length ? `<section class="section"><h2>Em resumo</h2><div class="card">${destaques.map((d) => `<div class="summary-line">${d}</div>`).join('')}</div></section>` : ''}
      <section class="section"><h2>Por cultura</h2><div class="card">${grupos.map((g) => `<div class="summary-line"><b>${g.c.e} ${h(g.c.nome)}</b> <span class="muted small">· ${plural(g.n, 'plantio')}</span><br><span class="small">${frasesCultura(g).map((f) => f.charAt(0).toUpperCase() + f.slice(1)).join('. ')}.</span></div>`).join('')}</div></section>
      <a class="btn soft block" style="margin-top:14px" href="#/assistente?q=analise">🤖 Pedir uma análise completa ao assistente</a>`;
  }

  const leits = [...state.leituras].sort((a, b) => new Date(a.data) - new Date(b.data)).slice(-80);
  return `<h1>Dados</h1>${seg}
    <section class="card"><h3>Dias para germinar — real × referência</h3><div style="margin-top:10px">${svgBarras(grupos)}</div></section>
    <section class="card"><h3>Sensores (últimas leituras)</h3><div style="margin-top:10px">${svgLinhas(leits, [['umidadeSolo', 'Umidade solo %', 'var(--info)'], ['temp', 'Temp °C', 'var(--accent)'], ['umidadeAr', 'Umidade ar %', 'var(--primary)']])}</div></section>
    <section class="section"><h2>Todos os plantios</h2><div class="card table-wrap"><table>
      <thead><tr><th>Planta</th><th>Plantio</th><th>Método</th><th>Local</th><th>Dia</th><th>Germinou</th><th>Regas</th><th>Colheitas</th><th>Situação</th></tr></thead>
      <tbody>${[...state.plantios].sort((a, b) => new Date(b.data) - new Date(a.data)).map((p) => { const a = analisar(p); return `<tr onclick="location.hash='#/p/${p.id}'" style="cursor:pointer">
        <td>${a.c.e} ${h(nomePlantio(p))}</td><td>${fmtData(p.data)}</td><td>${h(p.metodo)}</td><td>${h(p.local || '—')}</td><td>${a.dia}</td>
        <td>${a.germDia != null ? 'dia ' + a.germDia : a.precisaGerm ? '—' : 'muda'}</td><td>${ev(p, 'rega').length}</td><td>${ev(p, 'colheita').length}</td><td>${h(a.fase)}</td></tr>`; }).join('')}</tbody></table></div></section>
    <section class="section"><h2>Exportar</h2><div class="row wrap">
      <button class="btn" data-act="csv-plantios">📄 Plantios (CSV)</button><button class="btn" data-act="csv-eventos">📄 Diário (CSV)</button>
      <button class="btn" data-act="csv-leituras">📄 Leituras (CSV)</button><button class="btn" data-act="export-json">🗂️ Tudo (JSON)</button></div>
      <p class="small muted">CSV abre no Excel/Google Planilhas para seus comparativos.</p></section>`;
}
function csv(linhas) { return '﻿' + linhas.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n'); }

/* ---------- CLIMA ---------- */
function viewClima() {
  const cl = state.clima; const loc = cfg.local;
  const ativos = state.plantios.filter((p) => (p.status || 'ativo') === 'ativo');
  let dicas = acoesClima();
  if (cl && cl.dias) {
    const d = cl.dias[0];
    for (const p of ativos) { const c = cultura(p); if (c.temp && d.max > c.temp[1] + 2) dicas.push({ pri: 2, tipo: 'media', e: c.e, titulo: `${c.nome} prefere até ${c.temp[1]}°C`, sub: `Hoje vai a ${Math.round(d.max)}°C lá fora. Dentro de casa costuma ser mais ameno, mas evite sol direto à tarde.`, pid: p.id }); }
    const chuvaSem = cl.dias.filter((x) => x.chuva >= 60).length;
    dicas.push({ pri: 5, tipo: 'baixa', e: '📆', titulo: 'Semana', sub: `Máximas entre ${Math.round(Math.min(...cl.dias.map((x) => x.max)))}° e ${Math.round(Math.max(...cl.dias.map((x) => x.max)))}°C; ${chuvaSem ? plural(chuvaSem, 'dia') + ' com boa chance de chuva' : 'sem chuva forte prevista'}.` });
  }
  const seen = new Set(); dicas = dicas.filter((a) => !seen.has(a.titulo) && seen.add(a.titulo));
  return {
    html: `<h1>Clima</h1>
    <section class="card" style="margin-top:12px">
      <div class="row between"><div><b>${loc ? h(loc.nome) : 'Nenhuma cidade definida'}</b>${cl ? `<div class="small muted">Atualizado ${fmtData(new Date(cl.ts).toISOString())}${navigator.onLine ? '' : ' (offline: últimos dados salvos)'}</div>` : ''}</div>
      ${loc ? `<button class="btn sm" data-act="clima-atualizar">↻</button>` : ''}</div>
      <div class="row" style="margin-top:12px"><input type="search" id="cidade" placeholder="Buscar cidade…" class="grow"><button class="btn sm" id="btnCidade">Buscar</button></div>
      <button class="btn sm soft" style="margin-top:8px" id="btnGeo">📍 Usar minha localização</button>
      <div id="resCidade"></div>
    </section>
    ${cl && cl.atual ? `
    <section class="card"><div class="wx-now"><span style="font-size:2.6rem">${WMO(cl.atual.code)[0]}</span><div><div class="big">${Math.round(cl.atual.temp)}°C</div><div class="muted small">${WMO(cl.atual.code)[1]} · umidade ${cl.atual.umid}%</div></div></div>
      <div class="days" style="margin-top:14px">${cl.dias.map((d) => `<div><span>${new Date(d.data + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}</span><span style="font-size:1.2rem;display:block">${WMO(d.code)[0]}</span><b>${Math.round(d.max)}°</b><span class="muted">${Math.round(d.min)}°</span><span style="display:block;color:var(--info)">${d.chuva}%</span></div>`).join('')}</div>
      <p class="small muted" style="margin:10px 0 0">☀️ Sol: ${cl.dias[0].nascer?.slice(11)} às ${cl.dias[0].por?.slice(11)} · UV máx ${Math.round(cl.dias[0].uv)}</p></section>
    <section class="section"><h2>O que isso significa para a horta</h2><div class="card">${dicas.map(cardAcao).join('') || '<p class="small muted">Clima tranquilo hoje. 🌤️</p>'}</div>
    <p class="small muted">Lembrete: o clima é de fora de casa. Os sensores de ambiente vão mostrar o clima interno de verdade.</p></section>` : ''}`,
    mount() {
      const escolher = async (r) => { cfg.local = { nome: r.nome, lat: Number(r.lat.toFixed(4)), lon: Number(r.lon.toFixed(4)) }; salvarCfg(); toast('Local salvo. Buscando clima…'); try { await atualizarClima(true); } catch { toast('⚠ Não consegui baixar o clima agora.'); } render(); };
      $('#btnCidade').onclick = async () => {
        const q = $('#cidade').value.trim(); if (!q) return;
        if (!navigator.onLine) { toast('Precisa de internet para buscar.'); return; }
        const rs = await buscarCidade(q).catch(() => []);
        $('#resCidade').innerHTML = rs.length ? rs.map((r, i) => `<button class="btn sm" style="margin:8px 6px 0 0" data-i="${i}">${h(r.name)}${r.admin1 ? ', ' + h(r.admin1) : ''}</button>`).join('') : '<p class="small muted">Nada encontrado.</p>';
        $$('#resCidade [data-i]').forEach((b) => b.onclick = () => { const r = rs[b.dataset.i]; escolher({ nome: `${r.name}${r.admin1 ? ' - ' + r.admin1 : ''}`, lat: r.latitude, lon: r.longitude }); });
      };
      $('#btnGeo').onclick = () => {
        if (!navigator.geolocation) { toast('Localização não disponível.'); return; }
        navigator.geolocation.getCurrentPosition((pos) => escolher({ nome: 'Minha localização', lat: pos.coords.latitude, lon: pos.coords.longitude }), () => toast('Permissão de localização negada.'), { timeout: 10000 });
      };
    }
  };
}

/* ---------- ASSISTENTE (IA) ---------- */
const PROVEDORES = {
  gemini: { nome: 'Google Gemini (tem plano gratuito)', modelo: 'gemini-2.5-flash', link: 'https://aistudio.google.com/apikey' },
  anthropic: { nome: 'Claude (Anthropic)', modelo: 'claude-sonnet-5-5', link: 'https://console.anthropic.com/settings/keys' },
  openai: { nome: 'Compatível com OpenAI (OpenAI, OpenRouter, Groq…)', modelo: 'gpt-4o-mini', link: '' }
};
function contextoHorta(pidFoco) {
  const linhas = [`Data/hora: ${new Date().toLocaleString('pt-BR')}`];
  if (cfg.local) linhas.push(`Local: ${cfg.local.nome}`);
  const cl = state.clima;
  if (cl && cl.atual) linhas.push(`Clima externo agora: ${Math.round(cl.atual.temp)}°C, ${WMO(cl.atual.code)[1]}, umidade ${cl.atual.umid}%. Hoje: máx ${Math.round(cl.dias[0].max)}°C, mín ${Math.round(cl.dias[0].min)}°C, chuva ${cl.dias[0].chuva}%.`);
  linhas.push('Cultivo: pequeno quintal/ambiente dentro de casa, em vasos e bandejas.');
  const lista = pidFoco ? state.plantios.filter((p) => p.id === pidFoco) : state.plantios;
  linhas.push(pidFoco ? 'PLANTIO EM FOCO:' : `PLANTIOS (${lista.length}):`);
  for (const p of lista.slice(-40)) {
    const a = analisar(p);
    const evs = [...(p.eventos || [])].sort((x, y) => new Date(x.data) - new Date(y.data)).slice(-8).map((e) => `${fmtData(e.data, false)} ${window.EVENTOS[e.tipo]?.nome}${e.valor ? ' ' + e.valor : ''}${e.nota ? ' (' + e.nota + ')' : ''}`).join('; ');
    linhas.push(`- ${nomePlantio(p)} | ${p.metodo} | plantado ${fmtData(p.data)} | dia ${a.dia} | fase: ${a.fase} | germinou: ${a.germDia != null ? 'dia ' + a.germDia : a.precisaGerm ? 'não' : 'muda'} | local: ${p.local || '-'} | ${p.recipiente || ''} | substrato: ${p.substrato || '-'} | ref: germ ${a.c.germ.join('-')}d, meta ${a.c.alvo}d, rega a cada ${a.c.rega}d${p.notas ? ' | notas: ' + p.notas : ''}${evs ? ' | eventos: ' + evs : ''}`);
  }
  const leits = [...state.leituras].sort((a, b) => new Date(b.data) - new Date(a.data)).slice(0, 10);
  if (leits.length) linhas.push('ÚLTIMAS LEITURAS DE SENSOR: ' + leits.map((l) => `${fmtData(l.data)} ${l.plantioId ? '[' + nomePlantio(state.plantios.find((p) => p.id === l.plantioId) || {}) + ']' : ''} solo ${l.umidadeSolo ?? '-'}% pH ${l.ph ?? '-'} ${l.temp ?? '-'}°C ar ${l.umidadeAr ?? '-'}% luz ${l.luz ?? '-'}`).join(' / '));
  return linhas.join('\n');
}
const SISTEMA = `Você é o assistente de uma horta caseira (hortaliças e mudas em vasos, dentro de casa, no Brasil).
Responda sempre em português do Brasil, de forma direta e "mastigada":
1) comece com a resposta/conclusão em 1–2 frases;
2) depois, no máximo 5 tópicos curtos e práticos (use "- ");
3) se faltar um dado importante, diga qual registrar no app.
Use os dados da horta abaixo quando forem relevantes. Não invente registros que não existem.`;

async function chamarIA(mensagens, pidFoco) {
  const { provedor, chave, modelo, baseUrl } = cfg.ia;
  const sys = SISTEMA + '\n\n=== DADOS DA HORTA ===\n' + contextoHorta(pidFoco);
  const m = modelo || PROVEDORES[provedor].modelo;
  if (provedor === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(chave)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: mensagens.map((x) => ({ role: x.role === 'user' ? 'user' : 'model', parts: [{ text: x.text }] })) })
    });
    const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || 'Erro ' + r.status);
    return j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '(sem resposta)';
  }
  if (provedor === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: m, max_tokens: 1200, system: sys, messages: mensagens.map((x) => ({ role: x.role === 'user' ? 'user' : 'assistant', content: x.text })) })
    });
    const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || 'Erro ' + r.status);
    return j.content?.map((c) => c.text || '').join('') || '(sem resposta)';
  }
  const base = (baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const r = await fetch(base + '/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + chave },
    body: JSON.stringify({ model: m, messages: [{ role: 'system', content: sys }, ...mensagens.map((x) => ({ role: x.role === 'user' ? 'user' : 'assistant', content: x.text }))] })
  });
  const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || 'Erro ' + r.status);
  return j.choices?.[0]?.message?.content || '(sem resposta)';
}

function respostaOffline(pergunta, pidFoco) {
  const q = norm(pergunta);
  const alvoP = pidFoco ? state.plantios.find((p) => p.id === pidFoco) : null;
  const c = alvoP ? cultura(alvoP) : todasCulturas().find((x) => q.includes(norm(x.nome.replace(/\s*\(.*\)/, '')).split(' ')[0]));
  const out = [];
  if (/resum|como esta|situac|analis/.test(q) || (!c && !/rega|agua|germin|ph|praga|luz/.test(q))) {
    const ativos = state.plantios.filter((p) => (p.status || 'ativo') === 'ativo');
    const acoes = ativos.flatMap((p) => analisar(p).acoes).sort((a, b) => a.pri - b.pri);
    out.push(`**Resumo:** ${plural(ativos.length, 'plantio ativo', 'plantios ativos')}${acoes.length ? `, ${plural(acoes.filter((a) => a.pri <= 2).length, 'ponto', 'pontos')} de atenção hoje` : ', tudo em dia'}.`);
    acoes.slice(0, 5).forEach((a) => out.push(`- ${a.e} ${a.titulo}: ${a.sub}`));
  }
  if (c) {
    out.push(`**${c.e} ${c.nome}** — referência:`);
    if (/rega|agua|molh/.test(q) || !/germin|ph|praga|luz|colh/.test(q)) out.push(`- Rega: a cada ${plural(c.rega, 'dia')}; solo úmido, nunca encharcado${c.umid ? ` (sensor: ${c.umid[0]}–${c.umid[1]}%)` : ''}.`);
    if (/germin|brot|nasc/.test(q) || !/rega|ph|praga|luz|colh/.test(q)) out.push(`- Germinação: ${c.germ[0]}–${c.germ[1]} dias. Se passar disso, cheque profundidade (2–3× o tamanho da semente), umidade e temperatura${c.temp ? ` (ideal ${c.temp[0]}–${c.temp[1]}°C)` : ''}.`);
    if (/ph|acid|calcar/.test(q) && c.ph) out.push(`- pH ideal: ${c.ph[0]}–${c.ph[1]}.`);
    if (/luz|sol|lampada/.test(q)) out.push(`- Luz: ${c.luz} por dia.`);
    if (/colh|pronto/.test(q)) out.push(`- ${c.alvoLabel}: ~${c.alvo} dias após o plantio.`);
    if (c.dica) out.push(`- Dica: ${c.dica}`);
  }
  if (/praga|pulg|lagart|mosca|fung|mancha/.test(q)) out.push('- Pragas comuns em vaso: pulgão e mosca-branca (calda de sabão neutro: 1 colher de sopa em 1 L d\'água, borrifar no fim da tarde), lagartas (catar à mão), fungos (menos água nas folhas e mais ventilação). Registre uma foto no diário para comparar.');
  if (!out.length) out.push('Estou sem internet agora, então respondo só com a base local. Pergunte citando a planta (ex.: "quando regar a alface?") ou peça um "resumo da horta".');
  return out.join('\n');
}

function md(t) {
  const linhas = h(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split('\n');
  let html = '', lista = false;
  for (const l of linhas) {
    const m = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
    if (m) { if (!lista) { html += '<ul>'; lista = true; } html += `<li>${m[1]}</li>`; continue; }
    if (lista) { html += '</ul>'; lista = false; }
    if (l.trim()) html += `<p>${l.replace(/^#+\s*/, '')}</p>`;
  }
  return html + (lista ? '</ul>' : '');
}

let focoChat = '';
function viewAssistente(params) {
  focoChat = params.get('p') || '';
  const foco = focoChat ? state.plantios.find((p) => p.id === focoChat) : null;
  const temIA = !!cfg.ia.chave;
  const sugestoes = foco ? ['Está tudo normal com ele?', 'Quando devo regar?', 'Por que ainda não brotou?', 'Quando colher?'] : ['Resuma minha horta hoje', 'O que plantar agora?', 'Por que minha semente não germina?', 'Monte um calendário de rega'];
  return {
    html: `<div class="row between"><h1>Assistente</h1>${state.chat.length ? '<button class="btn sm" data-act="limpar-chat">Limpar</button>' : ''}</div>
    <p class="small muted">${temIA ? (navigator.onLine ? `🟢 IA conectada (${h(PROVEDORES[cfg.ia.provedor].nome.split(' (')[0])})` : '🟠 Sem internet — respondendo com a base local') : '⚪ Modo básico (base local). <a href="#/ia">Conectar uma IA</a> para respostas completas.'}${foco ? `<br>Falando sobre: <b>${h(nomePlantio(foco))}</b> · <a href="#/assistente">ver horta toda</a>` : ''}</p>
    <div class="chat" id="chat">${state.chat.length ? state.chat.map((m) => `<div class="msg ${m.role === 'user' ? 'user' : 'ai'}">${m.role === 'user' ? h(m.text) : md(m.text)}${m.tag ? `<span class="tag">${h(m.tag)}</span>` : ''}</div>`).join('') : `<div class="empty"><span class="e">🧑‍🌾</span>Pergunte qualquer coisa sobre o plantio.<br>Eu já conheço seus registros.</div>`}</div>
    <div class="suggestions" style="margin-top:12px">${sugestoes.map((s) => `<button class="btn sm" data-act="sugestao" data-t="${h(s)}">${h(s)}</button>`).join('')}</div>
    <form class="composer" id="fChat"><textarea name="t" rows="1" placeholder="Sua pergunta…"></textarea><button class="btn primary">Enviar</button></form>`,
    mount() {
      const f = $('#fChat');
      f.onsubmit = (e) => { e.preventDefault(); const t = f.t.value.trim(); if (t) { f.t.value = ''; enviarChat(t); } };
      f.t.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 700px)').matches) { e.preventDefault(); f.requestSubmit(); } });
      if (params.get('q') === 'analise' && !viewAssistente._feito) { viewAssistente._feito = true; history.replaceState(null, '', '#/assistente'); enviarChat('Analise todos os meus dados: compare as culturas, aponte o que está indo bem, o que está atrasado e o que devo mudar. Termine com 3 ações para esta semana.'); }
      window.scrollTo(0, document.body.scrollHeight);
    }
  };
}
let enviando = false;
async function enviarChat(texto) {
  if (enviando) return; enviando = true;
  state.chat.push({ role: 'user', text: texto }); render();
  const chat = $('#chat'); if (chat) { chat.insertAdjacentHTML('beforeend', '<div class="msg ai" id="pensando">🌱 pensando…</div>'); window.scrollTo(0, document.body.scrollHeight); }
  let resp, tag;
  try {
    if (cfg.ia.chave && navigator.onLine) { resp = await chamarIA(state.chat.slice(-12), focoChat); tag = 'IA'; }
    else { resp = respostaOffline(texto, focoChat); tag = 'base local (offline)'; }
  } catch (e) { resp = respostaOffline(texto, focoChat) + `\n\n⚠ A IA não respondeu (${e.message}). Mostrei a resposta da base local.`; tag = 'base local'; }
  state.chat.push({ role: 'ai', text: resp, tag });
  if (state.chat.length > 60) state.chat = state.chat.slice(-60);
  await salvar(); enviando = false;
  if (location.hash.startsWith('#/assistente')) render();
}

/* ---------- MAIS / CONFIG ---------- */
function viewMais() {
  const itens = [
    ['#/clima', '☀️', 'Clima', cfg.local ? cfg.local.nome : 'Definir cidade'],
    ['#/sensores', '📟', 'Sensores', cfg.sensor.url ? 'Conectado a ' + cfg.sensor.url : 'Umidade, pH, clima interno (futuro)'],
    ['#/backup', '☁️', 'Backup e nuvem', cfg.gist.token ? (cfg.gist.ultimo ? 'Último: ' + fmtData(new Date(cfg.gist.ultimo).toISOString()) : 'Configurado') : 'Exportar, importar, GitHub'],
    ['#/ia', '🤖', 'Inteligência artificial', cfg.ia.chave ? PROVEDORES[cfg.ia.provedor].nome.split(' (')[0] + ' conectada' : 'Conectar uma IA'],
    ['#/aparencia', '🎨', 'Aparência (Figma)', 'Cores, cantos, fonte, tokens'],
    ['#/sobre', '📲', 'Instalar no celular', 'E sobre o app']
  ];
  return `<h1>Mais</h1><div class="card menu" style="margin-top:14px">${itens.map(([href, e, t, s]) => `<a href="${href}"><span class="ico">${e}</span><span class="txt"><b>${t}</b><small>${h(s)}</small></span><span class="muted">›</span></a>`).join('')}</div>
  <label class="field"><span>Como posso te chamar?</span><input type="text" id="nomeUser" value="${h(cfg.nome)}" placeholder="Seu nome"></label>`;
}

function viewSensores() {
  const leits = [...state.leituras].sort((a, b) => new Date(b.data) - new Date(a.data));
  return {
    html: `<a href="#/mais" class="small">← Mais</a><h1 style="margin-top:8px">Sensores</h1>
    <p class="muted small">Por enquanto você lança as leituras à mão. Quando montar o ESP32 (umidade do solo, pH, temperatura/umidade do ar, luz), o app lê sozinho por um endereço na internet.</p>
    <button class="btn primary block" data-act="leitura-manual">+ Lançar leitura manual</button>
    <section class="card" style="margin-top:14px"><h3>Conexão automática (futuro)</h3>
      <label class="field"><span>Endereço (URL) que devolve as leituras em JSON</span><input type="url" id="sUrl" value="${h(cfg.sensor.url)}" placeholder="https://…/leituras.json"></label>
      <div class="grid2">
        <label class="field"><span>Ler a cada</span><select id="sInt">${[[0, 'Só manual'], [1, '1 minuto'], [5, '5 minutos'], [15, '15 minutos'], [60, '1 hora']].map(([v, l]) => `<option value="${v}" ${Number(cfg.sensor.intervalo) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Sensor está no plantio</span><select id="sPid"><option value="">(ambiente)</option>${state.plantios.filter((p) => (p.status || 'ativo') === 'ativo').map((p) => `<option value="${p.id}" ${cfg.sensor.plantioId === p.id ? 'selected' : ''}>${h(nomePlantio(p))}</option>`).join('')}</select></label>
      </div>
      <div class="row" style="margin-top:12px"><button class="btn" data-act="sensor-salvar">Salvar</button><button class="btn soft" data-act="sensor-ler">Ler agora</button></div>
      <details style="margin-top:12px"><summary class="small"><b>Formato esperado (para programar o ESP32)</b></summary>
      <pre class="small" style="white-space:pre-wrap;background:var(--bg);padding:10px;border-radius:10px">{
  "umidade_solo": 62,
  "ph": 6.4,
  "temperatura": 24.5,
  "umidade_ar": 70,
  "luz": 55,
  "sensor": "esp32-vaso1"
}</pre>
      <p class="small muted">Pode ser uma lista com vários sensores. Se "sensor" for igual ao "ID do sensor" de um plantio, a leitura vai para ele. Como o app fica em https (GitHub Pages), o navegador bloqueia ler direto um ESP32 em http na rede local; o caminho mais simples é o ESP32 enviar para um serviço na nuvem (ex.: Firebase, Supabase, Adafruit IO, ThingSpeak) e colocar aqui o link https de leitura. Vemos isso juntos quando chegar a hora.</p></details>
    </section>
    <section class="section"><h2>Últimas leituras</h2><div class="card table-wrap">${leits.length ? `<table><thead><tr><th>Quando</th><th>Plantio</th><th>Solo</th><th>pH</th><th>°C</th><th>Ar</th><th>Luz</th><th></th></tr></thead><tbody>${leits.slice(0, 40).map((l) => `<tr><td>${fmtData(l.data)}</td><td>${h(l.plantioId ? nomePlantio(state.plantios.find((p) => p.id === l.plantioId) || {}) : 'ambiente')}</td><td>${l.umidadeSolo ?? '—'}</td><td>${l.ph ?? '—'}</td><td>${l.temp ?? '—'}</td><td>${l.umidadeAr ?? '—'}</td><td>${l.luz ?? '—'}</td><td><button class="tl-del" data-act="del-leitura" data-id="${l.id}">✕</button></td></tr>`).join('')}</tbody></table>` : '<p class="small muted" style="margin:0">Nenhuma leitura ainda.</p>'}</div></section>`
  };
}
let sensorTimer = null;
function agendarSensor() {
  clearInterval(sensorTimer);
  if (cfg.sensor.url && Number(cfg.sensor.intervalo) > 0) sensorTimer = setInterval(() => lerSensor(true).catch(() => {}), Number(cfg.sensor.intervalo) * 60e3);
}
async function lerSensor(silencioso) {
  if (!cfg.sensor.url) throw new Error('Defina o endereço');
  const r = await fetch(cfg.sensor.url, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status);
  let j = await r.json(); if (!Array.isArray(j)) j = [j];
  const pick = (o, ...ks) => { for (const k of ks) if (o[k] != null && o[k] !== '') return Number(o[k]); return null; };
  let n = 0;
  for (const o of j) {
    const porId = o.sensor ? state.plantios.find((p) => p.sensorId && p.sensorId === o.sensor) : null;
    state.leituras.push({ id: uid(), data: o.data || new Date().toISOString(), plantioId: o.plantio || porId?.id || cfg.sensor.plantioId || '', umidadeSolo: pick(o, 'umidade_solo', 'umidadeSolo', 'soil', 'soil_moisture'), ph: pick(o, 'ph', 'pH'), temp: pick(o, 'temperatura', 'temp', 'temperature'), umidadeAr: pick(o, 'umidade_ar', 'umidadeAr', 'humidity'), luz: pick(o, 'luz', 'light', 'lux', 'ldr'), origem: 'sensor' });
    n++;
  }
  if (state.leituras.length > 3000) state.leituras = state.leituras.slice(-3000);
  await salvar(); if (!silencioso) toast(`📟 ${plural(n, 'leitura recebida', 'leituras recebidas')}`);
  if (['#/', '#/sensores', ''].includes(location.hash) || location.hash.startsWith('#/p/')) render();
}

function exportarDados() { return { app: 'minha-horta', versao: VERSAO, exportadoEm: new Date().toISOString(), state }; }
async function importarDados(obj) {
  const s = obj && obj.state; if (!s || !Array.isArray(s.plantios)) throw new Error('Arquivo não reconhecido');
  state = Object.assign(estadoPadrao(), s); await salvar();
}
const GIST_ARQ = 'minha-horta-backup.json';
async function gistBackup(silencioso) {
  const { token, id } = cfg.gist; if (!token) throw new Error('Configure o token do GitHub');
  const body = { description: 'Backup Minha Horta', public: false, files: { [GIST_ARQ]: { content: JSON.stringify(exportarDados()) } } };
  const r = await fetch(id ? `https://api.github.com/gists/${id}` : 'https://api.github.com/gists', { method: id ? 'PATCH' : 'POST', headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('GitHub respondeu ' + r.status + (r.status === 401 ? ' (token inválido)' : ''));
  const j = await r.json(); cfg.gist.id = j.id; cfg.gist.ultimo = Date.now(); cfg.gist.pendente = false; salvarCfg();
  if (!silencioso) toast('☁️ Backup feito na nuvem ✓');
}
async function gistRestaurar() {
  const { token } = cfg.gist; if (!token) throw new Error('Configure o token do GitHub');
  const H = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
  let id = cfg.gist.id;
  if (!id) { const r = await fetch('https://api.github.com/gists?per_page=100', { headers: H }); const l = await r.json(); id = (l.find?.((g) => g.files && g.files[GIST_ARQ]) || {}).id; }
  if (!id) throw new Error('Nenhum backup encontrado nessa conta');
  const r = await fetch(`https://api.github.com/gists/${id}`, { headers: H }); if (!r.ok) throw new Error('GitHub respondeu ' + r.status);
  const j = await r.json(); const f = j.files[GIST_ARQ]; if (!f) throw new Error('Arquivo de backup não encontrado');
  const txt = f.truncated ? await (await fetch(f.raw_url)).text() : f.content;
  await importarDados(JSON.parse(txt)); cfg.gist.id = id; salvarCfg();
}
function viewBackup() {
  const tam = new Blob([JSON.stringify(state)]).size;
  return `<a href="#/mais" class="small">← Mais</a><h1 style="margin-top:8px">Backup e nuvem</h1>
  <p class="muted small">Seus dados ficam salvos neste aparelho e funcionam sem internet (${(tam / 1024).toFixed(0)} KB hoje). Faça backup para não perder nada se trocar de celular.</p>
  <section class="card"><h3>Arquivo</h3><p class="small muted">Salve uma cópia no celular/Drive e restaure quando quiser.</p>
    <div class="row wrap"><button class="btn" data-act="export-json">⬇️ Baixar backup</button><label class="btn">⬆️ Restaurar arquivo<input type="file" id="impFile" accept="application/json,.json" hidden></label></div></section>
  <section class="card"><h3>Nuvem automática (GitHub)</h3>
    <p class="small muted">Usa um "Gist" secreto na sua conta do GitHub (a mesma onde o app vai ficar hospedado). Com internet, o backup é feito sozinho alguns segundos depois de cada mudança.</p>
    <label class="field"><span>Token do GitHub (permissão "gist")</span><input type="password" id="gTok" value="${h(cfg.gist.token)}" placeholder="ghp_… ou github_pat_…"></label>
    <label class="row small" style="margin-top:10px"><input type="checkbox" id="gAuto" ${cfg.gist.auto ? 'checked' : ''}> Backup automático</label>
    <p class="small muted">${cfg.gist.ultimo ? 'Último backup: ' + fmtData(new Date(cfg.gist.ultimo).toISOString()) : 'Nenhum backup na nuvem ainda.'}${cfg.gist.pendente ? ' · há mudanças esperando internet' : ''}</p>
    <div class="row wrap"><button class="btn" data-act="gist-salvar">Salvar token</button><button class="btn soft" data-act="gist-backup">☁️ Fazer backup agora</button><button class="btn" data-act="gist-restaurar">Restaurar da nuvem</button></div>
    <details style="margin-top:10px"><summary class="small"><b>Como criar o token</b></summary><ol class="small"><li>No GitHub: foto do perfil › <b>Settings</b> › <b>Developer settings</b> › <b>Personal access tokens</b> › <b>Tokens (classic)</b> › <b>Generate new token (classic)</b>.</li><li>Nome: "Minha Horta". Validade: o que preferir. Marque só a caixa <b>gist</b>.</li><li>Gere, copie e cole aqui. O token fica guardado só neste aparelho.</li></ol></details>
  </section>`;
}
function viewIA() {
  const p = cfg.ia;
  return {
    html: `<a href="#/mais" class="small">← Mais</a><h1 style="margin-top:8px">Inteligência artificial</h1>
    <p class="muted small">Sem IA o assistente responde com a base local (funciona offline). Com uma IA conectada, ele tira dúvidas livres e organiza/analisa seus dados. A chave fica guardada só neste aparelho e não vai no backup.</p>
    <section class="card">
      <label class="field"><span>Serviço</span><select id="iaProv">${Object.entries(PROVEDORES).map(([k, v]) => `<option value="${k}" ${p.provedor === k ? 'selected' : ''}>${v.nome}</option>`).join('')}</select></label>
      <label class="field"><span>Chave da API</span><input type="password" id="iaKey" value="${h(p.chave)}" placeholder="cole sua chave aqui"></label>
      <label class="field"><span>Modelo (opcional)</span><input type="text" id="iaModel" value="${h(p.modelo)}" placeholder="${h(PROVEDORES[p.provedor].modelo)}"></label>
      <label class="field" id="iaBaseBox" ${p.provedor === 'openai' ? '' : 'hidden'}><span>URL base (OpenAI-compatível)</span><input type="url" id="iaBase" value="${h(p.baseUrl)}" placeholder="https://api.openai.com/v1"></label>
      <p class="small" id="iaLink">${PROVEDORES[p.provedor].link ? `Pegar chave: <a href="${PROVEDORES[p.provedor].link}" target="_blank" rel="noopener">${PROVEDORES[p.provedor].link.replace('https://', '')}</a>` : ''}</p>
      <div class="row"><button class="btn primary" data-act="ia-salvar">Salvar</button><button class="btn soft" data-act="ia-testar">Testar</button>${p.chave ? '<button class="btn danger" data-act="ia-remover">Remover</button>' : ''}</div>
      <p class="small muted" id="iaRes"></p>
    </section>
    <p class="small muted">💡 Para começar sem custo, o Google Gemini tem uma cota gratuita: entre com sua conta Google no link acima e clique em "Create API key".</p>`,
    mount() { $('#iaProv').onchange = (e) => { const k = e.target.value; $('#iaBaseBox').hidden = k !== 'openai'; $('#iaModel').placeholder = PROVEDORES[k].modelo; $('#iaLink').innerHTML = PROVEDORES[k].link ? `Pegar chave: <a href="${PROVEDORES[k].link}" target="_blank" rel="noopener">${PROVEDORES[k].link.replace('https://', '')}</a>` : ''; }; }
  };
}

const TOKENS_EDITAVEIS = [['primary', 'Verde principal'], ['primary-strong', 'Verde escuro'], ['primary-soft', 'Verde claro'], ['bg', 'Fundo'], ['card', 'Cartões'], ['text', 'Texto'], ['muted', 'Texto secundário'], ['accent', 'Destaque'], ['danger', 'Alerta']];
function tokenAtual(k) { return (cfg.tema[k] || getComputedStyle(document.documentElement).getPropertyValue('--' + k)).trim(); }
function viewAparencia() {
  const raio = parseInt(tokenAtual('radius')) || 18;
  return {
    html: `<a href="#/mais" class="small">← Mais</a><h1 style="margin-top:8px">Aparência</h1>
    <p class="muted small">Os nomes abaixo são os mesmos "tokens" do arquivo styles.css. Crie variáveis com esses nomes no Figma para manter tudo igual.</p>
    <section class="card"><div class="grid2">${TOKENS_EDITAVEIS.map(([k, l]) => `<label class="row small"><input type="color" class="swatch" data-tok="${k}" value="${h(tokenAtual(k).slice(0, 7))}"><span>${l}<br><code class="muted">--${k}</code></span></label>`).join('')}</div>
      <label class="field"><span>Arredondamento: <b id="rv">${raio}px</b></span><input type="range" min="0" max="28" value="${raio}" id="raio" style="width:100%"></label>
      <label class="field"><span>Fonte</span><select id="fonte">${[['', 'Padrão do sistema'], ['"Inter", system-ui, sans-serif', 'Inter (se instalada)'], ['"Poppins", system-ui, sans-serif', 'Poppins (se instalada)'], ['Georgia, serif', 'Serifada'], ['ui-rounded, "SF Pro Rounded", system-ui, sans-serif', 'Arredondada']].map(([v, l]) => `<option value='${h(v)}' ${(cfg.tema.font || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="row wrap" style="margin-top:14px"><button class="btn" data-act="tema-reset">Restaurar padrão</button><button class="btn" data-act="tema-export">Exportar tokens (JSON)</button></div></section>
    <section class="card"><h3>Importar do Figma</h3><p class="small muted">Cole um JSON de tokens (ex.: exportado pelo plugin Tokens Studio ou Variables Export). Aceita <code>{"primary":"#2f8f4e"}</code> ou formato aninhado com <code>value</code>.</p>
      <textarea id="tokJson" placeholder='{"primary":"#2f8f4e","radius":"16px"}'></textarea><button class="btn soft" style="margin-top:8px" data-act="tema-import">Aplicar tokens</button></section>`,
    mount() {
      $$('[data-tok]').forEach((i) => i.oninput = () => { cfg.tema[i.dataset.tok] = i.value; aplicarTema(); salvarCfg(); });
      $('#raio').oninput = (e) => { cfg.tema.radius = e.target.value + 'px'; $('#rv').textContent = e.target.value + 'px'; aplicarTema(); salvarCfg(); };
      $('#fonte').onchange = (e) => { cfg.tema.font = e.target.value; if (!e.target.value) { delete cfg.tema.font; document.documentElement.style.removeProperty('--font'); } aplicarTema(); salvarCfg(); };
    }
  };
}
function achatarTokens(obj, out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v && typeof v === 'object') { if ('value' in v && typeof v.value !== 'object') out[k] = v.value; else if ('$value' in v) out[k] = v.$value; else achatarTokens(v, out); }
    else out[k] = v;
  }
  return out;
}
function viewSobre() {
  return `<a href="#/mais" class="small">← Mais</a><h1 style="margin-top:8px">Instalar no celular</h1>
  <section class="card"><h3>🤖 Android (Chrome)</h3><p class="small">Abra o endereço do app › menu <b>⋮</b> › <b>Instalar app</b> (ou "Adicionar à tela inicial"). Ele ganha ícone e abre em tela cheia, como app normal.</p></section>
  <section class="card"><h3>🍎 iPhone (Safari)</h3><p class="small">Abra o endereço no Safari › botão <b>Compartilhar</b> › <b>Adicionar à Tela de Início</b>.</p></section>
  <section class="card"><h3>Funciona sem internet?</h3><p class="small">Sim. Depois de aberto uma vez, o app fica guardado no aparelho. Cadastros, diário e dados funcionam offline; clima, IA, pesquisa e backup na nuvem esperam a internet voltar.</p></section>
  <p class="small muted center">Minha Horta v${VERSAO}</p>`;
}

/* =================== ROTEADOR =================== */
function render() {
  const [rota, qs] = (location.hash.slice(1) || '/').split('?');
  const partes = rota.split('/').filter(Boolean); const params = new URLSearchParams(qs || '');
  let r;
  switch (partes[0]) {
    case undefined: r = viewInicio(); break;
    case 'plantios': r = viewPlantios(); break;
    case 'novo': r = viewForm(); break;
    case 'editar': r = viewForm(partes[1]); break;
    case 'p': r = viewDetalhe(partes[1]); break;
    case 'dados': r = viewDados(); break;
    case 'assistente': r = viewAssistente(params); break;
    case 'clima': r = viewClima(); break;
    case 'mais': r = viewMais(); break;
    case 'sensores': r = viewSensores(); break;
    case 'backup': r = viewBackup(); break;
    case 'ia': r = viewIA(); break;
    case 'aparencia': r = viewAparencia(); break;
    case 'sobre': r = viewSobre(); break;
    default: r = viewInicio();
  }
  const view = $('#view');
  if (typeof r === 'string') view.innerHTML = r; else { view.innerHTML = r.html; r.mount && r.mount(); }
  const tab = { '': 'inicio', plantios: 'plantios', p: 'plantios', editar: 'plantios', novo: 'novo', dados: 'dados', assistente: 'assistente' }[partes[0] || ''];
  $$('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  // campos que salvam sozinhos
  const nomeU = $('#nomeUser'); if (nomeU) nomeU.onchange = () => { cfg.nome = nomeU.value.trim(); salvarCfg(); toast('Salvo ✓'); };
  const imp = $('#impFile'); if (imp) imp.onchange = async () => {
    const f = imp.files[0]; if (!f) return;
    try { const obj = JSON.parse(await f.text()); if (!confirm(`Restaurar backup com ${obj.state?.plantios?.length ?? 0} plantios? Os dados atuais serão substituídos.`)) return; await importarDados(obj); toast('Backup restaurado ✓'); location.hash = '#/'; render(); }
    catch (e) { toast('⚠ ' + e.message); }
  };
}

/* =================== AÇÕES (cliques) =================== */
const ACOES = {
  fechar: () => fecharModal(),
  filtro: (d) => { filtroPlantios = d.f; render(); },
  'modo-dados': (d) => { modoDados = d.m; render(); },
  'evento-rapido': async (d) => {
    const p = state.plantios.find((x) => x.id === d.pid); if (!p) return;
    p.eventos.push({ id: uid(), tipo: d.tipo, data: paraInputLocal(), nota: '', valor: '' });
    await salvar(); toast(`${window.EVENTOS[d.tipo].e} ${window.EVENTOS[d.tipo].nome} ✓ — ${nomePlantio(p)}`); render();
  },
  'novo-evento': (d) => sheetEvento(d.pid, d.tipo),
  'del-evento': async (d) => { const p = state.plantios.find((x) => x.id === d.pid); if (!p || !confirm('Apagar este registro?')) return; p.eventos = p.eventos.filter((e) => e.id !== d.eid); await salvar(); render(); },
  status: async (d) => { const p = state.plantios.find((x) => x.id === d.pid); p.status = d.s; await salvar(); toast('Situação atualizada'); render(); },
  'del-plantio': async (d) => { if (!confirm('Apagar este plantio e todo o diário dele? Não dá para desfazer.')) return; state.plantios = state.plantios.filter((p) => p.id !== d.pid); await salvar(); location.hash = '#/plantios'; },
  wiki: async (d) => { const box = $('#wikiBox'); box.innerHTML = '<p class="small muted">Buscando…</p>'; try { mostrarWiki(await wikiResumo(d.termo)); } catch { box.innerHTML = '<p class="small muted">Sem conexão agora. Tente quando estiver online.</p>'; } },
  'leitura-manual': (d) => sheetLeitura(d.pid || ''),
  'del-leitura': async (d) => { state.leituras = state.leituras.filter((l) => l.id !== d.id); await salvar(); render(); },
  'clima-atualizar': async () => { try { await atualizarClima(true); toast('Clima atualizado'); } catch { toast('⚠ Sem conexão com o serviço de clima'); } render(); },
  sugestao: (d) => enviarChat(d.t),
  'limpar-chat': async () => { state.chat = []; await salvar(); render(); },
  'csv-plantios': () => baixar('plantios.csv', csv([['id', 'planta', 'variedade', 'metodo', 'data_plantio', 'periodo', 'local', 'recipiente', 'quantidade', 'substrato', 'dias', 'germinou_dia', 'ref_germ_min', 'ref_germ_max', 'regas', 'colheitas', 'gramas', 'situacao', 'notas'],
    ...state.plantios.map((p) => { const a = analisar(p); const col = ev(p, 'colheita'); return [p.id, a.c.nome, p.variedade, p.metodo, p.data, periodo(p.data), p.local, p.recipiente, p.quantidade, p.substrato, a.dia, a.germDia ?? '', a.c.germ[0], a.c.germ[1], ev(p, 'rega').length, col.length, col.reduce((s, x) => s + (Number(x.valor) || 0), 0), a.fase, p.notas]; })]), 'text/csv'),
  'csv-eventos': () => baixar('diario.csv', csv([['plantio', 'tipo', 'data', 'dia_do_plantio', 'valor', 'nota'], ...state.plantios.flatMap((p) => (p.eventos || []).map((e) => [nomePlantio(p), window.EVENTOS[e.tipo]?.nome, e.data, diasDesde(p.data, new Date(e.data)), e.valor, e.nota]))]), 'text/csv'),
  'csv-leituras': () => baixar('leituras.csv', csv([['data', 'plantio', 'umidade_solo', 'ph', 'temperatura', 'umidade_ar', 'luz', 'origem'], ...state.leituras.map((l) => [l.data, l.plantioId ? nomePlantio(state.plantios.find((p) => p.id === l.plantioId) || {}) : 'ambiente', l.umidadeSolo, l.ph, l.temp, l.umidadeAr, l.luz, l.origem])]), 'text/csv'),
  'export-json': () => baixar(`minha-horta-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportarDados(), null, 1)),
  'sensor-salvar': () => { cfg.sensor.url = $('#sUrl').value.trim(); cfg.sensor.intervalo = Number($('#sInt').value); cfg.sensor.plantioId = $('#sPid').value; salvarCfg(); agendarSensor(); toast('Sensores salvos ✓'); },
  'sensor-ler': async () => { ACOES['sensor-salvar'](); try { await lerSensor(); } catch (e) { toast('⚠ ' + e.message); } },
  'gist-salvar': () => { cfg.gist.token = $('#gTok').value.trim(); cfg.gist.auto = $('#gAuto').checked; salvarCfg(); toast('Salvo ✓'); },
  'gist-backup': async () => { ACOES['gist-salvar'](); try { await gistBackup(); render(); } catch (e) { toast('⚠ ' + e.message); } },
  'gist-restaurar': async () => { ACOES['gist-salvar'](); if (!confirm('Substituir os dados deste aparelho pelo backup da nuvem?')) return; try { await gistRestaurar(); toast('Restaurado da nuvem ✓'); location.hash = '#/'; render(); } catch (e) { toast('⚠ ' + e.message); } },
  'ia-salvar': () => { cfg.ia = { provedor: $('#iaProv').value, chave: $('#iaKey').value.trim(), modelo: $('#iaModel').value.trim(), baseUrl: $('#iaBase').value.trim() }; salvarCfg(); toast('IA salva ✓'); render(); },
  'ia-testar': async () => {
    ACOES['ia-salvar'](); const res = $('#iaRes'); if (!cfg.ia.chave) { res.textContent = 'Cole uma chave primeiro.'; return; }
    res.textContent = 'Testando…';
    try { const t = await chamarIA([{ role: 'user', text: 'Responda só: "Conexão ok 🌱"' }]); res.textContent = '✅ ' + t.slice(0, 120); }
    catch (e) { res.textContent = '⚠ ' + e.message; }
  },
  'ia-remover': () => { cfg.ia.chave = ''; salvarCfg(); render(); },
  'tema-reset': () => { cfg.tema = {}; salvarCfg(); document.documentElement.removeAttribute('style'); aplicarTema(); render(); },
  'tema-export': () => { const t = {}; [...TOKENS_EDITAVEIS.map(([k]) => k), 'radius', 'font'].forEach((k) => t[k] = tokenAtual(k)); baixar('tokens-minha-horta.json', JSON.stringify(t, null, 2)); },
  'tema-import': () => {
    try {
      const flat = achatarTokens(JSON.parse($('#tokJson').value)); let n = 0;
      const validos = [...TOKENS_EDITAVEIS.map(([k]) => k), 'info', 'line', 'radius', 'font'];
      for (const [k0, v] of Object.entries(flat)) { const k = norm(k0).replace(/^--/, '').replace(/[\s_.]+/g, '-'); const alvo = validos.find((x) => k === x || k.endsWith('-' + x)); if (alvo) { cfg.tema[alvo] = alvo === 'radius' && /^\d+$/.test(String(v)) ? v + 'px' : String(v); n++; } }
      salvarCfg(); aplicarTema(); toast(n ? `🎨 ${n} tokens aplicados` : 'Nenhum token reconhecido'); render();
    } catch { toast('⚠ JSON inválido'); }
  }
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const f = ACOES[b.dataset.act]; if (f) { e.preventDefault(); f(b.dataset, b, e); }
});

/* =================== INÍCIO =================== */
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); viewAssistente._feito = false; render(); });
window.addEventListener('online', async () => {
  atualizarRede(); toast('🟢 Conectado — sincronizando');
  try { await atualizarClima(); } catch {}
  if (cfg.gist.pendente && cfg.gist.token && cfg.gist.auto) gistBackup(true).catch(() => {});
  render();
});
window.addEventListener('offline', () => { atualizarRede(); toast('🟠 Sem internet — tudo continua salvando no aparelho'); });

(async function iniciar() {
  carregarCfg(); aplicarTema(); atualizarRede();
  await carregarEstado();
  render();
  agendarSensor();
  if (cfg.local) atualizarClima().then(() => { if (!location.hash || location.hash === '#/' || location.hash.startsWith('#/clima')) render(); }).catch(() => {});
  if (navigator.onLine && cfg.gist.pendente && cfg.gist.token && cfg.gist.auto) gistBackup(true).catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
