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

- **DB**: SQLite (`node:sqlite`, integrato in Node 24 ed Electron: niente moduli nativi) + Drizzle ORM con il driver
  `sqlite-proxy` (`apps/server/src/db/client.ts`). Migrazioni in `apps/server/drizzle`, copiate nel codice e applicate
  all'avvio. Date in millisecondi UTC, UI in `Europe/Rome`. Fino alla 0.1.1 era MySQL (vedi «Local-first»).
- **Desktop**: SQLite solo per lo stato locale (progetti video, percorsi file).
- **Storage**: Cloudflare R2 (S3) solo per i file finali da pubblicare (fase 2).
- **Auth desktop↔server**: token API personale (`Authorization: Bearer`), single user.
- **LLM**: chiamato dal server (chiave solo nel `.env` della VPS). Interfaccia `LlmProvider`, prima implementazione DeepSeek via SDK OpenAI con base URL custom. Prompt in `apps/server/prompts/*.md`, risposte JSON validate con Zod.
- **Piattaforme**: `PublisherAdapter` con `validate(variant)`, `publish()`, `fetchMetrics()`. Prima di ogni adapter verificare sulla documentazione ufficiale attuale scope, limiti e revisione dell'app.
- **Scheduler**: worker con polling DB, claim in transazione (con SQLite una alla volta), retry con backoff esponenziale, `idempotency_key` univoca per pubblicazione.
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
- Schermate pronte (oltre a **Registra**, 6f): **Dashboard**, **Idee** (inserimento con tag, filtri con conteggi, eliminazione con conferma, piattaforme per idea salvate
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
- **FilmCraft: schede, B-roll e audio** (`addExtras` in `filmcraft/service.ts`, `placeCommands`/`placedClipIds` in
  `interchange.ts`, `prepareForFilmcraft` nel servizio di render): dopo il progetto di base si preparano i file come per
  l'export (schede PNG trasparenti con il brand kit passato dal renderer, B-roll, audio del video montato in WAV con
  voce ripulita, volume uniforme e musica: `audioOnlyGraph`, stesse misure di `measureGains`), si importano con
  `filmcraft-cli import` (restituisce gli id), `sequence.addTracks`, `timeline.place` (B-roll su V2, schede su V3,
  audio su A2; l'istante va come `seconds` al primo livello, `{"time":{"seconds":…}}` viene ignorato),
  `timeline.setTrack` A1 `muted` e `clip.fillFrame` sugli spezzoni. Una riga sbagliata in `run` ferma tutto e il
  progetto non si salva. Ogni clip della sequenza ha lo zoom del suo tratto (`otioParts`) e, con «Segui il volto», la
  posizione del percorso a metà clip (FilmCraft non anima il ritaglio). Provato con FilmCraft 0.20.1 dalla CLI headless:
  scheda e B-roll ai tempi giusti, zoom 1,25×, audio a −13,9 LUFS con la musica abbassata. Il layout con lo schermo
  (6f) resta di Prisma.
- **Trend** (`screens/Trend/`, fase 8a): radar dei trend, vedi «Fase 8».
- **Concorrenti** (`screens/Concorrenti/`, fase 8b): concorrenti, confronto e analisi dell'AI, vedi «Fase 8».
- **Ispirati** (`components/InspirePanel/`, fase 8c): pannello aperto dai post dei concorrenti, dai contenuti dei trend e
  da «Ispirati a un post» (testo incollato), vedi «Fase 8».
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
- **Elenco dei contenuti** (`screens/Studio/ContentList.tsx`, logica in `services/content-list.ts`): «Studio contenuto» senza
  un contenuto aperto elenca tutti i contenuti del brand (anche nati da idee eliminate, «senza idea») con lo stato per
  piattaforma, filtri con conteggi (Tutti, Bozze, Approvati, In coda, Pubblicati, Errori: un contenuto è in ogni filtro
  in cui ricade una sua variant) ed «Elimina» solo per quelli mai usciti (il server rifiuta comunque quelli con
  pubblicazioni, anche annullate, per lo storico e le metriche).
- **Eliminare un'idea** (`DELETE /ideas/:id`, `removeIdea` nel servizio dei contenuti): eliminare l'idea non tocca i
  contenuti (`idea_id` diventa null) salvo `?contenuti=bozze`, che nella stessa transazione elimina anche quelli nati
  dall'idea senza pubblicazioni; risponde con `removedContents` e `keptContents`. Nelle Idee due domande
  (`deleteIdeaQuestions`): l'idea, poi «Eliminare anche N contenuti mai usciti?» (con «Annulla» restano nello Studio);
  pubblicati e in coda restano sempre.
- **Studio** (`screens/Studio/`): tab per piattaforma con stato, anteprima nel feed per le 4 piattaforme (i media
  sono riquadri con i colori fissi del mockup), campi specifici con contatori (`TEXT_LIMITS`, verificati sulla doc: LinkedIn
  3.000, Instagram e TikTok 2.200, YouTube titolo 100 e descrizione 5.000), hashtag, chat «Modifica scrivendo» con diff riga per riga
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
- **Dashboard** (`screens/Dashboard/`): saluto con il nome del brand in base all'ora italiana, settimana in corso
  colorata (`weekStrip`: oggi con sfumatura dell'accento, giorni con uscite velati dal colore della prima piattaforma
  e una striscia per piattaforma in alto, weekend tratteggiato, giorni passati spenti, «+ Pianifica» al passaggio sui
  giorni vuoti),
  prossime 5 uscite, account, idee nuove e «Ultimi 7 giorni» come nel mockup (`weekMetricCards`: follower o
  iscritti, variazione e copertura della settimana con cosa misura su quella piattaforma).
- Il drag & drop HTML5 non si completa con il mouse simulato dagli strumenti di automazione: per verificarlo si
  inviano `DragEvent` con un `DataTransfer` dalla console della pagina.
- **Dettatura delle idee** (`src/main/video/dictation.ts`, `hooks/useDictation.ts`, `services/dictation.ts`): il
  microfono nel pannello «Nuova idea» registra con MediaRecorder (Opus in WebM), al secondo clic (o dopo 5 minuti)
  l'audio va al main (IPC `dictation:transcribe`, al massimo 32 MB), FFmpeg lo porta a WAV 16 kHz e whisper.cpp lo
  trascrive con lingua `auto`; il testo si aggiunge a quello scritto. Una dettatura alla volta, file in
  `userData/video-lavoro/dettatura-<uuid>/` cancellati sempre, annullata uscendo dalla schermata. Servono FFmpeg,
  whisper.cpp e un modello (Impostazioni › Strumenti video); nel browser il pulsante resta spento. Provato con
  whisper.cpp vero su voce italiana sintetica (testo esatto, `it` riconosciuto, 6,6 s) e nel renderer con un
  microfono simulato (stati «In ascolto · 00:02» e «Trascrivo…»).
- Il brand della sidebar arriva da `/brands`.
- Nota sul token `--rec`: in `tokens.css` è lo sfondo verde degli slot consigliati; nel mockup Idee lo stesso nome
  è il rosso della registrazione vocale. Per la registrazione servirà un token distinto.

## Video con l'AI (fase 6)

Scelte (proposte e confermate): prima 6a (montaggio dei propri video), poi 6c (video dall'idea), poi audio con musica da
una cartella dell'utente, B-roll, inquadratura che segue il volto, registrazione nell'app per ultima.

### «Monta con l'AI» (6a)

- **Modifiche** (`VideoEditSchema` in `packages/shared/src/schemas/video-edit.ts`, campi con default per i progetti
  vecchi): `zooms` (intervalli del sorgente con `scale` 1–1,5), `keywords` (istanti d'inizio delle parole da
  evidenziare), `hook` (`text` ≤ 80, `durationMs` 1–6 s). `zoomAt`, `zoomedParts` (parti rimaste divise dove cambia lo
  zoom), `isKeyword`.
- **Proposta dell'AI** (`POST /video/auto-edit`, `modules/ai/auto-edit.ts`, `video-auto-edit.{system,user}.md`): come
  «Genera Short» il modello legge le frasi numerate e risponde con `removeSegments` (false partenze, ripetizioni, al
  massimo un terzo delle frasi), `fillers` (riempitivi per frase: «cioè», «praticamente»…), `keywords` (1–2 parole per
  frase importante), `emphasis` (frasi su cui zoomare) e `hook` (≤ 60 caratteri, dalla frase più forte). Lo schema
  (`autoEditPlanSchema`) controlla i numeri di frase; il server non salva nulla.
- **Applicazione** (`applyAutoEdit` in `packages/shared/src/schemas/video-auto-edit.ts`, pura e testata): taglia i
  silenzi, le esitazioni riconosciute da sole (`isHesitation`: «ehm», «uhm», «mmh»…), i riempitivi e le frasi indicate
  (parole cercate senza punteggiatura dentro la frase, `matchSegmentWords`), toglie i pezzi rimasti sotto 250 ms;
  zoom 1,08 su una parte rimasta sì e una no (punch-in ai tagli) e 1,18 sulle frasi importanti; parole chiave (al
  massimo 2 per frase); hook di 2,5 s. Riepilogo per l'avviso.
- **Editor** (`VideoEditor.tsx`): «Monta con l'AI» (pulsante principale) con avviso del riepilogo e «Annulla» che
  rimette le modifiche di prima. `PlayerPanel`: riquadro ristretto dallo zoom attivo con «Zoom ×1,18», titolo
  d'apertura in alto nei primi secondi, parole chiave in azzurro nei sottotitoli; pannello «Montaggio dell'AI» con il
  titolo modificabile e «Togli» per titolo, parole chiave e zoom. Logica in `services/auto-edit.ts`.
- **Render** (`render-plan.ts`, `ass.ts`): ogni parte si ritaglia con il suo zoom (`zoomedCrop`: riquadro del formato
  diviso per `scale`, centrato, misure pari) e si scala alle dimensioni finali prima di `concat`. Sottotitoli ASS:
  parole chiave `#38BDF8`, stile `Hook` (in alto al centro, riquadro scuro, `\fad(150,250)`) sul livello 1.
  FilmCraft riceve anche gli zoom (una clip per tratto con il suo Motion `scale`), non parole chiave e hook.
- Provato nell'app vera su una cartella dei dati a parte con un video sintetico (voce italiana di Windows con falsa
  partenza, «ehm», «cioè» e pause), whisper.cpp vero e un servizio AI finto compatibile OpenAI: 4 tagli, hook,
  parola chiave e 3 zoom salvati, export 1080×1920 da 24,4 a 14,5 s con hook e parola chiave visibili nei
  fotogrammi e i ritagli dello zoom (608 → 562 → 516 px) nel grafo.

### Audio: voce, volume e musica (6b)

Scelte (proposte e confermate): filtri integrati di FFmpeg (niente modelli da scaricare); il brano lo sceglie l'utente,
«Crea video» ne mette uno a caso dalla cartella.

- **Modifiche** (`VideoAudioSchema` in `packages/shared/src/schemas/video-audio.ts`, campo `edit.audio`): `clean`,
  `normalize`, `music` (percorso, nome, durata, `volumeDb` −30…0, predefinito −10, `ducking`). Progetti nuovi
  `DEFAULT_VIDEO_AUDIO` (voce ripulita e volume uniforme); quelli salvati prima `LEGACY_VIDEO_AUDIO` (tutto spento),
  che `videoRenderKey` non conta, così i render già fatti restano aggiornati. Gli Short ereditano l'audio del video lungo.
- **Cartella della musica** (`src/main/video/music.ts`, `userData/musica.json`): scelta in **Impostazioni › Strumenti
  video** (riga «Cartella della musica», finestra di sistema dal main, IPC `music:status/pick/clear`). Si leggono
  solo i file direttamente nella cartella (MP3, WAV, M4A, AAC, FLAC, OGG, Opus), con la durata da ffprobe (in cache
  per dimensione e data). L'anteprima passa da `prisma-media://musica/<nome>` (solo nomi semplici di quella
  cartella); il render rifiuta un brano fuori dalla cartella (`isTrackInFolder`).
- **Render** (`render-plan.ts`, `audioMix`): dopo `concat` la voce passa da passa-alto a 80 Hz, `afftdn`
  (nr 20, nf −45, stima continua), compressione leggera, guadagno fisso fino a −14 LUFS, un gate morbido sulle pause
  (`agate` soglia 0,04, rapporto 4, fino a −15 dB, knee 1,5) e un limitatore (`level=false`). Il guadagno si misura
  prima con un passaggio di solo audio (`loudnessGraph`, `loudnorm` che stampa il JSON): `loudnorm` in tempo reale
  alzava le pause e riportava su il rumore appena tolto. Con solo «Pulisci» il gate lavora sul livello di
  riferimento e poi la voce torna al volume originale. Musica come ingresso 1 con `-stream_loop -1`: tagliata alla
  durata, `loudnorm` a −14, volume scelto, dissolvenze 1 s / 2 s, `sidechaincompress` comandato dalla voce (soglia
  0,02, rapporto 5: circa −13 dB mentre si parla), `amix` senza riscalare e limitatore. Con la musica una seconda
  misura del mix (`mixLoudnessGraph`) corregge il volume finale: le pause con la musica contano nella misura.
  FilmCraft riceve l'audio lavorato (vedi «FilmCraft: schede, B-roll e audio»).
- **Editor** (`screens/Video/AudioPanel.tsx`, logica in `services/audio.ts`): pannello «Audio» sotto gli stili dei
  sottotitoli con «Pulisci la voce», «Volume uniforme», il menu dei brani (o «Scegli la cartella della tua
  musica…»), volume e «Abbassa la musica mentre parli». L'anteprima fa sentire la musica al passo con il video
  montato (ricomincia se è corta), al volume scelto, abbassata mentre c'è una parola della trascrizione e in
  dissolvenza; pulizia e volume si sentono solo nell'export. Nella timeline la traccia «Musica» mostra il brano.
- **«Crea video»**: il progetto nasce con voce ripulita, volume uniforme e un brano a caso della cartella (`pickTrack`).
- Provato con FFmpeg 9.1 su un video sintetico (voce Piper con rumore rosa, pausa di 5 s) e musica sintetica:
  voce −16 dB, rumore nelle pause da −45 a −57 dB, −14,0 LUFS; musica −27 dB nelle pause e circa −13 dB sotto
  la voce; con la musica −14,02 LUFS secondo `loudnorm` (`ebur128` dà −13,4 su toni puri). Nell'app vera su una
  cartella dei dati a parte: brano scelto dal menu e salvato, anteprima da `prisma-media://musica/…` (volume 0,071
  mentre si parla), export 1080×1920 in 4 s.

### B-roll e testi in sovrimpressione (6d)

Scelte (proposte e confermate): B-roll dalla cartella dell'utente più un archivio gratuito, schede disegnate con il
brand kit, proposta con un pulsante a parte. Pexels è stato scartato: a novembre 2026 pexels.com/api dice «New API
key issuance is currently paused»; si usa **Pixabay** (chiave gratuita con un account).

- **Modifiche** (`packages/shared/src/schemas/video-overlays.ts`, campi `edit.overlays` ed `edit.broll` con default
  vuoti, che `videoRenderKey` conta solo se usati): schede `title`/`code`/`list` (titolo ≤ 80, punti ≤ 4, codice ≤ 8
  righe) e B-roll con il file (`BrollMedia`: chiave `cartella/<nome>` o `pixabay/<file>`, percorso, video o
  immagine, misure, durata, fonte e crediti). Tempi del sorgente. Gli Short tengono schede e B-roll del momento.
- **Proposta dell'AI** (`POST /video/enrich`, `modules/ai/enrich.ts`, `video-enrich.{system,user}.md`, schemi in
  `video-enrich.ts`): il modello legge le frasi numerate e propone schede (codice solo se detto, mai inventato) e
  ricerche di B-roll in inglese (2–4 parole visive). `enrichPlanSchema` controlla frasi esistenti, niente B-roll sulla
  frase 0, una scheda per frase, codice ed elenchi non vuoti, al massimo una scheda ogni 12 s e un B-roll ogni 8 s.
  `enrichOverlays` mette le schede (titolo all'inizio della frase per ≤ 3,5 s, codice ed elenchi per tutta la frase,
  1,5–10 s) e le ricerche (la frase, 1,5–8 s).
- **Pixabay** (`modules/stock/`, verificato su pixabay.com/api/docs, novembre 2026): chiave salvata cifrata nella
  tabella `app_credentials` (riga `pixabay`, provata con una ricerca prima di salvarla, mai restituita);
  `GET /stock/status`, `PUT/DELETE /stock/key`, `GET /stock/search?q=&kind=video|image&orientation=&lang=` con
  `safesearch`, 30 risultati e cache di 24 ore (lo chiede Pixabay). Video: il file `medium` (Full HD), poi gli
  altri; foto: `largeImageURL` (lato lungo 1280 px). 429 → «troppe ricerche». Limite 100 richieste al minuto.
- **B-roll sul computer** (`src/main/video/broll.ts`): cartella scelta in **Impostazioni › Strumenti video**
  (`userData/broll.json`, video MP4/MOV/WebM/MKV/M4V e immagini JPG/PNG/WebP, misure e durata da ffprobe) e cache
  `userData/broll-pixabay/pixabay-<id>.<ext>`: si scarica solo da `cdn.pixabay.com`/`pixabay.com` in https, una
  volta sola (file `.part` rinominato a fine download). `prisma-media://broll/<chiave>` e il render usano solo file
  di questi due posti.
- **Ricerca** (`useEnrich`, `services/enrich.ts`): per ogni ricerca prima un file della cartella il cui nome contiene
  le parole (`filenameScore`, prima i video lunghi abbastanza), poi Pixabay se c'è la chiave: video con
  l'orientamento del formato e lungo abbastanza (`bestStockItem`), altrimenti una foto. L'avviso dice quanti dalla
  cartella, quanti da Pixabay e quante ricerche sono rimaste senza file; «Annulla» rimette le modifiche di prima.
- **Schede** (`packages/templates/src/overlay.ts`, `renderOverlayCardHtml`): pagina trasparente grande quanto il
  video con la scheda (colori del template, codice sempre «Terminale», misure proporzionate al lato corto): in 9:16
  titolo in alto (10%) e codice/elenchi a metà, sopra i sottotitoli; in 16:9 titolo a sinistra e il resto a destra.
  Catturata in PNG trasparente dalla finestra offscreen (`captureImage` con
  `Emulation.setDefaultBackgroundColorOverride` trasparente); il renderer passa brand kit e template all'export.
- **Render** (`render-plan.ts`, `layerChain`): ingressi dopo sorgente e musica; spezzone con `-stream_loop -1`,
  `trim`, riempimento del riquadro (scala e ritaglio al centro); immagine ingrandita 2× e `zoompan` lento fino a
  1,08; scheda con dissolvenza alfa di 0,25 s. Ogni livello spostato con `setpts` all'istante sul video montato
  (`editedWindow`, saltato se tagliato) e sovrapposto con `overlay` attivo solo in quell'intervallo; poi i
  sottotitoli. Anche FilmCraft riceve schede e B-roll (sotto).
- **Editor**: «Aggiungi B-roll e testi» accanto a «Monta con l'AI»; anteprima nel riquadro (`LayersPreview`: lo stesso
  HTML del render in un iframe scalato, spezzone al passo col player); pannello «Testi e B-roll» (titolo, punti e
  codice modificabili, «Togli», orario cliccabile, «+ Titolo/+ Codice/+ Elenco» all'istante del player, crediti
  «Video di … da Pixabay»); timeline «Testi e overlay» con schede e B-roll.
- Provato con FFmpeg 9.1 (spezzone, immagine e scheda trasparente: fotogrammi giusti, durata invariata) e nell'app
  vera su una cartella dei dati a parte con un servizio AI finto e una cartella di B-roll sintetica: scheda «Perché uso
  Rust» e B-roll `server-room-lights.mp4` trovato per nome, anteprima, export 1080×1920 in 18 s con scheda e B-roll nei
  fotogrammi. La parte di Pixabay è provata con un Pixabay finto: da provare con una chiave vera.

### Inquadratura che segue il volto (6e)

Scelte (proposte e confermate): MediaPipe sul computer (nessun servizio esterno), «camera morbida».

- **Riconoscimento** (`services/face-detector.ts`): `@mediapipe/tasks-vision` 1.2.3 (Apache-2.0, devDependency inclusa nel
  bundle) con il modello BlazeFace short range (`assets/models/blaze_face_short_range.tflite`, 230 KB, da
  `storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/`, sha256 `b4578f35…`), sulla
  CPU, modalità immagine. Il video scorre muto a velocità 8× in un `<video>` nascosto e a ogni fotogramma decodificato
  (`requestVideoFrameCallback`), circa ogni 250 ms del sorgente (500 ms oltre i 3 minuti, `faceIntervalMs`), si disegna
  a 320 px su un canvas e si cerca il volto: quello più grande con punteggio ≥ 0,5 (`bestFace`, centro e lato in
  frazioni). Un errore ferma l'analisi con un messaggio; annullabile.
- **File dell'app con fetch**: dalla build il renderer è un `file://`, dove `fetch` non funziona. WebAssembly e modello
  (emessi da Vite con `?url`) passano dal protocollo `prisma-app://assets/<file>` (`src/main/app-assets.ts`: solo nomi
  semplici `.wasm/.js/.tflite` della cartella `out/renderer/assets`, `application/wasm`, `corsEnabled` e
  `access-control-allow-origin` perché la pagina ha origine «null»). CSP: `script-src 'self' 'wasm-unsafe-eval'`,
  `connect-src … prisma-app:` (non `prisma-media:`: i video restano illeggibili con fetch). Anche `prisma-media` ora ha
  `corsEnabled` e l'header CORS, e il `<video>` dell'analisi ha `crossOrigin`: senza, il canvas risulta «tainted» e
  MediaPipe non ne legge i pixel. In `img-src` c'è anche `prisma-media:` (immagini del B-roll della 6d).
- **Dati** (`packages/shared/src/schemas/video-face.ts`): `project.faces` (`FaceTrackSchema`: campioni con istante e
  centro/lato o null, copertura, modello) salvato con l'IPC `video:save-faces`; `edit.followFace` (default false,
  contato da `videoRenderKey` solo se acceso, insieme all'analisi).
- **Camera morbida** (`followPath`, pura e testata): sull'asse libero del formato (`freeAxis`: x per 9:16 da 16:9, y per
  16:9 da verticale, nessuno se coincidono) la camera sta ferma finché il volto resta nella zona centrale (12% del
  ritaglio); quando ne esce accelera verso il volto con velocità massima 0,6 ritagli al secondo, rallenta in arrivo e
  si ferma; senza volto resta dov'è. Il tempo vero tra i campioni conta (non sono regolari). Il percorso si semplifica
  (Ramer–Douglas–Peucker, tolleranza 0,004) tenendo sempre partenze e arresti; `followOffsetAt` interpola.
- **Render** (`followCropPosition` in `render-plan.ts`, `cropFollow` in `render.ts`): per ogni parte rimasta la
  posizione del `crop` diventa un'espressione di `t` tra apici (lineare a tratti sui punti del percorso dentro la
  parte, `followSegment`), più lo spostamento verso il centro dello zoom.
- **Editor** (`FollowFaceControl.tsx`, logica in `services/face.ts`, hook `useFaceAnalysis`): «Segui il volto» accanto ai
  formati (solo se il formato lascia un asse libero); la prima volta analizza («Cerco il volto… 45%», «Annulla») e si
  accende solo se un volto c'è; poi accende/spegne. Il riquadro dell'anteprima segue il percorso; trascinarlo a mano
  spegne «Segui il volto».
- Provato con FFmpeg 9.1 (espressione nel grafo da file, ritaglio che si sposta) e nell'app vera su una cartella dei
  dati a parte: WebAssembly e modello caricati da `prisma-app` con la CSP della build, 5 s di video analizzati in 1 s e
  salvati, export 1080×1920 con il ritaglio che segue una traccia di prova. Una faccina emoji non viene riconosciuta
  come volto (BlazeFace è fatto per volti veri): la precisione va provata su un video vero.

### Registrazione nell'app e layout (6f)

Scelte (proposte e confermate): schermo e webcam in due file separati, layout scelto nell'editor, 1080p a 30 fps.

- **Registra** (`screens/Registra/RecordScreen.tsx`, rotta `/registra`, voce «Registra» sotto CREA; hook `useRecording`,
  `useDevices`; logica in `services/recorder.ts`): webcam e microfono (`getUserMedia`, ideale 1920×1080 a 30 fps, con
  cancellazione dell'eco e del rumore), schermo o finestra con miniature (`desktopCapturer` dal main, IPC
  `record:sources`/`record:choose`; su Windows Electron non ha un selettore di sistema, quindi
  `setDisplayMediaRequestHandler` passa a `getDisplayMedia` la sorgente scelta). Anteprima con la webcam nell'angolo,
  conto alla rovescia 3-2-1, «REC 00:05», «Ferma e apri nell'editor», «Annulla».
- **Registrazione** (`SessionRecorder`): un MediaRecorder per traccia (H.264 se c'è, poi VP8; 8 Mb/s webcam, 6 Mb/s
  schermo), pezzi ogni secondo mandati in ordine al main (`record:chunk`) e scritti su disco in
  `userData/registrazioni/<id>/{camera,screen}.webm`; il microfono va sulla webcam o, senza webcam, sullo schermo.
  Gli istanti `onstart` delle due tracce danno la sfasatura.
- **Salvataggio** (`src/main/recording.ts`): FFmpeg converte in MP4 (H.264 veryfast CRF 20/22, 30 fps, AAC solo dove
  c'è il microfono: i WebM di MediaRecorder non hanno durata né indice), cancella i WebM, misura con ffprobe e crea il
  progetto: sorgente `webcam.mp4` (o lo schermo se non c'è la webcam), `project.screen` (`VideoScreenSchema`: file,
  misure, durata, `offsetMs`), `project.recording`, titolo «Registrazione del 25 nov, 14:06». Con webcam e schermo si
  parte dal layout «Diviso». Un errore cancella la cartella.
- **Permessi**: prima Electron concedeva tutto. Ora `setPermissionRequestHandler`/`setPermissionCheckHandler` ammettono
  solo `media`, `display-capture`, `clipboard-sanitized-write` e `fullscreen` (`isAllowedPermission`). Windows deve
  permettere webcam e microfono alle app desktop (messaggio in `mediaErrorMessage`).
- **Layout** (`packages/shared/src/schemas/video-layout.ts`, `edit.layout`, contato da `videoRenderKey` solo se diverso
  da «Solo tu»): `camera` (Solo tu), `screen` (Solo schermo), `pip` (schermo e webcam quadrata in alto a destra, lato
  34% del lato corto), `split` (solo 9:16: schermo sopra 1080×960, tu sotto 1080×960). `availableLayouts`,
  `effectiveLayout`, `layoutBoxes`, `screenTimeMs`. Il ritaglio della webcam prende le proporzioni del suo riquadro
  (`cropRectForAspect`, anche `freeAxis`/`followPath` accettano proporzioni), così zoom e «Segui il volto» valgono
  anche nel diviso e nell'angolo. `zoomedCrop` ora sta in shared.
- **Render** (`composeLayout` in `render-plan.ts`, `composition`/`cameraAspect` in `render.ts`): la webcam si scala al
  suo riquadro e esce come `[vcam]`; lo schermo (ultimo ingresso) segue gli stessi tagli spostati di `offsetMs`, ogni
  parte lunga esattamente come quella della webcam (`tpad` ripete il primo o l'ultimo fotogramma), `fps=30`, entra
  intero nel suo riquadro con le bande del colore di fondo (`pad`), `concat` in `[vscr]`; poi `vstack`, `overlay` o solo
  schermo (`[vcam]nullsink`) in `[vc]`, e da lì B-roll, schede e sottotitoli come prima. Senza layout il grafo è
  identico a prima.
- **Editor**: pulsanti «Tu / Schermo / Angolo / Diviso» accanto a «Segui il volto» (solo con lo schermo);
  `LayoutPreview` disegna a ogni fotogramma su un canvas lo schermo (`prisma-media://schermo/<id>`, al passo con la
  sfasatura) e la webcam ritagliata nel suo riquadro, con gli stessi calcoli del render (`services/layout.ts`).
- Provato con FFmpeg 9.1 (i tre layout, 4 s esatti con lo schermo partito 0,5 s dopo e finito prima) e nell'app vera
  su una cartella dei dati a parte con la webcam e il microfono finti di Chromium
  (`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`) e la finestra di Prisma come schermo: anteprime
  1920×1080, 5 s registrati, salvati in 2 s, progetto con webcam e schermo (sfasatura 13 ms) e layout «Diviso»,
  export 1080×1920 uguale all'anteprima, nessun errore in console.

### «Crea video dall'idea» (6c)

- **Copione** (`POST /video/script` con `ideaId` o `variantId`, `modules/ai/video-script.ts`,
  `generate-video-script.{system,user}.md`, schemi in `packages/shared/src/schemas/video-script.ts`): l'LLM scrive
  3–8 scene di circa 45 s in tutto (70–160 parole, controllate da `GeneratedVideoScriptSchema`, gli errori tornano al
  modello), ognuna con `narration` (letta alla lettera: niente simboli, emoji, elenchi) e una `slide` come quelle dei
  caroselli (cover all'inizio, cta alla fine). Dagli articoli del blog si usa il testo senza HTML. Il server non salva
  nulla.
- **Voce locale** (`src/main/video/tts.ts`): strumenti video `tts` (`sherpa-onnx-offline-tts.exe`, cercato anche in
  `%LOCALAPPDATA%\Programs\sherpa-onnx\*\bin`) e `ttsVoice` (voce Piper `.onnx` con `tokens.txt` ed
  `espeak-ng-data` accanto, cercata in `userData/voci/<voce>/`). Serve sherpa-onnx **1.13** (zip
  `win-x64-shared`): la 2.x ha tolto espeak-ng, che serve alle voci Piper. sherpa-onnx legge gli argomenti con la
  code page ANSI (1252), non in UTF-8: `ansiArgument` passa i byte UTF-8 come caratteri della code page (letta dal
  registro, `readAnsiCodePage`) e Windows li riconverte negli stessi byte; prima `speechText` tiene solo lettere
  latine, accenti italiani, cifre e punteggiatura semplice (e legge %, &, +, €). Senza sherpa-onnx o voce: **voce di
  Windows** (System.Speech da PowerShell con `-EncodedCommand`, testo da un file UTF-8, voce `it-IT` se c'è).
  Voce provata: `vits-piper-it_IT-paola-medium` (licenza CC0, release `tts-models` di sherpa-onnx).
- **Montaggio** (`idea-video.ts`, `slideshow.ts`): un WAV per scena (durata dall'intestazione, `wavDurationMs`),
  slide JPEG 1080×1350 con `renderSlideHtml` e la finestra offscreen dell'export (`captureJpeg`), template «Tech
  scuro»; un passaggio di FFmpeg con grafo da file: ogni slide ingrandita a 2× e poi `zoompan` lento fino a 1,06,
  `pad` a 1080×1920 col fondo del template (slide a 190 px dall'alto, sotto restano i sottotitoli), voce con
  `apad`/`atrim` alla durata della scena (voce + 450 ms), `concat`. Il video resta in
  `userData/video-creati/<lavoro>/video.mp4` (sorgente del progetto), i file di lavoro si cancellano; un errore toglie
  tutta la cartella. Un lavoro alla volta, annullabile (`video:cancel` con l'id del lavoro).
- **Progetto**: come un video importato, 9:16, sottotitoli parola per parola, `project.generated` (idea o post,
  voce, scene). Trascrizione: con whisper.cpp le parole del copione prendono i tempi sentiti (`alignScriptWords`,
  distanza di modifica: la voce sintetica a volte viene capita male, «bug» → «buco»); senza whisper tempi stimati
  per lunghezza delle parole (`estimatedWords`, modello `copione`). Poi «Monta con l'AI», export e «Collega a» come
  per ogni video.
- **UI**: «Crea video» nelle schede delle Idee e «Crea video dal post» nello Studio per YouTube, TikTok, Instagram e
  LinkedIn (a bozza salvata), con le fasi (`createVideoLabel`: copione, voce, slide, montaggio, Whisper) e
  «Annulla»; a fine lavoro si apre l'editor. Nell'elenco «Dall'idea · 0:30 · 9:16». Logica in
  `services/create-video.ts`, hook `useCreateVideo`. L'avanzamento arriva con l'id del lavoro scelto dal renderer.
- Provato nell'app vera su una cartella dei dati a parte con un servizio AI finto: clic su «Crea video» → editor in
  30 s, 5 scene, 1080×1920, 30 s con la voce Piper (sherpa-onnx 1.13.8), trascrizione identica al copione; con la
  voce di Windows (voce Piper non valida) 41 s di video in 26 s.

## Local-first: il server dentro l'app (fase 5c)

- **Dati sul computer** (predefinito, `Impostazioni › Dati`): all'avvio, durante l'intro, `src/main/core.ts` avvia
  `createPrismaRuntime` di `@prisma-app/server` (export `./runtime` e `./config`, incluso nel bundle del main) con
  il database `userData/contenuti.db` (diverso da `prisma.db` dei progetti video). Nessuna porta: `ipc.ts` passa le
  richieste del renderer a `app.inject` con un token interno casuale. Scheduler, metriche e suggerimenti girano
  mentre l'app è aperta (in background con la 5f).
- **Chiave di cifratura** di token e chiavi API: 32 byte casuali al primo avvio, salvati cifrati con `safeStorage`
  in `userData/chiave-dati.json`. Se c'è `chiave-importata.txt` (lasciato da `db:import-mysql`) la si adotta e il
  file in chiaro si cancella.
- In sviluppo il core legge dal `.env` del progetto le variabili facoltative (credenziali delle piattaforme, R2,
  ripiego `DEEPSEEK_*`), mai database, token, chiave e porta. Nell'app installata nessun `.env`.
- **Server remoto** (opzione): indirizzo e token come prima; `settings.json` ha `mode` (`locale`/`remoto`, assente =
  `locale`). Il cambio vale dal riavvio («Riavvia ora», IPC `app:restart`). Nel browser (`dev:web`) il proxy di Vite
  continua a usare il server da solo.
- **Driver SQLite**: una connessione `node:sqlite` (WAL, `foreign_keys`, `busy_timeout`), istruzioni preparate con
  `setReturnArrays(true)` come vuole `sqlite-proxy`. Una coda (`Mutex`) fa passare una transazione alla volta;
  `AsyncLocalStorage` riconosce le query dentro la transazione in corso (che vanno dirette) e una transazione
  chiesta dentro un'altra si unisce a quella. `affectedRows` = `changes`; chiave duplicata = `SQLITE_CONSTRAINT_UNIQUE`.
- **Copie nel codice**: migrazioni (`db/migrations.generated.ts`, tabella `__prisma_migrations`) e prompt
  (`llm/prompts.generated.ts`; il server da solo legge i file se ci sono). `pnpm --filter @prisma-app/server embed`
  le rigenera (lo fa la build del desktop); un test controlla che coincidano con i file.
- **Dal vecchio MySQL** (`db/import-mysql.ts`, una volta): copia tutte le tabelle con gli stessi id (date in ms, JSON
  in testo) in `%APPDATA%/Prisma/contenuti.db` o in `--to`; rifiuta un database con dati senza `--replace` (che ne
  tiene una copia `.bak`); controlla le chiavi esterne; per l'app lascia la chiave del vecchio server. Il MySQL non si
  tocca. Provato sui dati veri: brand, 5 argomenti, 2 idee, 4 contenuti con bozze, revisioni, chat e 9 file esportati,
  letti poi dall'app senza server avviato.

## App delle piattaforme e login dall'app (fase 5d)

Verificato sulla documentazione ufficiale (novembre 2026). Ogni utente crea le sue app sviluppatore e le inserisce in
**Impostazioni › Account** («App» accanto a ogni social) e **Archivio file** (R2).

- **Salvataggio** (`modules/app-credentials/`, tabella `app_credentials`, migrazione `0001_app_credentials`): per
  chiave (`linkedin`, `instagram`, `youtube`, `tiktok`, `r2`) un JSON cifrato con `tokenContext('app', key)`.
  `GET /settings/apps` (identificativo pubblico, `hasSecret`, indirizzo di ritorno da registrare, dati R2),
  `PUT/DELETE /settings/apps/:key`. Il segreto non torna mai; vuoto = tieni quello salvato, ma solo per la stessa app
  (stesso client id). Schemi in `packages/shared/src/schemas/app-credentials.ts`.
- **Uso**: `createPrismaRuntime` legge le credenziali salvate e le sovrappone al `.env` (`applySavedCredentials`), così
  OAuth, adapter e R2 non cambiano. Un salvataggio chiama `onCredentialsChanged`: il core dell'app (e il server da solo)
  ricostruisce il runtime dopo aver risposto; le richieste che arrivano intanto aspettano quello nuovo.
- **Ritorno del login** (indirizzi in `apps/desktop/src/main/core.ts`, `OAUTH_REDIRECTS`): il core apre un piccolo
  server HTTP su `127.0.0.1:47615` che risponde solo a `GET /oauth/<piattaforma>/callback` (lo `state` firmato lega la
  risposta al login partito da Prisma), il resto è 404.
  - **Google/YouTube**: client OAuth di tipo «App desktop», ritorno su `http://127.0.0.1:47615/oauth/youtube/callback`
    (nessun indirizzo da registrare), PKCE S256 base64url.
  - **TikTok**: Login Kit for Desktop, ritorno su `http://127.0.0.1:47615/oauth/tiktok/callback` (da registrare; sono
    ammessi solo localhost/127.0.0.1), PKCE S256 in esadecimale come chiede la doc desktop. `video.upload` va
    approvato da TikTok; in sandbox fino a 10 account propri (da confermare con la prima prova).
  - **LinkedIn e Instagram**: la doc chiede un ritorno https. Si registra la pagina statica del progetto su GitHub
    Pages (`docs/oauth/<piattaforma>/`, `https://code965.github.io/Prisma/oauth/<piattaforma>/`), che passa la query
    così com'è a `127.0.0.1:47615` (`docs/oauth/oauth.js`, nessun'altra richiesta). Il codice da solo non serve: lo
    scambio richiede il segreto, che sta solo sul PC.
  - PKCE in `auth/pkce.ts`: il verifier resta sul server legato allo state per 10 minuti e si usa una volta.
- **R2**: Account ID (32 hex), bucket, Access Key ID e Secret di un token «Object Read & Write», indirizzo pubblico del
  bucket (Instagram scarica le immagini da lì; r2.dev è limitato e va bene per uso personale, altrimenti un dominio
  su Cloudflare).
- Desktop: `screens/Impostazioni/AppCredentialsForm.tsx` (guida passo passo, «Apri la pagina di …», indirizzo da
  copiare, campi), logica e guide in `services/app-credentials.ts`. «Collega» resta spento finché l'app non è
  configurata. L'IPC apre nel browser anche le pagine dove si creano le app (elenco in `ipc-contract.ts`).
- Provato nell'app vera con credenziali di prova (poi tolte): runtime ricostruito, login YouTube con ritorno su
  127.0.0.1 e PKCE, listener che rifiuta uno state falso (401) e i percorsi non di login (404). Da provare con le app
  vere delle quattro piattaforme.

## Configurazione guidata (fase 5e)

- `screens/Setup/SetupWizard.tsx`: Benvenuto (simbolo `components/PrismaMark`, cosa fa Prisma), Il tuo brand (nome,
  iniziali ricavate dal nome, argomenti come etichette), AI (`AiSettingsSection`), Account (`AccountsSection`, la
  stessa delle Impostazioni con app, «Collega» e R2), Pronto («Scrivi la prima idea» porta alle Idee). Dopo il brand
  ogni passo si può rimandare; «Salta la configurazione» chiude tutto.
- Si apre (`services/setup.ts`, `shouldShowSetup`) solo su un database nuovo: un solo brand con il nome predefinito
  (`DEFAULT_BRAND` in shared, lo stesso del seed del server) e configurazione non completata
  (`localStorage` `prisma.configurazione`). `AppShell` lo decide una volta a brand caricati, così salvare il nome non
  la chiude a metà. Il brand si salva con `PATCH /brands/:id`, gli argomenti con le rotte dei tag (`tagChanges`).
- `PRISMA_DATA_DIR=<cartella>` avvia l'app su una cartella dei dati a parte (database nuovo): usato per provare la
  configurazione guidata senza toccare i dati veri. Provata così con il percorso completo (brand «Marta Rossi / MR»,
  arrivo alle Idee).

## Prisma in background e server sempre acceso (fase 5f)

- `src/main/background.ts` (solo con i dati sul computer): icona nell'area di notifica (menu «Apri Prisma»,
  «Avvia con Windows», «Esci da Prisma»; clic = apri). Chiudere la finestra la nasconde (evento `close` con
  `preventDefault`): scheduler, metriche e suggerimenti continuano; la prima volta una notifica lo spiega. «Esci da
  Prisma» o un aggiornamento chiudono davvero (`before-quit`).
- **Avvio con Windows** (`app.setLoginItemSettings`, solo nell'app installata) con l'argomento `--nascosta`: niente
  intro e finestra nascosta. Preferenze in `userData/background.json` (`keepRunning` predefinito sì, `openAtLogin`
  predefinito no), IPC `background:get/set`, sezione **In background** delle Impostazioni.
- **Una sola istanza** per cartella dei dati (`requestSingleInstanceLock` dopo aver impostato `userData`): un secondo
  avvio esce e riporta in primo piano la finestra del primo.
- `window.close()` dal renderer non passa dall'evento `close`: le prove si fanno con `WM_CLOSE` (come la X).
  Verificato nell'app vera su una cartella dei dati a parte: X → finestra nascosta e processo attivo, notifica una
  volta; `--nascosta` → nessuna finestra; secondo avvio → codice 0 e finestra visibile.
- **Server sempre acceso** (facoltativo, `docs/server-docker.md`): `Dockerfile` alla radice (build con pnpm, poi
  `node:24-slim` con il solo `dist/index.js` di tsup: tutte le dipendenze nel bundle, `removeNodeProtocol: false`
  perché `node:sqlite` esiste solo con il prefisso), database nel volume `/data`, utente `node`.
  `compose.example.yaml` lo espone solo su 127.0.0.1. Il workflow Release pubblica l'immagine
  `ghcr.io/code965/prisma-server` con il tag della versione e `latest`. Il bundle è provato da solo (health, 401
  senza token, dati iniziali); l'immagine la costruisce la CI (Docker non è installato su questo PC).

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
  Markdown, `docs/`, mockup e licenza) un job windows-latest fa lint, typecheck e test (alcuni test del desktop
  usano percorsi Windows), poi un job windows-latest calcola la
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
- Test di integrazione (`*.int.test.ts`): un database SQLite in memoria per file, con le migrazioni vere, dentro
  `withRollback` (`test/helpers/integration.ts`), una transazione sempre annullata, con orologio fisso `NOW`. Girano
  sempre, anche nella CI.

## Comandi

```
pnpm install
pnpm lint | pnpm typecheck | pnpm test | pnpm format
pnpm dev              # server da solo in watch (tsx), .env alla radice, database data/prisma.db
pnpm --filter @prisma-app/desktop dev       # app Electron in sviluppo
pnpm --filter @prisma-app/desktop dev:web   # solo il renderer nel browser (http://localhost:5174)
pnpm --filter @prisma-app/desktop build     # build di main, preload e renderer in apps/desktop/out
pnpm db:generate      # nuova migrazione dopo una modifica a schema.ts (e copia nel codice)
pnpm --filter @prisma-app/server embed            # ricopia prompt e migrazioni nel codice
pnpm --filter @prisma-app/server db:import-mysql  # una volta: dati dal vecchio MySQL all'app
```

## Server

- `src/app.ts` costruisce Fastify con le dipendenze iniettate (`buildApp(deps)`), così i test usano `app.inject` senza DB.
- `src/services.ts` compone i servizi con un `DbExecutor` (database o transazione) e un orologio `now()`.
- Auth: hook `onRequest` con bearer token confrontato a tempo costante; pubblico solo `/health`.
- Errori: `ZodError` → 400, `NotFoundError` → 404, `InvalidTransitionError`/`VersionConflictError`/`ConflictError`/chiave duplicata → 409, `BusinessRuleError` → 422, il resto → 500 senza dettagli.
- Gli stati cambiano solo tramite `applyVariantTransition` e `applyPublicationTransition`
  (`modules/*/transitions.ts`): leggono la riga nella transazione, validano con la macchina a stati
  condivisa e aggiornano pubblicazione e variant nella stessa transazione. Lo scheduler userà le stesse funzioni.
- `idempotency_key` = sha256(variant:account:versione approvata): la stessa versione non si programma due volte.
- Date come `integer` `timestamp_ms` (UTC), `created_at`/`updated_at` impostati da Drizzle; JSON come testo; enum
  come testo con valori chiusi; token cifrati in colonne `bytes` (BLOB letto come `Buffer`).
- `runtime.ts` (`createPrismaRuntime(env)`): database con migrazioni e dati iniziali (`seed.ts`: brand «Il mio brand»
  e 5 argomenti solo a database vuoto), servizi, Fastify, scheduler e metriche. Lo usano `index.ts` (server da solo,
  apre la porta) e l'app desktop (`core.ts`, senza porta).

### Brand kit e voce (`modules/brand-kit/`)

- `brands.kit` (JSON, null = `DEFAULT_BRAND_KIT` coi colori del mockup) e tabella `voice_examples`; migrazione
  `0002_brand_kit`. Schemi in `@prisma-app/shared` (`BrandKitSchema`, `VoiceExampleInputSchema`).
- `videoTemplate` (Tech scuro/Minimal chiaro/Terminale, default scuro): template dei video (slide di «Crea video»,
  schede di testo, fondo attorno allo schermo registrato), scelto nel pannello Brand kit; non entra nella chiave
  degli export dei caroselli.
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
- Chiave ricavata dal contenuto: `brand-<id>/<sha256>.<ext>`. Ricaricare lo stesso file non crea doppioni.
- **Pulizia** (`cleanupStorage` nel servizio degli asset, `POST /storage/cleanup`, verificato su
  developers.cloudflare.com/r2/api/s3/api: ListObjectsV2 e DeleteObjects supportati): ogni giorno (5 minuti dopo l'avvio,
  poi ogni 24 ore) e con «Pulisci ora» in Impostazioni › Account › Archivio file si tolgono gli oggetti sotto `brand-`
  a cui nessun file esportato fa più riferimento (`listRemoteKeys`) e più vecchi di 7 giorni
  (`STORAGE_CLEANUP_GRACE_DAYS`: un caricamento in corso non si tocca). `ObjectStorage` ha `list(prefix)` (tutte le
  pagine) e `remove(keys)` (a gruppi di 1.000).
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
2. **Claim**: in una transazione (con SQLite una alla volta: due worker non prendono la stessa riga) delle pubblicazioni `programmato` con
   `next_attempt_at <= now`, poi transizione `start`, `attempts + 1`, `locked_by` e riga in `publication_attempts`.
3. **Invio** (fuori dalla transazione, in sequenza): se `external_id` è già valorizzato si registra il successo
   senza reinviare; altrimenti adapter, `validate()`, decifratura del token e `publish()` con l'`idempotencyKey`.
4. **Esito**: successo → `pubblicato`; `PublishError` con `retryable` (o errore non classificato) e tentativi
   rimasti → `programmato` con backoff (1, 2, 4… min, max 1 h, jitter ±20%); altrimenti → `errore`.

Worker e recupero considerano solo le piattaforme con un adapter registrato in `src/index.ts`:
le altre pubblicazioni restano `programmato` finché l'adapter non esiste.

Test: `scheduler.int.test.ts` (rollback, orologio nel 1990) e `scheduler-concurrency.int.test.ts`
(3 worker sullo stesso database SQLite in memoria creato dal test, con orologio al 2000): ogni file di test ha il suo
database in memoria, quindi i test non vedono mai dati veri né lo scheduler di un server acceso.

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
| Trend         | `GET /brands/:brandId/trends`, `PUT /brands/:brandId/trends/keywords`, `POST /brands/:brandId/trends`                                                                                                                                                                 |
| Concorrenti   | `GET/POST /brands/:brandId/competitors`, `DELETE /competitors/:id`, `POST /competitors/:id/{refresh,posts}`, `DELETE /competitor-posts/:id`, `POST /brands/:brandId/competitors/analysis`                                                                             |
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
- **AI a scelta dell'utente** (fase 5b): un solo provider generico, `createOpenAiCompatibleProvider`
  (`llm/openai-compatible.ts`, SDK `openai` con base URL a piacere) per DeepSeek, Ollama, LM Studio, OpenAI, OpenRouter o
  qualsiasi servizio compatibile. Chiede `response_format: json_object`; se il servizio lo rifiuta (es. LM Studio) lo
  toglie e continua; `extractJson` accetta il JSON in un blocco ```json o tra testo. Preset in
  `packages/shared/src/schemas/ai-settings.ts` (`AI_PRESET_INFO`: indirizzo, modello proposto solo per DeepSeek, chiave
  sì/no, locale). DeepSeek verificato (novembre 2026): `deepseek-flash` (default) e `deepseek-v4-pro`.
- **Impostazioni › AI** (`modules/ai-settings/`, tabella `ai_settings` con una riga, migrazione `0007_ai_settings`):
  `GET/PUT/DELETE /ai/settings`, `POST /ai/settings/test` (con corpo prova quel servizio, senza quello in uso: domanda
  minima `{"ok": true}`, errore → 422 con il motivo). Chiave cifrata con `tokenContext('ai', 'settings')`, mai restituita
  (`hasKey`); `apiKey` assente = tieni la salvata, `""` = toglila; i preset con chiave obbligatoria senza chiave → 422.
- **Provider per operazione**: i servizi ricevono un `LlmSource` (`current()`): le Impostazioni se ci sono, altrimenti il
  ripiego `DEEPSEEK_*` del `.env` (`envProviderConfig`), altrimenti null → 503 `llm_non_configurato` («Impostazioni ›
  AI»). Un cambio vale subito; il provider si ricrea solo se cambia la configurazione. Nei test `llm` resta un provider
  fisso (`staticLlmSource`). `LlmError` → 502 `errore_llm`.
- Desktop: `Impostazioni/AiSettingsSection.tsx` (servizi locali per primi, «Prova», «Salva», «Togli»), logica in
  `services/ai-settings.ts`. Il JSON mode richiede la parola "json" e un esempio nel prompt.
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
- Nessun database da installare: SQLite. Il vecchio MySQL locale (servizio `MySQL80`) serve solo a `db:import-mysql`.
- Electron: il binario si scarica con lo script di installazione, autorizzato in `pnpm.onlyBuiltDependencies`.
  Se manca `apps/desktop/node_modules/electron/dist`, lanciare `node node_modules/electron/install.js` da `apps/desktop`.
- `.env`, `db-setup.local.sql` (del vecchio MySQL) e `data/` (database del server da solo) sono locali ed esclusi da git.
- Se la cartella del progetto viene spostata o rinominata, i collegamenti di pnpm restano sul vecchio percorso: serve
  `pnpm install --config.confirmModulesPurge=false` (poi `node node_modules/electron/install.js` in `apps/desktop`,
  che prende Electron dalla cache `%LOCALAPPDATA%\electron\Cache` senza scaricarlo).

## Stato di avanzamento

### Fase 1 — Fondamenta

- [x] 1. Monorepo, TypeScript, ESLint/Prettier, Vitest, docker-compose, `.env.example`, CLAUDE.md
- [x] 2. `packages/shared`: enum, schemi Zod, macchina a stati + test
- [x] 3. Server: config, auth, schema Drizzle, prima migrazione, seed brand
- [x] 4. API CRUD (brand, idee/tag, contenuti, variant + transizioni, pubblicazioni)
- [x] 5. Cifratura AES-256-GCM e scheduler (test concorrenza, retry, idempotenza)
- [x] 6. `LlmProvider` DeepSeek: generazione variant, chat di modifica con revisioni
- [x] 7. LinkedIn: verifica docs, OAuth, `LinkedInAdapter` con test su mock; provato con l'app LinkedIn reale (collegamento e primo post, novembre 2026)
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

### Fase 5 — Open source e local-first

Scelte (proposte e confermate): Prisma diventa multiutente senza costi per chi la mantiene. Ognuno la usa sul proprio
PC con le proprie chiavi e app sviluppatore; licenza AGPL-3.0; repository pubblico con release automatiche.

- [x] 5a. Pulizia e pubblicazione: Blog API generica (`docs/blog-api.md`), anteprima neutra, nessun riferimento
      personale, AGPL, cronologia nuova, release a ogni push su main, link di download fisso
- [x] 5b. AI a scelta dell'utente (Impostazioni › AI, servizi compatibili OpenAI, chiave cifrata, ripiego sul .env)
- [x] 5c. Server dentro l'app desktop con SQLite al posto di MySQL, e migrazione dei dati esistenti
- [x] 5d. Credenziali delle app delle piattaforme e di R2 nelle Impostazioni, OAuth con ritorno su localhost
- [x] 5e. Configurazione guidata al primo avvio
- [x] 5f. Prisma in background (area di notifica, avvio con Windows); server in Docker facoltativo

### Fase 6 — Video con l'AI

- [x] 6a. «Monta con l'AI» sui propri video: silenzi, esitazioni, riempitivi e false partenze, hook, parole chiave,
      zoom
- [x] 6c. «Crea video dall'idea»: copione dell'AI, voce locale, slide animate del brand kit, sottotitoli parola per
      parola
- [x] 6b. Audio: pulizia, volume uniforme, musica da una cartella dell'utente con ducking
- [x] 6d. B-roll (cartella dell'utente e Pixabay) e schede di testo in sovrimpressione
- [x] 6e. Inquadratura che segue il volto (MediaPipe sul computer, camera morbida)
- [x] 6f. Registrazione nell'app (webcam, microfono, schermo) e layout (tu, schermo, angolo, diviso)

### Fase 7 — Template personalizzabili

Scelte (proposte e confermate il 25 novembre 2026): più stili pronti e un editor per creare i propri (non un canvas
libero), font open source inclusi nell'app, galleria con anteprime vere, template predefinito per formato, «Duplica e
modifica».

- [x] 7a. Font open inclusi (scelta per titoli, testo e codice nel brand kit) e galleria con anteprime vere
- **Font** (`packages/shared/src/schemas/fonts.ts`): catalogo `SLIDE_FONTS` di 11 font @fontsource (OFL-1.1, solo
  latino e i pesi usati): Inter, Space Grotesk, Poppins, Manrope, IBM Plex Sans, Sora, Playfair Display, DM Serif
  Display per titoli e testo; JetBrains Mono, IBM Plex Mono, Fira Code per codice, numeri, etichette e iniziali. Nel kit
  `fonts: { heading, body, code }` (default Inter/Inter/JetBrains Mono, anche per i kit salvati prima); `titleWeight`
  per font (DM Serif ha solo il 400). `renderInputKey` conta i font solo se diversi da quelli di sempre, così gli export
  già fatti restano aggiornati. Slide, schede dei video e slide di «Crea video» usano `fontStack`.
- File: renderer `components/SlideFrame/slide-fonts.ts` (`?url`, tutte le `@font-face`: il browser scarica solo
  quelle usate), main `export/font-files.ts` (`?asset`); `slideFontFaceCss(kit.fonts)` nel main incorpora come data URL
  solo i font del kit, ognuno preparato una volta.
- **Brand kit**: tre gruppi «Titoli / Testo / Codice» con ogni nome scritto nel suo font. **Galleria**: un riquadro per
  stile (Tech scuro, Minimal chiaro, Terminale) con copertina, elenco e codice disegnati da `renderSlideHtml` col kit
  in bozza (colori, font, logo, handle; `galleryCarousel`, `draftKit`) e il segno «Video» sullo stile dei video. Le
  vecchie miniature finte (citazione, miniatura YouTube, copertina Reel) sono tolte finché non esistono quei formati.
- Provato nel browser con il server su un database di prova (configurazione `server` in `.claude/launch.json`, che
  usa `%TEMP%\prisma-prova`): font scelti caricati nelle slide, salvataggio e ricaricamento, tema scuro; build con i
  32 file dei font accanto al main.
- [x] 7b. Modello del template personalizzato (sfondo, forme decorative, logo e numerazione, tipografia) e nuovi stili
      pronti costruiti con lo stesso modello
- **Modello** (`packages/shared/src/schemas/template-style.ts`): `TemplateStyle` = `tone` (scuro, chiaro, codice,
  accento: da quale combinazione del kit nascono testo, accento e codice, `tonePalette`), `background` (tinta del tono,
  gradiente tra due ruoli del kit con angolo, foto ≤ 600 KB come data URL con velo `dim`), `decoration` (bagliore,
  griglia, puntini, angolo, filetto sopra il titolo), `logo` e `numbering` (in basso, in alto, barra di avanzamento,
  nessuno), `titleScale` 0,8–1,3, `uppercase`, `align`. Colori sempre per ruolo, così il template segue il kit.
- **Template**: `CAROUSEL_TEMPLATES` ora ha 7 stili pronti (`BUILTIN_TEMPLATE_STYLES`: i 3 di prima più Gradiente,
  Editoriale, Bold, Griglia); quelli dell'utente stanno in `kit.templates` (max 12, id `tpl-` + 8 caratteri,
  `CustomTemplateSchema`) e i caroselli li indicano con `TemplateIdSchema`. `resolveTemplate` (un template del kit
  eliminato torna a Tech scuro), `templateChoices` per i selettori. `brand-colors.ts` separa i colori dal kit (import
  circolari).
- **Renderer** (`slide.ts`): `styleCss` aggiunge CSS e `slideMarkup` cambia struttura solo se lo stile non è quello di
  base, quindi i tre stili di prima danno HTML identico byte per byte (verificato su tutte le slide, PDF e schede
  video). `renderInputKey` include lo stile dei template del kit. Le schede dei video prendono il tono del template.
- **UI**: nell'editor carosello un menu «Stili pronti / I tuoi template» con il campione del fondo (`templateSwatch`),
  nel brand kit i template dei video con il campione, in galleria tutti gli stili. Provato nel browser con il server
  su un database di prova: anteprime dei 4 nuovi stili, carosello salvato con `bold`.
- [x] 7c. Editor del template con anteprima dal vivo, «Duplica e modifica», template predefinito per formato
- **Editor** (`screens/Template/TemplateEditor.tsx`, logica in `services/template-editor.ts`): finestra sopra la pagina
  con nome, colori di base, sfondo (tinta, sfumatura con due ruoli del kit e direzione, foto con velo), decorazione,
  logo, numerazione, titoli (dimensione, maiuscole, allineamento); a destra copertina, elenco e codice ridisegnati a
  ogni modifica (anteprima con l'id fittizio `tpl-anteprim`). La foto si riduce nel renderer a 1350 px in JPEG,
  abbassando la qualità finché sta nei 600 KB (`prepareBackgroundImage`). Salvataggio subito nel kit
  (`saveTemplate`), al massimo 12, nomi unici; «Elimina template» con conferma (`removeTemplate`: predefiniti
  rimessi a Tech scuro, i caroselli che lo usavano si vedono in Tech scuro).
- **Galleria**: «+ Nuovo template», e su ogni card «Duplica e modifica» (`duplicateDraft`, «Copia di …»),
  «Modifica» sui propri, «Usa per i caroselli» e «Usa per i video» salvati subito, con i segni «Caroselli» e «Video».
  La scelta del template dei video è passata dal pannello Brand kit alla galleria.
- **Predefinito dei caroselli** (`kit.carouselTemplate`, default Tech scuro): «Parti da zero» (`starterCarousel`) e
  la generazione dell'AI sul server (`defaultTemplate` nel servizio dei caroselli) lo usano per i caroselli nuovi.
- Provato nel browser con il server su un database di prova: copia di Bold con sfumatura, puntini, barra e titoli
  centrati salvata; predefinito dei caroselli usato da «Parti da zero»; foto di 4000×3000 ridotta a 200 KB; eliminazione
  con ritorno a Tech scuro; tema scuro.

### Fase 8 — Trend, concorrenti e strategia

Scelte (proposte e confermate il 27 novembre 2026): niente scraping (LinkedIn e TikTok non danno i post altrui: si
aggiungono a mano), si parte da ciò che funziona senza storico. Ogni fonte va verificata sulla documentazione ufficiale.

- [x] 8a. Radar dei trend: Hacker News, GitHub, dev.to e ricerca di YouTube sulle parole del brand, raggruppati e
      ordinati dall'AI, «Crea un'idea» (Reddit escluso)
- **Scelte** (confermate il 27 novembre 2026): fonti HN, GitHub, dev.to e YouTube (solo con un account collegato, al
  massimo 3 ricerche al giorno); una volta al giorno più «Aggiorna»; voce «Trend» sotto MISURA (rotta `/trend`).
- **Fonti verificate** (documentazione ufficiale, 27 novembre 2026; `modules/trends/sources.ts`), nessuno scraping:
  - **Hacker News**: Algolia `GET https://hn.algolia.com/api/v1/search` (rilevanza, poi punti) con `tags=story`,
    `numericFilters=created_at_i>…,points>5`, `hitsPerPage`; nessuna chiave, 10.000 richieste all'ora per IP. Senza
    `url` (Ask HN) si apre la discussione.
  - **GitHub**: `GET /search/repositories?q=<parola> created:>AAAA-MM-GG&sort=stars&order=desc`, header `Accept:
application/vnd.github+json`, `X-GitHub-Api-Version: 2026-03-10` e `User-Agent`; senza token 10 ricerche al minuto
    (le parole si cercano in sequenza).
  - **dev.to** (Forem API v1): `GET https://dev.to/api/articles?tag=<tag>&top=7`, `Accept:
application/vnd.forem.api-v1+json`, senza chiave; nessun limite documentato. I tag sono solo lettere e numeri
    minuscoli (`devtoTag`: «Node.js» → `nodejs`, «C#» non si cerca).
  - **YouTube**: `search.list` (`type=video`, `order=viewCount`, `publishedAfter`) costa 1 unità ma ha un limite a parte
    di 100 chiamate al giorno per progetto; poi `videos.list part=statistics` (1 unità) per visualizzazioni, like e
    commenti veri. Con il token dell'account collegato (scope `youtube`); al massimo 3 ricerche nelle ultime 24 ore
    (`youtubeBudget`, contate in `sources[].requests`). Non confermato dalla doc che OAuth valga per `search.list`
    (gli esempi usano una chiave): da provare con l'account vero.
  - **Reddit escluso**: dalla «Responsible Builder Policy» (novembre 2025) ogni nuovo token OAuth richiede
    l'approvazione di Reddit, quindi ogni utente dovrebbe chiederla; le pagine ufficiali non sono leggibili da qui.
- **Dati** (`packages/shared/src/schemas/trends.ts`, migrazione `0002_trends`): `trend_settings` (parole del radar per
  brand, al massimo 5, senza doppioni) e `trend_reports` (parole, stato delle fonti, contenuti dei trend e trend, JSON;
  si tengono gli ultimi 10 per brand). I segnali (`points`, `stars`, `reactions`, `views`, `likes`, `comments`) sono
  quelli delle fonti; quelli assenti mancano, mai zero.
- **Servizio** (`modules/trends/service.ts`): finestra di 7 giorni, 6 contenuti per fonte e parola, cache di un'ora per
  ricerca, fonti in parallelo e parole in sequenza; un errore di una fonte finisce in `sources[].error` e non ferma le
  altre. Al massimo 80 contenuti al modello (`selectItems`: a turno tra fonti e parole, senza doppioni). Una chiamata
  LLM (`generate-trends.{system,user}.md`) risponde con 1–8 trend con i **numeri dei contenuti** (`generatedTrendsSchema`:
  numeri esistenti, ogni contenuto in un solo trend, argomento preso dai tag del brand), valutazioni 1–5 di crescita,
  interesse e adattamento al brand (giudizi dell'AI, il prompt vieta di citare numeri) e un'idea. Un aggiornamento alla
  volta per brand; «Aggiorna» rifiutato (422) per 15 minuti dopo l'ultimo; il giro orario (`refreshDue`, con le
  metriche) aggiorna i brand con parole e radar più vecchio di 20 ore, senza ritentare un errore prima di 20 ore.
- API: `GET /brands/:brandId/trends` (parole, ultimo radar, `blocked`, `nextRefreshAt`), `PUT …/trends/keywords`,
  `POST …/trends` (aggiorna). Nei test di integrazione `withRollback` passa un fetch che rifiuta la rete.
- **Desktop** (`screens/Trend/`, `services/trends.ts`, `hooks/useTrends.ts`): parole del radar a etichette (con i tag
  del brand proposti), una scheda per trend con valutazioni a puntini, contenuti con fonte, link all'originale e
  segnali veri abbreviati («12,3k stelle»), idea e «Crea un'idea» (con il tag del trend); in fondo le fonti senza
  risultati («Collega un account YouTube»). Provato nel browser con il server su un database di prova, HN, GitHub e
  dev.to veri e un servizio AI finto: 12 contenuti in 4 trend, idea salvata col tag, tema scuro.
- [x] 8b. Concorrenti: YouTube automatico, Instagram, LinkedIn e TikTok a mano; frequenza, formati, orari, tasso di
      interazione, confronto con le proprie metriche e analisi dell'AI dei post migliori
- **Fonti verificate** (documentazione ufficiale, 27 novembre 2026):
  - **YouTube Data API v3**: `channels.list` (`part=snippet,statistics,contentDetails`, filtro `forHandle` con o senza
    «@» oppure `id`: uno solo per richiesta), `playlistItems.list` sulla playlist dei caricamenti
    (`contentDetails.relatedPlaylists.uploads`, al massimo 50 per pagina), `videos.list
part=snippet,statistics,contentDetails`. Costo 1 unità ciascuna: un aggiornamento = 3 unità su 10.000 al giorno.
    Si usa il token dell'account YouTube collegato (scope `youtube`), come la 8a: la doc non dice in modo esplicito
    che un token OAuth valga per i dati pubblici di altri canali (gli esempi usano `mine=true`): da provare con
    l'account vero. `hiddenSubscriberCount` → follower null; gli iscritti sono arrotondati da YouTube. Gli Short si
    stimano dalla durata (≤ 3 minuti, senza le misure del video).
  - **Instagram Business Discovery**: la pagina di riferimento dice «Available for the Instagram API with Facebook
    Login» (permessi `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`, Pagina Facebook
    collegata). Prisma usa l'«Instagram API with Instagram Login»: il login non si cambia, Instagram si inserisce a
    mano come LinkedIn e TikTok.
  - **LinkedIn e TikTok**: nessuna API per i post di altri profili con i permessi in uso; niente scraping.
- **Dati** (`packages/shared/src/schemas/competitors.ts`, migrazione `0003_competitors`): `competitors` (per brand, al
  massimo 10, piattaforma + handle unici; id del canale, playlist dei caricamenti, follower, ultima lettura ed errore),
  `competitor_posts` (titolo/testo, link, data, formato, durata, like, commenti, condivisioni, visualizzazioni,
  follower quando noti, `source` api|manuale; unici su concorrente + id del video) e `competitor_analyses` (l'ultima
  analisi per brand). I numeri che mancano restano null.
- **Servizio** (`modules/competitors/`): aggiungere un canale YouTube lo cerca subito (inesistente → 422, nulla si
  salva; senza account collegato si salva con l'avviso e si aggiungono post a mano), poi legge gli ultimi 50 video.
  «Aggiorna» al massimo ogni 15 minuti; il giro orario (con metriche e trend) rilegge i canali con l'ultima lettura
  più vecchia di 20 ore, senza ripetere un errore prima di 20 ore. Solo i post a mano si cancellano.
- **Statistiche** (`stats.ts`, pure e testate, uguali per concorrenti e per il brand): ultimi 90 giorni; settimane dal
  post più vecchio letto (50 video di un canale attivo coprono meno di 90 giorni); interazioni = like + commenti +
  condivisioni noti; tasso = interazioni / visualizzazioni se ogni post le ha, altrimenti / follower (del post o del
  profilo), altrimenti nessun tasso: le basi non si mescolano e l'interfaccia dice quale. Mediane per formato, fasce
  giorno+ora italiane con almeno 2 post, 5 post migliori. «Tu»: i propri post pubblicati con l'ultima lettura
  (visualizzazioni o, se mancano, impressioni) e i follower dell'ultimo giorno.
- **Analisi dell'AI** (`analysis.ts`, `generate-competitors.{system,user}.md`): fino a 8 post migliori per concorrente,
  a turno, al massimo 40, numerati con testo e numeri; risposta `competitorAnalysisSchema` (riepilogo, aperture e
  argomenti con i numeri dei post, struttura, lunghezza, cosa ripetere e cosa evitare), numeri di post esistenti; il
  prompt vieta numeri nei testi. Servono almeno 3 post con numeri.
- **Desktop** (`screens/Concorrenti/`, `services/competitors.ts`, `hooks/useCompetitors.ts`, voce «Concorrenti» sotto
  MISURA): aggiunta, tabella di confronto per piattaforma con «Tu», «Cosa funziona» con i link ai post citati, una
  scheda per concorrente (frequenza, tasso, follower, formati, fasce, post migliori con link e numeri, post inseriti a
  mano) e il modulo «Aggiungi un post» (data e ora italiane, numeri vuoti = non noti). Provato nel browser con il
  server su un database di prova: concorrente LinkedIn con post a mano dal modulo, canale YouTube senza account
  (avviso), tema scuro. Analisi dell'AI e lettura di YouTube provate con API finte nei test di integrazione.
- [x] 8c. «Ispirati»: dal post di un concorrente una bozza con la propria voce (meccanismo, non copia)
- **Server** (`modules/ai/inspire.ts`, `inspire.{system,user}.md`, schemi in `packages/shared/src/schemas/inspiration.ts`):
  `POST /brands/:brandId/inspire` con `source` (`concorrente` + `postId` di un post salvato nella 8b, solo del brand;
  oppure `testo` con testo, titolo, link, piattaforma ed etichetta: testi incollati e contenuti del radar) e
  l'argomento (`tagId`, `topic` scritto, o nessuno: l'AI sceglie tra i tag del brand). Una chiamata LLM in due parti:
  `mechanism` (tipo di apertura, 2–6 parti della struttura, perché ha funzionato) e `idea` (argomento, testo, apertura
  con parole nuove); la voce del brand entra nel prompt. Lo schema (`inspirationSchema`) rimanda al modello le
  proposte con **6 parole di fila uguali all'originale** (`copiedPhrase`, senza maiuscole, accenti e punteggiatura),
  con **numeri che non vengono dai dati** (`inventedNumbers`: ammessi quelli dell'originale, dei numeri salvati e
  quelli fino a 10) e con un argomento fuori da quelli ammessi. I numeri del post (`signals`: visualizzazioni, like,
  commenti, condivisioni, tasso sulla base del profilo e mediana del profilo, da `postWithStats` dei concorrenti)
  arrivano dai dati salvati. Il server non salva nulla.
- **Provenienza**: `ideas.inspiration` (JSON, migrazione `0004_idea_inspiration`; `IdeaInspirationSchema`: tipo, id del
  post, etichetta, piattaforma, titolo, link) si passa a `POST /brands/:id/ideas`. L'idea si salva come `suggerita`
  con il tag dell'argomento e il testo `inspirationIdeaText` (idea, «Apertura:», «Struttura da seguire:»), così le
  bozze di `POST /contents/generate` seguono la forma; restano in bozza come tutte.
- **Desktop** (`components/InspirePanel/`, `services/inspire.ts`, `hooks/useInspire.ts`): «Ispirati» sui post migliori e
  su quelli inseriti a mano dei concorrenti, su ogni contenuto dei trend e «Ispirati a un post» in Concorrenti (testo
  e link facoltativo: Prisma non legge le pagine). Il pannello mostra il post d'origine, l'argomento (l'AI tra i tag,
  un tag, o scritto), «Analizza il post» / «Rigenera», il meccanismo con i numeri salvati, il testo dell'idea
  modificabile e le piattaforme (quella d'origine o LinkedIn); «Crea l'idea» o «Crea le bozze», che apre lo Studio.
  Nelle Idee «ispirata da <profilo>» con il link all'originale.
- Provato nel browser con il server su un database di prova e un'AI finta compatibile OpenAI: post LinkedIn di un
  concorrente → meccanismo con 328 like e tasso 4,7% contro la mediana 3,4% → bozza LinkedIn nello Studio; testo
  incollato con argomento scritto → idea salvata; temi chiaro e scuro. Da provare con l'AI vera che le regole sulla
  copia e sui numeri non facciano ritentare troppo spesso.
- [ ] 8d. Analisi più profonda dei propri post: tasso di interazione, per argomento, formato, apertura, lunghezza
- [ ] 8e. Piano editoriale mensile dell'AI (pilastri, frequenza, formati, orari, idee nel calendario) e revisione

### Fase 2 — Template e caroselli, brand kit, storage R2, Instagram

- [x] 2a. Brand kit e voce: schermata Template e brand kit, API, voce nei prompt
- [x] 2b. Modello del carosello (slide in `metadata.carousel`) e template HTML in `packages/templates`
- [x] 2c. Editor carosello: miniature, anteprima, campi, generazione e chat sulle slide
- [x] 2d. Export PNG/PDF con Electron offscreen, asset collegati alla variant
- [x] 2e. Storage R2 (upload firmato) e caroselli PDF su LinkedIn (da provare con un bucket R2 vero e l'app LinkedIn)
- [x] 2f. Adapter Instagram (verifica docs, OAuth, immagine e carosello, rinnovo del token; export in JPEG)

Fase 2 completata. Da provare con le credenziali reali: bucket R2 (chiavi e indirizzo pubblico), app Instagram
(account professionale, OAuth e primo post), caroselli PDF su LinkedIn.

### Decisioni prese per default (confermate il 25 novembre 2026)

- Nome app: **Prisma**.
- Dashboard inclusa nella fase 1 con i dati reali disponibili.
- LinkedIn: solo profilo personale.
- Slot consigliati nel calendario: configurazione fissa per piattaforma fino alla fase 4.
- Brand kit: 5 colori a ruolo fisso. Font fissi e niente template personalizzati fino alla fase 7, che li
  supera (vedi sotto). L'export delle immagini è JPEG, non PNG come nel mockup: Instagram accetta
  solo JPEG e le foto di TikTok non accettano PNG. Il carosello vivrà dentro la variant; «Post singolo» userà lo stesso
  motore con una slide; citazione, miniatura YouTube e copertina Reel restano anteprime fino alla fase 3.
