# Prisma sempre acceso, con Docker

L'app desktop pubblica le uscite programmate finché è aperta (anche solo nell'area di notifica).
Se vuoi che Prisma pubblichi anche a computer spento, puoi far girare lo stesso server su una macchina
sempre accesa (un VPS, un NAS, un Raspberry Pi) e collegarci l'app desktop.

## Avvio

1. Crea un file `.env` con almeno:

   ```env
   # Token che l'app desktop usa per collegarsi (openssl rand -hex 32)
   API_TOKEN=
   # Chiave che cifra token e chiavi API (openssl rand -base64 32). Conservala: senza non si
   # leggono più i token salvati.
   TOKEN_ENCRYPTION_KEY=
   ```

2. Copia [`compose.example.yaml`](../compose.example.yaml) come `compose.yaml` e avvia:

   ```sh
   docker compose up -d
   ```

   Il database SQLite sta nel volume `prisma-data` (`/data/prisma.db`): è l'unica cosa da salvare
   nei backup, insieme al `.env`.

3. Nell'app desktop, in **Impostazioni › Dati**, scegli **Server Prisma remoto**, inserisci
   indirizzo e `API_TOKEN` e riavvia Prisma.

## Accesso da fuori casa

L'esempio espone il server solo su `127.0.0.1`. Per raggiungerlo da un altro computer mettilo
dietro un proxy https (per esempio Caddy o Cloudflare Tunnel): il token viaggia in ogni richiesta e
non va mai mandato in chiaro su internet.

## Login delle piattaforme

Con il server remoto il ritorno del login arriva al server, non al tuo PC: imposta nel `.env` gli
indirizzi pubblici https del server e registrali nelle app delle piattaforme, per esempio
`LINKEDIN_REDIRECT_URI=https://prisma.miodominio.it/oauth/linkedin/callback` (lo stesso per
`INSTAGRAM_`, `YOUTUBE_` e `TIKTOK_REDIRECT_URI`). Le credenziali delle app si inseriscono come
sempre dall'app desktop, in **Impostazioni › Account**.

## Note

- I dati non si spostano da soli tra l'app (dati sul computer) e il server: sono due database
  distinti.
- L'immagine è `ghcr.io/code965/prisma-server`, con un tag per ogni versione (`0.1.5`, …) e
  `latest`.
