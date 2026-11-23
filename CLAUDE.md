# Prisma

App open source (AGPL-3.0) per gestire i contenuti di un creator tech su LinkedIn, Instagram, TikTok, YouTube e il
blog personale (tramite la Blog API, `docs/blog-api.md`):
idea → bozze per piattaforma generate dall'LLM → revisione → pianificazione → pubblicazione automatica → analytics.

**Regola fondamentale: niente viene pubblicato senza approvazione esplicita.** Si può programmare solo una
variant `approvato`; qualsiasi modifica a una variant approvata la riporta a `bozza`.

**Nome**: l'app si chiamava Cronaca, dal 23 novembre 2026 è **Prisma** (pacchetti `@prisma-app/*`, non `@prisma/*`
che è l'ORM). Compatibilità con i dati
vecchi: `app-data.ts` sposta (o unisce, senza sovrascrivere) `%APPDATA%\@cronaca\desktop` in `%APPDATA%\Prisma`
e rinomina `cronaca.db` → `prisma.db` correggendo i percorsi dei progetti; le preferenze `cronaca.*` si leggono
come ripiego; `origin: 'cronaca'` dei render diventa `prisma`.

## Architettura

Monorepo pnpm, TypeScript ovunque (Node ≥ 22).

| Pacchetto            | Ruolo                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `apps/server`        | Fastify sulla VPS: API, scheduler, token OAuth, chiamate alle piattaforme e all'LLM, metriche                    |
| `apps/desktop`       | Electron + React + Vite: Idee, Studio, Calendario, Coda, editor. Il main process lancia FFmpeg/Whisper/FilmCraft |
| `packages/shared`    | Schemi Zod, enum, tipi DTO e transizioni di stato condivisi                                                      |
| `packages/templates` | Template HTML/CSS per caroselli: `renderSlideHtml` (funzione pura, 1080×1350)                                    |
| `design/mockup`      | Mockup grafico di riferimento (sorgenti `.dc.html` + `tokens.css`)                                               |

- **DB**: MySQL 8 + Drizzle ORM, migrazioni versionate in `apps/server/drizzle`. Date sempre in UTC (`DATETIME(3)`), UI in `Europe/Rome`.
- **Desktop**: SQLite solo per lo stato locale (progetti video, percorsi file).
- **Storage**: Cloudflare R2 (S3) solo per i file finali da pubblicare (fase 2).
- **Auth desktop↔server**: token API personale (`Authorization: Bearer`), single user.
- **LLM**: chiamato dal server (chiave solo nel `.env` della VPS). Interfaccia `LlmProvider`, prima implementazione DeepSeek via SDK OpenAI con base URL custom. Prompt in `apps/server/prompts/*.md`, risposte JSON validate con Zod.
- **Piattaforme**: `PublisherAdapter` con `validate(variant)`, `publish()`, `fetchMetrics()`. Prima di ogni adapter verificare sulla documentazione ufficiale attuale scope, limiti e revisione dell'app.
- **Scheduler**: worker con polling DB, `SELECT … FOR UPDATE SKIP LOCKED`, retry con backoff esponenziale, `idempotency_key` univoca per pubblicazione.
- **Sicurezza**: token OAuth cifrati AES-256-GCM, chiave da `TOKEN_ENCRYPTION_KEY`. Segreti solo in `.env`.

### Stati

Variant: `bozza → da_approvare → approvato → programmato → in_pubblicazione → pubblicato | errore`.
Publication: `programmato | in_pubblicazione | pubblicato | errore | annullato`. Annullare riporta la variant ad `approvato`.
La Publication fa avanzare la Variant nella stessa transazione.

Le transizioni sono in `packages/shared/src/domain/` (`nextVariantStatus`, `nextPublicationStatus`,
`PUBLICATION_TO_VARIANT_ACTION`): il server non cambia mai uno stato senza passare da lì.

| Variant da         | Azioni ammesse                                                                        |
| ------------------ | ------------------------------------------------------------------------------------- |
| `bozza`            | `edit` → bozza, `submit` → da_approvare                                               |
| `da_approvare`     | `edit`/`reject` → bozza, `approve` → approvato                                        |
| `approvato`        | `edit` → bozza, `schedule` → programmato                                              |
| `programmato`      | `unschedule` → approvato, `startPublishing` → in_pubblicazione                        |
| `in_pubblicazione` | `publishSucceeded` → pubblicato, `publishFailed` → errore, `retryLater` → programmato |
| `errore`           | `edit` → bozza, `retry` → programmato, `unschedule` → approvato                       |
| `pubblicato`       | nessuna (finale)                                                                      |

Dall'API l'utente chiede solo `submit`/`approve`/`reject` (più `edit` via PATCH); le altre azioni passano da
coda e scheduler. Modifiche con lock ottimistico (`expectedVersion`). Date nei DTO: ISO 8601 con offset obbligatorio.

## Grafica

L'interfaccia desktop riproduce fedelmente `design/mockup`:

- token di tema da `design/mockup/design/tokens.css` (classi `.th-light` / `.th-dark` sul contenitore radice), nessun colore hardcoded;
- font Inter (UI) e JetBrains Mono (orari, codice, etichette tecniche);
- sidebar comprimibile 224 ↔ 64 px, stato persistito; promemoria approvazione e cambio tema in fondo;
- stati sempre colore + etichetta (`--s-draft`, `--s-review`, `--s-ok`, `--s-sched`, `--s-pub`, `--s-err`);
- colori piattaforma `--li`, `--ig`, `--tt`, `--yt` (+ `Soft`). Icone generiche finché non si adottano i loghi ufficiali;
- niente librerie UI: CSS Modules. Per layout, testi e misure aprire il `.dc.html` della schermata (logica nel blocco `<script type="text/x-dc">`).

## Desktop (`apps/desktop`)

Electron 45 + electron-vite 6 + React 19, cartelle standard di electron-vite:

- `src/main/index.ts`: finestra con `contextIsolation`, `sandbox`, niente `nodeIntegration`; i link esterni si aprono
  nel browser di sistema, la finestra non naviga fuori dall'app. Log di renderer terminato e caricamento fallito.
- `src/preload/index.ts`: espone `window.prisma` (`settings.get/save`, `request`, `openExternal`,
  `exportCarousel`, `showExport`, `uploadFile`, `tools.*`, `video.*`). Compilato in
  CommonJS (`index.cjs`), obbligatorio con la sandbox. Ogni capacità Node in più passa da IPC tipizzato nel main.
- **Collegamento al server** (`src/main/ipc.ts`, `settings.ts`, `ipc-contract.ts`): il token API non arriva mai al
  renderer. Il main lo conserva cifrato con `safeStorage` in `userData/settings.json`, valida con Zod ogni messaggio
  IPC (percorsi relativi, metodi ammessi, URL esterni solo le autorizzazioni OAuth di LinkedIn e Instagram) e inoltra le richieste
  aggiungendo `Authorization`. In sviluppo, senza token salvato, legge `API_TOKEN` dal `.env` alla radice.
- Nell'anteprima nel browser le richieste vanno a `/api/*` e il proxy di `vite.web.config.ts` aggiunge il token
  lato Node; il server di destinazione è `PRISMA_SERVER_URL` (default `http://127.0.0.1:4000`, non `PORT`).
- Dati nel renderer: `services/api/` (trasporto, client con risposte validate dagli schemi di `@prisma-app/shared`,
  una funzione per rotta) e hook TanStack Query in `hooks/` (`queryKeys` centralizzate, aggiornamenti ottimistici).
  La logica pura (filtri, conteggi, date, righe account) sta in `services/*.ts` con i test accanto.
- Date mostrate in `Europe/Rome` (`services/dates.ts`: giorni di calendario italiani, non 24 ore); `useNow()` per
  l'ora corrente nei componenti.
- `src/renderer/src/`: `main.tsx` (font @fontsource inclusi, niente Google Fonts), `App.tsx` (HashRouter),
  `layout/AppShell` (sidebar fissa, contenuto che scorre), `components/` (Sidebar, PlatformIcon, StatusPill, Page,
  Panel, icons/Icon con gli SVG del mockup), `screens/`, `theme/` (ThemeProvider), `services/`, `navigation.ts`.
- `styles/tokens.css` è la copia identica di `design/mockup/design/tokens.css`: il tema è la classe su `<html>`.
- Preferenze locali in `localStorage` (`prisma.tema`, `prisma.sidebar.chiusa`), sempre in try/catch.
- CSP come `<meta>` aggiunta solo alla build (plugin `prisma-csp` in `electron.vite.config.ts`): i file `file://`
  non hanno header HTTP e in sviluppo Vite inietta script inline.
- `renderer.config.ts` è condivisa tra Electron e `vite.web.config.ts`, che serve il solo renderer nel browser
  (porta 5174, configurazione `desktop-web` in `.claude/launch.json`) per confrontarlo con il mockup.
- Schermate pronte: **Dashboard**, **Idee** (inserimento con tag, filtri con conteggi, eliminazione con conferma, piattaforme per idea salvate
  subito, «Genera contenuti» che apre lo Studio), **Studio**, **Calendario**, **Coda** e **Impostazioni** (server,
  brand, account con «Collega» per LinkedIn e Instagram e il modulo del blog con indirizzo e chiave), **Template e brand kit** ed
  **Editor carosello** ed **Editor video** (libreria `/video` ed editor `/video/:id`) e **Analytics**.
- **Video, passo 3a** (`src/main/video/`, `screens/Video/`, `Impostazioni/VideoToolsSection.tsx`):
  - Strumenti esterni (`tools.ts`): FFmpeg, ffprobe, whisper.cpp (`whisper-cli.exe`), modello `ggml-*.bin` e FilmCraft. Si
    cercano nel PATH, nei collegamenti di winget (`%LOCALAPPDATA%\Microsoft\WinGet\Links`, assenti dal PATH di
    un'app già aperta) e in `userData/whisper-models` (vince il modello più grande); un percorso scelto nelle
    Impostazioni («Scegli…», finestra di sistema dal main) ha la precedenza ed è salvato in
    `userData/video-tools.json`. Ogni programma viene provato (`-version`, `-h`): un percorso che non parte è un errore.
  - Stato locale in SQLite (`store.ts`, `node:sqlite` di Electron 45/Node 24: niente moduli nativi) in
    `userData/prisma.db`, migrazioni con `PRAGMA user_version`. Tabella `video_projects` con il progetto in JSON
    (`VideoProjectSchema` in shared). Togliere un progetto non cancella il file.
  - Import: finestra di sistema → `ffprobe` (`parseProbe`: durata, dimensioni, fps, codec, audio; i video ruotati
    del telefono si raddrizzano) → progetto.
  - Riproduzione con il protocollo `prisma-media://video/<uuid>` (`media-protocol.ts`, privilegi `stream` per i
    Range): serve solo i file sorgente dei progetti registrati, mai percorsi arbitrari. CSP con
    `media-src 'self' prisma-media:`; `connect-src` non lo include, quindi il renderer non può leggerne i byte.
  - Verificato nell'app vera via DevTools: strumenti, archivio, player (con la CSP della build). Lo screenshot via
    `Page.captureScreenshot` resta appeso se la finestra non è in primo piano.
- **Trascrizione, passo 3b** (`src/main/video/{process,whisper,transcription}.ts`, `screens/Video/TranscriptPanel.tsx`):
  - whisper.cpp verificato su README ed `examples/cli` (novembre 2026): legge WAV a 16 bit, quindi prima FFmpeg
    estrae l'audio a 16 kHz mono (`-progress pipe:1` per l'avanzamento); poi
    `whisper-cli -m <modello> -f audio.wav -l it|en|auto -t <thread> -ojf -of <base> -pp`. Si usa `-ojf` (token con
    `offsets` in ms) e non `-ml 1`, che il README dichiara sperimentale. `-pp` stampa su stderr
    «whisper_print_progress_callback: progress = 45%» ogni 5%.
  - `parseWhisperJson`: un token che inizia con spazio apre una parola, pezzi e punteggiatura si attaccano alla
    precedente, i token speciali (`[_BEG_]`, `[_TT_…]`) si scartano; probabilità media per parola.
  - `runProcess`: `spawn` senza shell, righe di stdout/stderr man mano, annullabile con `AbortSignal`. Un lavoro alla
    volta per progetto; file temporanei in `userData/video-lavoro/<id>/`, cancellati sempre. Thread di whisper:
    processori − 1, al massimo 8.
  - Avanzamento con l'evento IPC `video:progress` (`window.prisma.video.onProgress`, restituisce la funzione per
    smettere di ascoltare). La trascrizione (`TranscriptSchema`: lingua, modello, parole con `startMs`/`endMs`/`p`)
    sta in `project.transcript`.
  - `transcriptSegments` (shared): frasi chiuse da punteggiatura o pausa ≥ 600 ms, silenzi ≥ 1 s (anche a inizio e
    fine). Base dell'editor del 3c. Nel pannello: riepilogo, prime frasi e parole incerte (p < 0,5) sottolineate.
  - Provato con whisper.cpp vero (release ufficiale `b5454` = v1.9.5, `whisper-bin-x64.zip`, estratto in
    `%LOCALAPPDATA%\Programs\whisper.cpp\Release`, percorso impostato nelle Impostazioni) e `ggml-small.bin` in
    `userData/whisper-models`, su voce italiana sintetica (sintesi vocale di Windows) dentro un video di prova: testo
    esatto, lingua `it`, silenzio di 2 s riconosciuto; 16 s di audio in circa 6 s sulla CPU, anche dall'app vera via
    IPC. L'avanzamento `-pp` arriva per finestre di 30 s: un audio breve passa da 0 a 100, uno di 80 s dà 31/69/100.
- **Editor video, passo 3c** (`screens/Video/{VideoEditor,PlayerPanel,TranscriptAside,EditorTimeline}.tsx`):
  - Modifiche in `project.edit` (`VideoEditSchema` in `packages/shared/src/schemas/video-edit.ts`): `cuts`
    (intervalli tagliati, sempre fusi), `format` 9:16/1:1/16:9, `cropOffset` 0–1 lungo l'asse libero, `subtitles`
    clean/word/box/big. Il sorgente non cambia: il render (3d) userà le stesse funzioni pure (`keptRanges`,
    `cropRect`, `buildCaptions`, `editedTimeMs`, `skipCuts`…).
  - Salvataggio automatico dopo 400 ms senza modifiche (IPC `video:save-edit`); l'editor è montato con chiave
    `project.id`.
  - Player: sorgente con riquadro del formato trascinabile (`draggedOffset`, si salva al rilascio), sottotitoli nello
    stile scelto (`captionAt`), riproduzione che salta i tagli controllando a ogni fotogramma, tempo e barra sul
    video montato (`sourceTimeMs` per tornare al sorgente).
  - Trascrizione: clic su una frase o un silenzio per tagliarli/ripristinarli, clic sull'orario per andarci; frase
    in riproduzione evidenziata; «Rimuovi silenzi» taglia tutti i silenzi con un avviso. Senza trascrizione la colonna
    mostra il pannello per farla.
  - Timeline: video e sottotitoli seguono i segmenti (tagli tratteggiati), clic per spostarsi; testi/overlay e musica
    sono tracce vuote fino al render.
  - Verificato nell'app vera (progetto di prova via DevTools: tagli, silenzi, formato, salvataggio nel DB) e nel
    browser con `window.prisma` simulato per vedere il layout (riquadro trascinato col mouse, sottotitoli). Colori
    delle tracce `--trVideo/--trSub/--trOver/--trMusic/--trText` in `screen-tokens.css`.
- **Render, passo 3d** (`src/main/video/{render,render-plan,ass}.ts`, `screens/Video/ExportVideoPanel.tsx`):
  - Un passaggio di FFmpeg: per ogni parte rimasta `trim`/`atrim` con `setpts`/`asetpts`, `concat`, `crop` del formato,
    `scale` a 1080×1920 / 1080×1080 / 1920×1080 (lanczos), `setsar=1`, `subtitles`; H.264 CRF 20 `yuv420p` + AAC 160k,
    `+faststart`. Il grafo va in `filtri.txt` letto con `-/filter_complex` (serve FFmpeg ≥ 7: con molti tagli la
    riga di comando di Windows sarebbe troppo lunga); FFmpeg gira nella cartella di lavoro, così grafo e `.ass` hanno
    nomi relativi e i percorsi con «:» e «\» non vanno protetti. Senza audio niente `atrim`.
  - Sottotitoli ASS (`buildAss`) con `PlayResX/Y` del formato, font Segoe UI (libass non legge i WOFF2), tempi del
    video montato (`editedTimeMs`). «Parola per parola» = una riga per parola con la parola attiva gialla (il fondo
    giallo per parola del mockup non si fa in ASS); «Grande al centro» = solo la parola attiva in maiuscolo; «Riquadro
    scuro» = `BorderStyle 3`.
  - Output in `userData/esportazioni/video-<id>/<istante>-9x16.mp4` (stessa cartella dei caroselli, quindi
    caricabile su R2); sha256 a flusso; `project.render` con `renderKey` = sha256 di `videoRenderKey` (sorgente,
    modifiche, parole): `video:render-status` dice se il file è superato. Errore o annullamento → file a metà cancellato.
  - «Collega a» una bozza YouTube/TikTok/Instagram/LinkedIn: `PUT /variants/:id/assets/video` sul server. A differenza
    dei caroselli il server non può verificare il video, che cambia ciò che verrà pubblicato: la variant passa da
    `edit` (torna bozza), prende il formato video della piattaforma (`VIDEO_VARIANT_FORMAT`: reel per Instagram,
    video per le altre), revisione «Video collegato», video precedente sostituito. Poi caricamento su R2.
  - Caricamento su R2 a flusso (`createPutFile`, `https.request` con `Content-Length`: R2/S3 non accettano upload
    «chunked» firmati), timeout solo se la connessione resta ferma 2 minuti.
  - Provato con FFmpeg 9.1 vero (winget `Gyan.FFmpeg`, rilevato dai collegamenti di winget) su video sintetici
    (`testsrc2` + tono): 9:16 con sottotitoli parola per parola dopo i tagli, 1:1 «Grande al centro», 16:9 «Riquadro
    scuro», sorgente verticale senza audio con 150 tagli (grafo da file), estrazione del WAV per Whisper; anche
    dall'app vera via IPC. I tagli cadono sul fotogramma più vicino: con molti tagli brevi la durata reale è un po'
    minore di quella calcolata, quindi dopo l'export si misura con ffprobe (`measureDurationMs`). Il PUT a flusso è
    provato con un server http locale.
- **Genera Short, passo 3e prima parte** (`packages/shared/src/schemas/shorts.ts`, `modules/ai/shorts.ts`,
  `services/shorts.ts`, `useGenerateShorts`):
  - Il desktop manda a `POST /shorts/generate` le frasi parlate della trascrizione (`shortSegments`, tempi del
    sorgente, non del montaggio), il titolo e la durata. Una chiamata LLM (`generate-shorts.{system,user}.md`) sceglie
    fino a 3 momenti indicando i **numeri delle frasi** (così i tagli cadono a fine frase) e scrive i testi per
    YouTube/TikTok/Instagram. Lo schema della risposta è costruito sulla richiesta (`generatedShortsSchema`): frasi
    esistenti, durata 10–90 s (`SHORT_LIMITS`, da riverificare con gli adapter del 3f), niente sovrapposizioni, un
    testo per piattaforma; gli errori tornano al modello che ritenta.
  - Un'unica transazione crea un contenuto in bozza per momento (senza idea), con variant `short` (YouTube), `video`
    (TikTok), `reel` (Instagram) e revisione `llm_generate`. Poi il main crea per ciascuno un progetto video
    (`video:create-short`): stesso file e trascrizione, `shortEdit` taglia fuori dal momento, conserva i tagli interni,
    formato 9:16; `project.short` ricorda video lungo, contenuto e momento. Nell'elenco «Short · 0:28 · 9:16»; nel
    «Video finale» la bozza proposta è quella del suo contenuto.
  - Provato con il server vero e un DeepSeek finto in locale (contenuti creati e poi cancellati) e il renderer nel
    browser con `window.prisma` simulato.
- **FilmCraft, passo 3e seconda parte** (`src/main/video/filmcraft/`, `screens/Video/FilmcraftControl.tsx`,
  `services/filmcraft.ts`), sperimentale. FilmCraft 0.20.1 (storytold/filmcraft, installato dal launcher di ArtCraft in
  `C:\Program Files\ArtCraft\FilmCraft`): comandi e parametri verificati con `filmcraft-cli commands` e
  `docs/control-protocol.md` (novembre 2026).
  - Rilevamento come strumento video `filmcraft` (`filmcraft.exe`, cercato anche in `%ProgramFiles%\ArtCraft\FilmCraft`
    e `%LOCALAPPDATA%\Programs\ArtCraft\FilmCraft`); si prova `filmcraft-cli.exe --version` accanto, perché l'app
    grafica con `--version` stampa la versione ma non esce.
  - «Apri in FilmCraft»: in `userData/filmcraft/<id>/` Prisma scrive `sequenza.otio` (`buildOtio`: una clip per parte
    rimasta, fotogrammi del sorgente, file come `ExternalReference` `file:///`) e `sottotitoli.srt` (`buildSrt`, tempi
    del video montato), poi con la CLI headless: `--save-as progetto.fcproj import sequenza.otio` (`file.import` accetta
    l'OTIO e collega il media), `inspect sequence` per gli id delle clip, `run passi.jsonl` con `sequence.settings`
    (1080×1920 / 1080×1080 / 1920×1080), `effects.setParam` Motion `scale`/`position` che riproducono il ritaglio
    (`setupCommands`, posizione in pixel della sequenza) e `captions.import`. Poi
    `filmcraft.exe --control <porta libera> --no-recover progetto.fcproj` con `FILMCRAFT_CONTROL_TOKEN` (64 hex casuali)
    solo nell'ambiente. Il `.fcproj` si crea alla prima apertura; «Ricrea dal montaggio di Prisma» (con conferma)
    lo rifà quando le modifiche di Prisma sono cambiate (`editKey` = sha256 di `videoRenderKey`).
  - Canale di controllo (`control.ts`): TCP 127.0.0.1, una riga JSON per richiesta; appena avviata l'app risponde
    «still starting» e si ripete; dopo 2 minuti di silenzio FilmCraft chiude il socket e il client si riconnette.
  - Export e rientro: con l'app aperta da Prisma `file.save`, `file.exportMedia {path, format: h264, burnCaptions:
true, range: entire, wait: false}` e `jobs.list` ogni secondo (`progress`, `finished`, `result`) → evento
    `video:progress` con fase `filmcraft`; annullabile con `jobs.cancel`. Senza canale (app chiusa o aperta da
    un'altra sessione) esporta l'ultimo salvataggio con `filmcraft-cli --project … exec file.exportMedia … wait=true`.
    File in `userData/esportazioni/video-<id>/<istante>-filmcraft.mp4`, misurato con ffprobe → `project.filmcraft.
returned`. «Usa la versione rientrata» lo mette in `project.render` con `origin: 'filmcraft'` (sempre aggiornato:
    è stato montato in FilmCraft), poi si collega a una bozza come il render di Prisma.
  - Stati del mockup (`filmcraftView`): «Aperto in FilmCraft · in attesa dell'esportazione», «Rientrato: <file> ·
    19:58», «Sincronizzato · video finale delle 19:58». I sottotitoli in FilmCraft hanno il suo stile (riquadro
    scuro): lo stile «parola per parola» resta del render di Prisma.
  - Provato con FilmCraft vero dalla CLI e dall'app Electron via DevTools (video sintetico con voce, trascrizione
    whisper, taglio, 9:16 con ritaglio al 30%): export di 14,2 s in 25 s con avanzamento, fotogramma con ritaglio e
    sottotitoli giusti; dall'app grafica l'export va a ~34 fps, dalla CLI headless a ~9,5. File di prova cancellati.
- **Analytics** (`screens/Analytics/`, `services/analytics.ts`, `hooks/useAnalytics.ts`): come il mockup, con
  metrica (Copertura, Follower, Interazioni) e periodo; quattro riquadri con totale, variazione dell'ultimo
  intervallo sul precedente («+27% sett.», «giorno» a 30 giorni), barre proporzionate (l'ultima piena, quelle
  senza dati grigie) e una nota: cosa c'è dietro la metrica o cosa fare se mancano i dati. Contenuti migliori
  (copertura in «k» già da 1.000 come nel mockup, il titolo apre il post). A destra i suggerimenti dell'AI
  (`InsightsPanel`: «DeepSeek · aggiornati lunedì 23 nov», «Aggiorna»; «Crea un'idea su questo» aggiunge l'idea
  proposta, «Apri il calendario», «Apri editor video»; con pochi dati il motivo) e «Metriche LinkedIn da inserire»: impressioni, reazioni, commenti, diffusioni per post.
  Verificato nel browser con un'API finta (temi chiaro e scuro).
- **Editor carosello** (`screens/Carosello/`, rotte `/carosello` e `/carosello/:contentId/:variantId`): senza variant
  elenca i contenuti con bozze LinkedIn/Instagram/TikTok; dallo Studio si arriva con «Crea il carosello» / «Modifica
  le slide» (solo a bozza salvata). Senza slide: «Genera dal testo del post» (LLM) o «Parti da zero»
  (`starterCarousel`). Con slide: miniature, anteprima al 40%, campi della slide (layout, titolo con contatore /60,
  testo, codice, etichetta), sposta/elimina/aggiungi (max 10), selettore del template, «Salva carosello». Bozza
  locale in `CarouselBody` con chiave `id:version`; slide selezionata e chat stanno in `CarouselEditor` e
  sopravvivono ai salvataggi. Chat «Modifica la slide scrivendo» in memoria (non in `chat_messages`): lavora sulla
  versione salvata, quindi con modifiche locali chiede di salvare; le proposte di titolo si applicano con «Usa».
  Logica pura in `services/carousel.ts`.
- **Export** (`src/main/export/`, `screens/Carosello/ExportControls.tsx`): «Esporta JPG» (Instagram, TikTok) ed
  «Esporta PDF» (LinkedIn; il formato della piattaforma è il pulsante principale), solo nell'app desktop e a carosello
  salvato. Il renderer manda via IPC slide salvate, brand kit e iniziali (validati con Zod nel main); il main li
  ridisegna con `renderSlideHtml`/`renderCarouselPdfHtml` e i font incorporati come data URL (`?asset`, esclusi
  dall'esternalizzazione in `electron.vite.config.ts`). JPEG (qualità 92): finestra offscreen + protocollo DevTools
  (`Emulation.setDeviceMetricsOverride` 1080×1350 densità 1, poi `Page.captureScreenshot`), perché le finestre nascoste
  vengono ristrette all'altezza dello schermo e `capturePage` offscreen non è affidabile. PDF: `printToPDF` con
  `preferCSSPageSize` (pagine 810×1013 pt, testo vettoriale). Ogni passo ha un timeout. File in
  `userData/esportazioni/variante-<id>/<istante>-<formato>/`; `showExport` apre solo percorsi lì dentro. Poi il server
  registra i file sulla variant e il pannello «File esportati» mostra se sono ancora aggiornati e se sono su R2.
- **Caricamento su R2** (`src/main/export/upload.ts`, `hooks/useExport.ts`): se `GET /storage/status` dice che R2 è
  configurato, dopo l'export ogni file va su R2: il server firma l'indirizzo, il main legge il file e fa il PUT
  (IPC `upload:file`: solo file della cartella degli export, solo host `*.r2.cloudflarestorage.com` in https, solo
  l'header `Content-Type` firmato), poi il server verifica. «Carica su R2 (n)» riprova quelli rimasti indietro.
- Per provare l'export senza cliccare: build, Electron con `--remote-debugging-port`, e `window.prisma.exportCarousel`
  dal renderer tramite `Runtime.evaluate`. Uno script di prova che usa solo il modulo deve registrare
  `app.on('window-all-closed')`, altrimenti Electron si chiude quando si distrugge la prima finestra di export.
- Le slide sono iframe `srcdoc` scalati (`components/SlideFrame`) con l'HTML di `renderSlideHtml`: `sandbox`
  senza script e con `allow-same-origin` per caricare i font dell'app (`slide-fonts.ts`, file `@fontsource` importati
  con `?url`, indirizzi assoluti). `useSlideRenderer` unisce brand kit, iniziali e font.
- **Template e brand kit** (`screens/Template/`): galleria dei 6 template con miniature disegnate con i colori del
  kit in bozza (si vede subito l'effetto di una modifica); pannello Brand kit con 5 colori a ruolo fisso (campione
  cliccabile con il selettore nativo), font fissi, logo (data URL ≤ 256 KB, PNG/JPEG/WebP/SVG, anteprima su fondo
  scuro e chiaro), handle; «Salva brand kit» solo se qualcosa è cambiato. Pannello Voce: regole a etichette salvate
  subito nel kit, esempi di post con piattaforma e nota. Logica pura in `services/brand-kit.ts`.
- **Studio** (`screens/Studio/`): tab per piattaforma con stato, anteprima nel feed per le 4 piattaforme (i media
  sono riquadri con i colori fissi del mockup), campi specifici con contatori (`TEXT_LIMITS`: LinkedIn verificato,
  gli altri da riverificare con i rispettivi adapter), hashtag, chat «Modifica scrivendo» con diff riga per riga
  ricostruito dalle revisioni e «annulla» (ripristino della revisione precedente, solo se la modifica è ancora in
  vigore). La bozza locale vive in `StudioBody`, montato con chiave `id:version`: dopo ogni salvataggio riparte dal
  testo salvato. «Approva» esegue `approvalSteps` (salva se serve, `submit`, `approve`): la macchina a stati non
  permette di saltare `da_approvare`. Controlli delle fasi 2-3 (PDF, copertine, video, visibilità) sostituiti da note.
- Token locali delle schermate del mockup (es. `--del`/`--add` del diff) in `styles/screen-tokens.css`.
- **Calendario** (`screens/Calendario/`): slot consigliati dal server (`useRecommendedSlots`, `slotMap`: dai dati
  o predefiniti; le funzioni di `services/calendar.ts` ricevono la mappa degli slot), con la nota in fondo che dice
  per quali piattaforme sono calcolati. Vista settimana (righe 8-21, allargate per uscite fuori fascia) e mese.
  Nella griglia ci sono le pubblicazioni non annullate; in «Da pianificare» le variant senza orario, e si trascinano
  solo quelle `approvato` (regola fondamentale). Trascinare una variant la programma sull'account collegato della
  sua piattaforma; trascinare una pubblicazione `programmato` la sposta (aggiornamento ottimistico); gli slot già
  passati non accettano il rilascio. «Usa orari consigliati» sposta le uscite del contenuto selezionato all'ora consigliata dello stesso giorno,
  e non tocca quelle in giorni senza slot. Orari in Europe/Rome con `services/zoned-time.ts` (giorni `YYYY-MM-DD`,
  conversione in UTC corretta anche nei cambi d'ora, testata).
- **Coda** (`screens/Coda/`): post `programmato`/`in_pubblicazione` con conto alla rovescia verso `next_attempt_at`
  (quando lo scheduler agirà davvero: dopo «Pubblica ora», «Riprova» o un backoff può differire dall'orario
  programmato; dopo un tentativo fallito l'etichetta è «nuovo tentativo tra»). I controlli dei requisiti arrivano da
  `GET /publications/checks?brandId=` (stessi `validate()` dello scheduler, più account e scadenza del token; per le
  piattaforme senza adapter un avviso che il post resta in coda). «Pubblica ora» e «Annulla» chiedono conferma;
  «Sposta» porta al calendario. Il log mostra pubblicati (link «Apri post»), errori («Riprova») e annullati.
- **Dashboard** (`screens/Dashboard/`): saluto con il nome del brand in base all'ora italiana, settimana in corso,
  prossime 5 uscite, account, idee nuove e «Ultimi 7 giorni» come nel mockup (`weekMetricCards`: follower o
  iscritti, variazione e copertura della settimana con cosa misura su quella piattaforma).
- Il drag & drop HTML5 non si completa con il mouse simulato dagli strumenti di automazione: per verificarlo si
  inviano `DragEvent` con un `DataTransfer` dalla console della pagina.
- La dettatura vocale è disattivata fino alla fase 3 (Whisper). Il brand della sidebar arriva da `/brands`.
- Nota sul token `--rec`: in `tokens.css` è lo sfondo verde degli slot consigliati; nel mockup Idee lo stesso nome
  è il rosso della registrazione vocale. Per la registrazione servirà un token distinto.

## Installazione, intro e aggiornamenti (desktop)

- **Logo**: sorgenti in `design/brand/` (simbolo, icona, `prisma.ico`, LEGGIMI con colori e usi); `apps/desktop/build/`
  ha `icon.ico` (eseguibile e installer) e `icon.png` (icona della finestra in sviluppo).
- **Intro** (`src/main/splash.ts`): finestra senza cornice 520×320 su `#101318` con il simbolo animato (le quattro facce
  si uniscono), «Prisma», «Un’idea, quattro piattaforme.», «Social studio · v<versione>» e una barra di caricamento.
  Documento statico in data URL con CSP senza script, font incorporati. Resta almeno 1,8 s, poi lascia il posto alla
  finestra principale quando è pronta (al massimo 20 s).
- **Installer**: `pnpm --filter @prisma-app/desktop dist` → electron-builder (`electron-builder.yml`), NSIS per
  utente, `apps/desktop/release/<versione>/Prisma-Setup.exe` (nome fisso: il link
  `https://github.com/Code965/Prisma/releases/latest/download/Prisma-Setup.exe` scarica sempre l'ultima) + `.blockmap` + `latest.yml` (cartella
  ignorata da git). Tutte le dipendenze del desktop sono `devDependencies` incluse nel bundle di electron-vite, così il
  pacchetto non ha `node_modules`; `electronDist` usa l'Electron già installato. Installer non firmato.
- **Release automatiche** (`.github/workflows/release.yml`): a ogni push su `main` (escluse le modifiche solo a
  Markdown, `docs/`, mockup e licenza) un job Ubuntu fa lint, typecheck e test, poi un job windows-latest calcola la
  versione (la prima è quella di `apps/desktop/package.json`; poi patch dell'ultimo tag + 1, salvo che il
  package.json sia più alto), scrive la versione nell'app, crea l'installer (`--publish never`) e
  `gh release create v<versione> --target <commit>` con installer, `.blockmap` e `latest.yml`. Note = messaggi dei
  commit dall'ultimo tag. Anche a mano da Actions › Release › «Run workflow». `scripts/release.ps1 0.2.0` alza solo la
  versione di base (commit + push); `-LocalOnly` crea l'installer sul PC. `ci.yml`: gli stessi controlli sulle pull
  request. L'app scarica gli aggiornamenti dalle release di `Code965/Prisma` (pubblico), senza token.
- **Aggiornamenti** (`src/main/updates.ts`, `update-state.ts`, `components/UpdateDialog`, `Impostazioni/UpdatesSection`):
  electron-updater, solo nell'app installata (`app.isPackaged`). 3 s dopo l'apertura cerca e scarica in background; a
  download finito il renderer apre «Aggiornamento disponibile» (come NaviFox: versioni, novità dalle note della
  release, Salta questa versione / Più tardi / Aggiorna ora). «Più tardi» installa alla chiusura; la versione saltata
  sta in `userData/updates.json` e non riapre la finestra, ma «Verifica aggiornamenti» la mostra comunque. Gli errori
  all'avvio (offline) non aprono nulla. Stato via IPC `updates:*` ed evento `updates:changed`.
- L'app installata condivide `%APPDATA%\Prisma` con quella di sviluppo; il token API va salvato nelle Impostazioni
  (il ripiego su `API_TOKEN` del `.env` vale solo in sviluppo).
- Verifica fatta: installer 0.1.0 creato, `win-unpacked\Prisma.exe` avviato con `--remote-debugging-port` e
  screenshot via CDP dell'intro e della finestra principale.

## Convenzioni

- Nomi di dominio in italiano dove compaiono in UI/stati, codice e identificatori in inglese.
- Server: `modules/<nome>/{routes,service,repository}.ts`; la logica di dominio pura in `domain/`.
- Nessuna logica di business nei componenti React: va in `services/` e hook.
- Funzioni piccole, nomi chiari, tipi da `@prisma-app/shared` (che esporta i sorgenti TS direttamente).
- Import ESM con estensione `.js`; `import type` per i tipi.
- Test con Vitest accanto al codice (`*.test.ts`) o in `test/`. Mock delle API esterne negli adapter.
- Test di integrazione (`*.int.test.ts`): usano il MySQL del `.env` dentro `withRollback`
  (`test/helpers/integration.ts`), una transazione sempre annullata, con orologio fisso `NOW`.
  Senza `DATABASE_URL` vengono saltati.

## Comandi

```
pnpm install
pnpm lint | pnpm typecheck | pnpm test | pnpm format
pnpm dev              # server in watch (tsx), legge il .env alla radice
pnpm --filter @prisma-app/desktop dev       # app Electron in sviluppo
pnpm --filter @prisma-app/desktop dev:web   # solo il renderer nel browser (http://localhost:5174)
pnpm --filter @prisma-app/desktop build     # build di main, preload e renderer in apps/desktop/out
pnpm db:generate      # nuova migrazione dopo una modifica a apps/server/src/db/schema.ts
pnpm db:migrate       # applica le migrazioni
pnpm db:seed          # brand e tag iniziali (idempotente)
pnpm db:up            # MySQL in Docker, alternativa al MySQL locale
```

## Server

- `src/app.ts` costruisce Fastify con le dipendenze iniettate (`buildApp(deps)`), così i test usano `app.inject` senza DB.
- `src/services.ts` compone i servizi con un `DbExecutor` (database o transazione) e un orologio `now()`.
- Auth: hook `onRequest` con bearer token confrontato a tempo costante; pubblico solo `/health`.
- Errori: `ZodError` → 400, `NotFoundError` → 404, `InvalidTransitionError`/`VersionConflictError`/`ConflictError`/chiave duplicata → 409, `BusinessRuleError` → 422, il resto → 500 senza dettagli.
- Gli stati cambiano solo tramite `applyVariantTransition` e `applyPublicationTransition`
  (`modules/*/transitions.ts`): bloccano la riga (`FOR UPDATE`), validano con la macchina a stati
  condivisa e aggiornano pubblicazione e variant nella stessa transazione. Lo scheduler userà le stesse funzioni.
- `idempotency_key` = sha256(variant:account:versione approvata): la stessa versione non si programma due volte.
- UTC: `mysql2` con `timezone: 'Z'` e `SET time_zone = '+00:00'` su ogni connessione (il MySQL locale è in CET,
  senza la seconda i `CURRENT_TIMESTAMP` dei default sarebbero un'ora avanti).
- Token cifrati in colonne `bytes` (VARBINARY letto come `Buffer`).

### Brand kit e voce (`modules/brand-kit/`)

- `brands.kit` (JSON, null = `DEFAULT_BRAND_KIT` coi colori del mockup) e tabella `voice_examples`; migrazione
  `0002_brand_kit`. Schemi in `@prisma-app/shared` (`BrandKitSchema`, `VoiceExampleInputSchema`).
- Colori con ruolo fisso (`ink`, `paper`, `accent`, `accentSoft`, `code`) perché i template sappiano quale usare;
  handle salvato senza «@»; logo come data URL validato (tipo e dimensione), così le slide esportate non dipendono
  da file esterni.
- La voce entra nei tre prompt di sistema (`{{voice}}` in generate-variants, generate-article, edit-variant):
  `formatVoice` mette le regole e gli ultimi 6 esempi (max 1200 caratteri ciascuno); senza indicazioni una frase
  neutra. L'AI service riceve `voice(brandId)` come dipendenza.

### Caroselli (`packages/shared/src/schemas/carousel.ts`, `packages/templates`)

- Le slide stanno in `metadata.carousel` della variant (`template`, `kicker`, `slides` da 1 a 10, ciascuna con
  `kind` cover/text/list/code/cta, `title`, `body`, `code`): valgono versioni, revisioni e la regola fondamentale.
  Il numero massimo di slide va riverificato con l'adapter Instagram.
- `renderSlideHtml({ carousel, index, kit, initials, fontFaceCss })` produce un documento HTML completo 1080×1350 con
  CSS inline, testi con escape e una CSP che vieta gli script. Misure del mockup (anteprima al 40%) × 2,5. Lo stesso
  HTML servirà all'anteprima (iframe scalato) e all'export di Electron: i font (`@font-face`) li fornisce chi disegna.
- Tre template con i colori del brand kit (`templatePalette`): Tech scuro, Minimal chiaro, Terminale; col kit
  predefinito riproducono i colori del mockup.
- La chat «Modifica scrivendo» dello Studio non vede né cambia il carosello (`editableFields` e `toMetadata` con
  `carousel` conservato).
- Il formato segue le slide (`formatForCarousel` in shared): con un carosello la variant diventa `carosello`,
  togliendolo torna al primo formato non carosello. Vale per modifiche a mano e dell'LLM. Su LinkedIn un carosello
  resta bloccato in coda finché l'adapter non pubblica i PDF (2e).
- LLM (`modules/ai/carousel.ts`): `POST /variants/:id/carousel/generate` (`expectedVersion`) crea 3-10 slide dal
  testo del post (`generate-carousel.*.md`, `GeneratedCarouselSchema`, template conservato);
  `POST /variants/:id/carousel/edit` (`instruction`, `expectedVersion`, `slideIndex`) restituisce o le slide
  modificate (salvate) o fino a 3 proposte di titolo senza salvare (`EditedCarouselSchema`, `edit-carousel.*.md`).
  Solo LinkedIn/Instagram/TikTok (422 altrimenti), controlli di versione e stato prima di chiamare il modello,
  transizione `edit` e revisione `llm_edit` con l'istruzione. La voce del brand entra anche qui.

### File esportati (`modules/assets/`)

- `PUT /variants/:id/assets/export` (`format` png|pdf, `renderHash`, `files` con posizione, mime, dimensioni, sha256 e
  percorso locale) e `GET /variants/:id/assets`. `renderHash` = sha256 di `renderInputKey(carousel, kit, iniziali)`
  (`@prisma-app/templates`, include solo ciò che cambia l'aspetto): se non coincide con lo stato attuale → 409. Servono
  tutte le slide (PNG) o un file (PDF). Il nuovo export sostituisce il precedente dello stesso tipo (asset orfani
  eliminati); gli export non cambiano stato né versione della variant, perché derivano dalle slide salvate.
- `variant_assets.render_hash` (migrazione `0003_render_hash`); `upToDate` = hash salvato uguale a quello attuale.
  La pubblicazione usa solo file aggiornati. Le immagini si esportano già in JPEG (Instagram non accetta altro).

### Instagram (`src/publishers/instagram/`, `modules/oauth/instagram-service.ts`)

Verificato sulla documentazione ufficiale (developers.facebook.com/docs/instagram-platform, novembre 2026):

- **API**: «Instagram API with Instagram Login» su `graph.instagram.com` (`INSTAGRAM_API_VERSION`, default `v27.0`).
  Serve un account professionale (Business o Creator), nessuna pagina Facebook. Scope
  `instagram_business_basic,instagram_business_content_publish`. Con un'app che pubblica solo sul proprio account
  basta lo Standard Access (niente App Review); l'account deve avere un ruolo sull'app.
- **OAuth**: `https://www.instagram.com/oauth/authorize` con `state` firmato; il codice vale 1 ora e può finire con
  `#_` (si toglie); `POST https://api.instagram.com/oauth/access_token` → token di 1 ora →
  `GET /access_token?grant_type=ig_exchange_token` → token di 60 giorni; profilo da `GET /me?fields=user_id,username`
  (`user_id` è l'id da usare per pubblicare). Le risposte possono essere dentro `data: [...]`.
- **Rinnovo**: `GET /refresh_access_token?grant_type=ig_refresh_token` per i token che scadono entro 20 giorni e
  hanno almeno 24 ore (`refreshExpiring`, all'avvio e ogni 6 ore); un errore resta in `last_error`.
- **Pubblicazione**: controllo della quota (`content_publishing_limit`: la doc dice sia 50 sia 100 post in 24 ore,
  si usa il valore restituito); una slide → container con `image_url` e `caption`; più slide → container con
  `is_carousel_item=true`, poi `media_type=CAROUSEL` con `children` e la didascalia; attesa di `status_code`
  `FINISHED` (ERROR definitivo, lentezza oltre 90 s ritentata); `media_publish` con `creation_id`; link da
  `GET /{media}?fields=permalink` (se manca, avviso). Instagram scarica le immagini da sé: servono JPEG su R2 con
  indirizzo pubblico (`R2_PUBLIC_BASE_URL`), fino a 8 MB, 4:5 va bene (ammesso 4:5–1,91:1).
- **Mai due volte**: nessuna chiave di idempotenza. Prima di `media_publish` rete, 429 e 5xx si ritentano (nulla è
  online); dopo, 5xx e risposte perse → «esito incerto» da controllare a mano. Token non valido (401, codice 190)
  → ricollegare.
- **Didascalia**: testo + hashtag in coda, massimo 2.200 caratteri, 30 hashtag, 20 menzioni (`validate()`).
- Carosello fino a 20 elementi per la doc; l'editor resta a 10 slide.

### Storage R2 (`src/storage/`)

Verificato sulla documentazione ufficiale (developers.cloudflare.com/r2, novembre 2026):

- SDK S3 v3 con endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` (o `R2_ENDPOINT` per i bucket con
  giurisdizione) e regione `auto`. Credenziali da un token «Object Read & Write» limitato al bucket. Senza le
  variabili `R2_*` lo storage è `null`: il caricamento risponde 503 e i caroselli LinkedIn restano bloccati in coda.
- URL firmati PUT validi 15 minuti, con `Content-Type` firmato (`signableHeaders`, altrimenti l'SDK non lo firma).
  Funzionano solo sull'endpoint S3, non sui domini pubblici. I caricamenti dal main di Electron non chiedono CORS.
- Chiave ricavata dal contenuto: `brand-<id>/<sha256>.<ext>`. Ricaricare lo stesso file non crea doppioni. Gli
  oggetti di export superati restano sul bucket: una pulizia periodica è da fare.
- `POST /variants/:id/assets/:assetId/upload` → `{ key, url, headers, expiresAt }`;
  `POST …/upload/complete` controlla con HEAD che l'oggetto esista con la dimensione attesa, poi salva
  `remote_key` e `remote_url` (`R2_PUBLIC_BASE_URL`; r2.dev è limitato e va bene solo per le prove).
- Scheduler e controlli della coda passano agli adapter i file della variant (`loadMedia` = `assets.list`):
  `validate(variant, media)` e `PublishRequest.media`.

### Blog (`platform: 'blog'`, formato `articolo`)

- Quinta piattaforma, aggiunta dopo il mockup: colore `--bl`/`--blSoft` (arancione RSS) in `screen-tokens.css`,
  icona a foglio con righe, slot consigliati proposti mar e gio alle 9:00. Migrazione `0001_blog`.
- L'articolo è HTML: titolo in `metadata.title`, estratto per la meta description in `metadata.description`
  (≤160), tag in `metadata.hashtags`, corpo in `body`.
- Generazione con una chiamata LLM dedicata (`generate-article.{system,user}.md`, `GeneratedArticleSchema`), in
  parallelo a quella dei social; il titolo del contenuto viene dai social se ci sono.
- L'HTML si salva solo ripulito (`content/article-html.ts`, sanitize-html): tag di testo, link (con
  `rel="noopener noreferrer"`) e codice; niente script, stili, eventi, iframe o immagini. Vale per generazione,
  modifica via chat e modifica a mano.
- **Collegamento** (`modules/blog-connection/`): `PUT /brands/:brandId/blog-connection` con `baseUrl` e `apiKey`
  (chiave del sito, ≥ 32 caratteri). L'indirizzo è la base della Blog API del sito (https, http solo in
  locale), normalizzato senza "/" finale; si verifica con `GET {base}/health` prima di salvare. Diventa un
  `social_account` con `external_id` = indirizzo, `display_name` = host, chiave cifrata con
  `tokenContext('blog', indirizzo)`, nessuna scadenza. Cambiando indirizzo il vecchio account passa a `scollegato`.
  `POST …/blog-connection/test` riprova il collegamento salvato. Errori del sito → 422 con messaggio in italiano.
- **Adapter** (`src/publishers/blog/`): `validate()` controlla formato, titolo (≤255), testo, avvisa sotto le 300
  parole e senza estratto; `publish()` invia `title`, `html`, l'`idempotencyKey` della pubblicazione e, se ci
  sono, `description` e `tags` (hashtag senza «#»). Il sito
  deduplica per chiave (`duplicate: true` → successo con avviso), quindi qui si ritentano 429, 5xx ed errori di
  rete; 401/403, `not_configured` (o `non_configurato`) e 400/404/422 sono definitivi. `externalId` = id del post, `url` dal sito.
- Nel desktop la riga Blog delle Impostazioni apre `BlogConnectionForm` («Salva e verifica», «Prova collegamento»).
  La chiave non torna mai al client: per aggiornarla si reinserisce. L'IPC ammette anche `PUT`.
- **Contratto** in `docs/blog-api.md` (`GET {base}/health`, `POST {base}/articles`, deduplica obbligatoria per
  `idempotencyKey`, esempio Express): qualsiasi sito può implementarlo. Nel codice non c'è nessun sito specifico.
- **Anteprima nello Studio** (`screens/Studio/BlogPreview.tsx`): «Anteprima dell’articolo» in una pagina di lettura
  neutra con i colori del tema: data e «Lo leggi in N minuti» (200 parole/min), titolo, autore (nome del brand),
  corpo e in fondo la meta description («Nei motori di ricerca»). L'HTML della bozza non passa mai da `innerHTML`:
  `services/article-preview.ts` lo legge con DOMParser e ricostruisce elementi React con i soli tag del server
  (link solo http/https/mailto). Test con happy-dom (`// @vitest-environment happy-dom`).

### Controlli della coda

`modules/publications/checks.ts`: per ogni pubblicazione in coda `adapter.validate()` (livelli `ok`/`warning`/`error`:
i `ok` sono requisiti verificati da mostrare, lo scheduler blocca solo sugli `error`), poi lo stato dell'account e la
scadenza del token rispetto all'orario di uscita. Il registro degli adapter è unico (`src/index.ts`) e condiviso da
scheduler e servizi.

### Cifratura token

`src/crypto/token-cipher.ts`: AES-256-GCM, payload `versione | IV(12) | tag(16) | ciphertext`.
L'AAD è `tokenContext(platform, externalId)`: un token copiato su un altro account non si decifra.

### Scheduler (`src/scheduler/`)

Ciclo `runOnce()` ogni `SCHEDULER_POLL_MS` (disattivabile con `SCHEDULER_ENABLED=false`):

1. **Recupero**: le pubblicazioni `in_pubblicazione` da più di 30 minuti vanno in `errore` con un messaggio che
   chiede di controllare la piattaforma. Non si ripubblica mai alla cieca: il post potrebbe essere già online.
2. **Claim**: in una transazione `SELECT … FOR UPDATE SKIP LOCKED` delle pubblicazioni `programmato` con
   `next_attempt_at <= now`, poi transizione `start`, `attempts + 1`, `locked_by` e riga in `publication_attempts`.
3. **Invio** (fuori dalla transazione, in sequenza): se `external_id` è già valorizzato si registra il successo
   senza reinviare; altrimenti adapter, `validate()`, decifratura del token e `publish()` con l'`idempotencyKey`.
4. **Esito**: successo → `pubblicato`; `PublishError` con `retryable` (o errore non classificato) e tentativi
   rimasti → `programmato` con backoff (1, 2, 4… min, max 1 h, jitter ±20%); altrimenti → `errore`.

Worker e recupero considerano solo le piattaforme con un adapter registrato in `src/index.ts`:
le altre pubblicazioni restano `programmato` finché l'adapter non esiste.

Test: `scheduler.int.test.ts` (rollback, orologio nel 1990) e `scheduler-concurrency.int.test.ts`
(3 worker su connessioni diverse, dati salvati davvero con orologio al 2000 e piattaforma TikTok, ripuliti
alla fine). Le date nel passato garantiscono che i test non vedano mai pubblicazioni reali.
Ora che l'adapter TikTok esiste conviene spostare i test su un database dedicato (vedi la sezione TikTok).
I file di test girano in sequenza (`fileParallelism: false`) per non bloccarsi righe a vicenda.

### API (tutte con `Authorization: Bearer <API_TOKEN>`)

| Risorsa       | Rotte                                                                                                                                                                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand         | `GET/POST /brands`, `GET/PATCH /brands/:id`                                                                                                                                                                                                                           |
| Brand kit     | `GET/PUT /brands/:brandId/kit`, `GET/POST /brands/:brandId/voice-examples`, `DELETE /voice-examples/:id`                                                                                                                                                              |
| Asset         | `GET /variants/:id/assets`, `PUT /variants/:id/assets/{export,video}`, `POST /variants/:id/assets/:assetId/upload[/complete]`, `GET /storage/status`                                                                                                                  |
| Tag           | `GET/POST /brands/:brandId/tags`, `DELETE /tags/:id`                                                                                                                                                                                                                  |
| Idee          | `GET/POST /brands/:brandId/ideas` (`?status=&tagId=`), `GET/PATCH/DELETE /ideas/:id`                                                                                                                                                                                  |
| Account       | `GET /brands/:brandId/social-accounts` (vista senza token)                                                                                                                                                                                                            |
| Contenuti     | `GET/POST /brands/:brandId/contents` (`platforms` crea le bozze), `GET/PATCH/DELETE /contents/:id`                                                                                                                                                                    |
| Variant       | `POST /contents/:contentId/variants`, `GET/PATCH/DELETE /variants/:id`, `POST /variants/:id/transitions` (`submit`/`approve`/`reject`), `GET /variants/:id/revisions`                                                                                                 |
| Pubblicazioni | `GET /publications?brandId=&from=&to=&status=`, `GET /publications/checks?brandId=`, `POST /publications`, `GET/PATCH /publications/:id`, `POST /publications/:id/{publish-now,cancel,retry}`, `GET /publications/:id/attempts`                                       |
| AI            | `POST /contents/generate` (`ideaId`, `platforms`), `POST /variants/:id/edit` (`instruction`, `expectedVersion`), `GET /contents/:id/chat`, `POST /variants/:id/revisions/:revisionId/restore`, `POST /variants/:id/carousel/{generate,edit}`, `POST /shorts/generate` |
| OAuth         | `GET /oauth/{linkedin,instagram}/start?brandId=` → `{ url }` da aprire nel browser; `GET /oauth/{linkedin,instagram}/callback` (pubbliche, rispondono con una pagina HTML)                                                                                            |

### LinkedIn (`src/publishers/linkedin/`, `modules/oauth/`)

Verificato sulla documentazione ufficiale (learn.microsoft.com/linkedin, novembre 2026):

- **App**: prodotti "Share on LinkedIn" (`w_member_social`) e "Sign in with LinkedIn using OpenID Connect"
  (`openid`, `profile`). Scope richiesti: `openid profile w_member_social`. Si pubblica solo sul profilo personale.
- **OAuth**: authorization code flow; `state` firmato HMAC (`auth/oauth-state.ts`, scade in 10 min, chiave derivata
  da `TOKEN_ENCRYPTION_KEY`); state non valido → 401. Token di 60 giorni; i refresh token sono solo per i partner
  MDP, quindi alla scadenza si ricollega. Lo stato dell'account diventa `da_rinnovare` 10 giorni prima.
- **Id membro**: `sub` di `GET /v2/userinfo`, usato come `urn:li:person:{sub}`. La doc non lo dichiara in modo
  esplicito: confermarlo con il primo post reale.
- **Post**: `POST /rest/posts` con `LinkedIn-Version` (`LINKEDIN_API_VERSION`, default `202611`, supportata almeno
  un anno) e `X-Restli-Protocol-Version: 2.0.0`; l'id (`urn:li:share:…` o `urn:li:ugcPost:…`) arriva in `x-restli-id`.
- **Testo**: formato little text, con escape di `| { } @ [ ] ( ) < > # \ * _ ~`; gli hashtag della variant vanno
  in coda come `{hashtag|\#|tag}`. Limite di 3.000 caratteri (non indicato dalla doc API, è quello dell'interfaccia).
- **Primo commento**: `POST /rest/socialActions/{urn}/comments`. La doc è ambigua sul permesso
  (`w_member_social` o `w_member_social_feed`): se fallisce il post resta pubblicato e `last_error` riporta un "Avviso".
- **Mai due volte**: l'API non ha chiavi di idempotenza. Si ritentano solo 429 ed errori di rete prima dell'invio
  (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`); 5xx, timeout e connessioni interrotte → errore "esito incerto"
  da controllare a mano. 401/403 → errore con invito a ricollegare.
- **Statistiche**: non disponibili per app self-serve (permessi riservati): si inseriscono a mano (fase 4).
- **Caroselli** (Documents API, verificata novembre 2026): `POST /rest/documents?action=initializeUpload` con
  `initializeUploadRequest.owner` = `urn:li:person:…` (ammesso dallo schema; gli esempi della doc sono solo per
  organizzazioni, quindi va confermato con la prima prova reale), PUT dei byte su `uploadUrl` con il bearer (il
  token parte solo verso domini `linkedin.com` in https), poi `GET /rest/documents/{urn}` finché lo stato è
  `AVAILABLE` (la doc non dice che serve aspettare: è una scelta prudente), infine `POST /rest/posts` con
  `content.media` = `{ id, title }` (titolo = copertina del carosello). PDF fino a 100 MB. Prima del post gli errori
  temporanei (rete, 429, 5xx, elaborazione lenta oltre 60 s) si ritentano, perché nulla è ancora pubblicato; dopo
  vale la regola «mai due volte». `validate()` chiede un PDF esportato, aggiornato e caricato su R2.
- Video: non ancora (YouTube e TikTok hanno i loro adapter).

### YouTube (`src/publishers/youtube/`, `modules/oauth/youtube-service.ts`)

Verificato sulla documentazione ufficiale (developers.google.com/youtube/v3, novembre 2026):

- **OAuth**: `https://accounts.google.com/o/oauth2/v2/auth` con `access_type=offline` e `prompt=consent` (il
  refresh token arriva solo così), token da `https://oauth2.googleapis.com/token`. Scope
  `https://www.googleapis.com/auth/youtube`: oltre a `videos.insert` servono `channels.list mine=true`,
  `videos.update` e `videos.delete`, che `youtube.upload` non copre. Il canale da `channels.list` (id, titolo,
  `customUrl`). Si salvano cifrati token di accesso e refresh token, senza scadenza dell'account: il token di
  accesso dura un'ora e se ne chiede uno nuovo a ogni uso (`createAccessTokenResolver` in
  `modules/social-accounts/tokens.ts`, condiviso da scheduler e servizio delle pubblicazioni). Con l'app OAuth
  in «Testing» il refresh token scade dopo 7 giorni: va messa «In production» (avviso «app non verificata»).
  `invalid_grant` → ricollegare.
- **Progetti non verificati**: dal 2 novembre 2026 i video caricati non sono più forzati a «privato». Quota:
  100 caricamenti al giorno per progetto (bucket separato), 10.000 unità per il resto.
- **Caricamento**: upload resumable (`POST …/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`
  con `X-Upload-Content-Length`/`-Type`, sessione nell'header `Location`, PUT dei byte a flusso da R2 con
  `Content-Length`). La sessione si salva in `publications.upload_session` **prima** di inviare i byte: dopo un
  errore si chiede a YouTube a che punto è (`Content-Range: bytes */N`: 308 con `Range` = byte ricevuti, 201 =
  già completo, 404 = scaduta) e si riprende da lì. Così un esito incerto non crea un secondo video, anche se
  `videos.insert` non ha chiavi di idempotenza. 5xx e rete si ritentano; `quotaExceeded`/`uploadLimitExceeded`
  no.
- **Uscita programmata** (scelta confermata): appena una variant YouTube è programmata, lo scheduler
  (`prepareUpcoming`, un video per ciclo, dopo le uscite dovute) la carica privata con `publishAt` = orario,
  se mancano almeno 15 minuti; la pubblicazione resta `programmato` con `external_id`, bloccata (`locked_by`)
  durante il caricamento. Un errore va in `last_error` («Caricamento anticipato non riuscito…») e si riprova
  dopo un'ora (`prepared_at`, migrazione `0004_upload_session`); i blocchi rimasti a metà si rilasciano dopo
  30 minuti. All'orario il worker trova l'`external_id` e chiama `advance.finalize`, che rende pubblico il
  video se non lo è già. Senza caricamento anticipato (meno di 15 minuti) `publish()` carica subito pubblico.
- **Annulla/Sposta/Pubblica ora** su un video già caricato: «Annulla» lo cancella da YouTube (`videos.delete`),
  «Sposta» cambia `publishAt` (`videos.update` partendo dallo stato letto, perché i campi non inviati si
  azzerano); se YouTube non risponde → 422 e in Prisma non cambia nulla. «Pubblica ora» anticipa solo lo
  scheduler. Durante il caricamento anticipato tutte e tre rispondono 422 «riprova tra qualche minuto».
- **Metadati**: titolo (≤100 caratteri, niente `<` `>`), descrizione = campo descrizione (o testo) + hashtag in
  coda (≤5000 byte), tag dagli hashtag (≤500 caratteri in tutto), `categoryId` da `YOUTUBE_CATEGORY_ID`
  (28), `defaultLanguage` it, `selfDeclaredMadeForKids` false. Short e video sono lo stesso caricamento: YouTube
  riconosce gli Short dal formato (avvisi per Short non verticali o oltre 3 minuti, limite non confermato
  dalla doc). Il commento fissato non si pubblica (avviso). URL `https://www.youtube.com/watch?v=<id>`.
- Desktop: «Collega» nelle Impostazioni (URL Google ammesso nell'IPC), nella coda «già caricato, esce da solo
  all'orario» o l'errore del caricamento anticipato.

### TikTok (`src/publishers/tiktok/`, `modules/oauth/tiktok-service.ts`)

Verificato sulla documentazione ufficiale (developers.tiktok.com, novembre 2026). **Modalità casella** (scelta
confermata): senza audit la pubblicazione diretta (`video.publish`) resta `SELF_ONLY` e richiede l'account
privato, e le linee guida escludono dall'audit «un'utilità per caricare contenuti sui propri account». Con
`video.upload` il video arriva nella casella dell'app come bozza: didascalia e privacy le sceglie l'autore.

- **OAuth**: `https://www.tiktok.com/v2/auth/authorize/` con `client_key`, scope `user.info.basic,video.upload`,
  `state` firmato; redirect https registrato nell'app (`TIKTOK_REDIRECT_URI`, in locale serve un tunnel). Token
  da `POST https://open.tiktokapis.com/v2/oauth/token/` (form): accesso 2 ore, refresh token 180 giorni che
  **ruota a ogni rinnovo** (il vecchio smette subito di valere). Si usano i campi `expires_in` /
  `refresh_expires_in` restituiti (la doc ha esempi in contraddizione col testo). Nome da
  `GET /v2/user/info/?fields=open_id,display_name` (`username` richiederebbe `user.info.profile`).
- **Token** (`createAccessTokenResolver`): per le piattaforme con refresh token si usa il token salvato finché
  mancano più di 10 minuti alla scadenza, poi si rinnova e si salvano i token nuovi (`updateAccountTokens`),
  compreso il refresh token ruotato. Nella vista dell'account la scadenza mostrata (e lo stato
  `da_rinnovare`) è quella del refresh token quando c'è: TikTok 180 giorni, YouTube nessuna.
- **Casella**: `POST /v2/post/publish/inbox/video/init/` con solo `source_info` (`FILE_UPLOAD`, `video_size`,
  `chunk_size`, `total_chunk_count`: la didascalia non si può inviare) → `publish_id` e `upload_url` (vale
  un'ora); pezzi in sequenza con PUT e `Content-Range` letti da R2 a intervalli (`readStream(key, start, end)`):
  fino a 64 MB un pezzo solo, oltre pezzi da 10 MB con l'avanzo nell'ultimo (`chunkPlan`); 206 = altri pezzi,
  201 = finito. Poi `status/fetch` ogni 5 s fino a `SEND_TO_USER_INBOX` (o `PUBLISH_COMPLETE`), al massimo
  3 minuti, altrimenti si riprova al ciclo dopo. `PULL_FROM_URL` non si usa: richiede il dominio di R2
  verificato su TikTok.
- **Esito**: la pubblicazione diventa `pubblicato` con `external_id` = `publish_id`, nessun URL e l'avviso
  «Inviato alla casella di TikTok…». Il `publish_id` si salva in `upload_session` con `uploaded`: un tentativo
  dopo un esito incerto controlla lo stato invece di ricaricare. Errori: `spam_risk_too_many_pending_share`
  (al massimo 5 video in attesa in 24 ore) definitivo con spiegazione; 401/`access_token_invalid` →
  ricollegare; 429 e 5xx si ritentano; `fail_reason` `internal`/`video_pull_failed` si ritentano, gli altri no.
- **Controlli**: video su R2 in MP4/MOV/WebM, al massimo 4 GB e 10 minuti (limite della casella); i
  caroselli TikTok non sono supportati (le foto vogliono `PULL_FROM_URL` con dominio verificato); avviso fisso
  «didascalia e privacy le scegli tu nell'app».
- **Desktop**: «Collega» nelle Impostazioni (URL di TikTok ammesso nell'IPC); nel log della coda «Inviato a
  TikTok» al posto di «Pubblicato», istruzioni e «Copia didascalia» (`socialCaption` in shared: testo + hashtag).
- Con tutte le piattaforme dotate di adapter, uno scheduler del server di sviluppo acceso durante i test di
  concorrenza potrebbe vedere le righe di prova (TikTok, anno 2000): non pubblica nulla, perché i token di prova
  sono cifrati con una chiave casuale, ma i test possono fallire. Meglio un database dedicato ai test.

### Metriche (`modules/analytics/`, fase 4)

Verificato sulla documentazione ufficiale (novembre 2026). Ogni piattaforma espone dati diversi: quelli assenti
restano null, mai zero.

- **Modello**: `metric_snapshots` (una riga per lettura di un post: impressioni, copertura, visualizzazioni, like,
  commenti, condivisioni, salvataggi, `source` api|manuale) e `account_metric_snapshots` (una riga per account e
  giorno, unica su `(account, day)`: follower totali del giorno, guadagnati/persi, copertura, visualizzazioni;
  un nuovo valore sostituisce il vecchio, quelli non riportati restano). Migrazione `0005_metrics`.
- **Adapter**: `metrics?: { post(externalId, account), account(account, fromDay, toDay) }` al posto del vecchio
  `fetchMetrics`. `MetricsNotReadyError` = dati non ancora disponibili (si riprova senza contarlo come errore);
  `resolved` aggiorna la pubblicazione.
  - **Instagram** (scope in più `instagram_business_manage_insights`): `GET /{media}/insights` con
    `reach,views,likes,comments,shares,saved` (`impressions` deprecata per i media dopo il 2 luglio 2024; se
    `views` viene rifiutata si riprova senza); account: `reach` giornaliera (`period=day&metric_type=time_series`,
    `end_time` = mezzanotte che chiude il giorno: il giorno si ricava togliendo 12 ore) e `followers_count` del
    profilo. Dati in ritardo fino a 48 ore; metriche dell'account conservate 90 giorni; follower e ore online solo
    con almeno 100 follower.
  - **YouTube** (scope in più `yt-analytics.readonly`, va abilitata la «YouTube Analytics API»): `videos.list
part=statistics` (visualizzazioni, like, commenti), `channels.list part=statistics` (iscritti, arrotondati) e
    `youtubeanalytics.googleapis.com/v2/reports` con `ids=channel==MINE`, `metrics=views,subscribersGained,
subscribersLost`, `dimensions=day` (gli ultimi giorni arrivano in ritardo). Nessun dato per ora del giorno.
  - **TikTok** (scope in più `video.list`, `user.info.stats`): dal `publish_id` della casella `status/fetch` dà
    `publicaly_available_post_id` (sic) quando l'autore ha pubblicato e il post è pubblico; da lì la pubblicazione
    prende l'id e lo `share_url` del video, e le statistiche arrivano da `POST /v2/video/query/` (visualizzazioni,
    like, commenti, condivisioni: niente copertura). Follower da `user/info?fields=follower_count`.
  - **LinkedIn**: nessuna metrica con i permessi aperti (servirebbe la Community Management API, prodotto da far
    approvare); inserimento a mano con `POST /publications/:id/metrics` (solo post pubblicati, reazioni → `likes`,
    diffusioni → `shares`). Blog: nessuna metrica.
- **Raccolta** (`collector.ts`, `schedule.ts`): un giro ogni `ANALYTICS_POLL_MS` (1 ora, `ANALYTICS_ENABLED`). Post
  pubblicati negli ultimi 90 giorni: ogni giorno nella prima settimana, poi ogni settimana; un post mai misurato si
  smette di cercarlo dopo 14 giorni; 25 per giro. Account una volta al giorno, chiedendo dall'ultimo giorno salvato
  meno 3 (dati completati in ritardo) fino a oggi, la prima volta 28 giorni. Gli errori di un post o account non
  fermano gli altri. Token dal resolver condiviso con lo scheduler.
- API: `GET /publications/:id/metrics` (ultima lettura o null), `POST /publications/:id/metrics` (manuale).
- **Report** (`aggregate.ts`, funzioni pure; `GET /brands/:brandId/analytics?period=8w|30d|90d`): intervalli in
  giorni italiani (8 settimane e 90 giorni a settimane da lunedì, 30 giorni a giorni; l'ultimo contiene oggi).
  Per piattaforma (LinkedIn, Instagram, TikTok, YouTube) tre serie:
  - **copertura**: Instagram copertura dell'account; YouTube visualizzazioni del canale; TikTok visualizzazioni
    dei video pubblicati nell'intervallo; LinkedIn impressioni inserite a mano (`notes` dice cosa c'è dietro);
  - **nuovi follower**: guadagnati − persi dove la piattaforma li dà (YouTube), altrimenti differenza tra
    l'ultimo totale dell'intervallo e l'ultimo prima (i giorni si leggono da una settimana prima); LinkedIn mai;
  - **interazioni**: like + commenti + condivisioni + salvataggi dei post pubblicati nell'intervallo.
    Contenuti migliori: i 5 post del periodo per copertura (o visualizzazioni/impressioni, con `reachKind`), poi
    interazioni. `manual`: post LinkedIn pubblicati negli ultimi 90 giorni con l'ultima lettura.
- **Slot consigliati dai dati** (`slots.ts`, `GET /brands/:brandId/analytics/slots`): per piattaforma i post degli
  ultimi 90 giorni con una misura di copertura diventano un punteggio relativo (valore / mediana della
  piattaforma); l'ora migliore (media, almeno 2 post in quell'ora) per i 3 giorni migliori (almeno 2 post
  ciascuno). Con meno di 8 post misurati, o senza ore e giorni ripetuti, restano gli slot del mockup
  (`DEFAULT_RECOMMENDED_SLOTS` in shared, `source: 'predefinito'`). Le ore online dei follower Instagram non si
  usano: la doc non descrive il formato della risposta.
- **Riepilogo della settimana** (`weekSummary`, `GET /brands/:brandId/analytics/summary`): per piattaforma
  follower all'ultimo giorno rilevato, variazione e copertura degli ultimi 7 giorni (oggi compreso).
- **Suggerimenti dell'AI** (`insights.ts`, tabella `analytics_insights`, migrazione `0006_insights`): una chiamata
  LLM (`generate-insights.{system,user}.md`) con le serie di 8 settimane, i contenuti con metriche (piattaforma,
  formato, giorno e ora, misure) e gli slot consigliati attuali; risposta `GeneratedInsightsSchema` con
  esattamente un suggerimento per tipo (argomenti con un'idea pronta, orari, formati), salvata con lunedì della
  settimana, modello e numero di post. Il prompt vieta numeri inventati e confronti tra misure diverse. Generati
  dal giro orario la prima volta utile della settimana (`refreshDue`) o con «Aggiorna»
  (`POST /brands/:brandId/analytics/insights`); `GET` dà gli ultimi e `blocked` (LLM non configurato o meno di 3
  contenuti con metriche nelle ultime 8 settimane).

### LLM (`src/llm/`, `modules/ai/`)

- `LlmProvider.completeJson({ messages, schema })`: unico punto di contatto con il modello. `completeValidatedJson`
  ritenta fino a 3 volte su risposta vuota (DeepSeek svuota il JSON non riconosciuto), non JSON o non conforme
  allo schema Zod; in quest'ultimo caso rimanda al modello gli errori da correggere.
- DeepSeek via SDK `openai`, base URL `https://api.deepseek.com`, `response_format: json_object`.
  Modelli verificati sulla documentazione ufficiale (novembre 2026): `deepseek-flash` (default) e `deepseek-v4-pro`;
  `deepseek-chat`/`deepseek-reasoner` non sono più elencati. Il JSON mode richiede la parola "json" e un esempio nel prompt.
- Senza `DEEPSEEK_API_KEY` il provider è `null`: il server parte e le rotte AI rispondono 503 `llm_non_configurato`;
  `LlmError` → 502 `errore_llm`.
- Prompt in `apps/server/prompts/` (esclusi da Prettier): `generate-variants.{system,user}.md`,
  `edit-variant.{system,user}.md`, `platforms/<piattaforma>.md` con le linee guida. Segnaposto `{{nome}}`:
  una variabile mancante è un errore. Un test verifica che i prompt reali e le variabili del codice coincidano.
- Risposte del modello validate con `GeneratedContentSchema` / `EditedVariantSchema` (hashtag normalizzati,
  campi vuoti scartati) e convertite in metadata con `toMetadata`.
- Generazione: una chiamata per tutte le piattaforme, poi un'unica transazione (contenuto + variant + revisioni
  `llm_generate`); se manca una piattaforma non si salva nulla.
- Modifica via chat: controlli di versione e stato prima della chiamata (per non pagare risposte inutili),
  poi transizione `edit` (torna `bozza`), revisione `llm_edit` con l'istruzione e due messaggi in `chat_messages`.
  La risposta contiene `before`/`after` per il diff nella UI. Il ripristino di una revisione è una modifica normale.
- Test con `FakeLlm` (passa dagli stessi schemi Zod) e client finto per DeepSeek: nessuna chiamata reale.

- Build con tsup: `@prisma-app/shared` e `@prisma-app/templates` vengono inclusi nel bundle (`noExternal`).
- Lo schema non va modificato a mano nel DB: si cambia `schema.ts` e si genera una migrazione.

## Ambiente di sviluppo

- pnpm installato globalmente con npm (corepack non ha i permessi su `C:\Program Files\nodejs`).
- In PowerShell gli script non firmati sono bloccati: usare `pnpm.cmd` (es. `pnpm.cmd dev`).
- MySQL 8.0 locale (servizio Windows `MySQL80`), Docker non installato.
- Electron: il binario si scarica con lo script di installazione, autorizzato in `pnpm.onlyBuiltDependencies`.
  Se manca `apps/desktop/node_modules/electron/dist`, lanciare `node node_modules/electron/install.js` da `apps/desktop`.
- `.env` e `db-setup.local.sql` (creazione DB e utente `prisma`) sono generati in locale ed esclusi da git.

## Stato di avanzamento

### Fase 1 — Fondamenta

- [x] 1. Monorepo, TypeScript, ESLint/Prettier, Vitest, docker-compose, `.env.example`, CLAUDE.md
- [x] 2. `packages/shared`: enum, schemi Zod, macchina a stati + test
- [x] 3. Server: config, auth, schema Drizzle, prima migrazione, seed brand
- [x] 4. API CRUD (brand, idee/tag, contenuti, variant + transizioni, pubblicazioni)
- [x] 5. Cifratura AES-256-GCM e scheduler (test concorrenza, retry, idempotenza)
- [x] 6. `LlmProvider` DeepSeek: generazione variant, chat di modifica con revisioni
- [x] 7. LinkedIn: verifica docs, OAuth, `LinkedInAdapter` con test su mock (manca la prova con l'app LinkedIn reale)
- [x] 8. Desktop: shell Electron, token, Sidebar, PlatformIcon
- [x] 9. Schermate, in quattro passi:
  - [x] 9a. Collegamento desktop ↔ server, Impostazioni minime, schermata Idee
  - [x] 9b. Studio contenuto (tab per piattaforma, anteprima nel feed, chat con diff, approvazione)
  - [x] 9c. Calendario (mese/settimana, drag & drop, slot consigliati fissi)
  - [x] 9d. Coda di pubblicazione e Dashboard

Fase 1 completata. Da provare con le credenziali reali: DeepSeek (chiave API), app LinkedIn (OAuth e primo post),
desktop Electron con il token salvato cifrato.

### Prossimi passi proposti

- Blog, in tre passi:
  - [x] B1. Piattaforma `blog`, formato `articolo`, prompt e generazione dell'articolo, HTML ripulito
  - [x] B2. Collegamento al sito nelle Impostazioni (Blog API), adapter del blog, controlli in coda
  - [x] B3. Studio: anteprima dell'articolo

### Fase 3 — Video: Whisper, editor dal testo, FFmpeg, FilmCraft, TikTok e YouTube

Scelte (proposte e confermate): strumenti installati dall'utente e rilevati da Prisma, modello Whisper `small`
(niente GPU), FilmCraft sperimentale nel 3e, TikTok e YouTube in fondo.

- [x] 3a. Strumenti video (rilevamento e percorsi), progetti in SQLite, import con ffprobe, player `prisma-media`
- [x] 3b. Trascrizione con whisper.cpp (tempi per parola, avanzamento) (provata con whisper.cpp v1.9.5 e modello small)
- [x] 3c. Editor video del mockup: trascrizione che taglia, silenzi, timeline, formati con ritaglio, stili sottotitoli
- [x] 3d. Render con FFmpeg (tagli, ritaglio, sottotitoli ASS), asset della variant e caricamento su R2 (provato con FFmpeg 9.1)
- [x] 3e-1. «Genera Short» con l'LLM: momenti dalla trascrizione, bozze nello Studio, progetti Short in 9:16
- [x] 3e-2. FilmCraft (OTIO + SRT, `--control`, export e rientro), provato con FilmCraft 0.20.1
- [x] 3f-1. YouTube: OAuth, upload resumable con ripresa, caricamento anticipato con uscita programmata
- [x] 3f-2. TikTok tramite la casella dell'app (`video.upload`), refresh token che ruota, «Copia didascalia»

Fase 3 completata. Da provare con le credenziali reali: app Google (YouTube Data API, OAuth «In production») e app
TikTok (Login Kit e Content Posting API con `video.upload`), entrambe con un video caricato su R2.

### Fase 4 — Analytics

Scelte (proposte e confermate): LinkedIn con inserimento a mano, YouTube con la YouTube Analytics API.

- [x] 4a. Raccolta dei dati: tabelle, metriche da Instagram/YouTube/TikTok, raccolta periodica, inserimento LinkedIn
- [x] 4b. Schermata Analytics del mockup: copertura, follower e interazioni per settimana, contenuti migliori
- [x] 4c. Dashboard (7 giorni) e slot consigliati dai dati
- [x] 4d. Suggerimenti settimanali dell'AI (argomenti, orari, formati)

Fase 4 completata. Da provare con i dati veri: servono gli account collegati e qualche settimana di metriche
(slot dai dati con almeno 8 post per piattaforma, suggerimenti con almeno 3 contenuti misurati).

### Fase 2 — Template e caroselli, brand kit, storage R2, Instagram

- [x] 2a. Brand kit e voce: schermata Template e brand kit, API, voce nei prompt
- [x] 2b. Modello del carosello (slide in `metadata.carousel`) e template HTML in `packages/templates`
- [x] 2c. Editor carosello: miniature, anteprima, campi, generazione e chat sulle slide
- [x] 2d. Export PNG/PDF con Electron offscreen, asset collegati alla variant
- [x] 2e. Storage R2 (upload firmato) e caroselli PDF su LinkedIn (da provare con un bucket R2 vero e l'app LinkedIn)
- [x] 2f. Adapter Instagram (verifica docs, OAuth, immagine e carosello, rinnovo del token; export in JPEG)

Fase 2 completata. Da provare con le credenziali reali: bucket R2 (chiavi e indirizzo pubblico), app Instagram
(account professionale, OAuth e primo post), caroselli PDF su LinkedIn.

### Decisioni prese per default (da confermare)

- Nome app: **Prisma**.
- Dashboard inclusa nella fase 1 con i dati reali disponibili.
- LinkedIn: solo profilo personale.
- Slot consigliati nel calendario: configurazione fissa per piattaforma fino alla fase 4.
- Brand kit: font fissi (Inter e JetBrains Mono), 5 colori a ruolo fisso, niente template personalizzati
  («+ Nuovo template» del mockup non c'è). L'export delle immagini è JPEG, non PNG come nel mockup: Instagram accetta
  solo JPEG e le foto di TikTok non accettano PNG. Il carosello vivrà dentro la variant; «Post singolo» userà lo stesso
  motore con una slide; citazione, miniatura YouTube e copertina Reel restano anteprime fino alla fase 3.
