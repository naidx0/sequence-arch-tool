import { useEffect, useState } from 'react';

export function useOrders() {
  const [orders, setOrders] = useState<{ id: number; total: number }[]>([]);
  useEffect(() => {
    fetch('/orders')
      .then((r) => r.json())
      .then(setOrders);
  }, []);
  return orders;
}
