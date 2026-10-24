import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { q } from '../db.js';

const CreateExam = z.object({
  title: z.string().trim().min(1).max(120),
  durationMin: z.coerce.number().int().min(1).max(600).default(60),
});
const JoinExam = z.object({ name: z.string().trim().min(1).max(80) });

export default function examsRoutes(io) {
  const router = Router();

  router.post('/', (req, res) => {
    const body = CreateExam.safeParse(req.body);
    if (!body.success) return res.status(400).json({ success: false, message: 'Title is required' });
    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    const { lastInsertRowid } = q.createExam.run(code, body.data.title, body.data.durationMin);
    res.status(201).json({ success: true, exam: q.examById.get(lastInsertRowid) });
  });

  router.get('/:id', (req, res) => {
    const exam = q.examById.get(req.params.id);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });
    res.json({
      success: true,
      exam,
      students: q.studentsByExam.all(exam.id),
      flags: q.flagsByExam.all(exam.id),
      results: q.resultsByExam.all(exam.id, 50),
    });
  });

  router.post('/:code/join', (req, res) => {
    const exam = q.examByCode.get(req.params.code.toUpperCase());
    if (!exam || exam.status !== 'running') {
      return res.status(404).json({ success: false, message: 'No running exam with that code' });
    }
    const body = JoinExam.safeParse(req.body);
    if (!body.success) return res.status(400).json({ success: false, message: 'Name is required' });
    const { lastInsertRowid } = q.createStudent.run(exam.id, body.data.name);
    const student = q.studentById.get(lastInsertRowid);
    io.to(`exam:${exam.id}`).emit('student:joined', student);
    res.status(201).json({ success: true, exam, student });
  });

  router.post('/:id/end', (req, res) => {
    const exam = q.examById.get(req.params.id);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });
    q.setExamStatus.run('ended', exam.id);
    io.to(`exam:${exam.id}`).emit('exam:ended', { examId: exam.id });
    res.json({ success: true });
  });

  return router;
}
