const express = require('express');
const { insertPayment, getPayment, getOrderTotal } = require('./db');
const { createStripeCharge } = require('./stripe');

const app = express();
app.use(express.json());

app.post('/charge', async (req, res) => {
  const { order_id: orderId, amount } = req.body;
  const expected = await getOrderTotal(orderId);
  if (expected !== amount) {
    return res.status(422).json({ error: 'amount mismatch' });
  }
  const charge = await createStripeCharge(amount);
  const payment = await insertPayment(orderId, amount, charge.id);
  res.status(201).json(payment);
});

app.get('/payments/:id', async (req, res) => {
  const payment = await getPayment(req.params.id);
  if (!payment) return res.status(404).end();
  res.json(payment);
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(4000, () => console.log('payments on :4000'));
