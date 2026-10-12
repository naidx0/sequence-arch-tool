import { Router } from 'express';
import { getJson } from '../lib/http';

const INVOICES_URL = process.env.INVOICES_URL!;

export const invoicesRouter = Router();

invoicesRouter.get('/:id', async (req, res) => {
  const invoice = await getJson(`${INVOICES_URL}/invoices/${req.params.id}`);
  res.json(invoice);
});
