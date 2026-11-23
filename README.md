<p align="center">
  <img src="design/brand/png/prisma-icona-app-128.png" width="96" height="96" alt="Prisma" />
</p>

<h1 align="center">Prisma</h1>
<p align="center"><b>Social studio</b> · Un’idea, quattro piattaforme.</p>

<p align="center">
  <a href="https://github.com/Code965/Prisma/releases/latest/download/Prisma-Setup.exe"><b>⬇ Scarica Prisma per Windows</b></a>
  ·
  <a href="https://github.com/Code965/Prisma/releases">Tutte le versioni</a>
</p>

---

Prisma è un’app desktop personale per chi crea contenuti tech. Parti da un’idea grezza e Prisma la
trasforma in post pronti per **LinkedIn, Instagram, TikTok, YouTube** e il **blog personale**, li fa
rivedere, li pianifica sul calendario, li pubblica da solo all’orario giusto e poi ne misura i risultati.

Come la luce in un prisma: un’idea entra al centro ed esce divisa in quattro facce, una per piattaforma.

> **Regola fondamentale:** niente viene pubblicato senza la tua approvazione esplicita. Si può
> programmare solo una bozza approvata, e qualsiasi modifica la riporta a bozza.

## Cosa fa

|                       |                                                                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Idee**              | Scrivi le idee, dai un argomento, scegli le piattaforme; elimini quelle che non vanno.                                                                                                                               |
| **Studio**            | L’AI scrive una bozza per piattaforma con la tua voce; la correggi a mano o scrivendo («accorcia», «più tecnico»), con il confronto riga per riga e l’annulla.                                                       |
| **Caroselli**         | Slide generate dal testo del post, template con i colori del tuo brand kit, export in JPEG e PDF.                                                                                                                    |
| **Video**             | Importi un video, Whisper lo trascrive in locale, tagli dal testo (frasi e silenzi), scegli formato e sottotitoli, esporti con FFmpeg. «Genera Short» trova i momenti migliori; FilmCraft per il montaggio avanzato. |
| **Calendario e coda** | Trascini le bozze approvate sugli orari consigliati; lo scheduler pubblica, riprova se serve e non pubblica mai due volte.                                                                                           |
| **Analytics**         | Copertura, follower e interazioni per piattaforma, contenuti migliori, orari consigliati dai tuoi dati e suggerimenti settimanali dell’AI.                                                                           |

## Come è fatto

- **App desktop** (Windows): Electron + React. Tutto gira sul tuo PC: i dati stanno in un database SQLite nella cartella dell’app, e video e file si lavorano con FFmpeg, whisper.cpp e FilmCraft.
- **Motore** (dentro l’app): Fastify + SQLite. Tiene i token delle piattaforme (cifrati), chiama l’AI che scegli tu (Ollama o LM Studio gratis sul tuo PC, oppure DeepSeek, OpenAI, OpenRouter… con la tua chiave) e fa girare lo scheduler.
- **Piattaforme**: API ufficiali di LinkedIn, Instagram, YouTube e TikTok, più la [Blog API](docs/blog-api.md) per pubblicare sul tuo blog personale. File da pubblicare su Cloudflare R2.

Dettagli tecnici, scelte e stato dei lavori sono in [CLAUDE.md](CLAUDE.md).

## Installazione

1. Scarica l’ultima versione:
   **[Prisma-Setup.exe](https://github.com/Code965/Prisma/releases/latest/download/Prisma-Setup.exe)**
   (Windows 10/11, 64 bit). Il link porta sempre alla versione più recente; le precedenti sono in
   [Releases](https://github.com/Code965/Prisma/releases).
2. Apri il file: Prisma si installa per il tuo utente, senza permessi di amministratore, e crea il
   collegamento nel menu Start e sul desktop.

Al primo avvio non c’è nulla da configurare per i dati: stanno sul tuo PC. In **Impostazioni › AI** scegli il
servizio che scrive le bozze (Ollama gratis sul PC, oppure DeepSeek, OpenAI, OpenRouter… con la tua chiave).

Windows potrebbe mostrare «Editore sconosciuto»: l’installer non è firmato. Scegli _Ulteriori
informazioni › Esegui comunque_.

## Aggiornamenti

A ogni avvio Prisma controlla le release su GitHub. Se c’è una versione nuova la scarica in
background e mostra **Aggiornamento disponibile** con le novità: _Aggiorna ora_ (si chiude, si
aggiorna e si riapre), _Più tardi_ (si installa alla chiusura) o _Salta questa versione_.
Puoi controllare anche a mano da **Impostazioni › Versione**.

### Pubblicare una nuova versione

È automatico: **a ogni push su `main`** GitHub Actions controlla il codice (lint, tipi, test),
costruisce l’installer e pubblica una nuova release (0.1.0 → 0.1.1 → 0.1.2…), con i messaggi dei
commit come note. Le modifiche alla sola documentazione non creano una release.

Per passare a una versione minor o major:

```powershell
.\scripts\release.ps1 0.2.0
```

Con `-LocalOnly` crea solo l’installer sul tuo PC, senza commit né push.

## Sviluppo

Serve Node ≥ 22 e pnpm.

```powershell
pnpm.cmd install
pnpm.cmd --filter @prisma-app/desktop dev       # app desktop (il server è dentro)
pnpm.cmd dev                                    # solo il server, per l’anteprima nel browser
pnpm.cmd lint; pnpm.cmd typecheck; pnpm.cmd test
```

Copia `.env.example` in `.env` e compila le chiavi: i segreti stanno solo lì, mai nel repository.

## Contribuire

Segnalazioni e pull request sono benvenute. Prima di una pull request: `pnpm lint`, `pnpm typecheck`
e `pnpm test` devono passare (lo controlla anche la CI). Le convenzioni del progetto sono in
[CLAUDE.md](CLAUDE.md).

## Licenza

[GNU AGPL-3.0](LICENSE): puoi usare, modificare e ridistribuire Prisma; chi distribuisce o offre come
servizio una versione modificata deve renderne disponibile il codice con la stessa licenza.
