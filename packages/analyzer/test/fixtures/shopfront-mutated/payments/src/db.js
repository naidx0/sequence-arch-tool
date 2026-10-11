const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function insertPayment(orderId, amount, chargeId) {
  const r = await pool.query(
    'INSERT INTO payments (order_id, amount, charge_id) VALUES ($1, $2, $3) RETURNING *',
    [orderId, amount, chargeId]
  );
  return r.rows[0];
}

async function getPayment(id) {
  const r = await pool.query('SELECT * FROM payments WHERE id = $1', [id]);
  return r.rows[0];
}

// shared-table coupling: payments reads the orders table owned by the orders service
async function getOrderTotal(orderId) {
  const r = await pool.query('SELECT total FROM orders WHERE id = $1', [orderId]);
  return r.rows[0] ? Number(r.rows[0].total) : null;
}

module.exports = { insertPayment, getPayment, getOrderTotal };
