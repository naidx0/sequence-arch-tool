import os

import psycopg2

CONN = psycopg2.connect(os.environ["DATABASE_URL"])


class Order:
    __tablename__ = "orders"

    def __init__(self, row):
        self.row = row

    def as_dict(self):
        return dict(self.row)

    @classmethod
    def all(cls):
        cur = CONN.cursor()
        cur.execute("SELECT id, total FROM orders")
        return [cls(r) for r in cur.fetchall()]

    @classmethod
    def create(cls, payload):
        cur = CONN.cursor()
        cur.execute("INSERT INTO orders (total) VALUES (%s) RETURNING id", (payload["total"],))
        return cls(cur.fetchone())
