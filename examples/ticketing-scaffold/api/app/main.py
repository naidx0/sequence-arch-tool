import json
import os

import redis
from fastapi import FastAPI
from sqlalchemy import create_engine, text

app = FastAPI(title="api")

# Broker connection (queue_publish edge api -> ticket.created via REDIS_URL)
r = redis.from_url(os.environ["REDIS_URL"])

# Database connection (db_access edge api -> postgres, table tickets, via DATABASE_URL)
engine = create_engine(os.environ["DATABASE_URL"])


@app.get("/tickets/{p1}")
def read_ticket(p1: int):
    with engine.begin() as conn:
        row = conn.execute(
            text("SELECT id, title FROM tickets WHERE id = :id"),
            {"id": p1},
        ).first()
    return {"id": row[0], "title": row[1]} if row else {}


@app.post("/tickets")
def create_ticket(payload: dict):
    with engine.begin() as conn:
        result = conn.execute(
            text("INSERT INTO tickets (title) VALUES (:title) RETURNING id"),
            {"title": payload.get("title")},
        )
        ticket_id = result.scalar()
    r.publish("ticket.created", json.dumps({"id": ticket_id, **payload}))
    return {"id": ticket_id}


@app.get("/health")
def health():
    return {"ok": True}
