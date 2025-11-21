require('dotenv').config(); // Ładowanie haseł z .env

const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const http = require('http');
const express = require('express');
const mongoose = require('mongoose'); 
const bodyParser = require('body-parser');

const app = express();
var urlencodedParser = bodyParser.urlencoded({ extended: false });

// ZMIENNA GLOBALNA STATUSU
let czyPobieranieAktywne = false; 
let intervalId = null; // Uchwyt do pętli czasowej

app.set('view engine', 'ejs');

// --- POŁĄCZENIE Z BAZĄ DANYCH ---
mongoose.connect('mongodb://127.0.0.1:27017/csapp_db')
    .then(() => console.log('Połączono z MongoDB!'))
    .catch(err => console.error('Błąd połączenia z bazą:', err));

// --- MODELE DANYCH ---

const zasadaSchema = new mongoose.Schema({
    nazwa: { type: String, default: "Nowa Zasada" }, // Tytuł
    tag: { type: String, default: "Ogólne" },       // Kategoria
    opis: String,                                   // Główna treść (dawniej tresc)
    data: String
});
const Zasada = mongoose.model('Zasada', zasadaSchema);

const mailSchema = new mongoose.Schema({
    temat: String,
    tresc: String,
    dataOdebrania: String,
    adresat: String,
    nadawca: String,
    komentarz: String,
    // NOWE POLA:
    status: { 
        type: String, 
        default: 'oczekuje' 
    },
    prompt: { type: String, default: '' },
    ai_response: { type: String, default: '' }
});
const Mail = mongoose.model('Mail', mailSchema);


// --- ROUTING OGÓLNY ---

var msg = "PROJEKT LABO NEXT STEP";

app.get('/', function(req, res) {
    res.render('index', { message: msg });
});

app.get('/zaczytywanie', (req, res) => res.render('zaczytywanie'));
app.get('/planowanie', (req, res) => res.render('planowanie'));
app.get('/ripowanie', (req, res) => res.render('ripowanie'));
app.get('/zaczytywanie/fundamentalne', (req, res) => res.render('fundamentalne'));
app.get('/zaczytywanie/uzytkownicy', (req, res) => res.render('uzytkownicy'));
app.get('/ogolnezasadylabo', (req, res) => res.render('ogolnezasadylabo'));


// --- OBSŁUGA MODUŁU: NADRZĘDNE ---

// 1. Lista Zasad
app.get('/zaczytywanie/nadrzedne', async function(req, res) {
    const zasadyZBazy = await Zasada.find().sort({ _id: -1 });
    res.render('nadrzedne', { zasady: zasadyZBazy });
});

// 2. Szczegóły Zasady (Edycja)
app.get('/zaczytywanie/nadrzedne/szczegoly/:id', async (req, res) => {
    try {
        const zasada = await Zasada.findById(req.params.id);
        // Pobieramy unikalne tagi z bazy, aby podpowiedzieć je w formularzu
        const unikalneTagi = await Zasada.distinct("tag");
        
        if (!zasada) return res.status(404).send('Nie znaleziono zasady');
        
        res.render('nadrzedne_szczegoly', { 
            zasada: zasada,
            dostepneTagi: unikalneTagi 
        });
    } catch (err) {
        console.error(err);
        res.redirect('/zaczytywanie/nadrzedne');
    }
});

// 3. Dodawanie nowej zasady (Tworzy pustą i przekierowuje do edycji)
app.post('/zaczytywanie/nadrzedne/dodaj', async function(req, res) {
    const nowa = new Zasada({
        nazwa: "Nowa Zasada",
        tag: "Ogólne",
        opis: "",
        data: new Date().toLocaleString()
    });
    const zapisana = await nowa.save();
    // Od razu idziemy do edycji tego nowego wpisu
    res.redirect(`/zaczytywanie/nadrzedne/szczegoly/${zapisana._id}`);
});

// 4. Aktualizacja (Zapis zmian)
app.post('/zaczytywanie/nadrzedne/aktualizuj', urlencodedParser, async function(req, res) {
    const { id, nazwa, tag, opis } = req.body;
    await Zasada.findByIdAndUpdate(id, { 
        nazwa, 
        tag, 
        opis, 
        data: new Date().toLocaleString() // Aktualizujemy datę modyfikacji
    });
    res.redirect(`/zaczytywanie/nadrzedne/szczegoly/${id}`);
});

// 5. Usuwanie (Opcjonalnie, przydatne przy zarządzaniu)
app.post('/zaczytywanie/nadrzedne/usun', urlencodedParser, async function(req, res) {
    await Zasada.findByIdAndDelete(req.body.id);
    res.redirect('/zaczytywanie/nadrzedne');
});


// --- OBSŁUGA MODUŁU: MAILE ---

// 1. Wyświetlanie listy maili
app.get('/zaczytywanie/maile', async (req, res) => {
    const maileZBazy = await Mail.find().sort({ _id: -1 });
    res.render('maile', { maile: maileZBazy, statusPobierania: czyPobieranieAktywne });
});

// 2. Wyświetlanie szczegółów maila (Nowy widok)
app.get('/zaczytywanie/maile/szczegoly/:id', async (req, res) => {
    try {
        const mail = await Mail.findById(req.params.id);
        if (!mail) return res.status(404).send('Nie znaleziono maila');
        res.render('mail_szczegoly', { mail: mail });
    } catch (err) {
        console.error(err);
        res.redirect('/zaczytywanie/maile');
    }
});

// 3. Aktualizacja szczegółów (Zapis z nowego widoku)
app.post('/zaczytywanie/maile/aktualizuj', urlencodedParser, async (req, res) => {
    const { id, status, komentarz, prompt, ai_response } = req.body;
    await Mail.findByIdAndUpdate(id, { 
        status, 
        komentarz, 
        prompt, 
        ai_response 
    });
    res.redirect(`/zaczytywanie/maile/szczegoly/${id}`);
});

// 4. Dodawanie testowego maila (Symulacja)
app.post('/zaczytywanie/maile/dodaj-testowy', async (req, res) => {
    await new Mail({
        temat: "Test " + Math.floor(Math.random() * 1000), 
        tresc: "Przykładowa treść maila testowego...", 
        dataOdebrania: new Date().toLocaleString(),
        adresat: "ja", 
        nadawca: "System Testowy", 
        komentarz: "",
        status: "oczekuje",
        prompt: "",
        ai_response: ""
    }).save();
    res.redirect('/zaczytywanie/maile');
});

// 5. Sterowanie automatycznym pobieraniem (START/STOP)
app.post('/zaczytywanie/maile/sterowanie', urlencodedParser, function(req, res) {
    const akcja = req.body.akcja;

    if (akcja === 'start' && !czyPobieranieAktywne) {
        czyPobieranieAktywne = true;
        console.log("!!! URUCHOMIONO AUTOMATYCZNE POBIERANIE !!!");
        pobierzMaile(); // Start od razu
        intervalId = setInterval(pobierzMaile, 60000); // Potem co 60s
        
    } else if (akcja === 'stop' && czyPobieranieAktywne) {
        czyPobieranieAktywne = false;
        console.log("!!! ZATRZYMANO AUTOMATYCZNE POBIERANIE !!!");
        clearInterval(intervalId);
    }

    res.redirect('/zaczytywanie/maile');
});


// --- LOGIKA IMAP (POBIERANIE MAILI) ---

const config = {
    imap: {
        user: process.env.GMAIL_USER,
        password: process.env.GMAIL_PASSWORD,
        host: 'imap.gmail.com',
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 10000
    }
};

async function pobierzMaile() {
    console.log('--> Sprawdzam skrzynkę pocztową...');
    
    try {
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        const searchCriteria = ['UNSEEN'];
        const fetchOptions = {
            bodies: ['HEADER', 'TEXT', ''],
            markSeen: true
        };

        const messages = await connection.search(searchCriteria, fetchOptions);

        if (messages.length > 0) {
            console.log(`--> Znaleziono ${messages.length} nowych wiadomości!`);
            
            for (let item of messages) {
                const all = item.parts.find(part => part.which === '');
                const id = item.attributes.uid;
                const idHeader = "Imap-Id: " + id + "\r\n";
                
                const mail = await simpleParser(idHeader + all.body);

                const nowyMail = new Mail({
                    temat: mail.subject,
                    tresc: mail.text || "Tylko HTML",
                    dataOdebrania: new Date().toLocaleString(),
                    adresat: process.env.GMAIL_USER,
                    nadawca: mail.from ? mail.from.text : "Nieznany",
                    komentarz: "Auto-IMAP",
                    status: "oczekuje" // Ustawiamy status dla nowych maili z IMAP
                });

                await nowyMail.save();
                console.log(`--> Zapisano maila: ${mail.subject}`);
            }
        } else {
            console.log('--> Brak nowych wiadomości.');
        }

        connection.end();
    } catch (err) {
        console.error("BŁĄD POBIERANIA MAILI:", err);
        if (err.code === 'AUTHENTICATIONFAILED') {
            console.log("Wyłączam automat z powodu błędu hasła.");
            czyPobieranieAktywne = false;
            clearInterval(intervalId);
        }
    }
}

// --- URUCHOMIENIE SERWERA ---
const server = http.createServer(app);
const port = 8000;
server.listen(port);
console.debug('Aplikacja działa na porcie ' + port);