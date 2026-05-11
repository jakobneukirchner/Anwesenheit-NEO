// netlify/plugins/inject-firebase-config/index.js
// Netlify Build Plugin: Ersetzt {{FIREBASE_*}} Platzhalter in index.html
// mit echten Netlify Environment Variables zur Build-Zeit.

const fs   = require('fs');
const path = require('path');

module.exports = {
  onBuild: async ({ utils }) => {
    const indexPath = path.join(process.cwd(), 'index.html');

    if (!fs.existsSync(indexPath)) {
      utils.build.failBuild('index.html nicht gefunden.');
      return;
    }

    const requiredVars = [
      'FIREBASE_API_KEY',
      'FIREBASE_AUTH_DOMAIN',
      'FIREBASE_PROJECT_ID',
      'FIREBASE_STORAGE_BUCKET',
      'FIREBASE_MESSAGING_SENDER_ID',
      'FIREBASE_APP_ID',
      'FIREBASE_MEASUREMENT_ID'
    ];

    // Prüfen ob alle Variablen gesetzt sind
    const missing = requiredVars.filter(v => !process.env[v]);
    if (missing.length > 0) {
      utils.build.failBuild(
        `Fehlende Netlify Environment Variables: ${missing.join(', ')}\n` +
        'Bitte unter Site settings → Environment variables eintragen.'
      );
      return;
    }

    let html = fs.readFileSync(indexPath, 'utf8');

    requiredVars.forEach(varName => {
      const value   = process.env[varName] || '';
      const pattern = new RegExp(`{{${varName}}}`, 'g');
      html = html.replace(pattern, value);
    });

    fs.writeFileSync(indexPath, html, 'utf8');
    console.log('✅ Firebase Config erfolgreich in index.html injiziert.');
  }
};
