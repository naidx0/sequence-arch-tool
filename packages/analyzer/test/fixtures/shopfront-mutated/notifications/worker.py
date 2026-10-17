import json
import os

import redis

r = redis.from_url(os.environ["REDIS_URL"])


def main() -> None:
    pubsub = r.pubsub()
    pubsub.subscribe("order.created")
    for message in pubsub.listen():
        if message["type"] != "message":
            continue
        order = json.loads(message["data"])
        send_email(order)


def send_email(order: dict) -> None:
    print(f"[email] order {order['id']} confirmed")


if __name__ == "__main__":
    main()
