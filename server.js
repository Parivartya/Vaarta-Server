const io = require("socket.io")(process.env.PORT || 3000, {
  cors: { origin: "*" },
});

// Maps to keep track of connections
const users = {}; // Key: User_ID (VAARTA-XXXX), Value: Socket_ID
const rooms = {}; // Key: 6-digit Room_ID, Value: Array of Socket_IDs

console.log("Vaarta Signaling Server started...");

io.on("connection", (socket) => {
  console.log("New Socket Connected:", socket.id);

  // --- PHASE 1 & 2: IDENTITY REGISTRATION ---
  socket.on("register-user", (data) => {
    // Map the permanent User ID to the current temporary Socket ID
    users[data.userId] = socket.id;
    socket.myUserId = data.userId; // Store on socket object for easy access
    console.log(
      `User Registered: ${data.userId} is now on Socket: ${socket.id}`,
    );
  });
  socket.on("add-friend-request", (data) => {
    const targetSocketId = users[data.targetUserId];
    if (targetSocketId) {
      // Notify the target that they have been added as a friend
      io.to(targetSocketId).emit("friend-added-notify", {
        newFriendId: socket.myUserId,
      });
      console.log(
        `${socket.myUserId} added ${data.targetUserId} as friend (Mutual)`,
      );
    }
  });

  // --- PHASE 1: QUICK SESSION CODE (6-DIGITS) ---
  socket.on("create-room", () => {
    const roomCode = Math.floor(100000 + Math.random() * 900000).toString();
    rooms[roomCode] = [socket.id];
    socket.join(roomCode);

    // Tell the creator they are in the room
    socket.emit("room-joined", { roomCode });
    updateRoomMembers(roomCode);
    console.log(`Room Created: ${roomCode} by ${socket.myUserId}`);
  });

  socket.on("join-room", (roomCode) => {
    if (rooms[roomCode]) {
      if (!rooms[roomCode].includes(socket.id)) {
        rooms[roomCode].push(socket.id);
      }
      socket.join(roomCode);
      socket.emit("room-joined", { roomCode });

      // Notify other peers in the room that a new person joined
      socket.to(roomCode).emit("peer-joined", { peerId: socket.id });
      updateRoomMembers(roomCode);
      console.log(`User ${socket.myUserId} joined Room: ${roomCode}`);
    } else {
      socket.emit("error-message", "Room not found. Check the code.");
    }
  });

  // ... inside your io.on("connection", (socket) => { ...

  socket.on("send-invite", (data) => {
    const targetSocketId = users[data.targetUserId];

    if (targetSocketId) {
      // IMPROVEMENT: Use the room code provided by the sender, 
      // otherwise generate a new one (for home-screen invites)
      const roomCode = data.roomCode || Math.floor(100000 + Math.random() * 900000).toString();

      // If sender isn't in a room yet, they should join this one
      if (!data.roomCode) {
        socket.join(roomCode);
        rooms[roomCode] = [socket.id];
        socket.emit("room-joined", { roomCode });
      }

      io.to(targetSocketId).emit("receive-invite", {
        fromUserId: socket.myUserId,
        roomCode: roomCode
      });
    } else {
      socket.emit("error-message", "User is offline.");
    }
  });

  socket.on("decline-invite", (data) => {
    const targetSocketId = users[data.targetUserId];
    if (targetSocketId) {
      io.to(targetSocketId).emit("invite-declined", {
        userId: socket.myUserId,
      });
    }
  });

  // --- PHASE 3: ROOM MEMBER UPDATES ---
  function updateRoomMembers(roomCode) {
    if (rooms[roomCode]) {
      const memberList = rooms[roomCode].map((sid) => {
        const s = io.sockets.sockets.get(sid);
        return {
          userId: s ? s.myUserId : "Offline User",
          socketId: sid,
        };
      });
      // Send the list of everyone in the room to everyone in the room
      io.to(roomCode).emit("room-update", { members: memberList });
    }
  }

  // --- WebRTC SIGNALING (PASSTHROUGH) ---
  socket.on("offer", (payload) => {
    io.to(payload.target).emit("offer-received", {
      from: socket.id,
      offer: payload.offer,
    });
  });

  socket.on("answer", (payload) => {
    io.to(payload.target).emit("answer-received", {
      from: socket.id,
      answer: payload.answer,
    });
  });

  socket.on("ice-candidate", (payload) => {
    io.to(payload.target).emit("ice-candidate-received", {
      from: socket.id,
      candidate: payload.candidate,
    });
  });

  // --- DISCONNECT LOGIC ---
  socket.on("disconnect", () => {
    console.log("User Disconnected:", socket.id);

    // Remove from the users identity map
    if (socket.myUserId) {
      delete users[socket.myUserId];
    }

    // Remove from any active rooms
    for (const roomCode in rooms) {
      rooms[roomCode] = rooms[roomCode].filter((sid) => sid !== socket.id);
      if (rooms[roomCode].length === 0) {
        delete rooms[roomCode];
      } else {
        updateRoomMembers(roomCode);
      }
    }
  });
});
