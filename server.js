require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const {
  listarClientes,
  criarCliente,
  atualizarFormSheet,
  buscarRespostasForm,
  salvarDiagnostico,
  buscarDiagnostico,
  salvarAcessos,
  buscarAcessos,
  salvarPlanilhaCobo,
  buscarPlanilhaCobo,
  exportarParaCobo,
  atualizarEtapa,
  buscarEtapas,
} = require('./sheets');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/debug', (req, res) => {
  res.json({
    temCredencial: !!process.env.GOOGLE_CREDENTIALS_BASE64,
    tamanhoCredencial: process.env.GOOGLE_CREDENTIALS_BASE64?.length || 0,
    temSheetId: !!process.env.GOOGLE_SHEET_ID,
    temApiKey: !!process.env.ANTHROPIC_API_KEY,
  });
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const WHATSAPP_TEMPLATES = {
  2: 'Bem-vindo! Ficamos muito felizes com sua decisão de iniciar esse projeto com a gente. Este grupo será nosso canal principal de comunicação, garantindo organização e agilidade. Nos próximos dias, vamos estruturar toda a base estratégica do seu crescimento.',
  3: 'Olá, [nome]! Para iniciarmos seu projeto da forma mais estratégica possível, preciso que preencha nosso formulário de coleta de dados. As respostas vão nos ajudar a entender seu cenário atual, objetivos e oportunidades de crescimento. Assim que finalizar, me avisa por aqui.',
  7: 'Perfeito, [nome]! Agora preciso da sua ajuda com 3 pontos rápidos: Quais são seus principais concorrentes hoje? Quais perfis ou conteúdos você usa como referência? Na sua visão, quais os principais motivos que fazem um possível cliente não comprar de você hoje?',
};

// GET /api/clientes — lista clientes com progresso de etapas
app.get('/api/clientes', async (req, res) => {
  try {
    const clientes = await listarClientes();

    const clientesComProgresso = await Promise.all(
      clientes.map(async (cliente) => {
        try {
          const etapas = await buscarEtapas(cliente.id);
          const concluidas = etapas.filter((e) => e.status === 'concluida').length;
          return { ...cliente, progresso: { concluidas, total: 13 } };
        } catch {
          return { ...cliente, progresso: { concluidas: 0, total: 13 } };
        }
      })
    );

    res.json({ clientes: clientesComProgresso });
  } catch (err) {
    res.status(500).json({ error: `Erro ao listar clientes: ${err.message}` });
  }
});

// POST /api/clientes — cria cliente e suas 13 etapas
app.post('/api/clientes', async (req, res) => {
  const { nome, responsavel } = req.body;
  if (!nome || !responsavel) {
    return res.status(400).json({ error: 'nome e responsavel são obrigatórios' });
  }
  try {
    const cliente = await criarCliente(nome, responsavel);
    res.status(201).json({ cliente });
  } catch (err) {
    res.status(500).json({ error: `Erro ao criar cliente: ${err.message}` });
  }
});

// PATCH /api/etapa — atualiza status e observação de uma etapa
app.patch('/api/etapa', async (req, res) => {
  const { clienteId, etapaNum, status, obs } = req.body;
  if (!clienteId || !etapaNum || !status) {
    return res.status(400).json({ error: 'clienteId, etapaNum e status são obrigatórios' });
  }
  try {
    const etapa = await atualizarEtapa(clienteId, etapaNum, status, obs);
    res.json({ etapa });
  } catch (err) {
    res.status(500).json({ error: `Erro ao atualizar etapa: ${err.message}` });
  }
});

// GET /api/templates/:etapa — retorna template de WhatsApp da etapa
app.get('/api/templates/:etapa', (req, res) => {
  const etapaNum = Number(req.params.etapa);
  const template = WHATSAPP_TEMPLATES[etapaNum];
  if (!template) {
    return res.status(404).json({ error: `Nenhum template encontrado para a etapa ${etapaNum}` });
  }
  res.json({ etapa: etapaNum, template });
});

// POST /api/diagnostico — gera diagnóstico via Claude com dados do cliente
app.post('/api/diagnostico', async (req, res) => {
  const { clienteId, dados } = req.body;
  if (!clienteId || !dados) {
    return res.status(400).json({ error: 'clienteId e dados são obrigatórios' });
  }
  try {
    const prompt = `Você é um especialista em marketing digital e crescimento de negócios.

Com base nos dados abaixo, gere um diagnóstico completo em markdown com:
- Resumo do cenário atual
- Principais pontos fortes
- Principais desafios e gargalos
- Oportunidades identificadas
- Recomendações estratégicas prioritárias

**Cliente ID:** ${clienteId}

**Dados coletados:**
${typeof dados === 'string' ? dados : JSON.stringify(dados, null, 2)}`;

    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    });

    res.json({ clienteId, diagnostico: result.content[0].text });
  } catch (err) {
    res.status(500).json({ error: `Erro ao gerar diagnóstico: ${err.message}` });
  }
});

// POST /api/clientes/:id/diagnostico — salva diagnóstico na planilha
app.post('/api/clientes/:id/diagnostico', async (req, res) => {
  const { diagnostico } = req.body;
  if (!diagnostico) return res.status(400).json({ error: 'diagnostico é obrigatório' });
  try {
    await salvarDiagnostico(req.params.id, diagnostico);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Erro ao salvar diagnóstico: ${err.message}` });
  }
});

// GET /api/clientes/:id/diagnostico — retorna diagnóstico salvo
app.get('/api/clientes/:id/diagnostico', async (req, res) => {
  try {
    const diagnostico = await buscarDiagnostico(req.params.id);
    res.json({ diagnostico });
  } catch (err) {
    res.status(500).json({ error: `Erro ao buscar diagnóstico: ${err.message}` });
  }
});

// POST /api/pauta — gera pauta de reunião de alinhamento com base no diagnóstico
app.post('/api/pauta', async (req, res) => {
  const { clienteId, diagnostico: diagBody } = req.body;
  if (!clienteId) return res.status(400).json({ error: 'clienteId é obrigatório' });

  let diagnostico = diagBody?.trim();
  if (!diagnostico) {
    try { diagnostico = await buscarDiagnostico(clienteId); } catch {}
  }
  if (!diagnostico) {
    return res.status(400).json({ error: 'Nenhum diagnóstico disponível. Gere o diagnóstico primeiro.' });
  }

  let nomeCliente = clienteId;
  try {
    const todos = await listarClientes();
    const c = todos.find((x) => x.id === clienteId);
    if (c) nomeCliente = c.nome;
  } catch {}

  try {
    const prompt = `Você é um especialista em marketing digital e estratégia de negócios.

Com base no diagnóstico abaixo, gere uma pauta completa em markdown para a Reunião de Alinhamento com o cliente "${nomeCliente}".

A pauta deve conter as seguintes seções, com tempo estimado, pontos específicos ao cliente e perguntas-chave para conduzir a conversa:

1. **Abertura** (5 min) — boas-vindas e objetivo da reunião
2. **Apresentação do Diagnóstico** — principais achados com perguntas de validação
3. **Validação dos Objetivos** — confirmar metas e expectativas
4. **Oportunidades Identificadas** — apresentar oportunidades e explorar reações
5. **Direção Estratégica Proposta** — caminho recomendado com perguntas de alinhamento
6. **Próximos Passos** — ações concretas, responsáveis e prazos
7. **Dúvidas e Alinhamentos** — espaço aberto

Para cada seção inclua perguntas-chave específicas ao diagnóstico do cliente.

Diagnóstico do cliente:
${diagnostico}`;

    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    res.json({ pauta: result.content[0].text });
  } catch (err) {
    res.status(500).json({ error: `Erro ao gerar pauta: ${err.message}` });
  }
});

// POST /api/apresentacao — gera slides via Claude e retorna com cores e logo
app.post('/api/apresentacao', async (req, res) => {
  const { clienteId, dados, corPrimaria, corSecundaria, logo } = req.body;
  if (!clienteId || !dados) {
    return res.status(400).json({ error: 'clienteId e dados são obrigatórios' });
  }
  try {
    let nomeCliente = clienteId;
    try {
      const todos = await listarClientes();
      const c = todos.find((x) => x.id === clienteId);
      if (c) nomeCliente = c.nome;
    } catch {}

    // Se não vieram dados, usa o diagnóstico salvo automaticamente
    let dadosFinais = dados?.trim();
    if (!dadosFinais) {
      try { dadosFinais = await buscarDiagnostico(clienteId); } catch {}
    }
    if (!dadosFinais) {
      return res.status(400).json({ error: 'Nenhum dado ou diagnóstico disponível. Preencha o campo de contexto.' });
    }

    const prompt = `Você é um especialista em marketing digital. Crie uma apresentação profissional de onboarding para o cliente abaixo.

Retorne SOMENTE um JSON válido, sem markdown, sem explicações, exatamente neste formato:
{
  "slides": [
    { "type": "capa", "titulo": "...", "subtitulo": "..." },
    { "type": "conteudo", "titulo": "...", "pontos": ["...", "..."] },
    { "type": "destaque", "texto": "frase de impacto curta" },
    { "type": "conteudo", "titulo": "...", "pontos": ["..."] },
    { "type": "encerramento", "titulo": "...", "subtitulo": "..." }
  ]
}

Tipos permitidos: "capa" (abertura), "conteudo" (título + lista de pontos), "destaque" (frase curta de impacto), "encerramento" (fechamento).
Gere entre 6 e 10 slides. Seja objetivo e direto. Cada ponto deve ter no máximo 12 palavras.

Dados do cliente:
${dadosFinais}`;

    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = result.content[0].text.trim();
    const jsonStr = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(jsonStr);

    res.json({
      slides:        parsed.slides,
      corPrimaria:   corPrimaria   || '#2563eb',
      corSecundaria: corSecundaria || '#0f172a',
      logo:          logo          || '',
      nomeCliente,
    });
  } catch (err) {
    res.status(500).json({ error: `Erro ao gerar apresentação: ${err.message}` });
  }
});

// PATCH /api/clientes/:id/formsheet — salva o ID da planilha de respostas do Forms
app.patch('/api/clientes/:id/formsheet', async (req, res) => {
  const { formSheetId } = req.body;
  if (!formSheetId) {
    return res.status(400).json({ error: 'formSheetId é obrigatório' });
  }
  try {
    const result = await atualizarFormSheet(req.params.id, formSheetId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `Erro ao salvar planilha: ${err.message}` });
  }
});

// GET /api/clientes/:id/respostas — lê respostas do Google Forms
// Aceita ?formSheetId= (sem precisar salvar antes) ou usa o salvo na planilha
app.get('/api/clientes/:id/respostas', async (req, res) => {
  try {
    let formSheetId = req.query.formSheetId?.trim();

    if (!formSheetId) {
      const clientes = await listarClientes();
      const cliente = clientes.find((c) => c.id === req.params.id);
      if (!cliente) return res.status(404).json({ error: 'Cliente não encontrado.' });
      formSheetId = cliente.formSheetId;
    }

    if (!formSheetId) {
      return res.status(400).json({ error: 'Informe o ID da planilha no campo acima.' });
    }

    const respostas = await buscarRespostasForm(formSheetId);
    res.json({ respostas });
  } catch (err) {
    res.status(500).json({ error: `Erro ao buscar respostas: ${err.message}` });
  }
});

// GET /api/clientes/:id/etapas — retorna etapas de um cliente
app.get('/api/clientes/:id/etapas', async (req, res) => {
  try {
    const etapas = await buscarEtapas(req.params.id);
    res.json({ etapas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/clientes/:id/conteudo/planilhaId — retorna ID da planilha Cobo
app.get('/api/clientes/:id/conteudo/planilhaId', async (req, res) => {
  try {
    const planilhaId = await buscarPlanilhaCobo(req.params.id);
    res.json({ planilhaId });
  } catch (err) {
    res.status(500).json({ error: `Erro ao buscar planilha Cobo: ${err.message}` });
  }
});

// PATCH /api/clientes/:id/conteudo/planilhaId — salva ID da planilha Cobo
app.patch('/api/clientes/:id/conteudo/planilhaId', async (req, res) => {
  const { planilhaId } = req.body;
  if (!planilhaId) return res.status(400).json({ error: 'planilhaId é obrigatório' });
  try {
    await salvarPlanilhaCobo(req.params.id, planilhaId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Erro ao salvar planilha Cobo: ${err.message}` });
  }
});

// POST /api/clientes/:id/conteudo/avaliar — avalia ideias com Claude
app.post('/api/clientes/:id/conteudo/avaliar', async (req, res) => {
  const { ideias, redes } = req.body;
  if (!ideias?.length) return res.status(400).json({ error: 'ideias são obrigatórias' });

  try {
    const prompt = `Você é especialista em conteúdo digital. Avalie cada ideia para as redes: ${(redes || ['Instagram']).join(', ')}.

Para cada ideia retorne um objeto JSON com:
- ideia: texto original
- demanda: 1-5 (quanto o público busca/consome esse tipo)
- competicao: 1-5 (saturação; 1=pouca concorrência)
- nota: demanda * competicao
- ordem: ranking (1=melhor)
- modelagem: "HERO" (aspiracional/viral) | "HUB" (série regular) | "HELP" (educacional/prático)
- permeabilidade: "Profundidade" | "Aderência" | "AD"
- formato: "Reels 60s" | "Reels 45s" | "Carrossel" | "Foto" | "Stories" | "Video"
- conversacao: sugestão de CTA curto (ex: "Salva esse vídeo!")
- horario: "12H" | "18H" | "20H"
- rede: qual das redes fornecidas é mais indicada

Ideias:
${ideias.map((id, i) => `${i + 1}. ${id}`).join('\n')}

Retorne APENAS um array JSON válido, sem markdown, sem explicações.`;

    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = result.content[0].text.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
    const conteudos = JSON.parse(raw);
    res.json({ conteudos });
  } catch (err) {
    res.status(500).json({ error: `Erro ao avaliar ideias: ${err.message}` });
  }
});

// POST /api/clientes/:id/conteudo/planejamento — monta planejamento semanal com Claude
app.post('/api/clientes/:id/conteudo/planejamento', async (req, res) => {
  const { conteudos, diasSemana } = req.body;
  if (!conteudos?.length || !diasSemana?.length) {
    return res.status(400).json({ error: 'conteudos e diasSemana são obrigatórios' });
  }

  try {
    // Busca diagnóstico salvo para personalizar o planejamento
    let diagnostico = '';
    try { diagnostico = await buscarDiagnostico(req.params.id); } catch {}

    const prompt = `Você é um estrategista de conteúdo sênior especializado em tráfego orgânico no Brasil.

Monte um planejamento semanal de conteúdo personalizado para este cliente baseado no diagnóstico abaixo.

DIAGNÓSTICO DO CLIENTE:
${diagnostico || 'Não disponível'}

CONTEÚDOS AVALIADOS (use apenas estes):
${JSON.stringify(conteudos)}

DIAS DA SEMANA: ${diasSemana.join(', ')}

REGRAS OBRIGATÓRIAS:
- Use APENAS os conteúdos da lista acima, não invente novos
- Distribua respeitando: mais HELP que HUB, mais HUB que HERO
- Nunca coloque dois HERO seguidos
- Adapte a ordem e os horários com base no perfil do cliente no diagnóstico
- Se o cliente tem baixo engajamento: priorize HELP e HUB antes de HERO
- Se o cliente tem produto de alto ticket: use mais Profundidade
- Se o cliente é iniciante nas redes: comece com conteúdos de Aderência
- Os horários devem fazer sentido para o público-alvo identificado no diagnóstico
- Retorne EXATAMENTE um conteúdo por dia para cada dia solicitado

Retorne APENAS um JSON array com esta estrutura, sem markdown:
[{ "dia": "Segunda", "conteudo": "...", "modelagem": "HELP", "permeabilidade": "Profundidade", "formato": "Reels 60s", "horario": "18H", "justificativa": "..." }]

O campo justificativa deve explicar em 1 linha por que este conteúdo foi escolhido para este dia.`;

    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = result.content[0].text.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
    const semana = JSON.parse(raw);
    res.json({ semana });
  } catch (err) {
    res.status(500).json({ error: `Erro ao montar planejamento: ${err.message}` });
  }
});

// POST /api/clientes/:id/conteudo/exportar — exporta para planilha Cobo
app.post('/api/clientes/:id/conteudo/exportar', async (req, res) => {
  const { conteudos, planejamento, planilhaId } = req.body;
  if (!conteudos?.length || !planejamento?.length || !planilhaId) {
    return res.status(400).json({ error: 'conteudos, planejamento e planilhaId são obrigatórios' });
  }
  try {
    await exportarParaCobo(planilhaId, conteudos, planejamento);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Erro ao exportar: ${err.message}` });
  }
});

// GET /api/clientes/:id/acessos — retorna acessos salvos
app.get('/api/clientes/:id/acessos', async (req, res) => {
  try {
    const acessos = await buscarAcessos(req.params.id);
    res.json({ acessos });
  } catch (err) {
    res.status(500).json({ error: `Erro ao buscar acessos: ${err.message}` });
  }
});

// POST /api/clientes/:id/acessos — salva acessos do cliente
app.post('/api/clientes/:id/acessos', async (req, res) => {
  const { acessos } = req.body;
  if (!acessos) return res.status(400).json({ error: 'acessos é obrigatório' });
  try {
    await salvarAcessos(req.params.id, acessos);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Erro ao salvar acessos: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
