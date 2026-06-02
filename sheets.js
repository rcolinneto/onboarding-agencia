require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents.readonly',
];

async function getSheets() {
  let auth;
  const credPath = path.join(__dirname, 'credentials.json');
  const fs = require('fs');

  if (fs.existsSync(credPath)) {
    auth = new google.auth.GoogleAuth({
      keyFile: credPath,
      scopes: SCOPES,
    });
  } else if (process.env.GOOGLE_CREDENTIALS_BASE64) {
    const credentials = JSON.parse(
      Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf8')
    );
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: SCOPES,
    });
  } else {
    throw new Error('Nenhuma credencial do Google encontrada');
  }

  return google.sheets({ version: 'v4', auth });
}

async function getDocs() {
  const fs = require('fs');
  const credPath = path.join(__dirname, 'credentials.json');
  let auth;
  if (fs.existsSync(credPath)) {
    auth = new google.auth.GoogleAuth({ keyFile: credPath, scopes: SCOPES });
  } else if (process.env.GOOGLE_CREDENTIALS_BASE64) {
    const credentials = JSON.parse(
      Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf8')
    );
    auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
  } else {
    throw new Error('Nenhuma credencial do Google encontrada');
  }
  return google.docs({ version: 'v1', auth });
}

function gerarId() {
  return `CLI-${Date.now()}`;
}

function dataHoje() {
  return new Date().toISOString().split('T')[0];
}

// Lê a aba "Clientes" — colunas: ID, Nome, DataInicio, Responsavel, FormSheetId
async function listarClientes() {
  try {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Clientes',
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) return [];

    const [, ...dataRows] = rows;
    return dataRows.map(([id, nome, dataInicio, responsavel, formSheetId]) => ({
      id,
      nome,
      dataInicio,
      responsavel,
      formSheetId: formSheetId || '',
    }));
  } catch (err) {
    throw new Error(`listarClientes: ${err.message}`);
  }
}

// Adiciona cliente na aba "Clientes" e cria 13 etapas na aba "Etapas"
async function criarCliente(nome, responsavel, formSheetId = '') {
  try {
    const sheets = await getSheets();
    const id = gerarId();
    const data = dataHoje();

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Clientes',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[id, nome, data, responsavel, formSheetId]],
      },
    });

    const etapas = Array.from({ length: 13 }, (_, i) => [
      id, i + 1, 'pendente', '', '',
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Etapas',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: etapas },
    });

    return { id, nome, dataInicio: data, responsavel, formSheetId };
  } catch (err) {
    throw new Error(`criarCliente: ${err.message}`);
  }
}

// Atualiza o FormSheetId de um cliente na aba "Clientes"
async function atualizarFormSheet(clienteId, formSheetId) {
  try {
    const sheets = await getSheets();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Clientes',
    });

    const rows = res.data.values || [];
    const rowIndex = rows.findIndex((row) => row[0] === clienteId);
    if (rowIndex === -1) throw new Error(`Cliente ${clienteId} não encontrado.`);

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Clientes!E${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[formSheetId]] },
    });

    return { clienteId, formSheetId };
  } catch (err) {
    throw new Error(`atualizarFormSheet: ${err.message}`);
  }
}

// Lê a planilha de respostas do Google Forms e retorna texto "Pergunta: Resposta"
async function buscarRespostasForm(formSheetId) {
  try {
    const sheets = await getSheets();

    // Descobre o nome da primeira aba
    const meta = await sheets.spreadsheets.get({ spreadsheetId: formSheetId });
    const firstSheet = meta.data.sheets?.[0]?.properties?.title || 'Sheet1';

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: formSheetId,
      range: firstSheet,
    });

    const rows = res.data.values || [];
    if (rows.length < 2) return 'Nenhuma resposta encontrada na planilha.';

    const [headers, ...dataRows] = rows;

    const texto = dataRows.map((row, i) => {
      const linhas = headers
        .map((h, j) => ({ h: (h || '').trim(), v: (row[j] || '').trim() }))
        .filter(({ h }) => h)
        .map(({ h, v }) => `${h}: ${v || '(sem resposta)'}`);
      return `=== Resposta ${i + 1} ===\n${linhas.join('\n')}`;
    }).join('\n\n');

    return texto || 'Planilha sem dados de resposta.';
  } catch (err) {
    throw new Error(`buscarRespostasForm: ${err.message}`);
  }
}

// Salva diagnóstico na coluna F da aba Clientes
async function salvarDiagnostico(clienteId, diagnostico) {
  try {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Clientes',
    });
    const rows = res.data.values || [];
    const rowIndex = rows.findIndex((row) => row[0] === clienteId);
    if (rowIndex === -1) throw new Error(`Cliente ${clienteId} não encontrado.`);

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Clientes!F${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[diagnostico]] },
    });
    return { clienteId };
  } catch (err) {
    throw new Error(`salvarDiagnostico: ${err.message}`);
  }
}

// Busca diagnóstico salvo na coluna F da aba Clientes
async function buscarDiagnostico(clienteId) {
  try {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Clientes',
    });
    const rows = res.data.values || [];
    const row = rows.find((r) => r[0] === clienteId);
    if (!row) throw new Error(`Cliente ${clienteId} não encontrado.`);
    return row[5] || '';
  } catch (err) {
    throw new Error(`buscarDiagnostico: ${err.message}`);
  }
}

// Salva JSON de acessos na coluna G da aba Clientes
async function salvarAcessos(clienteId, acessos) {
  try {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Clientes',
    });
    const rows = res.data.values || [];
    const rowIndex = rows.findIndex((row) => row[0] === clienteId);
    if (rowIndex === -1) throw new Error(`Cliente ${clienteId} não encontrado.`);

    const json = typeof acessos === 'string' ? acessos : JSON.stringify(acessos);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Clientes!G${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[json]] },
    });
    return { clienteId };
  } catch (err) {
    throw new Error(`salvarAcessos: ${err.message}`);
  }
}

// Busca JSON de acessos na coluna G da aba Clientes
async function buscarAcessos(clienteId) {
  try {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Clientes',
    });
    const rows = res.data.values || [];
    const row = rows.find((r) => r[0] === clienteId);
    if (!row) throw new Error(`Cliente ${clienteId} não encontrado.`);
    const raw = row[6] || '{}';
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (err) {
    throw new Error(`buscarAcessos: ${err.message}`);
  }
}

// Atualiza status e observação de uma etapa específica
async function atualizarEtapa(clienteId, etapaNum, status, obs = '') {
  try {
    const sheets = await getSheets();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Etapas',
    });

    const rows = res.data.values || [];
    const rowIndex = rows.findIndex(
      (row) => row[0] === clienteId && String(row[1]) === String(etapaNum)
    );

    if (rowIndex === -1) {
      throw new Error(`Etapa ${etapaNum} do cliente ${clienteId} não encontrada.`);
    }

    const dataConclusao = status === 'concluida' ? dataHoje() : (rows[rowIndex][3] || '');
    const range = `Etapas!C${rowIndex + 1}:E${rowIndex + 1}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[status, dataConclusao, obs]] },
    });

    return { clienteId, etapaNum, status, dataConclusao, obs };
  } catch (err) {
    throw new Error(`atualizarEtapa: ${err.message}`);
  }
}

// Retorna todas as 13 etapas de um cliente
async function buscarEtapas(clienteId) {
  try {
    const sheets = await getSheets();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Etapas',
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) return [];

    const [, ...dataRows] = rows;
    const etapas = dataRows
      .filter((row) => row[0] === clienteId)
      .map(([cId, etapaNum, status, dataConclusao, observacao]) => ({
        clienteId: cId,
        etapaNum: Number(etapaNum),
        status,
        dataConclusao: dataConclusao || null,
        observacao: observacao || '',
      }));

    if (etapas.length === 0) {
      throw new Error(`Nenhuma etapa encontrada para o cliente ${clienteId}.`);
    }

    return etapas;
  } catch (err) {
    throw new Error(`buscarEtapas: ${err.message}`);
  }
}

// Salva ID do Google Doc de referências na coluna I da aba Clientes
async function salvarDocReferencias(clienteId, docId) {
  try {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Clientes',
    });
    const rows = res.data.values || [];
    const rowIndex = rows.findIndex((row) => row[0] === clienteId);
    if (rowIndex === -1) throw new Error(`Cliente ${clienteId} não encontrado.`);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Clientes!I${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[docId]] },
    });
    return { clienteId, docId };
  } catch (err) {
    throw new Error(`salvarDocReferencias: ${err.message}`);
  }
}

// Busca ID do Google Doc de referências na coluna I da aba Clientes
async function buscarDocReferencias(clienteId) {
  try {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Clientes',
    });
    const rows = res.data.values || [];
    const row = rows.find((r) => r[0] === clienteId);
    if (!row) throw new Error(`Cliente ${clienteId} não encontrado.`);
    return row[8] || ''; // coluna I (índice 8)
  } catch (err) {
    throw new Error(`buscarDocReferencias: ${err.message}`);
  }
}

// Lê um range de qualquer planilha (para leitura da Cobo)
async function lerAbaCobo(planilhaId, range) {
  try {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: planilhaId, range });
    return res.data.values || [];
  } catch {
    return [];
  }
}

// Lê um Google Doc e retorna o texto extraído
async function lerDocGoogle(docId) {
  try {
    const docs = await getDocs();
    const doc = await docs.documents.get({ documentId: docId });
    const linhas = [];
    for (const el of (doc.data.body?.content || [])) {
      if (el.paragraph) {
        const linha = (el.paragraph.elements || [])
          .map((e) => e.textRun?.content || '')
          .join('')
          .replace(/\n$/, '')
          .trim();
        if (linha) linhas.push(linha);
      }
    }
    return linhas.join('\n');
  } catch (err) {
    throw new Error(`lerDocGoogle: ${err.message}`);
  }
}

// Salva ID da planilha Cobo na coluna H da aba Clientes
async function salvarPlanilhaCobo(clienteId, planilhaId) {
  try {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Clientes',
    });
    const rows = res.data.values || [];
    const rowIndex = rows.findIndex((row) => row[0] === clienteId);
    if (rowIndex === -1) throw new Error(`Cliente ${clienteId} não encontrado.`);

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Clientes!H${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[planilhaId]] },
    });
    return { clienteId, planilhaId };
  } catch (err) {
    throw new Error(`salvarPlanilhaCobo: ${err.message}`);
  }
}

// Busca ID da planilha Cobo na coluna H da aba Clientes
async function buscarPlanilhaCobo(clienteId) {
  try {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Clientes',
    });
    const rows = res.data.values || [];
    const row = rows.find((r) => r[0] === clienteId);
    if (!row) throw new Error(`Cliente ${clienteId} não encontrado.`);
    return row[7] || '';
  } catch (err) {
    throw new Error(`buscarPlanilhaCobo: ${err.message}`);
  }
}

// Escreve conteúdos em blocos de 7 linhas de uma aba RDC (Reels ou Fotos)
async function exportarParaRDCFotos(planilhaId, fotos) {
  const sheets = await getSheets();
  const RDC_BLOCOS = [6, 13, 20, 27, 34, 41, 48];
  const sorted = [...(fotos || [])].sort((a, b) => (a.ordem || 99) - (b.ordem || 99));
  const data = RDC_BLOCOS.map((lin, i) => {
    const c = sorted[i];
    return [
      { range: `'RDC - Fotos'!B${lin}`, values: [[c?.ideia      || '']] },
      { range: `'RDC - Fotos'!D${lin}`, values: [[c?.modelagem  || '']] },
      { range: `'RDC - Fotos'!F${lin}`, values: [[c?.demanda    ?? '']] },
      { range: `'RDC - Fotos'!H${lin}`, values: [[c?.competicao ?? '']] },
      { range: `'RDC - Fotos'!L${lin}`, values: [[c?.ordem      ?? '']] },
    ];
  }).flat();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: planilhaId,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  });
}

// Exporta reels e fotos para COBO + RDC Reels + RDC Fotos + Matriz Estratégica
async function exportarParaCobo(planilhaId, reels, fotos, diasSemana) {
  const DIAS_PADRAO = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
  diasSemana = (diasSemana && diasSemana.length) ? diasSemana : DIAS_PADRAO;
  try {
    const sheets   = await getSheets();
    const todos    = [...(reels || []), ...(fotos || [])];
    const pad      = (arr, n = 25) => { const r = [...arr]; while (r.length < n) r.push(['']); return r; };
    const RDC_BLOCOS = [6, 13, 20, 27, 34, 41, 48];

    // ── 1. Aba "COBO" — todas as ideias por rede ─────────────────────────────
    const inst = todos.filter((c) => (c.rede || '').includes('Instagram')).map((c) => [c.ideia || '']);
    const tik  = todos.filter((c) => (c.rede || '').includes('TikTok')).map((c) => [c.ideia || '']);
    const was  = todos.filter((c) => (c.rede || '').includes('WhatsApp')).map((c) => [c.ideia || '']);
    try {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: planilhaId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: [
            { range: "'COBO'!B6:B30", values: pad(inst) },
            { range: "'COBO'!G6:G30", values: pad(tik)  },
            { range: "'COBO'!K6:K30", values: pad(was)  },
          ],
        },
      });
    } catch (_) { /* aba COBO opcional */ }

    // ── 2. Aba "RDC - Reels" ─────────────────────────────────────────────────
    const sortedReels = [...(reels || [])].sort((a, b) => (a.ordem || 99) - (b.ordem || 99));
    const rdcReelsData = RDC_BLOCOS.map((lin, i) => {
      const c = sortedReels[i];
      return [
        { range: `'RDC - Reels'!B${lin}`, values: [[c?.ideia      || '']] },
        { range: `'RDC - Reels'!D${lin}`, values: [[c?.modelagem  || '']] },
        { range: `'RDC - Reels'!F${lin}`, values: [[c?.demanda    ?? '']] },
        { range: `'RDC - Reels'!H${lin}`, values: [[c?.competicao ?? '']] },
        { range: `'RDC - Reels'!L${lin}`, values: [[c?.ordem      ?? '']] },
      ];
    }).flat();
    try {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: planilhaId,
        requestBody: { valueInputOption: 'USER_ENTERED', data: rdcReelsData },
      });
    } catch (_) { /* aba RDC Reels opcional */ }

    // ── 3. Aba "RDC - Fotos" ─────────────────────────────────────────────────
    try {
      await exportarParaRDCFotos(planilhaId, fotos);
    } catch (_) { /* aba RDC Fotos opcional */ }

    // ── 4. Aba "Matriz Estratégica - Insta" — distribuição pelos dias selecionados ──
    try {
      const n = Math.min(diasSemana.length, 7); // quantos conteúdos selecionar

      // Quotas de equilíbrio por total de dias
      // Regra: mín 2 HERO, mín 2 HUB, mín 3 HELP (escala para n < 7)
      const heroQ = n >= 4 ? 2 : 1;
      const hubQ  = n >= 4 ? 2 : Math.min(1, n - heroQ);
      const helpQ = Math.max(0, n - heroQ - hubQ);

      const sortedTodos = [...todos].sort((a, b) => (b.nota || 0) - (a.nota || 0));
      const pool = sortedTodos.map((c) => ({ ...c, modelagem: (c.modelagem || '').toUpperCase() }));
      const topN = [];
      const usados = new Set();

      const pickType = (type, max) => {
        let picked = 0;
        for (const c of pool) {
          if (picked >= max || topN.length >= n) break;
          if (!usados.has(c.ideia) && c.modelagem === type) {
            topN.push({ ...c }); usados.add(c.ideia); picked++;
          }
        }
      };

      pickType('HERO', heroQ);
      pickType('HUB',  hubQ);
      pickType('HELP', helpQ + 2); // margem extra de HELP para completar slots

      // Preenche slots restantes com qualquer conteúdo
      for (const c of pool) {
        if (topN.length >= n) break;
        if (!usados.has(c.ideia)) { topN.push({ ...c }); usados.add(c.ideia); }
      }

      // Reclassificação para garantir mínimos obrigatórios
      const cnt = (t) => topN.filter((s) => s.modelagem === t).length;

      // mín 2 HERO: reclassifica melhores não-HERO como HERO
      while (cnt('HERO') < heroQ) {
        const cand = topN
          .filter((s) => s.modelagem !== 'HERO')
          .sort((a, b) => (b.nota || 0) - (a.nota || 0))[0]; // maior nota
        if (!cand) break;
        cand.modelagem = 'HERO';
      }

      // mín 2 HUB: reclassifica HELP de menor nota como HUB
      while (cnt('HUB') < hubQ) {
        const cand = topN
          .filter((s) => s.modelagem === 'HELP')
          .sort((a, b) => (a.nota || 0) - (b.nota || 0))[0]; // menor nota
        if (!cand) break;
        cand.modelagem = 'HUB';
      }

      // mín 3 HELP (quando n=7): reclassifica HUB excedente como HELP
      while (cnt('HELP') < helpQ && cnt('HUB') > hubQ) {
        const cand = topN
          .filter((s) => s.modelagem === 'HUB')
          .sort((a, b) => (a.nota || 0) - (b.nota || 0))[0]; // menor nota
        if (!cand) break;
        cand.modelagem = 'HELP';
      }

      // Mapa ideia → conteudo completo (para buscar CTA)
      const ideiaMapa = {};
      todos.forEach((c) => { ideiaMapa[c.ideia] = c; });

      // Estrutura fixa da planilha
      // L7: D=Segunda E=Terça F=Quarta G=Quinta H=Sexta I=Sábado J=Domingo
      // L10=Conteúdo L11=Modelagem L12=Permeab L13=Formato L14=Conversação L15=Horário
      const DIA_COL_MAT = {
        Segunda: 'D', Terça: 'E', Terca: 'E', Quarta: 'F',
        Quinta: 'G', Sexta: 'H', Sábado: 'I', Sabado: 'I', Domingo: 'J',
      };
      const TODAS_COLUNAS = ['D', 'E', 'F', 'G', 'H', 'I', 'J']; // todas as colunas de dias
      const M = "'Matriz Estratégica - Insta'";

      // Indexa planejamento por dia
      const matrizPlan = topN.map((c, i) => ({
        dia:            diasSemana[i],
        conteudo:       c.ideia,
        modelagem:      c.modelagem,
        permeabilidade: c.permeabilidade,
        formato:        c.formato,
        horario:        c.horario || '18H',
      }));
      const diaMap = {};
      matrizPlan.forEach((p) => { diaMap[p.dia] = p; });

      // Monta updates: para cada coluna (dia), escreve ou apaga as 6 linhas de dados
      const matData = [];
      for (const [dia, col] of Object.entries(DIA_COL_MAT)) {
        // Evita duplicatas para aliases (Terca/Terça → mesma coluna E)
        if (matData.some((d) => d.range.startsWith(`${M}!${col}10`))) continue;

        const item = diaMap[dia];
        const cta  = item ? (ideiaMapa[item.conteudo]?.conversacao || '') : '';
        matData.push(
          { range: `${M}!${col}10`, values: [[item?.conteudo       || '']] },
          { range: `${M}!${col}11`, values: [[item?.modelagem      || '']] },
          { range: `${M}!${col}12`, values: [[item?.permeabilidade || '']] },
          { range: `${M}!${col}13`, values: [[item?.formato        || '']] },
          { range: `${M}!${col}14`, values: [[cta]]                        },
          { range: `${M}!${col}15`, values: [[item?.horario        || '']] },
        );
      }

      // Equilíbrio: linhas fixas K25=Hero, K26=Hub, K27=Help, K32=Profundidade, K33=Aderência
      const heroCount = matrizPlan.filter((p) => p.modelagem      === 'HERO').length;
      const hubCount  = matrizPlan.filter((p) => p.modelagem      === 'HUB').length;
      const helpCount = matrizPlan.filter((p) => p.modelagem      === 'HELP').length;
      const profCount = matrizPlan.filter((p) => p.permeabilidade === 'Profundidade').length;
      const aderCount = matrizPlan.filter((p) => p.permeabilidade === 'Aderência').length;
      matData.push(
        { range: `${M}!K25`, values: [[heroCount]] },
        { range: `${M}!K26`, values: [[hubCount]]  },
        { range: `${M}!K27`, values: [[helpCount]] },
        { range: `${M}!K32`, values: [[profCount]] },
        { range: `${M}!K33`, values: [[aderCount]] },
      );

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: planilhaId,
        requestBody: { valueInputOption: 'RAW', data: matData },
      });
    } catch (_) { /* aba Matriz opcional */ }

    return { ok: true };
  } catch (err) {
    throw new Error(`exportarParaCobo: ${err.message}`);
  }
}

module.exports = {
  listarClientes,
  criarCliente,
  atualizarFormSheet,
  buscarRespostasForm,
  salvarDiagnostico,
  buscarDiagnostico,
  salvarAcessos,
  buscarAcessos,
  salvarDocReferencias,
  buscarDocReferencias,
  lerDocGoogle,
  lerAbaCobo,
  salvarPlanilhaCobo,
  buscarPlanilhaCobo,
  exportarParaCobo,
  exportarParaRDCFotos,
  atualizarEtapa,
  buscarEtapas,
};
