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
    const pad = (arr, n = 15) => { const r = [...arr]; while (r.length < n) r.push(['']); return r; };

    // ── 1. Aba "COBO" — ideias por rede ──────────────────────────────────────
    const inst = (conteudos || []).filter((c) => (c.rede || '').includes('Instagram')).map((c) => [c.ideia || '']);
    const tik  = (conteudos || []).filter((c) => (c.rede || '').includes('TikTok')).map((c) => [c.ideia || '']);
    const was  = (conteudos || []).filter((c) => (c.rede || '').includes('WhatsApp')).map((c) => [c.ideia || '']);

    try {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: planilhaId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: [
            { range: "'COBO'!B6:B20", values: pad(inst) },
            { range: "'COBO'!G6:G20", values: pad(tik)  },
            { range: "'COBO'!K6:K20", values: pad(was)  },
          ],
        },
      });
    } catch (e) { /* aba COBO opcional */ }

    // ── 2. Aba "RDC - Reels" — blocos de 7 linhas ────────────────────────────
    // Cada conteúdo ocupa a 1ª linha de um bloco: 6, 13, 20, 27, 34, 41, 48...
    const RDC_BLOCOS = [6, 13, 20, 27, 34, 41, 48];
    const sorted = [...(conteudos || [])].sort((a, b) => (a.ordem || 99) - (b.ordem || 99));

    const rdcData = RDC_BLOCOS.map((lin, i) => {
      const c = sorted[i]; // undefined para slots além do total de conteúdos
      return [
        { range: `'RDC - Reels'!B${lin}`, values: [[c?.ideia      || '']] },
        { range: `'RDC - Reels'!F${lin}`, values: [[c?.demanda    ?? '']] },
        { range: `'RDC - Reels'!H${lin}`, values: [[c?.competicao ?? '']] },
        { range: `'RDC - Reels'!L${lin}`, values: [[c?.ordem      ?? '']] },
        // Coluna D = Resolução/Modelagem (extra info)
        { range: `'RDC - Reels'!D${lin}`, values: [[c?.modelagem  || '']] },
      ];
    }).flat();

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: planilhaId,
      requestBody: { valueInputOption: 'USER_ENTERED', data: rdcData },
    });

    // ── 3. Aba "Planejamento" — grade dia × horário ───────────────────────────
    // Colunas dos dias: B=Segunda, C=Terça, D=Quarta, E=Quinta, F=Sexta, G=Sábado, H=Domingo
    // Linhas dos horários: 7=10H, 13=12H, 16=14H, 22=18H, 25=20H, 28=22H
    const DIA_COL = {
      Segunda: 'B', Terça: 'C', Terca: 'C', Quarta: 'D',
      Quinta: 'E', Sexta: 'F', Sábado: 'G', Sabado: 'G', Domingo: 'H',
    };
    const HORARIO_LIN = {
      '10H': 9,  '10h': 9,
      '12H': 15, '12h': 15,
      '14H': 21, '14h': 21,
      '18H': 24, '18h': 24,
      '20H': 27, '20h': 27,
      '22H': 30, '22h': 30,
    };

    // Limpa a área de conteúdo antes de escrever
    await sheets.spreadsheets.values.clear({
      spreadsheetId: planilhaId,
      range: 'Planejamento!B9:H30',
    });

    // Indexa planejamento por chave dia|horario
    const planIdx = {};
    (planejamento || []).forEach((p) => {
      planIdx[`${p.dia}|${p.horario}`] = p.conteudo || '';
    });

    // Gera células apenas para os itens do planejamento
    const planData = (planejamento || []).map((p) => {
      const col = DIA_COL[p.dia];
      const lin = HORARIO_LIN[p.horario] || HORARIO_LIN[(p.horario || '').toUpperCase()];
      if (!col || !lin) return null;
      return { range: `Planejamento!${col}${lin}`, values: [[p.conteudo || '']] };
    }).filter(Boolean);

    if (planData.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: planilhaId,
        requestBody: { valueInputOption: 'USER_ENTERED', data: planData },
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
