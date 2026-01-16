const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const db = require('./database');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'chess_secret_key_2026';

const games = new Map();
const onlineUsers = new Map();

function generateGameCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

app.get('/', (req, res) => {
  res.json({ 
    status: 'Chess Server Running',
    activeGames: games.size,
    onlineUsers: onlineUsers.size
  });
});

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  db.registerUser(username, password, (err) => {
    if (err) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    res.json({ success: true });
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  db.loginUser(username, password, (err, user) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, userId: user.id, username: user.username });
  });
});

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

io.on('connection', (socket) => {
  console.log('✅ Joueur connecté:', socket.id);
  
  socket.on('authenticate', ({ token }) => {
    const user = verifyToken(token);
    if (!user) {
      socket.emit('error', { message: 'Invalid token' });
      return;
    }
    
    socket.userId = user.id;
    socket.username = user.username;
    onlineUsers.set(user.id, { socketId: socket.id, username: user.username });
    
    io.emit('onlineUsers', Array.from(onlineUsers.values()));
    console.log(`🔐 ${user.username} authentifié`);
  });

  socket.on('getFriends', () => {
    if (!socket.userId) return;
    
    db.getFriends(socket.userId, (err, friends) => {
      if (err) return socket.emit('error', { message: 'Could not fetch friends' });
      
      const friendsWithStatus = friends.map(f => ({
        ...f,
        online: onlineUsers.has(f.id)
      }));
      
      socket.emit('friendsList', friendsWithStatus);
    });
  });

  socket.on('addFriend', ({ username }) => {
    if (!socket.userId) return;
    
    db.searchUser(username, (err, user) => {
      if (err || !user) {
        return socket.emit('error', { message: 'User not found' });
      }
      
      if (user.id === socket.userId) {
        return socket.emit('error', { message: 'Cannot add yourself' });
      }
      
      db.sendFriendRequest(socket.userId, user.id, (err) => {
        if (err) {
          return socket.emit('error', { message: 'Friend request failed' });
        }
        
        socket.emit('success', { message: 'Friend request sent' });
        
        const targetSocket = onlineUsers.get(user.id);
        if (targetSocket) {
          io.to(targetSocket.socketId).emit('friendRequest', {
            from: socket.username,
            userId: socket.userId
          });
        }
      });
    });
  });

  socket.on('getFriendRequests', () => {
    if (!socket.userId) return;
    
    db.getFriendRequests(socket.userId, (err, requests) => {
      if (err) return socket.emit('error', { message: 'Could not fetch requests' });
      socket.emit('friendRequests', requests);
    });
  });

  socket.on('acceptFriendRequest', ({ requestId }) => {
    if (!socket.userId) return;
    
    db.acceptFriendRequest(requestId, (err) => {
      if (err) return socket.emit('error', { message: 'Could not accept request' });
      socket.emit('success', { message: 'Friend request accepted' });
    });
  });

  socket.on('rejectFriendRequest', ({ requestId }) => {
    if (!socket.userId) return;
    
    db.rejectFriendRequest(requestId, (err) => {
      if (err) return socket.emit('error', { message: 'Could not reject request' });
      socket.emit('success', { message: 'Friend request rejected' });
    });
  });

  socket.on('inviteFriend', ({ friendId }) => {
    if (!socket.userId) return;
    
    const gameCode = generateGameCode();
    games.set(gameCode, {
      players: [socket.id],
      creator: socket.userId,
      invited: friendId,
      gameState: null,
      createdAt: Date.now()
    });
    
    socket.join(gameCode);
    socket.gameCode = gameCode;
    socket.emit('gameCreated', { gameCode });
    
    db.sendGameInvitation(socket.userId, friendId, gameCode, (err) => {
      if (err) return;
      
      const friendSocket = onlineUsers.get(friendId);
      if (friendSocket) {
        io.to(friendSocket.socketId).emit('gameInvitation', {
          from: socket.username,
          gameCode: gameCode
        });
      }
    });
    
    console.log(`🎮 Invitation envoyée: ${gameCode}`);
  });

  socket.on('getInvitations', () => {
    if (!socket.userId) return;
    
    db.getInvitations(socket.userId, (err, invitations) => {
      if (err) return socket.emit('error', { message: 'Could not fetch invitations' });
      socket.emit('invitationsList', invitations);
    });
  });

  socket.on('acceptInvitation', ({ gameCode }) => {
    const game = games.get(gameCode);
    
    if (!game) {
      socket.emit('error', { message: 'Game not found' });
      return;
    }
    
    if (game.players.length >= 2) {
      socket.emit('error', { message: 'Game full' });
      return;
    }
    
    game.players.push(socket.id);
    socket.join(gameCode);
    socket.gameCode = gameCode;
    socket.emit('gameJoined', { gameCode, color: 'black' });
    socket.to(gameCode).emit('opponentJoined', {});
    
    console.log(`👥 Invitation acceptée: ${gameCode}`);
  });

  socket.on('createGame', () => {
    const gameCode = generateGameCode();
    games.set(gameCode, {
      players: [socket.id],
      gameState: null,
      createdAt: Date.now()
    });
    
    socket.join(gameCode);
    socket.gameCode = gameCode;
    socket.emit('gameCreated', { gameCode, color: 'white' });
    console.log(`🎮 Partie créée: ${gameCode}`);
  });
  
  socket.on('joinGame', ({ gameCode }) => {
    const game = games.get(gameCode);
    
    if (!game) {
      socket.emit('error', { message: 'Partie introuvable' });
      return;
    }
    
    if (game.players.length >= 2) {
      socket.emit('error', { message: 'Partie complète' });
      return;
    }
    
    game.players.push(socket.id);
    socket.join(gameCode);
    socket.gameCode = gameCode;
    socket.emit('gameJoined', { gameCode, color: 'black' });
    socket.to(gameCode).emit('opponentJoined', {});
    
    console.log(`👥 Joueur a rejoint: ${gameCode}`);
  });
  
  socket.on('move', (data) => {
    console.log(`♟️ Coup joué dans: ${data.gameCode}`);
    socket.to(data.gameCode).emit('move', data);
  });
  
  socket.on('disconnect', () => {
    console.log('❌ Joueur déconnecté:', socket.id);
    
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      io.emit('onlineUsers', Array.from(onlineUsers.values()));
    }
    
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
