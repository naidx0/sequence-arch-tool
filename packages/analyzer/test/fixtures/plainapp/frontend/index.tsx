import next from 'next';

// A tiny Next.js-style frontend that fetches from the backend service.
// The `next` import marks this as a frontend service to the scanner/explain layer.
export async function loadNotes() {
  // GET /notes — proxied to the backend service (http edge frontend -> backend)
  const r = await fetch(`${process.env.API_URL}/notes`);
  return r.json();
}

export default function App() {
  return next;
}
