import express from 'express';
import { invoicesRouter } from './routes/invoices';
import { ordersRouter } from './routes/orders';
import { paymentsRouter } from './routes/payments';
import { shipmentsRouter } from './routes/shipments';

const app = express();
app.use(express.json());

app.use('/api/orders', ordersRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/shipments', shipmentsRouter);
app.use('/api/invoices', invoicesRouter);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(3000, () => console.log('gateway on :3000'));
