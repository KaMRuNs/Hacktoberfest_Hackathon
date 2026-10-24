import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { handleFrame } from '../services/frames.js';

const Frame = z.object({
  studentId: z.coerce.number().int(),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  image: z.string().startsWith('data:image/jpeg;base64,'),
});

export default function framesRoutes(io) {
  const router = Router();

  router.post('/', async (req, res) => {
    const body = Frame.safeParse(req.body);
    if (!body.success) return res.status(400).json({ success: false, message: 'Invalid frame' });
    const student = q.studentById.get(body.data.studentId);
    const exam = student && q.examById.get(student.exam_id);
    if (!exam || exam.status !== 'running') {
      return res.status(409).json({ success: false, message: 'Exam is not running' });
    }
    const imageBase64 = body.data.image.slice('data:image/jpeg;base64,'.length);
    const { source } = await handleFrame(io, student, { hash: body.data.hash, imageBase64 });
    res.json({ success: true, source });
  });

  return router;
}
