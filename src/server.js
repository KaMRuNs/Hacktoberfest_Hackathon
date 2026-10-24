import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import { Server } from 'socket.io';
import { config } from './config.js';
import { q } from './db.js';
import { status as ollamaStatus } from './services/ollama.js';
import { queueSize } from './services/queue.js';
import examsRoutes from './routes/exams.routes.js';
import framesRoutes from './routes/frames.routes.js';
import flagsRoutes from './routes/flags.routes.js';

fs.mkdirSync(config.storageDir, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '5mb' }));
app.use(express.static('public'));
app.use('/frames', express.static(config.storageDir));

app.get('/health', async (req, res) => {
  try {
    const ollama = await ollamaStatus();
    res.json({ success: true, ollama, models: config.models, secondOpinion: config.secondOpinion, queue: queueSize() });
  } catch {
    res.status(503).json({ success: false, message: 'Ollama is not reachable' });
  }
});
app.get('/api/config', (req, res) => res.json({ success: true, capture: config.capture }));

app.use('/api/exams', examsRoutes(io));
app.use('/api/frames', framesRoutes(io));
app.use('/api/flags', flagsRoutes(io));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Server error' });
});

io.on('connection', (socket) => {
  socket.on('examiner:watch', (examId) => socket.join(`exam:${examId}`));

  socket.on('student:hello', (studentId) => {
    const student = q.studentById.get(studentId);
    if (!student) return;
    socket.data.student = student;
    io.to(`exam:${student.exam_id}`).emit('student:status', { studentId: student.id, status: 'sharing' });
  });

  socket.on('student:sharing', (sharing) => {
    const student = socket.data.student;
    if (!student) return;
    io.to(`exam:${student.exam_id}`).emit('student:status', { studentId: student.id, status: sharing ? 'sharing' : 'stopped' });
  });

  socket.on('disconnect', () => {
    const student = socket.data.student;
    if (student) io.to(`exam:${student.exam_id}`).emit('student:status', { studentId: student.id, status: 'offline' });
  });
});

server.listen(config.port, () => {
  console.log(`FairLens on http://localhost:${config.port}`);
  console.log(`Triage model: ${config.models.triage} | second opinion: ${config.secondOpinion ? config.models.confirm : 'off'}`);
});
