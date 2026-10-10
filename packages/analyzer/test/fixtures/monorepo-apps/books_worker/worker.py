import redis

async def run():
    r = redis.Redis(host="redis")
    return r.get("jobs")
