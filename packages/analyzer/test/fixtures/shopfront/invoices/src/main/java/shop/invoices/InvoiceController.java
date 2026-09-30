package shop.invoices;

import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/invoices")
public class InvoiceController {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @GetMapping("/{id}")
    public Map<String, Object> getInvoice(@PathVariable String id) {
        String sql = "SELECT id, order_id, total FROM invoices WHERE id = ?";
        return jdbcTemplate.queryForMap(sql, id);
    }

    @PostMapping("")
    public void create(@RequestBody Map<String, Object> body) {
        String sql = "INSERT INTO invoices (order_id, total) VALUES (?, ?)";
        jdbcTemplate.update(sql, body.get("orderId"), body.get("total"));
    }
}
