// trap: external third-party API call — must NOT become an internal service edge
async function createStripeCharge(amount) {
  const r = await fetch('https://api.stripe.com/v1/charges', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.STRIPE_KEY}` },
    body: new URLSearchParams({ amount: String(amount), currency: 'usd' }),
  });
  return r.json();
}

module.exports = { createStripeCharge };
