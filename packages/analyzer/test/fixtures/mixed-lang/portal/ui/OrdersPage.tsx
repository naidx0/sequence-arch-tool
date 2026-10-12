import { useOrders } from './useOrders';

export function OrdersPage() {
  const orders = useOrders();
  return (
    <ul>
      {orders.map((o) => (
        <li key={o.id}>{o.total}</li>
      ))}
    </ul>
  );
}
