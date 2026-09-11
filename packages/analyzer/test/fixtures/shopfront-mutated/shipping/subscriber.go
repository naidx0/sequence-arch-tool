package main

import (
	"context"
	"encoding/json"
	"log"
	"os"

	"github.com/redis/go-redis/v9"
)

// OrderCreatedEvent mirrors the payload orders publishes on order.created.
type OrderCreatedEvent struct {
	OrderID int `json:"order_id"`
}

func subscribeOrders() {
	ctx := context.Background()
	rdb := redis.NewClient(&redis.Options{
		Addr: os.Getenv("REDIS_ADDR"),
	})

	sub := rdb.Subscribe(ctx, "order.created")
	ch := sub.Channel()

	for msg := range ch {
		var evt OrderCreatedEvent
		if err := json.Unmarshal([]byte(msg.Payload), &evt); err != nil {
			log.Println("bad payload", err)
			continue
		}
		if err := insertShipment(evt.OrderID, "pending"); err != nil {
			log.Println("insert failed", err)
		}
	}
}
