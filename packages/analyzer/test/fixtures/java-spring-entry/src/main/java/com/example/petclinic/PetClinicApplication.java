package com.example.petclinic;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * The U33 shape, taken from spring-petclinic-monolith: an annotated class whose
 * only call is into the framework. It has, and must keep having, NO outbound
 * call edge — Spring's dispatch is not in this source, and inventing one to
 * make a metric go green would invert the point of the metric.
 */
@SpringBootApplication
public class PetClinicApplication {

	public static void main(String[] args) {
		SpringApplication.run(PetClinicApplication.class, args);
	}

}
