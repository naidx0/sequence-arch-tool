import os

DSN = os.environ["DATABASE_URL"]


def dsn() -> str:
    return DSN
