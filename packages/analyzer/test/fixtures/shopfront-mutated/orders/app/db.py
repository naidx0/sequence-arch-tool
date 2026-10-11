import os

from sqlalchemy import create_engine, text

engine = create_engine(os.environ["DATABASE_URL"])


def get_order(order_id: int):
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT id, sku, qty, total FROM orders WHERE id = :id"),
            {"id": order_id},
        ).fetchone()
    return dict(row._mapping) if row else None


def insert_order(payload: dict):
    with engine.begin() as conn:
        row = conn.execute(
            text(
                "INSERT INTO orders (sku, qty, total) VALUES (:sku, :qty, :total) RETURNING id"
            ),
            payload,
        ).fetchone()
    return {**payload, "id": row.id}
