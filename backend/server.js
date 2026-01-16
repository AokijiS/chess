const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

const games = new Map();

function generateGameCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

app.get('/', (req, res) => {
    res.json({ 
        status: 'Chess Server Running',
        activeGames: games.size
    });
});

io.on('connection', (socket) => {
    console.log('✅ Joueur connecté:', socket.id);
    
    socket.on('createGame', () => {
        const gameCode = generateGameCode();
        games.set(gameCode, {
            players: [socket.id],
            gameState: null,
            createdAt: Date.now()
        });
        socket.join(gameCode);
        socket.emit('gameCreated', { gameCode });
        console.log(`🎮 Partie créée: ${gameCode}`);
    });
    
    socket.on('joinGame', ({ gameCode }) => {
        const game = games.get(gameCode);
        
        if (!game) {
            socket.emit('error', { message: 'Partie introuvable' });
            console.log(`❌ Partie introuvable: ${gameCode}`);
            return;
        }
        
        if (game.players.length >= 2) {
            socket.emit('error', { message: 'Partie complète' });
            console.log(`❌ Partie complète: ${gameCode}`);
            return;
        }
        
        game.players.push(socket.id);
        socket.join(gameCode);
        socket.emit('gameJoined', { gameCode });
        socket.to(gameCode).emit('opponentJoined', {});
        console.log(`👥 Joueur a rejoint: ${gameCode}`);
    });
    
    socket.on('move', (data) => {
        console.log(`♟️ Coup joué dans: ${data.gameCode}`);
        socket.to(data.gameCode).emit('move', data);
    });
    
    socket.on('disconnect', () => {
        console.log('❌ Joueur déconnecté:', socket.id);
        
        games.forEach((game, code) => {
            if (game.players.includes(socket.id)) {
                io.to(code).emit('gameEnd', { 
                    message: 'Adversaire déconnecté' 
                });
                games.delete(code);
                console.log(`🗑️ Partie supprimée: ${code}`);
            }
        });
    });
});

setInterval(() => {
    const now = Date.now();
    games.forEach((game, code) => {
        if (now - game.createdAt > 3600000) {
            games.delete(code);
            console.log(`⏰ Partie expirée: ${code}`);
        }
    });
}, 300000);

server.listen(PORT, () => {
    console.log(`🚀 Serveur démarré sur le port ${PORT}`);
});
