package main

import (
	"fmt"

	"github.com/example/deployer/internal/store"
)

func main() {
	fmt.Println(store.Load("default"))
}
