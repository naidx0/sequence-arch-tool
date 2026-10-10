package shop.invoices;

import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

@Service
public class PaymentClient {

    @Value("${PAYMENTS_URL}")
    private String paymentsUrl;

    private final RestTemplate restTemplate = new RestTemplate();

    public Map charge(Map req) {
        return restTemplate.postForObject(paymentsUrl + "/charge", req, Map.class);
    }
}
