const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    isJidGroup
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const express = require('express');

// Configuración del servidor web para Render (evita que el bot se duerma)
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🤖 ¡El bot de WhatsApp está activo y funcionando correctamente!');
});

app.listen(PORT, () => {
    console.log(`Servidor web corriendo en el puerto ${PORT}`);
});

// Almacén en memoria para el antienlace por grupo
const antienlaceState = {};

async function startBot() {
    // Si estás en Render y usas un disco persistente, puedes apuntar a esa carpeta (ej: /opt/render/project/src/sesion_bot)
    // De manera predeterminada usará una carpeta local 'sesion_bot'
    const { state, saveCreds } = await useMultiFileAuthState('sesion_bot');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ['BotAntienlaceCloud', 'Chrome', '1.0.0']
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('Escanea el código QR desde la consola de Render (Número vinculado: 50232131287):');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.log(`Conexión cerrada. Motivo: ${reason}`);
            
            if (reason !== DisconnectReason.loggedOut) {
                startBot();
            } else {
                console.log('Sesión cerrada permanentemente.');
            }
        } else if (connection === 'open') {
            console.log('¡Bot conectado exitosamente a la nube!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const remoteJid = m.key.remoteJid;
        const isGroup = isJidGroup(remoteJid);
        
        const messageType = Object.keys(m.message)[0];
        const text = messageType === 'conversation' 
            ? m.message.conversation 
            : messageType === 'extendedTextMessage' 
                ? m.message.extendedTextMessage.text 
                : '';

        if (!text) return;
        const sender = m.key.participant || remoteJid;

        // Comando !menu
        if (text.toLowerCase() === '!menu') {
            const menuText = 
`🤖 *MENÚ DE COMANDOS DEL BOT* 🤖

🔹 *!menu* - Muestra este menú de ayuda.
🔹 *!antienlace on* - Activa el filtro antienlace.
🔹 *!antienlace off* - Desactiva el filtro antienlace.

_Número configurado:_ +502 3213 1287`;

            await sock.sendMessage(remoteJid, { text: menuText }, { quoted: m });
            return;
        }

        // Comando !antienlace configuración
        if (isGroup && text.toLowerCase().startsWith('!antienlace')) {
            const args = text.split(' ');
            const action = args[1] ? args[1].toLowerCase() : '';

            if (action === 'on') {
                antienlaceState[remoteJid] = true;
                await sock.sendMessage(remoteJid, { text: '🛡️ *Antienlace activado* en este grupo.' }, { quoted: m });
            } else if (action === 'off') {
                antienlaceState[remoteJid] = false;
                await sock.sendMessage(remoteJid, { text: '⚠️ *Antienlace desactivado* en este grupo.' }, { quoted: m });
            } else {
                await sock.sendMessage(remoteJid, { text: 'Uso correcto: `!antienlace on` o `!antienlace off`' }, { quoted: m });
            }
            return;
        }

        // Detección y eliminación de enlaces
        if (isGroup && antienlaceState[remoteJid] === true) {
            const linkRegex = /(https?:\/\/[^\s]+)|(chat\.whatsapp\.com\/[^\s]+)|(t\.me\/[^\s]+)/gi;

            if (linkRegex.test(text)) {
                try {
                    const groupMetadata = await sock.groupMetadata(remoteJid);
                    const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                    const botParticipant = groupMetadata.participants.find(p => p.id === botId);
                    const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';

                    if (!isBotAdmin) {
                        await sock.sendMessage(remoteJid, { text: '⚠️ Detecté un enlace, pero no soy administrador para eliminar al usuario.' }, { quoted: m });
                        return;
                    }

                    await sock.groupParticipantsUpdate(remoteJid, [sender], 'remove');
                    await sock.sendMessage(remoteJid, { text: `🚫 @${sender.split('@')[0]} fue eliminado por enviar enlaces.`, mentions: [sender] });
                } catch (error) {
                    console.error('Error al eliminar usuario:', error);
                }
            }
        }
    });
}

startBot();
