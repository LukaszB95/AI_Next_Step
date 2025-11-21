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
const server = http.createServer(app);
const port = 8000;
server.listen(port);
console.debug('Aplikacja działa na porcie ' + port);