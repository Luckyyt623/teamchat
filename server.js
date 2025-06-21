const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const teamCodes = {
    '[REKT]': 'REKT',
    '[SMT]': 'SMT'
};

const users = new Map();        // WebSocket -> { username, teamCode, joined }
const teamChannels = new Map(); // teamCode -> Set of sockets
const messageHistory = {
    global: [],
    '[REKT]': [],
    '[SMT]': []
};

const MAX_HISTORY = 100;
const MSG_LIFETIME_MS = 30 * 60 * 1000; // 30 min

// Cleanup job every 60 seconds
setInterval(() => {
    const now = Date.now();
    for (const channel in messageHistory) {
        messageHistory[channel] = messageHistory[channel].filter(msg => (now - msg._rawTime) < MSG_LIFETIME_MS);
    }
}, 60 * 1000);

app.get('/', (req, res) => {
    res.send('Slither Team Chat Server is running!');
});

wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const user = users.get(ws);

            switch (data.type) {
                case 'user-join':
                    const username = data.username || 'AnonymousSnake';
                    users.set(ws, { username, teamCode: null, joined: true });
                    broadcastSystemMessage(`[${username}] joined the chat.`, 'global');
                    break;

                case 'auth-request':
                    if (user?.joined) handleAuthRequest(ws, data.code);
                    break;

                case 'join-team':
                    if (user?.joined) handleJoinTeam(ws, data.code);
                    break;

                case 'chat-message':
                    if (user?.joined) handleChatMessage(ws, data.text, data.channel);
                    break;

                case 'get-history':
                    if (user?.joined) sendHistory(ws, data.channel);
                    break;

                default:
                    console.log('Unknown message type:', data.type);
            }
        } catch (e) {
            console.error('Invalid message:', e);
            ws.send(JSON.stringify({ type: 'system-message', text: 'Error processing your request.', timestamp: getCurrentTime() }));
        }
    });

    ws.on('close', () => {
        const user = users.get(ws);
        if (user) {
            broadcastSystemMessage(`[${user.username}] left the chat.`, 'global');
            if (user.teamCode) {
                teamChannels.get(user.teamCode)?.delete(ws);
            }
            users.delete(ws);
        }
        console.log('Client disconnected');
    });
});

function handleAuthRequest(ws, code) {
    const teamName = teamCodes[code];
    if (teamName) {
        const user = users.get(ws);
        if (user) {
            user.teamCode = code;
            ws.send(JSON.stringify({ type: 'auth-response', success: true, code, timestamp: getCurrentTime() }));
            handleJoinTeam(ws, code);
        }
    } else {
        ws.send(JSON.stringify({ type: 'auth-response', success: false, timestamp: getCurrentTime() }));
    }
}

function handleJoinTeam(ws, code) {
    const user = users.get(ws);
    if (user && user.teamCode === code) {
        let teamUsers = teamChannels.get(code) || new Set();
        teamChannels.set(code, teamUsers);
        teamUsers.add(ws);

        ws.send(JSON.stringify({
            type: 'system-message',
            text: `Joined team channel for ${teamCodes[code]}`,
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
        _rawTime: now // for cleanup only
    };

    // Store message history
    if (!messageHistory[channel]) {
        messageHistory[channel] = [];
    }
    messageHistory[channel].push(msg);
    if (messageHistory[channel].length > MAX_HISTORY) {
        messageHistory[channel].shift();
    }

    // Send to correct recipients
    if (channel === 'team' && user.teamCode) {
        teamChannels.get(user.teamCode)?.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(msg));
            }
        });
    } else if (channel === 'global') {
        broadcastMessage(msg);
    }
}

function sendHistory(ws, channel) {
    const history = messageHistory[channel] || [];
    ws.send(JSON.stringify({ type: 'chat-history', messages: history }));
}

function broadcastMessage(msg) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
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
    } else {
        teamChannels.get(channel)?.forEach(client => {
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