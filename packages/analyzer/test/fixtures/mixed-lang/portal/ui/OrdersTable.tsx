import { formatTotal } from './format';

export function OrdersTable({ orders }: { orders: { id: number; total: number }[] }) {
  return (
    <table>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id}>
            <td>{formatTotal(o.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
