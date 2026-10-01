import json
import os

import redis

r = redis.from_url(os.environ["REDIS_URL"])


def publish_order_created(order: dict) -> None:
    r.publish("order.created", json.dumps(order))
