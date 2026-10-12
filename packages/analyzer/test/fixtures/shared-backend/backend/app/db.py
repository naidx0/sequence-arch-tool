import os


def get_conn():
    return os.environ["DATABASE_URL"]
