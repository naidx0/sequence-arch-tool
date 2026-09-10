from fastapi import APIRouter

from .models import Order

router = APIRouter()


@router.get("/orders")
def list_orders():
    return [o.as_dict() for o in Order.all()]


@router.post("/orders")
def create_order(payload: dict):
    return Order.create(payload).as_dict()
