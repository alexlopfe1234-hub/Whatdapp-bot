const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');

// Servidor web obligatorio para la nube de Render
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('¡Bot activo en la nube!');
});

app.listen(PORT, () => {
    console.log(`Servidor web corriendo en el puerto ${PORT}`);
});

const advertencias = {};
const malasPalabras = ["puta", "puto", "idiota", "perra", "estupido", "estupida"];

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.appropriate('Chrome'),
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('¡Bot conectado exitosamente a WhatsApp!');
        }

        // Sistema de emparejamiento por código de 8 dígitos
        if (!sock.authState.creds.registered) {
            const phoneNumber = process.env.PHONE_NUMBER;
            if (phoneNumber) {
                setTimeout(async () => {
                    try {
                        const code = await sock.requestPairingCode(phoneNumber);
                        console.log(`\n========================================`);
                        console.log(`TU CÓDIGO DE VINCULACIÓN ES: ${code}`);
                        console.log(`========================================\n`);
                    } catch (error) {
                        console.error('Error al solicitar el código de emparejamiento:', error);
                    }
                }, 3000);
            }
        }
    });

    // Manejador de mensajes entrantes
    sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const m = messages[0];
            if (!m.message || m.key.fromMe) return;

            const remoteJid = m.key.remoteJid;
            const sender = m.key.participant || remoteJid;
            const text = m.message.conversation || m.message.extendedTextMessage?.text || '';
            const textLower = text.toLowerCase();

            // Detector de groserías
            const contieneGroseria = malasPalabras.some(palabra => textLower.includes(palabra));
            if (contieneGroseria) {
                if (!advertencias[remoteJid]) advertencias[remoteJid] = {};
                if (!advertencias[remoteJid][sender]) advertencias[remoteJid][sender] = { count: 0, lastTime: 0 };

                const userData = advertencias[remoteJid][sender];
                if (Date.now() - userData.lastTime > 2 * 24 * 60 * 60 * 1000) {
                    userData.count = 0;
                }

                userData.count += 1;
                userData.lastTime = Date.now();

                if (userData.count >= 4) {
                    try {
                        await sock.sendMessage(remoteJid, { delete: m.key });
                        await sock.groupParticipantsUpdate(remoteJid, [sender], 'remove');
                        await sock.sendMessage(remoteJid, { text: '❌ Usuario expulsado por acumular groserías.' });
                        delete advertencias[remoteJid][sender];
                    } catch (e) {}
                } else {
                    try {
                        await sock.sendMessage(remoteJid, { delete: m.key });
                        await sock.sendMessage(remoteJid, { text: `⚠️ Advertencia (${userData.count}/4) por lenguaje inapropiado.` });
                    } catch (e) {}
                }
            }
        } catch (err) {
            console.log(err);
        }
    });
}

connectToWhatsApp();
