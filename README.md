# GODTRADE Delta Exchange Proxy

Deploy on Railway for a fixed outbound IP.

## Deploy Steps

1. Push this folder to a GitHub repo
2. Go to railway.app → New Project → Deploy from GitHub
3. Select this repo
4. Railway auto-deploys — takes ~2 minutes
5. Go to your Railway project → Settings → Networking → Generate Domain
6. Visit https://YOUR-DOMAIN/_myip to get the fixed outbound IP
7. Add that IP to Delta Exchange API key whitelist
8. Update VITE_PROXY_URL in your local godtrade2 project

## Endpoints

- GET /_health  — confirms proxy is running
- GET /_myip    — shows Railway's outbound IP (add this to Delta whitelist)
