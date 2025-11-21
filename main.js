require('dotenv').config(); // Ładowanie haseł z .env
const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const http = require('http');
const express = require('express');
const mongoose = require('mongoose'); // 1. Dołączamy Mongoose
const bodyParser = require('body-parser');

const app = express();
var urlencodedParser = bodyParser.urlencoded({ extended: false });

app.set('view engine', 'ejs');

// --- POŁĄCZENIE Z BAZĄ DANYCH ---
// Łączymy się z lokalną bazą o nazwie 'csapp_db' (stworzy się sama)
mongoose.connect('mongodb://127.0.0.1:27017/csapp_db')
    .then(() => console.log('Połączono z MongoDB!'))
    .catch(err => console.error('Błąd połączenia z bazą:', err));

// --- SCHEMAT DANYCH (MODEL) ---
// Definiujemy jak wygląda pojedyncza "Zasada" w bazie
const zasadaSchema = new mongoose.Schema({
    tresc: String,
    data: String
});


// Tworzymy model (to on pozwala zapisywać/szukać w bazie)
const Zasada = mongoose.model('Zasada', zasadaSchema);

// --- SCHEMAT MAILA ---
const mailSchema = new mongoose.Schema({
    temat: String,
    tresc: String,
    dataOdebrania: String,
    adresat: String,
    nadawca: String,
    komentarz: String // To pole będziemy edytować
});

const Mail = mongoose.model('Mail', mailSchema);

// --- ROUTING ---

var msg = "PROJEKT LABO NEXT STEP";

app.get('/', function(req, res) {
    res.render('index', { message: msg });
});

// Inne podstrony (statyczne)
app.get('/zaczytywanie', (req, res) => res.render('zaczytywanie'));
app.get('/planowanie', (req, res) => res.render('planowanie'));
app.get('/ripowanie', (req, res) => res.render('ripowanie'));
app.get('/zaczytywanie/fundamentalne', (req, res) => res.render('fundamentalne'));
app.get('/zaczytywanie/uzytkownicy', (req, res) => res.render('uzytkownicy'));
app.get('/ogolnezasadylabo', (req, res) => res.render('ogolnezasadylabo'));


// --- OBSŁUGA MODUŁU NADRZĘDNE (Z BAZĄ DANYCH) ---

// 1. Wyświetlanie (Pobieramy z bazy)
app.get('/zaczytywanie/nadrzedne', async function(req, res) {
    // 'find()' szuka wszystkiego w kolekcji Zasad
    const zasadyZBazy = await Zasada.find(); 
    res.render('nadrzedne', { zasady: zasadyZBazy });
});

// 2. Dodawanie (Zapisujemy do bazy)
app.post('/zaczytywanie/nadrzedne/dodaj', urlencodedParser, async function(req, res) {
    const nowaZasada = new Zasada({
        tresc: req.body.nowaTresc,
        data: new Date().toLocaleString()
    });
    
    await nowaZasada.save(); // Zapisz w MongoDB
    res.redirect('/zaczytywanie/nadrzedne');
});

// 3. Edycja (Aktualizujemy w bazie)
app.post('/zaczytywanie/nadrzedne/edytuj', urlencodedParser, async function(req, res) {
    const idDoEdycji = req.body.id;
    const nowaTresc = req.body.tresc;
    const nowaData = new Date().toLocaleString();

    // Znajdź po ID i zaktualizuj
    await Zasada.findByIdAndUpdate(idDoEdycji, { 
        tresc: nowaTresc, 
        data: nowaData 
    });

    res.redirect('/zaczytywanie/nadrzedne');
});
// 4. Przetworzone Maile 

// --- OBSŁUGA MODUŁU MAILE ---

// 1. Wyświetlanie listy maili
app.get('/zaczytywanie/maile', async function(req, res) {
    const maileZBazy = await Mail.find();
    res.render('maile', { maile: maileZBazy });
});

// 2. Zapisywanie komentarza do maila
app.post('/zaczytywanie/maile/komentarz', urlencodedParser, async function(req, res) {
    const idMaila = req.body.id;
    const nowyKomentarz = req.body.komentarz;

    await Mail.findByIdAndUpdate(idMaila, { komentarz: nowyKomentarz });
    res.redirect('/zaczytywanie/maile');
});

// 3. (Pomocnicze) Dodawanie testowego maila (żebyś miał co wyświetlić)
app.post('/zaczytywanie/maile/dodaj-testowy', async function(req, res) {
    const nowyMail = new Mail({
        temat: "Zamówienie nr " + Math.floor(Math.random() * 1000),
        tresc: "Dzień dobry, proszę o realizację zamówienia na 500 sztuk...",
        dataOdebrania: new Date().toLocaleString(),
        adresat: "biuro@csapp.pl",
        nadawca: "klient@firma.pl",
        komentarz: ""
    });
    await nowyMail.save();
    res.redirect('/zaczytywanie/maile');
});

// --- AUTOMATYZACJA ODBIERANIA MAILI (IMAP) ---

let czyPobieranieAktywne = false; // Domyślnie wyłączone
let intervalId = null; // Uchwyt do pętli czasowej

// Konfiguracja połączenia z Gmailem
const config = {
    imap: {
        user: process.env.GMAIL_USER,
        password: process.env.GMAIL_PASSWORD,
        host: 'imap.gmail.com',
        port: 993,
        tls: true,
        authTimeout: 3000
    }
};

// Główna funkcja pobierająca maile
async function pobierzMaile() {
    console.log('--> Sprawdzam skrzynkę pocztową...');
    
    try {
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        // Szukamy tylko NIEPRZECZYTANYCH maili (UNSEEN)
        const searchCriteria = ['UNSEEN'];
        const fetchOptions = {
            bodies: ['HEADER', 'TEXT', ''],
            markSeen: true // Oznacz jako przeczytane po pobraniu
        };

        const messages = await connection.search(searchCriteria, fetchOptions);

        if (messages.length === 0) {
            console.log('--> Brak nowych wiadomości.');
        } else {
            console.log(`--> Znaleziono ${messages.length} nowych wiadomości!`);
        }

        for (let item of messages) {
            const all = item.parts.find(part => part.which === '');
            const id = item.attributes.uid;
            const idHeader = "Imap-Id: " + id + "\r\n";
            
            // Parsowanie (zamiana kodu na tekst)
            const mail = await simpleParser(idHeader + all.body);

            // Zapis do bazy MongoDB
            const nowyMail = new Mail({
                temat: mail.subject,
                tresc: mail.text || mail.html || "Brak treści tekstowej", // Czasem mail to tylko HTML
                dataOdebrania: new Date().toLocaleString(),
                adresat: Array.isArray(mail.to) ? mail.to[0].text : mail.to.text, // Obsługa różnych formatów
                nadawca: mail.from.text,
                komentarz: "Automatycznie pobrano z Gmaila"
            });

            await nowyMail.save();
            console.log(`--> Zapisano maila: ${mail.subject}`);
        }

        connection.end(); // Rozłączamy się
    } catch (err) {
        console.error("BŁĄD POBIERANIA MAILI:", err.message);
        // Nie wyłączamy procesu, próbujemy za chwilę znowu
    }
}

// --- ROUTING STEROWANIA ---

// Przycisk WŁĄCZ / WYŁĄCZ
app.post('/zaczytywanie/maile/sterowanie', function(req, res) {
    const akcja = req.body.akcja; // "start" lub "stop"

    if (akcja === 'start' && !czyPobieranieAktywne) {
        czyPobieranieAktywne = true;
        console.log("!!! URUCHOMIONO AUTOMATYCZNE POBIERANIE !!!");
        
        // Uruchom natychmiast raz
        pobierzMaile();
        
        // Ustaw pętlę co 60 sekund (60000 ms)
        intervalId = setInterval(pobierzMaile, 60000);
        
    } else if (akcja === 'stop' && czyPobieranieAktywne) {
        czyPobieranieAktywne = false;
        console.log("!!! ZATRZYMANO AUTOMATYCZNE POBIERANIE !!!");
        clearInterval(intervalId);
    }

    res.redirect('/zaczytywanie/maile');
});

// Aktualizacja widoku (musimy przekazać status do pliku ejs)
// ZNAJDŹ I PODMIEŃ SWÓJ STARY ROUTE 'app.get(/zaczytywanie/maile...)' NA TEN:
app.get('/zaczytywanie/maile', async function(req, res) {
    const maileZBazy = await Mail.find().sort({ _id: -1 }); // Sortowanie: najnowsze na górze
    res.render('maile', { 
        maile: maileZBazy,
        statusPobierania: czyPobieranieAktywne // Przekazujemy zmienną do widoku
    });
});

const server = http.createServer(app);
const port = 8000;
server.listen(port);
console.debug('Aplikacja działa na porcie ' + port);