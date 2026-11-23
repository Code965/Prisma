# Blog API di Prisma

Prisma pubblica gli articoli sul tuo blog personale tramite un'API minima che il tuo sito espone.
Bastano due rotte: qualsiasi backend (Express, Laravel, Django, una funzione serverless…) può
implementarle in pochi minuti.

Nelle **Impostazioni › Account › Blog** di Prisma inserisci:

- **Indirizzo base** dell'API, ad esempio `https://api.miosito.it/prisma` (https obbligatorio,
  `http` solo per `localhost`). Le rotte sotto sono relative a questo indirizzo.
- **Chiave API**: una stringa casuale di almeno 32 caratteri, uguale a quella configurata sul sito
  (es. `openssl rand -hex 32`). Prisma la conserva cifrata.

Ogni richiesta porta l'header `Authorization: Bearer <chiave API>`.

## `GET {base}/health`

Usata da Prisma per verificare indirizzo e chiave prima di salvarli.

| Risposta                                       | Significato                         |
| ---------------------------------------------- | ----------------------------------- |
| `200` (qualsiasi corpo, es. `{"status":"ok"}`) | Collegamento valido                 |
| `401` / `403`                                  | Chiave rifiutata                    |
| `503 {"error":"not_configured"}`               | Il sito non ha una chiave impostata |

## `POST {base}/articles`

Corpo JSON:

```json
{
  "title": "Perché uso ancora VB.NET",
  "html": "<p>Testo dell'articolo…</p>",
  "idempotencyKey": "9f2c…",
  "description": "Estratto per la meta description (facoltativo)",
  "tags": ["dotnet", "carriera"]
}
```

- `title`: al massimo 255 caratteri.
- `html`: già ripulito da Prisma. Contiene solo tag di testo (`p`, `h2`–`h4`, `ul`/`ol`/`li`,
  `blockquote`, `strong`, `em`, `code`, `pre`, `a` con `rel="noopener noreferrer"`), mai script,
  stili, iframe o immagini. È comunque buona norma ripulirlo anche sul sito.
- `idempotencyKey`: identifica la pubblicazione. **Il sito deve salvarla con un vincolo di unicità**:
  se arriva una seconda volta (Prisma ritenta dopo un timeout o un errore 5xx), non crea un nuovo
  articolo ma restituisce quello esistente con `duplicate: true`.
- `description` e `tags`: facoltativi, il sito può ignorarli.

Risposte:

| Risposta                                        | Cosa fa Prisma                                       |
| ----------------------------------------------- | ---------------------------------------------------- |
| `201 {"id": 42, "url": "https://…/blog/42"}`    | Pubblicato: salva id e link                          |
| `200 {"id": 42, "url": "…", "duplicate": true}` | Già pubblicato: registra quello esistente            |
| `401` / `403`                                   | Errore definitivo: chiede di aggiornare la chiave    |
| `400` / `404` / `422` `{"message": "…"}`        | Errore definitivo, il messaggio compare nella coda   |
| `429` / `5xx` / rete                            | Ritenta più tardi (sicuro grazie a `idempotencyKey`) |

`id` è un numero, `url` l'indirizzo pubblico dell'articolo.

## Esempio minimo (Express)

```js
import express from 'express';

const router = express.Router();
const KEY = process.env.PRISMA_BLOG_API_KEY;

router.use((req, res, next) => {
  if (!KEY) return res.status(503).json({ error: 'not_configured' });
  if (req.get('authorization') !== `Bearer ${KEY}`) return res.status(401).end();
  next();
});

router.get('/health', (req, res) => res.json({ status: 'ok' }));

router.post('/articles', express.json({ limit: '2mb' }), async (req, res) => {
  const { title, html, idempotencyKey } = req.body ?? {};
  if (!title || !html || !idempotencyKey)
    return res.status(400).json({ message: 'Campi mancanti' });
  const existing = await db.findPostByKey(idempotencyKey);
  if (existing) return res.json({ id: existing.id, url: existing.url, duplicate: true });
  const post = await db.createPost({ title, html, idempotencyKey });
  res.status(201).json({ id: post.id, url: `https://miosito.it/blog/${post.id}` });
});

app.use('/prisma', router);
```

Per confrontare la chiave in tempo costante usa `crypto.timingSafeEqual`.
