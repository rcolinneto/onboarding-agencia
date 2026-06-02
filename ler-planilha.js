require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

async function lerPlanilha() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'credentials.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = '1oHJ4LHRoPSSsURFOP0p1xJvkgEDzKiU1nFD1Hj6-bJU';

  const abas = ['COBO', 'RDC - Reels', 'Matriz Estratégica - Insta', 'Planejamento'];

  for (const aba of abas) {
    console.log('\n========== ABA:', aba, '==========');
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${aba}'!A1:P40`,
      });
      const rows = res.data.values || [];
      rows.forEach((row, i) => {
        console.log(`Linha ${i+1}:`, JSON.stringify(row));
      });
    } catch(err) {
      console.log('ERRO na aba', aba, ':', err.message);
    }
  }
}

lerPlanilha();
