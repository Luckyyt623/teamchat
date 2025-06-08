const WebSocket = require('ws');
const http = require('http');
const server = http.createServer();
const wss = new WebSocket.Server({ server });

// Mock team codes (in production, store in a secure database)
const teamCodes = {
    '[hekbaivskabHaibak]': 'REKT',
    '[xyz123abcDEF456]': 'ELITE' // Add more teams as needed
};

// Track connected users and their team affiliations
const users = new Map();
const teamChannels = new Map(); // Map of team codes to user sets

wss.on('connection', (ws) => {
    console.log('New client connected');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'user-join':
                    users.set(ws, { username: data.username, teamCode: null });
                    broadcastSystemMessage(`[${data.username}] joined the chat.`);
                    break;

                case 'auth-request':
                    handleAuthRequest(ws, data.code);
                    break;

                case 'join-team':
                    handleJoinTeam(ws, data.code);
                    break;

                case 'chat-message':
                    handleChatMessage(ws, data.text, data.channel);
                    break;

                case 'get-history':
                    sendHistory(ws, data.channel);
                    break;

                default:
                    console.log('Unknown message type:', data.type);
            }
        } catch (e) {
            console.error('Error parsing message:', e);
            ws.send(JSON.stringify({ type: 'system-message', text: 'Error processing your request.' }));
        }
    });

    ws.on('close', () => {
        const user = users.get(ws);
        if (user) {
            broadcastSystemMessage(`[${user.username}] left the chat.`);
            if (user.teamCode) {
                const teamUsers = teamChannels.get(user.teamCode);
                if (teamUsers) teamUsers.delete(ws);
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
            ws.send(JSON.stringify({ type: 'auth-response', success: true, code }));
            console.log(`User ${user.username} authenticated for team ${teamName}`);
        }
    } else {
        ws.send(JSON.stringify({ type: 'auth-response', success: false }));
        console.log('Invalid team code attempt');
    }
}

function handleJoinTeam(ws, code) {
    const user = users.get(ws);
    if (user && user.teamCode === code) {
        let teamUsers = teamChannels.get(code);
        if (!teamUsers) {
            teamUsers = new Set();
            teamChannels.set(code, teamUsers);
        }
        teamUsers.add(ws);
        ws.send(JSON.stringify({ type: 'system-message', text: `Joined team channel for ${teamCodes[code]}.` }));
        console.log(`${user.username} joined team ${teamCodes[code]}`);
    }
}

function handleChatMessage(ws, text, channel) {
    const user = users.get(ws);
    if (user) {
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const messageData = {
            type: 'chat-message',
            username: user.username,
            text,
            timestamp,
            channel
        };

        if (channel === 'team' && user.teamCode) {
            const teamUsers = teamChannels.get(user.teamCode);
            if (teamUsers) {
                teamUsers.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(messageData));
                    }
                });
            }
        } else if (channel === 'global') {
            broadcastMessage(messageData);
        }
    }
}

function sendHistory(ws, channel) {
    // Mock history (in production, fetch from a database)
    const history = [
        { username: 'System', text: 'Welcome to the chat!', timestamp: '12:00', channel: 'global' }
    ];
    ws.send(JSON.stringify({ type: 'chat-history', messages: history.filter(msg => msg.channel === channel) }));
}

function broadcastMessage(messageData) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(messageData));
        }
    });
}

function broadcastSystemMessage(text) {
    const messageData = {
        type: 'system-message',
        text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(messageData));
        }
    });
}

// Start the server on port 8080 (change as needed)
server.listen(8080, () => {
    console.log('WebSocket server running on ws://localhost:8080');
});