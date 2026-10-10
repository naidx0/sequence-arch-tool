package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"

	_ "github.com/lib/pq"
)

var db *sql.DB

// Shipment is the wire representation returned to the gateway.
type Shipment struct {
	ID      int    `json:"id"`
	OrderID int    `json:"order_id"`
	Status  string `json:"status"`
}

func getShipment(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Path[len("/shipments/"):]
	row := db.QueryRow("SELECT id, order_id, status FROM shipments WHERE id = $1", id)

	var s Shipment
	if err := row.Scan(&s.ID, &s.OrderID, &s.Status); err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(s)
}

func insertShipment(orderID int, status string) error {
	_, err := db.Exec("INSERT INTO shipments (order_id, status) VALUES ($1, $2)", orderID, status)
	return err
}

func health(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("ok"))
}

func main() {
	var err error
	db, err = sql.Open("postgres", os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}

	go subscribeOrders()

	mux := http.NewServeMux()
	mux.HandleFunc("/shipments/", getShipment)
	mux.HandleFunc("/health", health)
	log.Fatal(http.ListenAndServe(":8100", mux))
}
