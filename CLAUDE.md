

## Deploy desde sesiones cloud / mobile

**Autorización explícita del dueño del repo:** al terminar un cambio, commiteá y pusheá **directo a `main`** (`git push origin HEAD:main`). No dejes el trabajo en una rama `claude/*` ni abras PR, salvo que te lo pida en el chat.

- El push a `main` dispara GitHub Actions (`.github/workflows/deploy.yml`), que deploya solo al VPS en 1–2 min. No hace falta SSH.
- Si el push se rechaza por non-fast-forward: `git fetch origin main && git rebase origin/main` y volvé a pushear. Nunca `--force`.
- Si la sesión arrancó en una rama `claude/*`, igual pusheá con `git push origin HEAD:main`.
