import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db.js';

const Review = z.object({ status: z.enum(['confirmed', 'dismissed', 'pending']) });

export default function flagsRoutes(io) {
  const router = Router();

  router.patch('/:id', (req, res) => {
    const body = Review.safeParse(req.body);
    if (!body.success) return res.status(400).json({ success: false, message: 'Invalid status' });
    if (!q.flagById.get(req.params.id)) return res.status(404).json({ success: false, message: 'Flag not found' });
    q.setFlagStatus.run(body.data.status, req.params.id);
    const flag = q.flagById.get(req.params.id);
    io.to(`exam:${flag.exam_id}`).emit('flag:update', flag);
    res.json({ success: true, flag });
  });

  return router;
}
