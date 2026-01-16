const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const db = new sqlite3.Database('./chess.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    createdAt INTEGER DEFAULT (strftime('%s', 'now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    friendId INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    createdAt INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY(userId) REFERENCES users(id),
    FOREIGN KEY(friendId) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fromUserId INTEGER NOT NULL,
    toUserId INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    gameCode TEXT,
    createdAt INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY(fromUserId) REFERENCES users(id),
    FOREIGN KEY(toUserId) REFERENCES users(id)
  )`);
});

module.exports = {
  registerUser: (username, password, callback) => {
    bcrypt.hash(password, 10, (err, hash) => {
      if (err) return callback(err);
      db.run('INSERT INTO users (username, password) VALUES (?, ?)', 
        [username, hash], callback);
    });
  },

  loginUser: (username, password, callback) => {
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
      if (err || !user) return callback(err || new Error('User not found'));
      bcrypt.compare(password, user.password, (err, valid) => {
        if (err || !valid) return callback(err || new Error('Invalid password'));
        callback(null, user);
      });
    });
  },

  getUserById: (id, callback) => {
    db.get('SELECT id, username FROM users WHERE id = ?', [id], callback);
  },

  searchUser: (username, callback) => {
    db.get('SELECT id, username FROM users WHERE username = ?', [username], callback);
  },

  sendFriendRequest: (userId, friendId, callback) => {
    db.run('INSERT INTO friends (userId, friendId, status) VALUES (?, ?, "pending")', 
      [userId, friendId], callback);
  },

  getFriendRequests: (userId, callback) => {
    db.all(`SELECT f.id, u.id as userId, u.username, f.status 
      FROM friends f JOIN users u ON f.userId = u.id 
      WHERE f.friendId = ? AND f.status = 'pending'`, [userId], callback);
  },

  acceptFriendRequest: (requestId, callback) => {
    db.run('UPDATE friends SET status = "accepted" WHERE id = ?', [requestId], callback);
  },

  rejectFriendRequest: (requestId, callback) => {
    db.run('DELETE FROM friends WHERE id = ?', [requestId], callback);
  },

  getFriends: (userId, callback) => {
    db.all(`SELECT u.id, u.username FROM users u 
      WHERE u.id IN (
        SELECT friendId FROM friends WHERE userId = ? AND status = 'accepted'
        UNION
        SELECT userId FROM friends WHERE friendId = ? AND status = 'accepted'
      )`, [userId, userId], callback);
  },

  sendGameInvitation: (fromUserId, toUserId, gameCode, callback) => {
    db.run('INSERT INTO invitations (fromUserId, toUserId, gameCode) VALUES (?, ?, ?)', 
      [fromUserId, toUserId, gameCode], callback);
  },

  getInvitations: (userId, callback) => {
    db.all(`SELECT i.id, u.username as fromUsername, i.gameCode, i.createdAt 
      FROM invitations i JOIN users u ON i.fromUserId = u.id 
      WHERE i.toUserId = ? AND i.status = 'pending'`, [userId], callback);
  },

  acceptInvitation: (invitationId, callback) => {
    db.run('UPDATE invitations SET status = "accepted" WHERE id = ?', [invitationId], callback);
  },

  rejectInvitation: (invitationId, callback) => {
    db.run('DELETE FROM invitations WHERE id = ?', [invitationId], callback);
  }
};
