# Prisma — logo dell'app

Un'idea entra al centro, come la luce in un prisma, ed esce divisa in quattro facce: una per piattaforma.

| File                                                     | Uso                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------- |
| `svg/prisma-icona-app.svg`                               | Icona dell'app (quadrato con angoli arrotondati, sfondo scuro)              |
| `svg/prisma-simbolo.svg`                                 | Simbolo a colori, sfondo trasparente: sidebar, splash, intestazioni         |
| `svg/prisma-simbolo-mono-scuro.svg` / `-mono-chiaro.svg` | Versioni a un colore, per sfondi chiari o scuri                             |
| `svg/prisma-logo-orizzontale-chiaro.svg` / `-scuro.svg`  | Simbolo + scritta «Prisma» (richiede il font Inter Bold installato)         |
| `png/prisma-icona-app-*.png`                             | Icona in 1024, 512, 256, 128, 64, 48, 32, 16 px                             |
| `png/prisma-simbolo-512.png`                             | Simbolo trasparente in PNG                                                  |
| `prisma.ico`                                             | Icona Windows multi-dimensione (16–256 px) per l'eseguibile .NET / Avalonia |

Colori: LinkedIn #3D7FF2 · Instagram #E2447F · TikTok #17AFA6 · YouTube #F26B3A · Inchiostro #101318.
Scritta: Inter Bold, spaziatura -0,04 em.

In Avalonia: `<Window Icon="/Assets/prisma.ico">` e, nel .csproj, `<ApplicationIcon>Assets\prisma.ico</ApplicationIcon>`.
