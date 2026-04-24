# Lynx Local Console Server Package

This directory contains the compiled local-console backend and frontend deliverables only.

## Backend runtime setup

Install backend production dependencies on the target machine before starting the server:

```bash
cd backend
npm ci --omit=dev
node dist/main.js
```

The backend will serve the frontend from `../frontend/dist` automatically when this layout is preserved.
When this package is bundled under the Lynx plugin `server/` directory, the plugin will also try to install
the backend production dependencies automatically on first startup if they are missing.

Useful runtime environment variables:

- `LYNX_LOCAL_CONSOLE_PORT`
- `LYNX_LOCAL_CONSOLE_HOST`
- `LYNX_LOCAL_CONSOLE_DATA_DIR`
- `LYNX_LOCAL_CONSOLE_DB_PATH`
- `LYNX_LOCAL_CONSOLE_FRONTEND_DIST_PATH`

If you are packaging for Linux, do not reuse Windows-built `node_modules`; install dependencies on the target platform.
