# Configuratore Layout Display

Piattaforma web, in stile foglio Excel, per disegnare il layout di un display e ottenere le
**coordinate dell'angolo in alto a sinistra** di ogni blocco, pronte da copiare nelle
visualizzazioni **CODESYS** (proprietà *Posizione → X, Y*, *Larghezza*, *Altezza*).

Funziona interamente nel browser: nessuna installazione, nessun server, nessun dato inviato in rete.

**Sito:** <https://giova-giovanni.github.io/configDisplaySizeFormat/> (attivo dopo aver abilitato GitHub Pages, vedi sotto).

## Cosa fa

1. **Display**: dimensioni in pixel (predefinito 800 × 480) o un formato comune (480 × 272, 1024 × 600, 1280 × 800, …).
2. **Struttura della pagina**: la pagina è un albero di
   - **gruppi**: griglie di elementi uguali (es. 6 righe di LED + Scritta);
   - **frame**: contenitori in cui mettere altri gruppi e frame (“gruppi di gruppi”).
     Un frame può **riempire la sua area** (es. un pannello di base) oppure avere **dimensione fissa**
     e ripetersi in griglia (es. 4 schede motore uguali).
3. **Area nel contenitore**: offset dai bordi del display o del frame che contiene l'oggetto
   (es. 30 px in alto per l'intestazione, 50 px in basso per i pulsanti).
4. **Blocchi di ogni elemento**: es. *LED* 50 × 50 + *Scritta* 300 × 50. Per ogni blocco: larghezza, altezza,
   **distanza** (spazio prima del blocco: dal blocco precedente, per il primo dal bordo dell'area),
   allineamento e **colore**. I blocchi possono essere affiancati (→) o impilati (↓).
5. **Disposizione**: numero di elementi, colonne, distanza tra righe e tra colonne, numerazione per
   righe o per colonne, allineamento nell'area (sinistra, centro, destra, distribuisci).

Il risultato si aggiorna mentre scrivi:

- **anteprima** del display in scala, con frame, aree di lavoro, griglia e coordinate di ogni blocco
  (passando il mouse su un oggetto vedi X, Y e dimensioni; con un clic lo selezioni); opzione
  **Colori pieni** per vedere il pannello con i colori reali;
- **tabella delle coordinate** come un foglio Excel: un clic su una cella copia il valore, trascinando
  copi un intervallo da incollare in Excel, Ctrl+C / Ctrl+A come in Excel;
- **avvisi** per gli oggetti che escono dalla loro area o dal display e per quelli che si sovrappongono.

### Coordinate nel frame o sul display

Quando ci sono frame, la tabella mostra le coordinate:

- **nel frame**: rispetto all'angolo in alto a sinistra del frame che contiene l'oggetto, come dentro la
  visualizzazione referenziata da un *Frame* CODESYS. Il contenuto dei frame ripetuti è identico in ogni copia
  e compare una volta sola; i frame stessi compaiono con la loro posizione nel contenitore;
- **sul display**: coordinate assolute, per ogni copia.

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

### Colori

Nelle celle colore si scrive un codice **esadecimale** (`CC0605`, `#cc0605`) oppure **RAL** (`RAL 3020`,
`ral3020`, `3020`). Con un clic sul quadratino si apre la tabella dei **213 colori RAL Classic**, con i più usati
su quadri e pannelli e la ricerca per codice o nome (es. “3020”, “rosso traffico”). I valori esadecimali dei
RAL sono le approssimazioni sRGB più diffuse (es. RAL 3020 = CC0605): indicativi, perché un RAL è un campione fisico.

### Altre funzioni

- **Celle con formule**: nelle celle numeriche puoi scrivere `=800-30-50` o `(800-45)/2`.
- **Tastiera come in Excel**: Invio e frecce ↑ ↓ per spostarsi, Esc per annullare la modifica.
- **Incolla da Excel** righe di blocchi (Nome, Larghezza, Altezza, Distanza, Allineamento, Colore).
- **Esporta**: tabella per Excel (TSV), CSV, **codice Structured Text per CODESYS** (una struttura DUT
  e una lista di variabili globali GVL con tutte le coordinate), testo, JSON ad albero; immagine PNG o SVG
  dell'anteprima in scala 1:1.
- **Aspetto**: tema chiaro/scuro/automatico e menu **Colore** per il colore dell'interfaccia
  (blu industriale predefinito, altri colori o un codice esadecimale/RAL).
- **Annulla / Ripristina** (Ctrl+Z / Ctrl+Y), stampa.

## Salvataggio: come funziona

| Dove | Come | Quando usarlo |
|---|---|---|
| **Browser di questo PC** (automatico) | ogni modifica viene memorizzata subito nella memoria del browser (*localStorage*) | riaprendo la pagina con lo stesso browser ritrovi il lavoro, anche dopo aver spento il PC |
| **Browser di questo PC** (con nome) | **Salva** / **Apri** (Ctrl+S) | per tenere più layout (es. “Pagina allarmi”, “Pagina motori”) |
| **File .json** | **Salva file** / **Apri file** | backup sicuro, altro PC, cartella del progetto CODESYS |
| **Link** | **Link** copia un indirizzo che contiene tutto il layout | per condividere una configurazione |

La memoria del browser è un piccolo spazio che ogni browser riserva a ciascun sito, **sul tuo computer**:
i dati non vanno su GitHub né su altri server e non sono visibili da altri PC o da altri browser.
Si perdono se cancelli i dati di navigazione o usi una finestra in incognito: per i layout importanti
usa anche **Salva file**. Nel link il layout sta dopo il simbolo `#`, una parte dell'indirizzo che il browser
non invia al server.

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
| `index.html`, `css/style.css` | pagina e stile (colore principale in `--acc`) |
| `js/layout.js` | motore di calcolo: frame, gruppi, coordinate relative e assolute (senza DOM, testabile) |
| `js/ral.js` | tabella RAL Classic e lettura dei codici colore |
| `js/exporters.js` | tabelle ed esportazioni (TSV, CSV, ST CODESYS, testo, JSON) |
| `js/expr.js` | formule nelle celle (senza `eval`) |
| `js/sheet.js`, `js/editor.js`, `js/colorpicker.js`, `js/preview.js`, `js/app.js` | interfaccia |
| `tests/` | test automatici (`node --test`) |

I layout salvati con la versione precedente (elenco di gruppi senza frame) vengono convertiti automaticamente.

Test (Node.js 18 o successivo):

```bash
npm test
```
