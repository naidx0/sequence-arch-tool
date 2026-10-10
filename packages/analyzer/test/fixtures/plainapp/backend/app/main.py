from fastapi import FastAPI
import psycopg2
import os

app = FastAPI()


def db():
    return psycopg2.connect(os.environ["DATABASE_URL"])


@app.get("/notes")
def list_notes():
    conn = db()
    cur = conn.cursor()
    cur.execute("SELECT id, body FROM notes")
    return cur.fetchall()


@app.post("/notes")
def create_note(body: str):
    conn = db()
    cur = conn.cursor()
    cur.execute("INSERT INTO notes (body) VALUES (%s)", (body,))
    conn.commit()
    return {"ok": True}
