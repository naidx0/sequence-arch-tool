import os

from fastapi import FastAPI

from .views import router

app = FastAPI()
app.include_router(router)

DATABASE_URL = os.environ["DATABASE_URL"]


def main() -> None:
    import uvicorn

    uvicorn.run(app, port=8000)


if __name__ == "__main__":
    main()
