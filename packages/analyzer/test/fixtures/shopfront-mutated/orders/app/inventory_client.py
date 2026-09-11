import os

import grpc

from app import inventory_pb2, inventory_pb2_grpc

channel = grpc.insecure_channel(os.environ["INVENTORY_ADDR"])
stub = inventory_pb2_grpc.InventoryStub(channel)


def reserve_stock(sku: str, qty: int):
    return stub.Reserve(inventory_pb2.ReserveRequest(sku=sku, qty=qty))
