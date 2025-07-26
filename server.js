const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Team codes, author keys, and their associated usernames
const teamCodes = {
    '[REKT]': { code: 'REKT', authorKey: 'authorKeyREKT', username: 'REKT_Member' },
    '[SMT]': { code: 'SMT', authorKey: 'authorKeySMT', username: 'SMT_Member' }
};

const users = new Map(); // WebSocket -> { globalUsername, teamCode, teamUsername, joined }
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
    console.log('New WebSocket connection established.');
    users.set(ws, { globalUsername: null, teamCode: null, teamUsername: null, joined: false });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const user = users.get(ws);
            console.log('Received message:', data);

            switch (data.type) {
                case 'user-join':
                    user.joined = true;
                    if (data.authorKey) {
                        let found = false;
                        for (const code in teamCodes) {
                            if (teamCodes[code].authorKey === data.authorKey) {
                                user.teamUsername = teamCodes[code].username;
                                console.log(`Set teamUsername to ${user.teamUsername} for authorKey ${data.authorKey}`);
                                found = true;
                                break;
                            }
                        }
                        if (!found) {
                            ws.send(JSON.stringify({ 
                                type: 'system-message', 
                                text: 'Invalid author key for team chat.', 
                                timestamp: getCurrentTime() 
                            }));
                        }
                    } else if (data.username) {
                        user.globalUsername = data.username || 'AnonymousSnake';
                        console.log(`Set globalUsername to ${user.globalUsername}`);
                        broadcastSystemMessage(`[${user.globalUsername}] joined the chat.`, 'global');
                        sendHistory(ws, 'global');
                    }
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
            console.error("Error processing message:", e, message);
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
            if (user.globalUsername) {
                broadcastSystemMessage(`[${user.globalUsername}] left the chat.`, 'global');
            }
            if (user.teamCode && user.teamUsername) {
                broadcastSystemMessage(`[${user.teamUsername}] left the team chat.`, user.teamCode);
                teamChannels.get(user.teamCode)?.delete(ws);
            }
            users.delete(ws);
            console.log('WebSocket connection closed.');
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

function handleJoinTeam(ws, code, authorKey) {
    const user = users.get(ws);
    if (!user || !user.joined) {
        console.log('Join team failed: User not joined.');
        return;
    }

    if (teamCodes[code] && teamCodes[code].authorKey === authorKey) {
        user.teamCode = code;
        user.teamUsername = teamCodes[code].username;
        console.log(`Joined team ${code} with teamUsername ${user.teamUsername}`);
        let teamUsers = teamChannels.get(code) || new Set();
        teamChannels.set(code, teamUsers);
        if (!teamUsers.has(ws)) {
            teamUsers.add(ws);
        }
        ws.send(JSON.stringify({
            type: 'system-message',
            text: `Joined team channel for ${teamCodes[code].code} as ${user.teamUsername}`,
            timestamp: getCurrentTime()
        }));
        sendHistory(ws, code);
    } else {
        console.log(`Join team failed: Invalid ${teamCodes[code] ? 'author key' : 'team code'} for code ${code}, authorKey ${authorKey}`);
        ws.send(JSON.stringify({
            type: 'system-message',
            text: teamCodes[code] ? 'Invalid author key.' : 'Invalid team code.',
            timestamp: getCurrentTime()
        }));
    }
}

function handleChatMessage(ws, text, channel) {
    const user = users.get(ws);
    const username = channel === 'global' ? user.globalUsername : user.teamUsername;
    if (!username) {
        ws.send(JSON.stringify({
            type: 'system-message',
            text: 'Username not set for this channel.',
            timestamp: getCurrentTime()
        }));
        console.log(`Chat message failed: Username not set for channel ${channel}`);
        return;
    }

    const now = Date.now();
    const msg = {
        type: 'chat-message',
        username,
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
        console.log(`Broadcasting global message: ${username}: ${text}`);
        broadcastMessage(msg);
    } else if (user.teamCode && teamChannels.get(user.teamCode)) {
        console.log(`Broadcasting team message to ${user.teamCode}: ${username}: ${text}`);
        teamChannels.get(user.teamCode).forEach(client => {
            if (client.readyState === WebSocket.OPEN && !client._sentMessages?.has(msg._rawTime)) {
                client._sentMessages = client._sentMessages || new Set();
                client._sentMessages.add(msg._rawTime);
                client.send(JSON.stringify(msg));
            }
        });
    }
}

function sendHistory(ws, channel) {
    const history = messageHistory[channel] || [];
    ws._sentMessages = new Set(); // Reset sent messages for history
    ws.send(JSON.stringify({ type: 'chat-history', messages: history }));
    console.log(`Sent history for channel ${channel} to client.`);
}

function broadcastMessage(msg) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && users.get(client)?.joined) {
            if (!client._sentMessages?.has(msg._rawTime)) {
                client._sentMessages = client._sentMessages || new Set();
                client._sentMessages.add(msg._rawTime);
                client.send(JSON.stringify(msg));
            }
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
        console.log(`Broadcasting global system message: ${text}`);
        broadcastMessage(msg);
    } else if (teamChannels.get(channel)) {
        console.log(`Broadcasting team system message to ${channel}: ${text}`);
        teamChannels.get(channel).forEach(client => {
            if (client.readyState === WebSocket.OPEN && !client._sentMessages?.has(msg._rawTime)) {
                client._sentMessages = client._sentMessages || new Set();
                client._sentMessages.add(msg._rawTime);
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