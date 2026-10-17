from fastapi import FastAPI

from app.routes import router

app = FastAPI(title="orders")
app.include_router(router)


@app.get("/health")
def health():
    return {"ok": True}
