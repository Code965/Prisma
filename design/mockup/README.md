# Pipeline V3 — mockup app desktop per creator tech

Mockup interattivo dell'app per gestire contenuti su LinkedIn, Instagram, TikTok e YouTube.
Flusso: idea grezza → bozze per piattaforma generate dall'LLM → revisione → pianificazione → pubblicazione automatica.
**Nulla viene pubblicato senza approvazione esplicita**: in coda entrano solo i post approvati.

Canvas originale (sempre aggiornato): https://claude.ai/artifact/MEgDaRoNBAZnMgEpuzXDFr — pagina «Versione 3 · Brief».

## Contenuto dello zip

```
README.md            questo file
brief.md             il brief di partenza
design/tokens.css    colori e token dei temi chiaro e scuro
schermate/           sorgenti delle 10 schermate + 2 componenti condivisi
```

I file `.dc.html` sono il formato del canvas Design di Claude: si vedono e si modificano dentro il canvas,
non aprendoli da soli nel browser. Servono come riferimento preciso di layout, testi, dati di esempio e
comportamenti (la logica è nel blocco `<script type="text/x-dc">` in fondo a ogni file).

## Schermate

| # | File | Priorità | Cosa fa nel mockup |
|---|------|----------|--------------------|
| 1 | `V3Dashboard` | essenziale | Settimana in corso, prossime uscite con conto alla rovescia, account, metriche 7 giorni, idee in coda |
| 2 | `V3Idee` | essenziale | Inserimento testuale e vocale (Whisper locale), tag, filtro per argomento, scelta piattaforme per idea, «Genera contenuti» |
| 3 | `V3Studio` | **chiave** | Tab per piattaforma con anteprima nel feed e campi specifici; chat laterale con modifiche mostrate come diff |
| 4 | `V3Carosello` | **chiave** | Miniature slide, anteprima 1080×1350 che si aggiorna mentre scrivi, 3 template, chat con titoli alternativi, export PNG / PDF |
| 5 | `V3Template` | essenziale | Galleria (carosello, post, citazione, codice, miniatura YT, copertina Reel/TikTok), brand kit, voce |
| 6 | `V3Video` | **chiave** | Player con ritaglio 9:16 / 1:1 / 16:9, trascrizione cliccabile che taglia il video, timeline a 4 tracce, stili sottotitoli, «Rimuovi silenzi», «Genera Short», FilmCraft con stato di sincronizzazione |
| 7 | `V3Calendario` | **chiave** | Settimana e mese, drag & drop dei post, slot consigliati, 6 stati, filtro piattaforme, pianificazione multipiattaforma con orari diversi |
| 8 | `V3Coda` | essenziale | Conto alla rovescia live, controlli requisiti con avvisi, Pubblica ora / Sposta / Annulla, log con Riprova |
| 9 | `V3Analytics` | essenziale | Metriche per piattaforma nel tempo (piccoli multipli), contenuti migliori, suggerimenti AI |
| 10 | `V3Impostazioni` | essenziale | Selettore brand (multi-brand), account, DeepSeek + chiave API, Whisper, percorso FilmCraft |

Componenti condivisi:

- `V3Sidebar` — menu laterale comprimibile (224 px ↔ 64 px, solo icone). Lo stato resta salvato tra le schermate. Contiene anche il cambio tema e il promemoria sull'approvazione.
- `V3Icon` — icona piattaforma con colore di accento (`li`, `ig`, `tt`, `yt`).

## Sistema visivo

- **Font**: Inter (interfaccia), JetBrains Mono (orari, codice, etichette tecniche).
- **Temi**: classi `.th-light` / `.th-dark` sul contenitore radice, tutti i colori passano da variabili CSS (`design/tokens.css`).
- **Colori piattaforma**: `--li`, `--ig`, `--tt`, `--yt` (+ versione `Soft` per gli sfondi).
- **Stati del post** (sempre colore + etichetta, mai solo colore):

| Stato | Token |
|-------|-------|
| Bozza | `--s-draft` |
| Da approvare | `--s-review` |
| Approvato | `--s-ok` |
| Programmato | `--s-sched` |
| Pubblicato | `--s-pub` |
| Errore | `--s-err` |

## Note per lo sviluppo

- **Icone piattaforma**: nel mockup sono icone generiche. Nell'app vanno usati i loghi ufficiali dai brand kit di ogni piattaforma, rispettandone le linee guida.
- **DeepSeek**: API compatibile OpenAI (`https://api.deepseek.com`), quindi in .NET basta un client OpenAI con base URL diversa. Verifica i nomi dei modelli al momento dello sviluppo.
- **TikTok**: finché l'app non supera la verifica di TikTok, i post pubblicati via API restano privati. Il mockup prevede l'invio alle bozze come ripiego.
- **Instagram**: la pubblicazione via API richiede un account Creator o Business e ha un limite di post nelle 24 ore. Alcuni elementi interattivi delle storie (es. sondaggi) non sono pubblicabili via API: la coda lo segnala come avviso.
- **YouTube**: caricamento come privato e passaggio a pubblico all'ora programmata.
- **Dati**: tutti i numeri, gli handle (`[@tuohandle]`) e il secondo brand sono di esempio.
