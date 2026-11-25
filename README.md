# Configuratore Layout Display

Piattaforma web, in stile foglio Excel, per disegnare il layout di un display e ottenere le
**coordinate dell'angolo in alto a sinistra** di ogni blocco, pronte da copiare nelle
visualizzazioni **CODESYS** (proprietà *Posizione → X, Y*, *Larghezza*, *Altezza*).

Funziona interamente nel browser: nessuna installazione, nessun server, nessun dato inviato in rete.

**Sito:** <https://giova-giovanni.github.io/configDisplaySizeFormat/> (attivo dopo aver abilitato GitHub Pages, vedi sotto).

## Cosa fa

1. **Display**: dimensioni in pixel (predefinito 800 × 480) o un formato comune (480 × 272, 1024 × 600, 1280 × 800, …).
2. **Area di lavoro**: offset dai bordi (es. 30 px in alto per l'intestazione, 50 px in basso per i pulsanti).
3. **Blocchi di ogni elemento**: l'elemento che si ripete, es. *LED* 50 × 50 + *Scritta* 300 × 50.
   Per ogni blocco: larghezza, altezza, **distanza** (spazio prima del blocco: dal blocco precedente,
   per il primo dal bordo dell'area) e allineamento se le altezze sono diverse.
   I blocchi possono essere affiancati (→) o impilati (↓).
4. **Disposizione**: numero di elementi, colonne, distanza tra righe e tra colonne, numerazione per
   righe o per colonne, allineamento nell'area (sinistra, centro, destra, distribuisci).

Il risultato si aggiorna mentre scrivi:

- **anteprima** del display in scala, con area di lavoro, griglia e coordinate di ogni blocco
  (passando il mouse su un blocco vedi X, Y e dimensioni; con un clic lo selezioni in tabella);
- **tabella delle coordinate** come un foglio Excel: un clic su una cella copia il valore, trascinando
  copi un intervallo da incollare in Excel, Ctrl+C / Ctrl+A come in Excel;
- **avvisi** per i blocchi che escono dall'area di lavoro o dal display e per i gruppi che si sovrappongono.

### Esempio (valori iniziali)

Display 800 × 480, offset 30 in alto e 50 in basso → area di lavoro 800 × 400 a partire da Y = 30.
LED 50 × 50 e Scritta 300 × 50, distanza 15 px ciascuno, 20 px tra le righe:

| Elemento | LED X | LED Y | Scritta X | Scritta Y |
|---:|---:|---:|---:|---:|
| 1 | 15 | 30 | 80 | 30 |
| 2 | 15 | 100 | 80 | 100 |
| … | … | … | … | … |
| 6 | 15 | 380 | 80 | 380 |

Le 6 righe occupano 6 × 50 + 5 × 20 = 400 px: esattamente l'area disponibile.

### Altre funzioni

- **Celle con formule**: nelle celle numeriche puoi scrivere `=800-30-50` o `(800-45)/2`.
- **Tastiera come in Excel**: Invio e frecce ↑ ↓ per spostarsi, Esc per annullare la modifica.
- **Incolla da Excel** righe di blocchi (Nome, Larghezza, Altezza, Distanza, Allineamento).
- **Più gruppi** (schede in alto): ad esempio la lista di segnalazioni e una fila di pulsanti in basso,
  ognuno con la propria area e disposizione.
- **Esporta**: tabella per Excel (TSV), CSV, **codice Structured Text per CODESYS** (una struttura DUT
  e una lista di variabili globali GVL con tutte le coordinate), testo, JSON; immagine PNG o SVG
  dell'anteprima in scala 1:1.
- **Salvataggi**: automatico nel browser, layout con nome (Salva / Apri, Ctrl+S), file `.json` da
  esportare e importare, link di condivisione che contiene tutto il layout.
- **Annulla / Ripristina** (Ctrl+Z / Ctrl+Y), tema chiaro/scuro, stampa.

## Pubblicare il sito con GitHub Pages

1. Su GitHub apri il repository → **Settings** → **Pages**.
2. In *Build and deployment* scegli **Source: Deploy from a branch**.
3. Seleziona il branch con il codice (es. `main`) e la cartella **/ (root)**, poi **Save**.
4. Dopo circa un minuto il sito è disponibile all'indirizzo indicato nella stessa pagina.

Il file `.nojekyll` fa pubblicare i file così come sono, senza elaborazioni.

## Uso senza internet

Scarica il repository (pulsante *Code → Download ZIP*), estrai e apri `index.html` con il browser:
funziona anche offline.

## Sicurezza e privacy

- Il sito è statico: non usa server, account, cookie di tracciamento o librerie esterne.
  I layout restano nel browser (localStorage) o nei file che esporti tu.
- Il repository è **pubblico**: non inserire mai password, token, chiavi API o dati di accesso.
  - `.gitignore` esclude file tipici con segreti (`.env`, chiavi `*.pem`/`*.key`, credenziali,
    impostazioni locali di Claude Code ed editor).
  - `scripts/check-secrets.sh` cerca token e chiavi (GitHub, Anthropic/Claude, OpenAI, AWS, Google,
    chiavi private…) e blocca il commit se ne trova. Per attivarlo sul tuo PC, una volta per clone:

    ```bash
    git config core.hooksPath .githooks
    ```

  - La GitHub Action *Controlli* ripete il controllo e i test a ogni push.
- Per non pubblicare la tua email nei commit, imposta su GitHub *Settings → Emails →
  Keep my email addresses private* e usa nel tuo PC l'indirizzo `…@users.noreply.github.com`
  indicato in quella pagina:

  ```bash
  git config user.email "ID+UTENTE@users.noreply.github.com"
  ```

## Sviluppo

Nessuna dipendenza da installare. Struttura:

| Percorso | Contenuto |
|---|---|
| `index.html`, `css/style.css` | pagina e stile |
| `js/layout.js` | motore di calcolo del layout (senza DOM, testabile) |
| `js/exporters.js` | tabelle ed esportazioni (TSV, CSV, ST CODESYS, testo, JSON) |
| `js/expr.js` | formule nelle celle (senza `eval`) |
| `js/sheet.js`, `js/editor.js`, `js/preview.js`, `js/app.js` | interfaccia |
| `tests/` | test automatici (`node --test`) |

Test (Node.js 18 o successivo):

```bash
npm test
```
