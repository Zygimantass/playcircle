# Playcircle

Playcircle is a Tauri v2, React, TypeScript, and Rust desktop app prototype.

## Prerequisites

- Node.js and npm
- Rust and Cargo
- Tauri system dependencies for your operating system

## Install

```sh
npm install
```

## Run the Web App

Start the Vite development server:

```sh
npm run dev
```

Open http://localhost:1420 in your browser.

## Run the Desktop App

Start the Tauri desktop app with Vite hot reload:

```sh
npm run tauri:dev
```

Frontend changes hot reload through Vite. Rust/Tauri changes are watched by `tauri dev` and restart the app process.

## Build

Build the frontend:

```sh
npm run build
```

Build the Tauri app:

```sh
npm run tauri:build
```

## Preview

Preview the production frontend build:

```sh
npm run preview
```

The preview server runs at http://127.0.0.1:1420.

## Tests and Checks

Run the Rust test suite:

```sh
cargo test
```

Run the Playwright tests:

```sh
npx playwright test
```

## Fixtures and Performance Scripts

Generate the Rekordbox demo fixture:

```sh
npm run fixture:rekordbox
```

Available performance scripts:

```sh
npm run perf:load
npm run perf:library
npm run perf:sort
npm run perf:audio
npm run perf:decode
```
