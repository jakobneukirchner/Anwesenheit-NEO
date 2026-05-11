#!/usr/bin/env node
// scripts/inject-config.js
// Lokales Entwicklungs-Skript: Liest Firebase-Werte aus .env.local
// und erstellt eine index.local.html mit eingesetzten Werten.
// Nutzung: node scripts/inject-config.js

const fs   = require('fs');
const path = require('path');

const envPath   = path.join(__dirname, '..', '.env.local');
const indexPath = path.join(__dirname, '..', 'index.html');
const outPath   = path.join(__dirname, '..', 'index.local.html');

if (!fs.existsSync(envPath)) {
  console.error('❌  .env.local nicht gefunden. Bitte anlegen (siehe .env.example).');
  process.exit(1);
}

// .env.local parsen
const envVars = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) return;
  const key   = trimmed.slice(0, eqIdx).trim();
  const value = trimmed.slice(eqIdx + 1).trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '');
  envVars[key] = value;
});

const requiredVars = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
  'FIREBASE_MEASUREMENT_ID'
];

const missing = requiredVars.filter(v => !envVars[v]);
if (missing.length > 0) {
  console.error('❌  Fehlende Variablen in .env.local:', missing.join(', '));
  process.exit(1);
}

let html = fs.readFileSync(indexPath, 'utf8');
requiredVars.forEach(varName => {
  html = html.replace(new RegExp(`{{${varName}}}`, 'g'), envVars[varName]);
});

fs.writeFileSync(outPath, html, 'utf8');
console.log('✅  index.local.html erstellt – öffne diese Datei lokal im Browser.');
