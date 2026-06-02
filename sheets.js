require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

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

// Exporta conteudos e planejamento para as 4 abas da planilha Cobo
async function exportarParaCobo(planilhaId, conteudos, planejamento) {
  try {
    const sheets = await getSheets();

    // ── Mapa auxiliar: ideia → conteudo completo (para buscar CTA) ──────────
    const ideiaMapa = {};
    (conteudos || []).forEach((c) => { ideiaMapa[c.ideia] = c; });

    // ── 1. Aba "COBO" — ideias por rede em colunas separadas ─────────────────
    const instIdeias  = (conteudos || []).filter((c) => (c.rede || '').includes('Instagram')).map((c) => [c.ideia || '']);
    const tikIdeias   = (conteudos || []).filter((c) => (c.rede || '').includes('TikTok')).map((c) => [c.ideia || '']);
    const wasIdeias   = (conteudos || []).filter((c) => (c.rede || '').includes('WhatsApp')).map((c) => [c.ideia || '']);

    // Preenche até 20 linhas (esvazia células antigas com string vazia)
    const pad = (arr, n = 20) => { const r = [...arr]; while (r.length < n) r.push(['']); return r; };

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: planilhaId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: "'COBO'!B6:B25", values: pad(instIdeias) },
          { range: "'COBO'!G6:G25", values: pad(tikIdeias)  },
          { range: "'COBO'!K6:K25", values: pad(wasIdeias)  },
        ],
      },
    });

    // ── 2. Aba "RDC - Reels" — todos os campos, ordenados por ordem ──────────
    const sorted = [...(conteudos || [])].sort((a, b) => (a.ordem || 99) - (b.ordem || 99));
    const rdcRows = sorted.map((c) => [
      c.ideia        || '',
      c.demanda      ?? '',
      c.competicao   ?? '',
      c.nota         ?? '',
      c.ordem        ?? '',
      c.modelagem    || '',
      c.permeabilidade || '',
      c.formato      || '',
      c.conversacao  || '',
      c.horario      || '',
      c.rede         || '',
    ]);

    await sheets.spreadsheets.values.clear({
      spreadsheetId: planilhaId,
      range: "'RDC - Reels'!A2:K20",
    });
    if (rdcRows.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: planilhaId,
        range: "'RDC - Reels'!A2",
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rdcRows },
      });
    }

    // ── 3. Aba "Matriz Estratégica - Insta" — dias e equilíbrio ──────────────
    // Mapeamento dia → coluna (D=Segunda … J=Domingo)
    const DIA_COL = {
      Segunda: 'D', Terça: 'E', Quarta: 'F',
      Quinta:  'G', Sexta: 'H', Sábado: 'I', Domingo: 'J',
    };
    const TODOS_DIAS = Object.keys(DIA_COL);

    // Indexa planejamento por dia
    const diaMap = {};
    (planejamento || []).forEach((p) => { diaMap[p.dia] = p; });

    // Monta 6 linhas (linhas 10-15) × 7 colunas (D-J) de uma vez
    // Cada linha: um atributo; cada coluna: um dia
    const ATRIBS = ['conteudo', 'modelagem', 'permeabilidade', 'formato', 'cta', 'horario'];
    const matrizValues = ATRIBS.map((attr) =>
      TODOS_DIAS.map((dia) => {
        const item = diaMap[dia];
        if (!item) return '';
        if (attr === 'cta') return ideiaMapa[item.conteudo]?.conversacao || '';
        return item[attr] || '';
      })
    );

    // Contagens de equilíbrio (baseadas no planejamento atual)
    const plan = planejamento || [];
    const heroN = plan.filter((p) => p.modelagem === 'HERO').length;
    const hubN  = plan.filter((p) => p.modelagem === 'HUB').length;
    const helpN = plan.filter((p) => p.modelagem === 'HELP').length;
    const profN = plan.filter((p) => p.permeabilidade === 'Profundidade').length;
    const aderN = plan.filter((p) => p.permeabilidade === 'Aderência').length;

    const M = "'Matriz Estratégica - Insta'";
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: planilhaId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: `${M}!D10:J15`, values: matrizValues },
          { range: `${M}!K25`,     values: [[heroN]] },
          { range: `${M}!K26`,     values: [[hubN]]  },
          { range: `${M}!K27`,     values: [[helpN]] },
          { range: `${M}!K32`,     values: [[profN]] },
          { range: `${M}!K33`,     values: [[aderN]] },
        ],
      },
    });

    // ── 4. Aba "Planejamento" — sem linhas vazias, dia sempre preenchido ──────
    const planRows = (planejamento || []).map((p) => [
      p.dia            || '',
      p.conteudo       || '',
      p.modelagem      || '',
      p.permeabilidade || '',
      p.formato        || '',
      p.horario        || '',
    ]);

    await sheets.spreadsheets.values.clear({
      spreadsheetId: planilhaId,
      range: 'Planejamento!A2:F20',
    });
    if (planRows.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: planilhaId,
        range: 'Planejamento!A2',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: planRows },
      });
    }

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
  salvarPlanilhaCobo,
  buscarPlanilhaCobo,
  exportarParaCobo,
  atualizarEtapa,
  buscarEtapas,
};
