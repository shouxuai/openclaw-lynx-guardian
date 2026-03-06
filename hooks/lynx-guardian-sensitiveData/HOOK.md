---
name: lynx-guardian-sensitiveData
description: "Blocks sensitive data in agent messages"
metadata: {"openclaw":{"emoji":"🔒","events":["agent:bootstrap"]}}
---

# Sensitive Data Blocking Hook

Blocks sensitive data in agent messages.

## What It Does

- Fires on `agent:bootstrap` (before workspace files are injected)
- Blocks messages containing sensitive data
- Terminates the session if sensitive data is detected

## Configuration

No configuration needed. Enable with:

```bash
openclaw hooks enable lynx-guardian-sensitiveData
```
