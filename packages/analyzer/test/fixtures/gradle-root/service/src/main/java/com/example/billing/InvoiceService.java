package com.example.billing;

public class InvoiceService {
    private final InvoiceRepository repository;

    public InvoiceService(InvoiceRepository repository) {
        this.repository = repository;
    }

    public String describe(String id) {
        return repository.find(id);
    }
}
