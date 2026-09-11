from fastapi import APIRouter, HTTPException

from app.db import get_order, insert_order
from app.events import publish_order_created
from app.inventory_client import reserve_stock
from app.payments_client import charge_order

router = APIRouter()


@router.get("/orders/{order_id}")
def read_order(order_id: int):
    order = get_order(order_id)
    if order is None:
        raise HTTPException(status_code=404)
    return order


@router.post("/orders")
async def create_order(payload: dict):
    reserve_stock(payload["sku"], payload["qty"])
    order = insert_order(payload)
    await charge_order(order)
    publish_order_created(order)
    return order
