require('dotenv').config()
const { Client, LegacySessionAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal')
const request = require('request');
const fs = require('fs');
const express = require('express')
const ExcelJS = require('exceljs');
const moment = require('moment')
const cors = require('cors')
const { execFileSync } = require('child_process');
const SESSION_FILE_PATH = './session.json';
let client;
let sessionData;
const app = express();
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

app.use(cors())
app.use(express.urlencoded({ extended: true }))
app.listen(process.env.PORT || 1337, () => console.log('webhook is listening'));

const sendWithApi = (req, res) => {
    const { message, to } = req.body;
    const newNumber = `${to}@c.us`
    sendMessage(newNumber, message)
    res.send({ status: 'enviado' })
}
app.post('/send', sendWithApi);
// Creates the endpoint for our webhook Messenger
app.post('/webhook', (req, res) => {

    let body = req.body;

    // Checks this is an event from a page subscription
    if (body.object === 'page') {

        // Iterates over each entry - there may be multiple if batched
        body.entry.forEach(function (entry) {

            // Gets the webhook event. entry.messaging is an array, but 
            // will only ever contain one message, so we get index 0
            let webhook_event = entry.messaging[0];
            console.log(webhook_event);

            // Get the sender PSID
            let sender_psid = webhook_event.sender.id;
            console.log('Sender PSID: ' + sender_psid);

            // Check if the event is a message or postback and
            // pass the event to the appropriate handler function
            if (webhook_event.message) {
                handleMessageMessenger(sender_psid, webhook_event.message);
            } else if (webhook_event.postback) {
                handlePostbackMessenger(sender_psid, webhook_event.postback);
            }
        });

        // Returns a '200 OK' response to all requests
        res.status(200).send('EVENT_RECEIVED');
    } else {
        // Returns a '404 Not Found' if event is not from a page subscription
        res.sendStatus(404);
    }

});
// Adds support for GET requests to our webhook Messenger
app.get('/webhook', (req, res) => {

    // Your verify token. Should be a random string.
    let VERIFY_TOKEN = process.env.VERIFY_TOKEN

    // Parse the query params
    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];

    // Checks if a token and mode is in the query string of the request
    if (mode && token) {

        // Checks the mode and token sent is correct
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {

            // Responds with the challenge token from the request
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);

        } else {
            // Responds with '403 Forbidden' if verify tokens do not match
            res.sendStatus(403);
        }
    }
});
// Handles Messenger messages events 
const handleMessageMessenger = (sender_psid, received_message) => {
    let response;

    // Check if the message contains text
    if (received_message.text) {

        // Create the payload for a basic text message
        response = {
            "text": `You sent the message: "${received_message.text}". Now send me an image!`
        }

    } else if (received_message.attachments) {
        // Get the URL of the message attachment
        let attachment_url = received_message.attachments[0].payload.url;
        response = {
            "attachment": {
                "type": "template",
                "payload": {
                    "template_type": "generic",
                    "elements": [{
                        "title": "Is this the right picture?",
                        "subtitle": "Tap a button to answer.",
                        "image_url": attachment_url,
                        "buttons": [
                            {
                                "type": "postback",
                                "title": "Yes!",
                                "payload": "yes",
                            },
                            {
                                "type": "postback",
                                "title": "No!",
                                "payload": "no",
                            },
                            {
                                "type":"web_url",
                                "title": "Contactar",
                                "url":"https://www.messenger.com"
                            }
                        ],
                    }]
                }
            }
        }
    }

    // Send the response message
    callSendAPIMessenger(sender_psid, response);

}
// Handles Messenger messaging_postbacks events
const handlePostbackMessenger = (sender_psid, received_postback) => {
    let response;

    // Get the payload for the postback
    let payload = received_postback.payload;

    // Set the response based on the postback payload
    if (payload === 'yes') {
        response = { "text": "Thanks!" }
    } else if (payload === 'no') {
        response = { "text": "Oops, try sending another image." }
    }
    // Send the message to acknowledge the postback
    callSendAPIMessenger(sender_psid, response);
}
// Sends response Messenger messages via the Send API
const callSendAPIMessenger = (sender_psid, response) => {
    // Construct the message body
    let request_body = {
        "recipient": {
            "id": sender_psid
        },
        "message": response
    }

    // Send the HTTP request to the Messenger Platform
    request({
        "uri": "https://graph.facebook.com/v2.6/me/messages",
        "qs": { "access_token": process.env.PAGE_ACCESS_TOKEN },
        "method": "POST",
        "json": request_body
    }, (err, res, body) => {
        if (!err) {
            console.log('message sent!')
        } else {
            console.error("Unable to send message:" + err);
        }
    });
}
const withSession = () => {
    console.log('Validando session de whatsapp...')
    sessionData = require(SESSION_FILE_PATH);
    client = new Client({
        authStrategy: new LegacySessionAuth({
            session: sessionData
        }),
    })
    client.on('ready', () => {
        console.log('Cliente ready!');
        listenMessage();
    })
    client.on('auth_failure', () => {
        console.log('Error de autenticación');
    })
    client.initialize();

}
const withOutSession = () => {
    client = new Client({
        authStrategy: new LegacySessionAuth(),
        puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });
    client.on('qr', qr => {
        qrcode.generate(qr, { small: true })
    });
    client.on('authenticated', (session) => {
        sessionData = session;
        if (sessionData) {
            fs.writeFile(SESSION_FILE_PATH, JSON.stringify(session), function (err) {
                if (err) {
                    console.log(`Ocurrio un error con el archivo: `, err);
                }
            });
        }
    });

    client.initialize();
}
const listenMessage = () => {
    client.on('message', (msg) => {
        const { from, to, body } = msg;
        console.log(from, to, body);
        sendMessage(from, 'Hola cómo vas');
        sendMedia(from, 'foto1.png')
        saveHistorial(from, body)
    })
}
const sendMessage = (to, message) => {
    client.sendMessage(to, message)
}
const sendMedia = (to, file) => {
    const mediaFile = MessageMedia.fromFilePath(`./mediaSend/${file}`)
    client.sendMessage(to, mediaFile)
}
const saveHistorial = (number, message) => {
    const pathChat = `./chats/${number}.xlsx`;
    const workbook = new ExcelJS.Workbook();
    const today = moment().format('DD-MM-YYYY hh:mm')

    if (fs.existsSync(pathChat)) {
        workbook.xlsx.readFile(pathChat)
            .then(() => {
                const worksheet = workbook.getWorksheet(1)
                const lastRow = worksheet.lastRow;
                let getRowInsert = worksheet.getRow(++(lastRow.number))
                getRowInsert.getCell('A').value = today
                getRowInsert.getCell('B').value = message
                getRowInsert.commit();
                workbook.xlsx.writeFile(pathChat)
                    .then(() => {
                        console.log('Se agregó chat');
                    })
                    .catch((e) => {
                        console.log('Algo falló' + e);
                    })
            })
    } else {
        const worksheet = workbook.addWorksheet('Chats');
        worksheet.columns = [
            { header: 'fecha', key: 'date' },
            { header: 'Mensaje', key: 'message' }
        ]
        worksheet.addRow([today, message])
        workbook.xlsx.writeFile(pathChat)
            .then(() => {
                console.log('Historial Creado!');
            })
            .catch((e) => {
                console.log('Algo falló' + e);
            })
    }
}
(fs.existsSync(SESSION_FILE_PATH)) ? withSession() : withOutSession();
