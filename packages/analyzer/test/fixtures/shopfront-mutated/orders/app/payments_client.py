import os

import httpx

PAYMENTS_URL = os.environ["PAYMENTS_URL"]


async def charge_order(order: dict) -> dict:
    async with httpx.AsyncClient() as client:
        r = await client.post(f"{PAYMENTS_URL}/charge", json={"order_id": order["id"], "amount": order["total"]})
        r.raise_for_status()
        return r.json()
