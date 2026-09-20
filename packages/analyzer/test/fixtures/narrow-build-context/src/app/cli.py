import os

from rules import lint

DB_HOST = os.environ.get("POSTGRES_HOST", "localhost")


def main():
    print(lint("select 1"))
