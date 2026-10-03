# NomNom 🥣

> **Welche Lebensmittel sind aktuell geöffnet und seit wann?**  
> Eine extrem einfache, private, geteilte Food-Tracking PWA für den Haushalt.

---

## 🌟 Features

- **Fokus auf das Wesentliche**: Zeigt sofort alle aktuell geöffneten Lebensmittel mit Öffnungsdatum und Zeitdauer.
- **Schneller Barcode-Scan**: Barcode per Kamera (`BarcodeDetector`) scannen oder manuell eingeben.
- **Open Food Facts Integration**: Unbekannte Barcodes werden automatisch über Open Food Facts angereichert und lokal in D1 gespeichert.
- **Keine Account-Bürokratie**: Ein Worker entspricht genau einem Haushalt. Zugriff über einen sicheren Haushalts-Token (`AUTH_TOKEN`).
- **Verbrauchshistorie**: Abgeschlossene Items (`finished_at`) bleiben in der Datenbank für spätere Analysen erhalten.
- **PWA-fähig**: Standalone installierbar auf Mobilgeräten mit App-Icon und Offline-App-Shell.

---

## 🏗️ Architektur

- **Backend**: [Hono](https://hono.dev/) auf Cloudflare Workers
- **Datenbank**: Cloudflare D1 (SQLite)
- **Frontend**: Plain HTML5, CSS3 & JavaScript (kein React, kein Bundler, ausgeliefert über Cloudflare Static Assets)
- **Scanner**: Native Browser `BarcodeDetector` API mit manuellem Fallback

```
food-tracker/
├── public/                 # Statische PWA-Dateien
│   ├── index.html          # App-Struktur und Views
│   ├── app.js              # Client-Logik & API-Client
│   ├── style.css           # Modernes UI Design System
│   ├── manifest.webmanifest# PWA-Konfiguration
│   ├── sw.js               # Service Worker für App-Shell-Cache
│   └── icons/              # App-Icons (SVG & 512x512 PNG)
├── src/                    # Worker Backend (Hono + TypeScript)
│   ├── index.ts            # Worker Entrypoint & Routing
│   ├── auth.ts             # Haushalts-Token Middleware
│   ├── products.ts         # Produkt-Endpunkte & Open Food Facts
│   ├── items.ts            # Tracking von geöffneten Lebensmitteln
│   └── types.ts            # TypeScript-Definitionen
├── migrations/             # D1 Datenbank-Migrationen
│   └── 0001_initial.sql
├── wrangler.jsonc          # Cloudflare Worker & D1 Konfiguration
└── package.json
```

---

## 🚀 Lokale Entwicklung

### 1. Abhängigkeiten installieren
```bash
pnpm install
```

### 2. D1 Migrationen lokal anwenden
```bash
npx wrangler d1 migrations apply DB --local
```

### 3. Haushalts-Token konfigurieren
Erstelle eine `.dev.vars` Datei (wird nicht committet):
```ini
AUTH_TOKEN=nomnom-secret-token
```

### 4. Entwicklungsserver starten
```bash
pnpm run dev
```
Die App läuft unter `http://localhost:8787`.

---

## ☁️ Deployment auf Cloudflare

### 1. D1 Datenbank in Cloudflare anlegen
```bash
npx wrangler d1 create nomnom-db
```
Trage die ausgegebene `database_id` in `wrangler.jsonc` ein.

### 2. Migrationen auf Remote anwenden
```bash
npx wrangler d1 migrations apply DB --remote
```

### 3. Haushalts-Token als Worker Secret setzen
```bash
npx wrangler secret put AUTH_TOKEN
```
Gib deinen gewünschten Haushalts-Zugangscode ein.

### 4. Worker & Frontend deployen
```bash
pnpm run deploy
```

---

## 📱 Erste Schritte in der App

1. Öffne die deployte Worker-URL im mobilen Chrome-Browser.
2. Trage beim ersten Start deinen Haushalts-Zugangscode ein.
3. Klicke auf **"Zum Startbildschirm hinzufügen"** / **"App installieren"**.
4. Über den FAB **"Scannen"** Barcode erfassen, öffnen und den Überblick behalten!
