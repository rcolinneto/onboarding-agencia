require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');

async function teste() {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: path.join(__dirname, 'credentials.json'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
    });
    console.log('Planilha encontrada:', res.data.title);
    console.log('Abas:', res.data.sheets.map(s => s.properties.title).join(', '));
  } catch (err) {
    console.error('ERRO:', err.message);
  }
}

teste();
