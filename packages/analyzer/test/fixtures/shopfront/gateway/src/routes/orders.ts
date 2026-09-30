import { Router } from 'express';
import { getJson, postJson } from '../lib/http';

const ORDERS_URL = process.env.ORDERS_URL!;

export const ordersRouter = Router();

ordersRouter.get('/:id', async (req, res) => {
  const order = await getJson(`${ORDERS_URL}/orders/${req.params.id}`);
  res.json(order);
});

ordersRouter.post('/', async (req, res) => {
  const created = await postJson(`${ORDERS_URL}/orders`, req.body);
  res.status(201).json(created);
});
