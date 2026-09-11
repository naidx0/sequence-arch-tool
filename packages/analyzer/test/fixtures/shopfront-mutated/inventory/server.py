from concurrent import futures

import grpc

import inventory_pb2
import inventory_pb2_grpc

STOCK = {"widget": 100}


class InventoryService(inventory_pb2_grpc.InventoryServicer):
    def Reserve(self, request, context):
        available = STOCK.get(request.sku, 0)
        ok = available >= request.qty
        if ok:
            STOCK[request.sku] = available - request.qty
        return inventory_pb2.ReserveReply(ok=ok)


def serve() -> None:
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    inventory_pb2_grpc.add_InventoryServicer_to_server(InventoryService(), server)
    server.add_insecure_port("[::]:50051")
    server.start()
    server.wait_for_termination()


if __name__ == "__main__":
    serve()
