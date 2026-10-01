import express from 'express';

const app = express();
app.use(express.json());

// GET /tickets/:id — proxied to the api service (http edge gateway -> api, GET /tickets/*)
app.get('/tickets/:id', async (req, res) => {
  const p1 = req.params.id;
  const r = await fetch(`${process.env.API_URL}/tickets/${p1}`);
  const ticket = await r.json();
  res.json(ticket);
});

// POST /tickets — proxied to the api service (http edge gateway -> api, POST /tickets)
app.post('/tickets', async (req, res) => {
  const payload = req.body;
  const r = await fetch(`${process.env.API_URL}/tickets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const created = await r.json();
  res.status(201).json(created);
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(3000);
