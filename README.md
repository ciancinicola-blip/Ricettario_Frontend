# Cianci's Menù 🍲

Ricettario familiare digitale con **118 ricette 100% senza latticini**, pianificazione dei pasti settimanali, categoria Contorni, timer di cottura e lista della spesa automatica.

---

## 🌟 Funzionalità Principali

- **Pianificazione Settimanale Completa (Pranzo, Cena e Contorno):** ciclo rolling di 4 settimane con pasti bilanciati, calorie e proteine visibili a colpo d'occhio.
- **🔒 Blocco Ricetta ("Blocca Piatto"):** possibilità di fissare (tramite icona lucchetto 🔒) i piatti desiderati per un determinato giorno, proteggendoli dal rimescolamento casuale o da scambi accidentali.
- **🥗 Categoria "Contorni":** 18 ricette tradizionali e sfiziose (senza latticini) integrate sia nel menù giornaliero che nel ricettario e nella spesa settimanale.
- **⏱️ Timer di Cottura & Modalità Cucina:**
  - Countdown digitale interattivo con controlli avvio/pausa, reset e pulsanti rapidi (+1 min, +5 min, +10 min).
  - Rilevamento automatico del tempo di cottura descritto nel passo corrente (es. *"Imposta 20 min del passo"*).
  - Allarme acustico sintetizzato (Web Audio API senza dipendenze) e notifica visiva quando il tempo scade.
  - Barra di avanzamento visiva percentuale e pulsanti per saltare rapidamente da un passo all'altro.
  - Cassetto rapido per consultare le dosi degli ingredienti senza uscire dal passo di preparazione.
  - Wake Lock API per mantenere attivo lo schermo dello smartphone mentre si cucina.
- **🔍 Ricerca Avanzata nel Ricettario:** ricerca istantanea estesa non solo al titolo, ma anche a ingredienti, modalità di cottura ("forno", "padella", "vapore"), note nutrizionali e fonti.
- **🎨 Palette Solare & Vivace:** interfaccia luminosa a colori vivaci culinari (Verde Smeraldo fresco, Arancio Mandarino, Rosso Fragola e Slate nitido ad alto contrasto).
- **🔄 Strategia Mista sui Link Fonte:** zero errori 404 e zero pagine "Ops" grazie all'abbinamento di link diretti verificati e fallback di ricerca ufficiale della fonte.
- **Porzioni dinamiche:** scalatura automatica degli ingredienti (selettori rapidi 2, 3, 4, 5, 6 o input personalizzato da 1 a 20 persone).
- **Lista della Spesa intelligente:**
  - Raggruppamento e somma automatica delle quantità degli ingredienti per la settimana selezionata (inclusi i contorni).
  - Riconoscimento della dispensa di casa (gli articoli presenti vengono contrassegnati).
  - Spunta degli ingredienti acquistati.
  - Condivisione rapida su **WhatsApp** o copia negli appunti.
- **Esperienza Mobile Ottimizzata:** visualizzazione dei giorni della settimana con snap orizzontale fluido e barra di navigazione fissa in basso.
- **PWA (Progressive Web App):** installabile su iOS e Android come applicazione autonoma con supporto offline tramite Service Worker.
- **Login Familiare Protetto:** credenziali verificate con hashing crittografico SHA-256 client-side.

---

## 🛠️ Stack Tecnologico

- **Frontend:** HTML5, Tailwind CSS, Vanilla JavaScript (ES6+)
- **Audio & Dispositivi:** Web Audio API (chime per timer), Screen Wake Lock API
- **Stile:** Font Awesome 6, Google Fonts (*Quicksand*), CSS Variables per theming vivace
- **Offline / PWA:** Service Worker (`sw.js`), Web App Manifest (`manifest.json`), fallback `recipes-data.js`
- **Dati:** `recipes.json` (118 ricette complete con ingredienti normalizzati, passaggi, valori nutrizionali e fonti verificate)
