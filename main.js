require('dotenv').config(); // Ładowanie haseł z .env

const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const http = require('http');
const express = require('express');
const mongoose = require('mongoose'); 
const bodyParser = require('body-parser');

const app = express();
var urlencodedParser = bodyParser.urlencoded({ extended: false });

// ZMIENNA GLOBALNA STATUSU (Musi być tutaj)
let czyPobieranieAktywne = false; 
let intervalId = null; // Uchwyt do pętli czasowej

app.set('view engine', 'ejs');

// --- POŁĄCZENIE Z BAZĄ DANYCH ---
mongoose.connect('mongodb://127.0.0.1:27017/csapp_db')
    .then(() => console.log('Połączono z MongoDB!'))
    .catch(err => console.error('Błąd połączenia z bazą:', err));

// --- MODELE DANYCH ---

const zasadaSchema = new mongoose.Schema({
    tresc: String,
    data: String
});
const Zasada = mongoose.model('Zasada', zasadaSchema);

const mailSchema = new mongoose.Schema({
    temat: String,
    tresc: String,
    dataOdebrania: String,
    adresat: String,
    nadawca: String,
    komentarz: String
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

app.get('/zaczytywanie/nadrzedne', async function(req, res) {
    const zasadyZBazy = await Zasada.find(); 
    res.render('nadrzedne', { zasady: zasadyZBazy });
});

app.post('/zaczytywanie/nadrzedne/dodaj', urlencodedParser, async function(req, res) {
    const nowaZasada = new Zasada({
        tresc: req.body.nowaTresc,
        data: new Date().toLocaleString()
    });
    await nowaZasada.save();
    res.redirect('/zaczytywanie/nadrzedne');
});

app.post('/zaczytywanie/nadrzedne/edytuj', urlencodedParser, async function(req, res) {
    const idDoEdycji = req.body.id;
    await Zasada.findByIdAndUpdate(idDoEdycji, { 
        tresc: req.body.tresc, 
        data: new Date().toLocaleString()
    });
    res.redirect('/zaczytywanie/nadrzedne');
});


// --- OBSŁUGA MODUŁU: MAILE ---

// 1. Wyświetlanie listy maili (TO JEST TA JEDYNA, POPRAWNA WERSJA)
app.get('/zaczytywanie/maile', async function(req, res) {
    const maileZBazy = await Mail.find().sort({ _id: -1 }); // Najnowsze na górze
    
    res.render('maile', { 
        maile: maileZBazy,
        statusPobierania: czyPobieranieAktywne // Przekazujemy status do widoku
    });
});

// 2. Zapisywanie komentarza
app.post('/zaczytywanie/maile/komentarz', urlencodedParser, async function(req, res) {
    await Mail.findByIdAndUpdate(req.body.id, { komentarz: req.body.komentarz });
    res.redirect('/zaczytywanie/maile');
});

// 3. Symulacja maila (testowa)
app.post('/zaczytywanie/maile/dodaj-testowy', async function(req, res) {
    const nowyMail = new Mail({
        temat: "Zamówienie nr " + Math.floor(Math.random() * 1000),
        tresc: "Testowa wiadomość...",
        dataOdebrania: new Date().toLocaleString(),
        adresat: "biuro@csapp.pl",
        nadawca: "klient@firma.pl",
        komentarz: ""
    });
    await nowyMail.save();
    res.redirect('/zaczytywanie/maile');
});

// 4. Sterowanie automatycznym pobieraniem (START/STOP)
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
        // --- DODAJ TE LINIE PONIŻEJ ---
        tlsOptions: { 
            rejectUnauthorized: false 
        },
        // ------------------------------
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
                    adresat: process.env.GMAIL_USER, // Uprościłem dla testów
                    nadawca: mail.from ? mail.from.text : "Nieznany",
                    komentarz: "Automatycznie pobrano z Gmaila"
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
        // Jeśli błąd logowania, wyłącz automat żeby nie zablokować konta
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