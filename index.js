const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');

// Servidor web obligatorio para la nube de Render
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('¡Bot activo en la nube!');
});

app.listen(PORT, () => {
    console.log(`Servidor web corriendo en el puerto ${PORT}`);
});

const grupoConfig = {}; 
const advertencias = {}; 
const malasPalabras = ["puta", "puto", "idiota", "perra", "estupido", "estúpido"]; 

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.appropriate('Chrome'),
        logger: pino({ level: 'silent' })
    });

    // Código de vinculación de 8 dígitos automático usando la variable de Render
    if (!sock.authState.creds.registered) {
        const phoneNumber = process.env.PHONE_NUMBER; 
        
        if (!phoneNumber) {
            console.log('⚠️ ADVERTENCIA: Falta configurar la variable PHONE_NUMBER en Render.');
        } else {
            setTimeout(async () => {
                try {
                    let code = await sock.requestPairingCode(phoneNumber.trim());
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    console.log(`\n🔑 TU CÓDIGO DE VINCULACIÓN DE 8 DÍGITOS ES: \x1b[32m${code}\x1b[0m\n`);
                } catch (e) {
                    console.log('❌ Error al solicitar el código:', e);
                }
            }, 3000);
        }
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('\n¡Bot conectado exitosamente a WhatsApp!\n');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Lógica de anti-groserías
    sock.ev.on('messages.upsert', async (m) => {
        try {
            const mek = m.messages[0];
            if (!mek.message) return;
            
            const remoteJid = mek.key.remoteJid;
            const sender = mek.key.participant || remoteJid;
            const textMessage = mek.message.conversation || mek.message.extendedTextMessage?.text || '';
            const isAdmin = false; 

            if (grupoConfig.antigroserias && !isAdmin) {
                const textoLimpiado = textMessage.toLowerCase();
                const contieneGroseria = malasPalabras.some(palabra => textoLimpiado.includes(palabra));

                if (contieneGroseria) {
                    if (!advertencias[remoteJid]) advertencias[remoteJid] = {};
                    if (!advertencias[remoteJid][sender]) advertencias[remoteJid][sender] = { count: 0, lastTime: Date.now() };
                    
                    const userData = advertencias[remoteJid][sender];

                    if (Date.now() - userData.lastTime > 2 * 24 * 60 * 60 * 1000) {
                        userData.count = 0;
                    }

                    userData.count += 1;
                    userData.lastTime = Date.now();

                    if (userData.count >= 4) {
                        try {
                            await sock.sendMessage(remoteJid, { delete: mek.key });
                            await sock.groupParticipantsUpdate(remoteJid, [sender], "remove");
                            await sock.sendMessage(remoteJid, { text: `❌ @${sender.split('@')[0]} expulsado por acumular 4 advertencias de groserías.`, mentions: [sender] });
                            delete advertencias[remoteJid][sender];
                        } catch (e) {}
                    } else {
                        try {
                            await sock.sendMessage(remoteJid, { delete: mek.key });
                            await sock.sendMessage(remoteJid, { text: `⚠️ @${sender.split('@')[0]} Advertencia (${userData.count}/4). Cuida tu vocabulario.`, mentions: [sender] });
                        } catch (e) {}
                    }
                }
            }
        } catch (err) {
            console.log(err);
        }
    });
}

connectToWhatsApp();

