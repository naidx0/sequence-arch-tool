import { Router } from 'express';

export const paymentsRouter = Router();

paymentsRouter.get('/:id', async (req, res) => {
  const r = await fetch(`${process.env.PAYMENTS_URL}/payments/${req.params.id}`);
  res.json(await r.json());
});
