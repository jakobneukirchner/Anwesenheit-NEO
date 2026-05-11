# Anwesenheit-NEO

Modernes, konfigurierbares Anwesenheitsmanagementsystem.

## Tech-Stack
- **Hosting:** Netlify (direkt aus GitHub)
- **Backend:** Firebase Authentication + Firestore
- **Frontend:** Vanilla HTML/CSS/JS – kein Build-Tool nötig

## Setup

### 1. Firebase Projekt erstellen
1. Gehe zu [console.firebase.google.com](https://console.firebase.google.com)
2. Neues Projekt anlegen
3. Authentication aktivieren (E-Mail/Passwort)
4. Firestore Database erstellen
5. Web-App hinzufügen → Web-Config notieren

### 2. Netlify verbinden
1. Repo bei Netlify als neue Site hinzufügen
2. Build command: leer lassen
3. Publish directory: `/` (Root)
4. Unter **Site settings → Environment variables** folgende Variablen eintragen (siehe `.env.example`):

```
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
FIREBASE_MEASUREMENT_ID
```

### 3. Firebase Config in index.html eintragen
Für lokale Entwicklung: Ersetze in `index.html` die `{{PLACEHOLDER}}`-Werte durch deine echten Firebase-Werte.
In Produktion (Netlify): Die Werte werden via Netlify-Environment-Substitution ersetzt (Netlify Build Plugin oder manuell).

> **Tipp:** Firebase Web Config Keys sind grundsätzlich public nutzbar – die Sicherheit kommt über Firestore Security Rules, nicht über Geheimhaltung der Keys.

### 4. Ersten Admin anlegen
1. In Firebase Authentication einen neuen Benutzer anlegen
2. In Firestore unter `users/{uid}` ein Dokument anlegen:
```json
{
  "email": "deine@email.de",
  "displayName": "Admin",
  "roles": ["admin"],
  "groups": [],
  "isActive": true
}
```

## Rollen
| Datenhaltung | Standard-Label |
|---|---|
| `admin` | Admin |
| `coordinator` | Koordinator |
| `teacher` | Trainer |
| `member` | Mitglied |

Rollen-Labels können im Admin-Bereich umbenannt werden.

## Datenmodell (Firestore)

- `users/{uid}` – Benutzerprofile mit Rollen
- `groups/{id}` – Trainingsgruppen
- `events/{id}` – Termine (auch wiederholende)
- `eventAttendance/{eventId_userId}` – Anwesenheitsstatus
- `settings/global` – Globale Einstellungen & Branding

## Lizenz
MIT
