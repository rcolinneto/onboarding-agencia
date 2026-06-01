'use strict';

const ETAPA_NOMES = {
  1:  'Aprovação',
  2:  'Grupo WhatsApp',
  3:  'Formulário',
  4:  'Contrato',
  5:  'Financeiro',
  6:  'Análise Estratégica',
  7:  'Coleta Complementar',
  8:  'Planejamento',
  9:  'Apresentação',
  10: 'Reunião de Alinhamento',
  11: 'Ativação',
  12: 'Coleta de Ativos',
  13: 'Estruturação',
};

const ETAPAS_COM_TEMPLATE = new Set([2, 3, 7]);

const PLATAFORMAS = [
  { key: 'instagram',  label: 'Instagram',              hint: 'usuário + senha ou acesso via Meta Business' },
  { key: 'facebook',   label: 'Facebook',               hint: 'acesso via Business Manager' },
  { key: 'site',       label: 'Site',                   hint: 'URL + acesso ao painel (WordPress, etc.)' },
  { key: 'analytics',  label: 'Google Analytics',       hint: 'acesso à conta GA4' },
  { key: 'search',     label: 'Google Search Console',  hint: 'acesso à propriedade' },
  { key: 'meta_ads',   label: 'Meta Ads',               hint: 'Business Manager / conta de anúncios' },
  { key: 'google_ads', label: 'Google Ads',             hint: 'ID da conta Google Ads' },
  { key: 'youtube',    label: 'YouTube',                hint: 'acesso via conta Google' },
  { key: 'tiktok',     label: 'TikTok',                 hint: 'usuário + senha ou Business Center' },
  { key: 'email',      label: 'Email de contato',       hint: 'endereço e credenciais de acesso' },
  { key: 'outros',     label: 'Outros',                 hint: 'outros acessos relevantes' },
];

// ── State ─────────────────────────────────────────────
let clientes      = [];
let clienteAtual  = null;
let etapas        = [];
const debounceMap = {};
let ultimoDiag    = '';
let acessosState  = {};

// ── Boot ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  carregarClientes();
  document.getElementById('form-novo-cliente').addEventListener('submit', submitNovoCliente);
  document.getElementById('overlay').addEventListener('click', (e) => {
    if (e.target.id === 'overlay') fecharModal();
  });
});

// ── API wrapper ───────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Clientes ──────────────────────────────────────────
async function carregarClientes() {
  try {
    const data = await api('GET', '/api/clientes');
    clientes = data.clientes || [];
    renderListaClientes();
  } catch {
    document.getElementById('lista-clientes').innerHTML =
      '<p class="sidebar-empty">Erro ao carregar</p>';
  }
}

function renderListaClientes() {
  const el = document.getElementById('lista-clientes');
  if (!clientes.length) {
    el.innerHTML = '<p class="sidebar-empty">Nenhum cliente ainda</p>';
    return;
  }
  el.innerHTML = clientes.map((c) => {
    const { concluidas, total } = c.progresso;
    const ok = concluidas === total;
    return `
      <div class="cliente-item ${clienteAtual?.id === c.id ? 'ativo' : ''}"
           onclick="selecionarCliente('${esc(c.id)}')">
        <span class="cliente-nome">${esc(c.nome)}</span>
        <span class="badge ${ok ? 'completo' : ''}">${concluidas}/${total}</span>
      </div>`;
  }).join('');
}

async function selecionarCliente(id) {
  // Cancel pending obs saves from previous client
  Object.values(debounceMap).forEach(clearTimeout);
  Object.keys(debounceMap).forEach((k) => delete debounceMap[k]);

  clienteAtual = clientes.find((c) => c.id === id) || null;
  if (!clienteAtual) return;
  etapas = [];

  renderListaClientes();
  renderChecklist();      // skeleton while loading

  try {
    const data = await api('GET', `/api/clientes/${id}/etapas`);
    etapas = data.etapas || [];
  } catch (err) {
    showToast('Erro ao carregar etapas: ' + err.message, 'error');
  }
  renderChecklist();
}

// ── Novo cliente ──────────────────────────────────────
function abrirModalCliente() {
  document.getElementById('input-nome').value = '';
  document.getElementById('input-responsavel').value = '';
  abrirModal('modal-cliente');
}

async function submitNovoCliente(e) {
  e.preventDefault();
  const nome        = document.getElementById('input-nome').value.trim();
  const responsavel = document.getElementById('input-responsavel').value.trim();
  const btn         = document.getElementById('btn-criar');
  btn.disabled = true;
  btn.textContent  = 'Criando...';
  try {
    const data = await api('POST', '/api/clientes', { nome, responsavel });
    fecharModal();
    await carregarClientes();
    selecionarCliente(data.cliente.id);
    showToast('Cliente criado com sucesso!');
  } catch (err) {
    showToast('Erro ao criar cliente: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Criar cliente';
  }
}

// ── Checklist render ──────────────────────────────────
function renderChecklist() {
  const area = document.getElementById('area-principal');
  if (!clienteAtual) {
    area.className = 'area-vazia';
    area.innerHTML = `
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <path d="M9 12l2 2 4-4"/>
      </svg>
      <p style="font-size:.9rem">Selecione um cliente para ver o checklist</p>`;
    return;
  }

  const { concluidas, total } = clienteAtual.progresso;
  const pct      = Math.round((concluidas / total) * 100);
  const cor      = corProgresso(clienteAtual.dataInicio);
  const diasUtil = diasUteisDecorridos(clienteAtual.dataInicio);

  area.className = 'checklist-wrap';
  area.innerHTML = `
    <div class="cl-header">
      <h2>${esc(clienteAtual.nome)}</h2>
      <div class="cl-meta">
        <span>👤 ${esc(clienteAtual.responsavel)}</span>
        <span>📅 Início: ${fmtData(clienteAtual.dataInicio)}</span>
      </div>
    </div>

    <div class="progresso-card">
      <div class="prog-top">
        <span class="prog-label">Progresso do onboarding</span>
        <span class="prog-valor">${concluidas} de ${total} etapas — ${pct}%</span>
      </div>
      <div class="prog-track">
        <div class="prog-fill ${cor}" style="width:${pct}%"></div>
      </div>
      <span class="prazo-pill ${cor}">${prazoLabel(diasUtil)}</span>
    </div>

    <div class="etapas-lista" id="etapas-lista">
      ${etapas.length === 0
        ? '<p style="color:var(--muted);text-align:center;padding:2.5rem 0">Carregando etapas...</p>'
        : etapas.map(renderEtapa).join('')}
    </div>`;
}

function renderEtapa(etapa) {
  const { etapaNum, status, dataConclusao, observacao } = etapa;
  const nome      = ETAPA_NOMES[etapaNum] || `Etapa ${etapaNum}`;
  const concluida = status === 'concluida';

  return `
    <div class="etapa-row ${concluida ? 'concluida-row' : ''}" id="etapa-row-${etapaNum}">

      <div class="etapa-cb-col">
        <input type="checkbox" id="cb-${etapaNum}" ${concluida ? 'checked' : ''}
               onchange="toggleEtapa(${etapaNum}, this.checked)" />
        <span class="etapa-num">${etapaNum}</span>
      </div>

      <div class="etapa-info">
        <label class="etapa-nome ${concluida ? 'riscada' : ''}" for="cb-${etapaNum}">
          ${esc(nome)}
        </label>
        <textarea class="etapa-obs" id="obs-${etapaNum}"
          placeholder="Observações..."
          oninput="debounceSalvarObs(${etapaNum}, this.value)"
        >${esc(observacao || '')}</textarea>
      </div>

      <div class="etapa-acoes">
        ${concluida && dataConclusao
          ? `<span class="data-ok">✓ ${fmtData(dataConclusao)}</span>`
          : ''}
        ${ETAPAS_COM_TEMPLATE.has(etapaNum)
          ? `<button class="btn-sm btn-copy" id="btn-copy-${etapaNum}"
                     onclick="copiarTemplate(${etapaNum})">📋 Copiar msg</button>`
          : ''}
        ${etapaNum === 6
          ? `<button class="btn-sm btn-ia" onclick="abrirDiagnostico()">✨ Diagnóstico IA</button>`
          : ''}
        ${etapaNum === 9
          ? `<button class="btn-sm btn-apres" onclick="abrirApresentacao()">🎯 Apresentação</button>`
          : ''}
        ${etapaNum === 10
          ? `<button class="btn-sm btn-pauta" onclick="abrirPauta()">📋 Gerar pauta</button>`
          : ''}
        ${etapaNum === 12
          ? `<button class="btn-sm btn-acessos" onclick="abrirAcessos()">🔑 Gerenciar acessos</button>`
          : ''}
      </div>
    </div>`;
}

// ── Toggle etapa ──────────────────────────────────────
async function toggleEtapa(etapaNum, concluida) {
  const novoStatus = concluida ? 'concluida' : 'pendente';
  const obs = document.getElementById(`obs-${etapaNum}`)?.value || '';
  try {
    await api('PATCH', '/api/etapa', {
      clienteId: clienteAtual.id,
      etapaNum,
      status: novoStatus,
      obs,
    });
    // Refresh etapas + sidebar badge
    const [dataEtapas, dataClientes] = await Promise.all([
      api('GET', `/api/clientes/${clienteAtual.id}/etapas`),
      api('GET', '/api/clientes'),
    ]);
    etapas   = dataEtapas.etapas  || [];
    clientes = dataClientes.clientes || [];
    clienteAtual = clientes.find((c) => c.id === clienteAtual.id) || clienteAtual;
    renderListaClientes();
    renderChecklist();
  } catch (err) {
    showToast('Erro ao atualizar etapa: ' + err.message, 'error');
    const cb = document.getElementById(`cb-${etapaNum}`);
    if (cb) cb.checked = !concluida;
  }
}

// ── Obs autosave ──────────────────────────────────────
function debounceSalvarObs(etapaNum, valor) {
  clearTimeout(debounceMap[etapaNum]);
  debounceMap[etapaNum] = setTimeout(() => salvarObs(etapaNum, valor), 800);
}

async function salvarObs(etapaNum, obs) {
  const etapa = etapas.find((e) => e.etapaNum === etapaNum);
  if (!etapa) return;
  try {
    await api('PATCH', '/api/etapa', {
      clienteId: clienteAtual.id,
      etapaNum,
      status: etapa.status,
      obs,
    });
    // Update local state silently
    etapa.observacao = obs;
  } catch {
    showToast('Erro ao salvar observação', 'error');
  }
}

// ── Templates WhatsApp ────────────────────────────────
async function copiarTemplate(etapaNum) {
  const btn = document.getElementById(`btn-copy-${etapaNum}`);
  try {
    const data = await api('GET', `/api/templates/${etapaNum}`);
    const texto = data.template.replace(/\[nome\]/gi, clienteAtual.nome);
    await navigator.clipboard.writeText(texto);
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML  = '✓ Copiado!';
      btn.className  = 'btn-sm btn-copied';
      setTimeout(() => {
        btn.innerHTML = orig;
        btn.className = 'btn-sm btn-copy';
      }, 2000);
    }
  } catch (err) {
    showToast('Erro ao copiar template: ' + err.message, 'error');
  }
}

// ── Diagnóstico ───────────────────────────────────────
function abrirDiagnostico() {
  // Reconstrói o conteúdo do diag-form a cada abertura
  document.getElementById('diag-form').innerHTML = `
    <label for="input-form-sheet-id">ID da planilha de respostas do Forms</label>
    <div class="input-row">
      <input id="input-form-sheet-id" type="text"
        value="${esc(clienteAtual.formSheetId || '')}"
        placeholder="Cole o ID da planilha aqui (parte da URL entre /d/ e /edit)" />
      <button type="button" class="btn-carregar" id="btn-carregar-respostas"
              onclick="carregarRespostasForm()">
        📥 Carregar respostas
      </button>
    </div>

    <label for="diag-dados" style="margin-top:1rem">Dados e contexto</label>
    <textarea id="diag-dados" rows="7"
      placeholder="Cole aqui as respostas do formulário, informações sobre mercado-alvo, objetivos, concorrentes..."></textarea>

    <div class="modal-actions">
      <button type="button" class="btn-cancel" onclick="fecharModal()">Cancelar</button>
      <button type="button" class="btn-inline" id="btn-salvar-id"
              onclick="salvarFormSheet()">Salvar ID</button>
      <button type="button" class="btn-primary" id="btn-gerar"
              onclick="executarDiagnostico()">Gerar diagnóstico</button>
    </div>`;

  mostrarSecao('diag-form');
  abrirModal('modal-diag');
}

async function salvarFormSheet() {
  const formSheetId = document.getElementById('input-form-sheet-id').value.trim();
  if (!formSheetId) { showToast('Informe o ID da planilha', 'error'); return; }
  const btn = document.getElementById('btn-salvar-id');
  btn.disabled = true;
  btn.textContent = 'Salvando...';
  try {
    await api('PATCH', `/api/clientes/${clienteAtual.id}/formsheet`, { formSheetId });
    clienteAtual.formSheetId = formSheetId;
    const c = clientes.find((x) => x.id === clienteAtual.id);
    if (c) c.formSheetId = formSheetId;
    btn.textContent = '✓ Salvo';
    btn.className = 'btn-inline ok';
    setTimeout(() => {
      btn.textContent = 'Salvar ID';
      btn.className = 'btn-inline';
      btn.disabled = false;
    }, 2500);
  } catch (err) {
    showToast('Erro ao salvar: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Salvar ID';
  }
}

async function carregarRespostasForm() {
  const formSheetId = document.getElementById('input-form-sheet-id')?.value.trim();
  if (!formSheetId) {
    showToast('Informe o ID da planilha antes de carregar', 'error');
    return;
  }
  const btn = document.getElementById('btn-carregar-respostas');
  btn.disabled = true;
  btn.innerHTML = '⏳ Carregando...';
  try {
    const url = `/api/clientes/${clienteAtual.id}/respostas?formSheetId=${encodeURIComponent(formSheetId)}`;
    const data = await api('GET', url);
    document.getElementById('diag-dados').value = data.respostas;
    showToast('Respostas carregadas!');
  } catch (err) {
    showToast('Erro ao carregar respostas: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '📥 Carregar respostas';
  }
}

async function executarDiagnostico() {
  const dados = document.getElementById('diag-dados').value.trim();
  const btn   = document.getElementById('btn-gerar');
  btn.disabled = true;
  mostrarSecao('diag-loading');

  try {
    const etapasResumo = etapas.map((e) =>
      `Etapa ${e.etapaNum} (${ETAPA_NOMES[e.etapaNum]}): ${e.status}` +
      (e.observacao ? ` — ${e.observacao}` : '')
    ).join('\n');

    const dadosCompletos = [
      `Cliente: ${clienteAtual.nome}`,
      `Responsável: ${clienteAtual.responsavel}`,
      `Início do onboarding: ${clienteAtual.dataInicio}`,
      '',
      'Status das etapas:',
      etapasResumo,
      dados ? `\nInformações adicionais:\n${dados}` : '',
    ].filter(Boolean).join('\n');

    const res = await api('POST', '/api/diagnostico', {
      clienteId: clienteAtual.id,
      dados: dadosCompletos,
    });

    ultimoDiag = res.diagnostico;
    document.getElementById('diag-texto').innerHTML = renderMarkdown(res.diagnostico);
    mostrarSecao('diag-resultado');

    // Salva diagnóstico automaticamente na planilha
    try {
      await api('POST', `/api/clientes/${clienteAtual.id}/diagnostico`, { diagnostico: res.diagnostico });
    } catch { /* silencioso */ }
  } catch (err) {
    showToast('Erro ao gerar diagnóstico: ' + err.message, 'error');
    mostrarSecao('diag-form');
  } finally {
    btn.disabled = false;
  }
}

async function copiarDiagnostico() {
  if (!ultimoDiag) return;
  try {
    await navigator.clipboard.writeText(ultimoDiag);
    showToast('Diagnóstico copiado!');
  } catch {
    showToast('Não foi possível copiar', 'error');
  }
}

// ── Apresentação ──────────────────────────────────────
async function abrirApresentacao() {
  document.getElementById('apres-dados').value = '';
  document.getElementById('apres-logo').value  = '';
  document.getElementById('apres-cor-primaria').value   = '#2563eb';
  document.getElementById('apres-cor-secundaria').value = '#0f172a';
  document.getElementById('apres-diag-status').classList.add('hidden');
  document.getElementById('apres-form').classList.remove('hidden');
  document.getElementById('apres-loading').classList.add('hidden');
  abrirModal('modal-apres');

  // Tenta carregar diagnóstico salvo automaticamente
  try {
    const data = await api('GET', `/api/clientes/${clienteAtual.id}/diagnostico`);
    if (data.diagnostico) {
      document.getElementById('apres-dados').value = data.diagnostico;
      document.getElementById('apres-diag-status').classList.remove('hidden');
    }
  } catch { /* silencioso */ }
}

async function executarApresentacao() {
  const corPrimaria   = document.getElementById('apres-cor-primaria').value;
  const corSecundaria = document.getElementById('apres-cor-secundaria').value;
  const logo          = document.getElementById('apres-logo').value.trim();
  const dados         = document.getElementById('apres-dados').value.trim();
  const btn           = document.getElementById('btn-gerar-apres');

  // Abre a janela ANTES do await para não ser bloqueado como popup
  const win = window.open('about:blank', '_blank');

  btn.disabled = true;
  document.getElementById('apres-form').classList.add('hidden');
  document.getElementById('apres-loading').classList.remove('hidden');

  try {
    const etapasResumo = etapas.map((e) =>
      `Etapa ${e.etapaNum} (${ETAPA_NOMES[e.etapaNum]}): ${e.status}` +
      (e.observacao ? ` — ${e.observacao}` : '')
    ).join('\n');

    const dadosCompletos = [
      `Cliente: ${clienteAtual.nome}`,
      `Responsável: ${clienteAtual.responsavel}`,
      `Início: ${clienteAtual.dataInicio}`,
      '',
      'Status das etapas:',
      etapasResumo,
      dados ? `\nContexto adicional:\n${dados}` : '',
    ].filter(Boolean).join('\n');

    const res = await api('POST', '/api/apresentacao', {
      clienteId:    clienteAtual.id,
      dados:        dadosCompletos,
      corPrimaria,
      corSecundaria,
      logo,
    });

    localStorage.setItem('apresentacao_data', JSON.stringify(res));
    fecharModal();
    if (win && !win.closed) {
      win.location.href = '/apresentacao.html';
    } else {
      window.open('/apresentacao.html', '_blank');
    }
    showToast('Apresentação gerada!');
  } catch (err) {
    if (win && !win.closed) win.close();
    showToast('Erro ao gerar apresentação: ' + err.message, 'error');
    document.getElementById('apres-form').classList.remove('hidden');
    document.getElementById('apres-loading').classList.add('hidden');
  } finally {
    btn.disabled = false;
  }
}

// ── Acessos ───────────────────────────────────────────
async function abrirAcessos() {
  // Inicializa estado padrão
  acessosState = {};
  PLATAFORMAS.forEach((p) => { acessosState[p.key] = { status: 'pendente', obs: '' }; });

  abrirModal('modal-acessos');
  renderAcessos();

  // Carrega acessos salvos automaticamente
  try {
    const data = await api('GET', `/api/clientes/${clienteAtual.id}/acessos`);
    if (data.acessos && Object.keys(data.acessos).length) {
      PLATAFORMAS.forEach((p) => {
        if (data.acessos[p.key]) acessosState[p.key] = data.acessos[p.key];
      });
      renderAcessos();
    }
  } catch { /* silencioso */ }
}

function renderAcessos() {
  const recebidos = PLATAFORMAS.filter((p) => acessosState[p.key]?.status === 'recebido').length;
  const total     = PLATAFORMAS.length;
  const resumo    = document.getElementById('acessos-resumo');
  resumo.textContent = `${recebidos} de ${total} acessos recebidos`;
  resumo.className   = `acessos-resumo${recebidos === total ? ' completo' : ''}`;

  document.getElementById('acessos-lista').innerHTML = PLATAFORMAS.map((p) => {
    const s = acessosState[p.key] || { status: 'pendente', obs: '' };
    return `
      <div class="acesso-row acesso-${s.status}" id="acesso-row-${p.key}">
        <div class="acesso-header">
          <span class="acesso-label">${esc(p.label)}</span>
          <div class="status-btns">
            <button class="status-btn s-pendente ${s.status === 'pendente'   ? 'active' : ''}"
                    onclick="setAcessoStatus('${p.key}', 'pendente')">Pendente</button>
            <button class="status-btn s-recebido ${s.status === 'recebido'   ? 'active' : ''}"
                    onclick="setAcessoStatus('${p.key}', 'recebido')">✓ Recebido</button>
            <button class="status-btn s-nao ${s.status === 'nao_aplica' ? 'active' : ''}"
                    onclick="setAcessoStatus('${p.key}', 'nao_aplica')">N/A</button>
          </div>
        </div>
        <input class="acesso-obs" type="text"
               value="${esc(s.obs)}"
               placeholder="${esc(p.hint)}"
               oninput="setAcessoObs('${p.key}', this.value)" />
      </div>`;
  }).join('');
}

function setAcessoStatus(key, status) {
  acessosState[key] = { ...acessosState[key], status };

  const row = document.getElementById(`acesso-row-${key}`);
  if (row) {
    row.className = `acesso-row acesso-${status}`;
    row.querySelectorAll('.status-btn').forEach((b) => b.classList.remove('active'));
    const sel = status === 'nao_aplica' ? 's-nao' : `s-${status}`;
    row.querySelector(`.${sel}`)?.classList.add('active');
  }

  const recebidos = PLATAFORMAS.filter((p) => acessosState[p.key]?.status === 'recebido').length;
  const resumo    = document.getElementById('acessos-resumo');
  if (resumo) {
    resumo.textContent = `${recebidos} de ${PLATAFORMAS.length} acessos recebidos`;
    resumo.className   = `acessos-resumo${recebidos === PLATAFORMAS.length ? ' completo' : ''}`;
  }
}

function setAcessoObs(key, obs) {
  acessosState[key] = { ...acessosState[key], obs };
}

async function salvarAcessosModal() {
  const btn = document.getElementById('btn-salvar-acessos');
  btn.disabled = true;
  btn.textContent = 'Salvando...';
  try {
    await api('POST', `/api/clientes/${clienteAtual.id}/acessos`, { acessos: acessosState });
    showToast('Acessos salvos com sucesso!');
    fecharModal();
  } catch (err) {
    showToast('Erro ao salvar acessos: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

// ── Pauta ─────────────────────────────────────────────
let ultimaPauta = '';

async function abrirPauta() {
  document.getElementById('pauta-dados').value = '';
  document.getElementById('pauta-diag-status').classList.add('hidden');
  mostrarSecaoPauta('pauta-form');
  abrirModal('modal-pauta');

  // Tenta carregar diagnóstico salvo automaticamente
  try {
    const data = await api('GET', `/api/clientes/${clienteAtual.id}/diagnostico`);
    if (data.diagnostico) {
      document.getElementById('pauta-dados').value = data.diagnostico;
      document.getElementById('pauta-diag-status').classList.remove('hidden');
    }
  } catch { /* silencioso */ }
}

async function executarPauta() {
  const diagnostico = document.getElementById('pauta-dados').value.trim();
  const btn = document.getElementById('btn-gerar-pauta');
  btn.disabled = true;
  mostrarSecaoPauta('pauta-loading');

  try {
    const res = await api('POST', '/api/pauta', {
      clienteId: clienteAtual.id,
      diagnostico: diagnostico || undefined,
    });
    ultimaPauta = res.pauta;
    document.getElementById('pauta-texto').innerHTML = renderMarkdown(res.pauta);
    mostrarSecaoPauta('pauta-resultado');
  } catch (err) {
    showToast('Erro ao gerar pauta: ' + err.message, 'error');
    mostrarSecaoPauta('pauta-form');
  } finally {
    btn.disabled = false;
  }
}

async function copiarPauta() {
  if (!ultimaPauta) return;
  try {
    await navigator.clipboard.writeText(ultimaPauta);
    showToast('Pauta copiada!');
  } catch {
    showToast('Não foi possível copiar', 'error');
  }
}

function mostrarSecaoPauta(id) {
  ['pauta-form', 'pauta-loading', 'pauta-resultado'].forEach((s) => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}

// ── Markdown renderer ─────────────────────────────────
function renderMarkdown(text) {
  const lines = esc(text).split('\n');
  let html   = '';
  let inList = false;

  for (const line of lines) {
    if (line.startsWith('### ')) {
      closeList();  html += `<h3>${fmt(line.slice(4))}</h3>`;
    } else if (line.startsWith('## ')) {
      closeList();  html += `<h2>${fmt(line.slice(3))}</h2>`;
    } else if (line.startsWith('# ')) {
      closeList();  html += `<h1>${fmt(line.slice(2))}</h1>`;
    } else if (/^[-*] /.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${fmt(line.slice(2))}</li>`;
    } else if (line.trim() === '') {
      closeList();  html += '<br>';
    } else {
      closeList();  html += `<p>${fmt(line)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;

  function closeList() { if (inList) { html += '</ul>'; inList = false; } }
}

function fmt(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/`(.+?)`/g,       '<code>$1</code>');
}

// ── Modal helpers ─────────────────────────────────────
function abrirModal(id) {
  const overlay = document.getElementById('overlay');
  overlay.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden'));
  overlay.classList.remove('hidden');
  document.getElementById(id).classList.remove('hidden');
}

function fecharModal() {
  document.getElementById('overlay').classList.add('hidden');
}

function mostrarSecao(id) {
  ['diag-form', 'diag-loading', 'diag-resultado'].forEach((s) => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}

// ── Date / progress utils ─────────────────────────────
function diasUteisDecorridos(dataInicio) {
  if (!dataInicio) return 0;
  const inicio = new Date(dataInicio + 'T00:00:00');
  const hoje   = new Date(); hoje.setHours(0, 0, 0, 0);
  if (hoje <= inicio) return 0;
  let count = 0;
  const cur = new Date(inicio);
  while (cur < hoje) {
    cur.setDate(cur.getDate() + 1);
    const d = cur.getDay();
    if (d !== 0 && d !== 6) count++;
  }
  return count;
}

function corProgresso(dataInicio) {
  const d = diasUteisDecorridos(dataInicio);
  if (d >= 5) return 'vermelho';
  if (d >= 3) return 'amarelo';
  return 'verde';
}

function prazoLabel(d) {
  const r = 5 - d;
  if (r <= 0) return `⚠ Prazo encerrado (${d} dias úteis)`;
  if (r === 1) return '⏰ Falta 1 dia útil';
  if (r === 2) return '⏰ Faltam 2 dias úteis';
  return `✓ No prazo (${r} dias úteis restantes)`;
}

function fmtData(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

// ── Escape HTML ───────────────────────────────────────
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Toast ─────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}
