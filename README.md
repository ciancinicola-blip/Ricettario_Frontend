# Cianci's Menù 🍲

Ricettario familiare digitale con **100 ricette 100% senza latticini**, pianificazione dei pasti settimanali e lista della spesa automatica.

---

## 🌟 Funzionalità

- **Pianificazione settimanale (ciclo rolling di 4 settimane):** pranzo e cena bilanciati con calorie e proteine visibili a colpo d'occhio.
- **Rimescola & Personalizza:** possibilità di rimescolare la settimana o scambiare singole ricette (`Primi` e `Secondi`).
- **Modalità Cucina con Wake Lock:** mantiene lo schermo attivo dello smartphone durante la preparazione, guidando passo-passo a caratteri grandi.
- **Porzioni dinamiche:** scalatura automatica degli ingredienti (selettori rapidi 2, 3, 4, 5, 6 o input personalizzato da 1 a 20 persone).
- **Lista della Spesa intelligente:**
  - Raggruppamento e somma automatica delle quantità degli ingredienti per la settimana selezionata.
  - Riconoscimento della dispensa di casa (gli articoli presenti vengono contrassegnati).
  - Spunta degli ingredienti acquistati.
  - Condivisione rapida su **WhatsApp** o copia negli appunti.
- **Tema Scuro Nativo:** supporto automatico a `prefers-color-scheme: dark` tramite palette con variabili CSS (verde salvia e toni caldi).
- **Esperienza Mobile Ottimizzata:** visualizzazione dei giorni della settimana con snap orizzontale fluido e barra di navigazione fissa in basso.
- **PWA (Progressive Web App):** installabile su iOS e Android come applicazione autonoma con supporto offline tramite Service Worker.
- **Login Familiare Protetto:** credenziali verificate con hashing crittografico SHA-256 client-side.

---

## 🛠️ Stack Tecnologico

- **Frontend:** HTML5, Tailwind CSS, Vanilla JavaScript (ES6+)
- **Stile:** Font Awesome 6, Google Fonts (*Quicksand*), CSS Variables per theming chiaro/scuro
- **Offline / PWA:** Service Worker (`sw.js`), Web App Manifest (`manifest.json`)
- **Dati:** `recipes.json` (100 ricette con ingredienti, passaggi, valori nutrizionali e fonti verificate)
