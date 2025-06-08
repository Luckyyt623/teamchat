const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Mock team codes (in production, store in a secure database)
const teamCodes = {
    '[REKT]': 'REKT',
    '[SMT]': 'SMT' // Add more teams as needed
};

// Track connected users and their team affiliations
const users = new Map();
const teamChannels = new Map(); // Map of team codes to user sets

// HTTP GET route for health check
app.get('/', (req, res) => {
    res.send('Slither Team Chat Server is running!');
});

// WebSocket handling
wss.on('connection', (ws) => {
    console.log('New client connected at 11:11 AM IST, Sunday, June 08, 2025');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received message:', data.type, data);

            switch (data.type) {
                case 'user-join':
                    ws.username = data.username || 'AnonymousSnake'; // Set username on WebSocket object
                    users.set(ws, { username: ws.username, teamCode: null });
                    broadcastSystemMessage(`[${ws.username}] joined the chat.`);
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
            user.teamCode = code; // Update teamCode immediately
            ws.send(JSON.stringify({ type: 'auth-response', success: true, code }));
            console.log(`User ${user.username} authenticated for team ${teamName}`);
            // Automatically join the team after authentication
            handleJoinTeam(ws, code);
        }
    } else {
        ws.send(JSON.stringify({ type: 'auth-response', success: false }));
        console.log('Invalid team code attempt:', code);
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
        if (!teamUsers.has(ws)) {
            teamUsers.add(ws);
            ws.send(JSON.stringify({ type: 'system-message', text: `Joined team channel for ${teamCodes[code]}.` }));
            console.log(`${user.username} joined team ${teamCodes[code]}`);
        } else {
            console.log(`${user.username} already in team ${teamCodes[code]}`);
        }
    } else {
        console.log(`Join team failed for ${user?.username}: Invalid or unmatched team code ${code}`);
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

// Start the server
server.listen(PORT, () => {
    console.log(`WebSocket server running on ws://0.0.0.0:${PORT} at 11:11 AM IST, Sunday, June 08, 2025`);
});