import { Header } from './components/Header';
import { fetchStats } from './api/client';

export function App() {
  fetchStats();
  return <Header title="Dashboard" />;
}
