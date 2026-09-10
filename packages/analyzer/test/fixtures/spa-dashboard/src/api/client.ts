export async function fetchStats() {
  const res = await fetch('https://api.example.com/stats');
  return res.json();
}
