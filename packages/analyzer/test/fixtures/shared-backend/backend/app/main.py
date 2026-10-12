from fastapi import FastAPI
from app.db import get_conn

app = FastAPI()


@app.get("/health")
def health():
    conn = get_conn()
    return {"ok": True}
