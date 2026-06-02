require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');

async function lerPlanilha() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'credentials.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = '1SqR1GO5LdWuS0-N42pZhvcxPIbtx7l14LXaYbnyc8hA';

  const abas = ['Matriz Estratégica - Insta', 'Planejamento'];

  for (const aba of abas) {
    console.log('\n========== ABA:', aba, '==========');
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${aba}'!A1:T50`,
      });
      const rows = res.data.values || [];
      rows.forEach((row, i) => {
        console.log(`L${i+1}:`, JSON.stringify(row));
      });
    } catch(err) {
      console.log('ERRO:', err.message);
    }
  }
}

lerPlanilha();
