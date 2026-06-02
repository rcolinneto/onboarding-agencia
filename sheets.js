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

module.exports = {
  listarClientes,
  criarCliente,
  atualizarFormSheet,
  buscarRespostasForm,
  salvarDiagnostico,
  buscarDiagnostico,
  salvarAcessos,
  buscarAcessos,
  atualizarEtapa,
  buscarEtapas,
};
