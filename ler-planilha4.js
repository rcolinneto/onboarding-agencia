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

  console.log('\n========== ABA: Planejamento ==========');
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Planejamento'!A1:A120",
    });
    const rows = res.data.values || [];
    rows.forEach((row, i) => {
      if (row[0] && row[0] !== '') {
        console.log(`L${i+1}: "${row[0]}"`);
      }
    });
  } catch(err) {
    console.log('ERRO:', err.message);
  }
}

lerPlanilha();
