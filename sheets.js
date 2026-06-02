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

// Exporta conteudos e planejamento para as abas da planilha Cobo
async function exportarParaCobo(planilhaId, conteudos, planejamento) {
  try {
    const sheets = await getSheets();
    const pad = (arr, n = 15) => { const r = [...arr]; while (r.length < n) r.push(['']); return r; };

    // Converte "12H" / "12h" / "12:00" → prefixo "12" para comparar com células da planilha
    function horNumero(h) {
      return String(h).replace(/[Hh]$/, '').replace(/:.*/, '').trim();
    }

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
    } catch (_) { /* aba COBO opcional */ }

    // ── 2. Aba "RDC - Reels" — blocos de 7 linhas ────────────────────────────
    const RDC_BLOCOS = [6, 13, 20, 27, 34, 41, 48];
    const sorted = [...(conteudos || [])].sort((a, b) => (a.ordem || 99) - (b.ordem || 99));
    const rdcData = RDC_BLOCOS.map((lin, i) => {
      const c = sorted[i];
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
        requestBody: { valueInputOption: 'USER_ENTERED', data: rdcData },
      });
    } catch (_) { /* aba RDC opcional */ }

    // ── 3. Aba "Planejamento" — 4 blocos semanais com detecção dinâmica ─────────
    const planSheet = (await sheets.spreadsheets.values.get({
      spreadsheetId: planilhaId,
      range: 'Planejamento!A1:H120',
    })).data.values || [];

    const HORAS        = ['10', '12', '14', '18', '20', '22'];
    const DIA_COL_PLAN = {
      Segunda: 'B', Terça: 'C', Terca: 'C', Quarta: 'D',
      Quinta: 'E', Sexta: 'F', Sábado: 'G', Sabado: 'G', Domingo: 'H',
    };

    // Encontra TODOS os blocos: cada linha onde col B === 'SEGUNDA'
    const blocos = [];
    for (let i = 0; i < planSheet.length; i++) {
      if ((planSheet[i][1] || '').toUpperCase() === 'SEGUNDA') {
        const linhaDias = i + 1; // 1-based

        // Detecta horários nas próximas 30 linhas: coluna A começa com "10", "12", ...
        const horMap = {};
        for (let j = i + 1; j < Math.min(planSheet.length, i + 31); j++) {
          const cel = (planSheet[j][0] || '').trim();
          for (const h of HORAS) {
            if ((cel.startsWith(`${h}:`) || cel === h) && !horMap[h]) {
              horMap[h] = j + 1; // 1-based
            }
          }
        }
        blocos.push({ linhaDias, horMap });
      }
    }

    if (blocos.length === 0) throw new Error('Nenhum bloco semanal encontrado na aba Planejamento');

    // Resolve a linha do horário: exata → mais próxima numericamente
    function resolverLinhaBloco(horMap, horario) {
      const num = horNumero(horario || '18H');
      if (horMap[num]) return horMap[num];
      const sorted = Object.entries(horMap)
        .map(([h, l]) => ({ diff: Math.abs(Number(h) - Number(num)), lin: l }))
        .sort((a, b) => a.diff - b.diff);
      return sorted[0]?.lin || null;
    }

    // Limpa todos os blocos com batchClear
    await sheets.spreadsheets.values.batchClear({
      spreadsheetId: planilhaId,
      requestBody: {
        ranges: blocos.map(({ linhaDias }) =>
          `Planejamento!B${linhaDias + 2}:H${linhaDias + 25}`
        ),
      },
    });

    // Busca o sheetId da aba Planejamento para formatação de cores
    let planSheetId = null;
    try {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId: planilhaId,
        fields: 'sheets.properties',
      });
      const tab = meta.data.sheets.find((s) => s.properties.title === 'Planejamento');
      planSheetId = tab?.properties?.sheetId ?? null;
    } catch (_) {}

    // Cores por modelagem (RGB 0–1)
    const CORES = {
      HERO: { red: 1.0,    green: 0.8784, blue: 0.8784 }, // #FFE0E0
      HUB:  { red: 0.8784, green: 0.9333, blue: 1.0    }, // #E0EEFF
      HELP: { red: 0.8784, green: 1.0,    blue: 0.9098 }, // #E0FFE8
    };

    // Monta dados e células para todos os blocos (mesmo planejamento em cada bloco)
    const planData      = [];
    const cellsParaColorir = []; // { rowIndex, colIndex, modelagem }

    for (const { horMap } of blocos) {
      for (const p of (planejamento || [])) {
        const col = DIA_COL_PLAN[p.dia];
        const lin = resolverLinhaBloco(horMap, p.horario);
        if (!col || !lin) continue;

        planData.push({ range: `Planejamento!${col}${lin}`, values: [[p.conteudo || '']] });

        cellsParaColorir.push({
          rowIndex:   lin - 1,                         // 0-based
          colIndex:   col.charCodeAt(0) - 65,          // A=0, B=1...
          modelagem:  (p.modelagem || '').toUpperCase(),
        });
      }
    }

    // Escreve os conteúdos
    if (planData.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: planilhaId,
        requestBody: { valueInputOption: 'USER_ENTERED', data: planData },
      });
    }

    // Aplica cores de fundo por modelagem
    if (planSheetId !== null && cellsParaColorir.length) {
      const colorRequests = cellsParaColorir
        .map(({ rowIndex, colIndex, modelagem }) => {
          const cor = CORES[modelagem];
          if (!cor) return null;
          return {
            repeatCell: {
              range: {
                sheetId:          planSheetId,
                startRowIndex:    rowIndex,
                endRowIndex:      rowIndex + 1,
                startColumnIndex: colIndex,
                endColumnIndex:   colIndex + 1,
              },
              cell: {
                userEnteredFormat: { backgroundColor: cor },
              },
              fields: 'userEnteredFormat.backgroundColor',
            },
          };
        })
        .filter(Boolean);

      if (colorRequests.length) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: planilhaId,
          requestBody: { requests: colorRequests },
        });
      }
    }

    // Atualiza linha 1 (LEGENDAS) com redes ativas
    const hasInsta  = (conteudos || []).some((c) => (c.rede || '').includes('Instagram'));
    const hasTikTok = (conteudos || []).some((c) => (c.rede || '').includes('TikTok'));
    const legendas  = [];
    if (hasInsta)  legendas.push({ range: 'Planejamento!C1', values: [['INSTA ✓']]  });
    if (hasTikTok) legendas.push({ range: 'Planejamento!H1', values: [['TIKTOK ✓']] });
    if (legendas.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: planilhaId,
        requestBody: { valueInputOption: 'USER_ENTERED', data: legendas },
      });
    }

    // ── 4. Aba "Matriz Estratégica - Insta" — detecção dinâmica ──────────────
    try {
      const matSheet = (await sheets.spreadsheets.values.get({
        spreadsheetId: planilhaId,
        range: "'Matriz Estratégica - Insta'!A1:L40",
      })).data.values || [];

      // Encontra linha onde coluna D (index 3) === 'Segunda'
      let linhaDiasMat = -1;
      for (let i = 0; i < matSheet.length; i++) {
        if ((matSheet[i][3] || '') === 'Segunda') {
          linhaDiasMat = i + 1;
          break;
        }
      }

      if (linhaDiasMat === -1) throw new Error('Linha dos dias não encontrada na Matriz');

      // Linhas de atributos: offsets relativos à linha dos dias
      const lC = linhaDiasMat + 3; // Conteúdo
      const lM = linhaDiasMat + 4; // Modelagem
      const lP = linhaDiasMat + 5; // Permeabilidade
      const lF = linhaDiasMat + 6; // Formato
      const lV = linhaDiasMat + 7; // Conversação (CTA)
      const lH = linhaDiasMat + 8; // Horário

      const DIA_COL_MAT = {
        Segunda: 'D', Terça: 'E', Terca: 'E', Quarta: 'F',
        Quinta: 'G', Sexta: 'H', Sábado: 'I', Sabado: 'I', Domingo: 'J',
      };

      const diaMap   = {};
      (planejamento || []).forEach((p) => { diaMap[p.dia] = p; });
      const ideiaMapa = {};
      (conteudos || []).forEach((c) => { ideiaMapa[c.ideia] = c; });

      const TODOS_DIAS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
      const matData = [];

      for (const dia of TODOS_DIAS) {
        const col  = DIA_COL_MAT[dia];
        const item = diaMap[dia];
        const cta  = item ? (ideiaMapa[item.conteudo]?.conversacao || '') : '';
        const M    = "'Matriz Estratégica - Insta'";
        matData.push(
          { range: `${M}!${col}${lC}`, values: [[item?.conteudo       || '']] },
          { range: `${M}!${col}${lM}`, values: [[item?.modelagem      || '']] },
          { range: `${M}!${col}${lP}`, values: [[item?.permeabilidade || '']] },
          { range: `${M}!${col}${lF}`, values: [[item?.formato        || '']] },
          { range: `${M}!${col}${lV}`, values: [[cta]] },
          { range: `${M}!${col}${lH}`, values: [[item?.horario        || '']] },
        );
      }

      // Encontra dinamicamente as linhas de equilíbrio pela coluna J (index 9)
      const EQ_LABELS = ['Hero', 'Hub', 'Help', 'Profundidade', 'Aderência'];
      const eqLinhas  = {};
      for (let i = 0; i < matSheet.length; i++) {
        const jVal = (matSheet[i][9] || '').trim();
        for (const label of EQ_LABELS) {
          if (jVal === label && !eqLinhas[label]) eqLinhas[label] = i + 1;
        }
      }

      const plan   = planejamento || [];
      const counts = {
        Hero:         plan.filter((p) => p.modelagem      === 'HERO').length,
        Hub:          plan.filter((p) => p.modelagem      === 'HUB').length,
        Help:         plan.filter((p) => p.modelagem      === 'HELP').length,
        Profundidade: plan.filter((p) => p.permeabilidade === 'Profundidade').length,
        Aderência:    plan.filter((p) => p.permeabilidade === 'Aderência').length,
      };

      for (const [label, lin] of Object.entries(eqLinhas)) {
        matData.push({
          range: `'Matriz Estratégica - Insta'!K${lin}`,
          values: [[counts[label] ?? '']],
        });
      }

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: planilhaId,
        requestBody: { valueInputOption: 'USER_ENTERED', data: matData },
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
  salvarPlanilhaCobo,
  buscarPlanilhaCobo,
  exportarParaCobo,
  atualizarEtapa,
  buscarEtapas,
};
