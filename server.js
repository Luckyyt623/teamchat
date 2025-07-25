const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Team codes and their corresponding author keys
const teamCodes = {
    '[REKT]': { code: 'REKT', authorKey: 'authorKeyREKT' },
    '[SMT]': { code: 'SMT', authorKey: 'authorKeySMT' }
};

const users = new Map(); // WebSocket -> { username, teamCode, joined }
const teamChannels = new Map(); // teamCode -> Set of sockets
const messageHistory = {
    global: [],
    '[REKT]': [],
    '[SMT]': []
};

const MAX_HISTORY = 50; // Reduced to minimize memory usage
const MSG_LIFETIME_MS = 10 * 60 * 1000; // 10 minutes

// Cleanup job every 120 seconds to reduce CPU usage
setInterval(() => {
    const now = Date.now();
    for (const channel in messageHistory) {
        messageHistory[channel] = messageHistory[channel].filter(msg => (now - msg._rawTime) < MSG_LIFETIME_MS);
    }
}, 120 * 1000);

// Health check endpoint to keep Render instance active
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.get('/', (req, res) => {
    res.send('Slither Team Chat Server is running!');
});

wss.on('connection', (ws) => {
    users.set(ws, { username: null, teamCode: null, joined: false });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const user = users.get(ws);

            switch (data.type) {
                case 'user-join':
                    user.username = data.username || 'AnonymousSnake';
                    user.joined = true;
                    broadcastSystemMessage(`[${user.username}] joined the chat.`, 'global');
                    sendHistory(ws, 'global');
                    break;

                case 'join-team':
                    handleJoinTeam(ws, data.teamCode, data.authorKey);
                    break;

                case 'chat-message':
                    if (user.joined) handleChatMessage(ws, data.text, data.channel || 'global');
                    break;

                case 'get-history':
                    if (user.joined) sendHistory(ws, data.channel || 'global');
                    break;

                default:
                    ws.send(JSON.stringify({ 
                        type: 'system-message', 
                        text: 'Unknown message type.', 
                        timestamp: getCurrentTime() 
                    }));
            }
        } catch (e) {
            ws.send(JSON.stringify({ 
                type: 'system-message', 
                text: 'Error processing your request.', 
                timestamp: getCurrentTime() 
            }));
        }
    });

    ws.on('close', () => {
        const user = users.get(ws);
        if (user && user.joined) {
            broadcastSystemMessage(`[${user.username}] left the chat.`, 'global');
            if (user.teamCode) {
                teamChannels.get(user.teamCode)?.delete(ws);
            }
            users.delete(ws);
        }
    });
});

function handleJoinTeam(ws, code, authorKey) {
    const user = users.get(ws);
    if (!user || !user.joined) return;

    if (teamCodes[code] && teamCodes[code].authorKey === authorKey) {
        user.teamCode = code;
        let teamUsers = teamChannels.get(code) || new Set();
        teamChannels.set(code, teamUsers);
        teamUsers.add(ws);
        ws.send(JSON.stringify({
            type: 'system-message',
            text: `Joined team channel for ${teamCodes[code].code}`,
            timestamp: getCurrentTime()
        }));
        sendHistory(ws, code);
    } else {
        ws.send(JSON.stringify({
            type: 'system-message',
            text: teamCodes[code] ? 'Invalid author key.' : 'Invalid team code.',
            timestamp: getCurrentTime()
        }));
    }
}

function handleChatMessage(ws, text, channel) {
    const user = users.get(ws);
    const now = Date.now();
    const msg = {
        type: 'chat-message',
        username: user.username,
        text,
        timestamp: getCurrentTime(),
        channel,
        _rawTime: now
    };

    if (!messageHistory[channel]) {
        messageHistory[channel] = [];
    }
    messageHistory[channel].push(msg);
    if (messageHistory[channel].length > MAX_HISTORY) {
        messageHistory[channel].shift();
    }

    if (channel === 'global') {
        broadcastMessage(msg);
    } else if (user.teamCode && teamChannels.get(user.teamCode)) {
        teamChannels.get(user.teamCode).forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(msg));
            }
        });
    }
}

function sendHistory(ws, channel) {
    const history = messageHistory[channel] || [];
    ws.send(JSON.stringify({ type: 'chat-history', messages: history }));
}

function broadcastMessage(msg) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && users.get(client)?.joined) {
            client.send(JSON.stringify(msg));
        }
    });
}

function broadcastSystemMessage(text, channel) {
    const now = Date.now();
    const msg = {
        type: 'system-message',
        text,
        timestamp: getCurrentTime(),
        _rawTime: now
    };

    if (!messageHistory[channel]) {
        messageHistory[channel] = [];
    }
    messageHistory[channel].push(msg);
    if (messageHistory[channel].length > MAX_HISTORY) {
        messageHistory[channel].shift();
    }

    if (channel === 'global') {
        broadcastMessage(msg);
    } else if (teamChannels.get(channel)) {
        teamChannels.get(channel).forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(msg));
            }
        });
    }
}

function getCurrentTime() {
    return new Date().toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: 'Asia/Kolkata'
    });
}

server.listen(PORT, () => {
    console.log(`✅ Team Chat Server running on ws://0.0.0.0:${PORT}`);
});