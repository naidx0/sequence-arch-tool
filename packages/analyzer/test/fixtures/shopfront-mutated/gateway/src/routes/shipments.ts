import { Router } from 'express';
import { getJson } from '../lib/http';

const SHIPPING_URL = process.env.SHIPPING_URL!;

export const shipmentsRouter = Router();

shipmentsRouter.get('/:id', async (req, res) => {
  const shipment = await getJson(`${SHIPPING_URL}/shipments/${req.params.id}`);
  res.json(shipment);
});
