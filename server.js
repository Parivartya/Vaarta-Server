const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for simplicity
    }
});

const rooms = {};

// Helper to generate a unique 6-digit room code
const generateRoomCode = () => {
    let code;
    do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (rooms[code]);
    return code;
};


io.on('connection', (socket) => {
    console.log(`[Connect] User connected with ID: ${socket.id}`);

    // Create a new room
    socket.on('create-room', () => {
        console.log(`[Request] Received 'create-room' request from ${socket.id}`);
        const roomCode = generateRoomCode();
        socket.join(roomCode);
        rooms[roomCode] = { users: [socket.id] };
        
        // FIX: Ensure the 'room-created' event is always emitted back
        socket.emit('room-created', roomCode);
        console.log(`[Success] Room ${roomCode} created for ${socket.id}. Sent code back.`);
    });

    // Join an existing room
    socket.on('join-room', (roomCode) => {
        console.log(`[Request] Received 'join-room' request from ${socket.id} for room ${roomCode}`);
        
        if (!rooms[roomCode]) {
            console.log(`[Error] Room ${roomCode} does not exist.`);
            return socket.emit('error-message', 'Room does not exist.');
        }
        if (rooms[roomCode].users.length >= 2) {
            console.log(`[Error] Room ${roomCode} is full.`);
            return socket.emit('error-message', 'Room is full.');
        }

        socket.join(roomCode);
        rooms[roomCode].users.push(socket.id);

        const otherUser = rooms[roomCode].users.find(id => id !== socket.id);
        
        console.log(`[Success] ${socket.id} joined room ${roomCode}. Notifying peer ${otherUser}.`);
        
        // Notify the original user (the creator) that a peer has joined
        io.to(otherUser).emit('peer-joined', { peerId: socket.id });
        
        // Confirm to the current user that they have joined
        socket.emit('room-joined', roomCode);
    });
    
    // Relay WebRTC signals
    socket.on('offer', (payload) => {
        console.log(`[Signal] Relaying 'offer' from ${socket.id} to ${payload.target}`);
        io.to(payload.target).emit('offer-received', { from: socket.id, offer: payload.offer });
    });

    socket.on('answer', (payload) => {
        console.log(`[Signal] Relaying 'answer' from ${socket.id} to ${payload.target}`);
        io.to(payload.target).emit('answer-received', { from: socket.id, answer: payload.answer });
    });

    socket.on('ice-candidate', (payload) => {
        // This can be very noisy, so we can comment it out for now
        // console.log(`[Signal] Relaying 'ice-candidate' from ${socket.id} to ${payload.target}`);
        io.to(payload.target).emit('ice-candidate-received', { from: socket.id, candidate: payload.candidate });
    });
    
    // Handle user disconnection
    socket.on('disconnect', () => {
        console.log(`[Disconnect] User disconnected: ${socket.id}`);
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const userIndex = room.users.indexOf(socket.id);

            if (userIndex !== -1) {
                console.log(`[Cleanup] Removing ${socket.id} from room ${roomCode}`);
                room.users.splice(userIndex, 1);

                if (room.users.length === 0) {
                    delete rooms[roomCode];
                    console.log(`[Cleanup] Room ${roomCode} is empty and has been deleted.`);
                } else {
                    const remainingUser = room.users[0];
                    console.log(`[Cleanup] Notifying remaining user ${remainingUser} that peer has left.`);
                    io.to(remainingUser).emit('peer-left');
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`✅ Vaarta Signaling Server is running on port ${PORT}`);
});