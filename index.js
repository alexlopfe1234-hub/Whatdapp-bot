const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    isJidGroup
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🤖 ¡El bot de WhatsApp con código de vinculación está activo!');
});

app.listen(PORT, () => {
    console.log(`Servidor web corriendo en el puerto ${PORT}`);
});

const antienlaceState = {};
// Tomar el número directamente de la variable de entorno configurada en Render
const phoneNumber = process.env.PHONE_NUMBER || "50232131287";

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sesion_bot');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['Chrome (Linux)', 'Chrome', '120.0.0.0']
    });

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n========================================`);
                console.log(`🔑 CÓDIGO DE VINCULACIÓN PARA ${phoneNumber}:`);
                console.log(`${code?.match(/.{1,4}/g)?.join('-') || code}`);
                console.log(`========================================\n`);
            } catch (error) {
                console.error('Error al solicitar el código de vinculación:', error);
            }
        }, 3000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.log(`Conexión cerrada. Motivo: ${reason}`);
            
            if (reason !== DisconnectReason.loggedOut) {
                startBot();
            } else {
                console.log('Sesión cerrada permanentemente.');
            }
        } else if (connection === 'open') {
            console.log('¡Bot conectado exitosamente a la nube mediante código!');
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

        if (text.toLowerCase() === '!menu') {
            const menuText = 
`🤖 *MENÚ DE COMANDOS DEL BOT* 🤖

🔹 *!menu* - Muestra este menú de ayuda.
🔹 *!antienlace on* - Activa el filtro antienlace.
🔹 *!antienlace off* - Desactiva el filtro antienlace.

_Número configurado:_ +${phoneNumber}`;

            await sock.sendMessage(remoteJid, { text: menuText }, { quoted: m });
            return;
        }

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
