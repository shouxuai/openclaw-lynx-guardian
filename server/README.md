# Lynx Server Package

This directory contains the compiled Lynx backend and frontend deliverables only.

## Backend runtime setup

The backend is a self-contained Go executable:

```bash
cd backend
./lynx-server-linux-x64
```

The backend will serve the frontend from `../frontend/dist` automatically when this layout is preserved.
No Node production dependencies are required for the backend.

Useful runtime environment variables:

- `LYNX_LOCAL_CONSOLE_PORT`
- `LYNX_LOCAL_CONSOLE_HOST`
- `LYNX_LOCAL_CONSOLE_DATA_DIR`
- `LYNX_LOCAL_CONSOLE_DB_PATH`
- `LYNX_LOCAL_CONSOLE_FRONTEND_DIST_PATH`

The package normally includes `lynx-server-linux-x64` for the OpenClaw Docker gateway and a current-host binary for local use.
