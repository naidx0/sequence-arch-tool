package com.example.shop;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OrderController {
  private final OrderRepository orders;

  public OrderController(OrderRepository orders) {
    this.orders = orders;
  }

  @GetMapping("/orders")
  public String list() {
    return orders.all();
  }
}
