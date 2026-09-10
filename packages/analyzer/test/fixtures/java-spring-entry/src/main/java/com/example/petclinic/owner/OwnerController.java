package com.example.petclinic.owner;

import com.example.petclinic.util.EntityUtils;

@Controller
class OwnerController {

	private final OwnerRepository owners;

	public OwnerController(OwnerRepository owners) {
		this.owners = owners;
	}

	@GetMapping("/owners/{ownerId}")
	public String showOwner(Integer ownerId) {
		// receiver typed by a FIELD declaration, `this.`-qualified
		Owner owner = this.owners.loadById(ownerId);
		// receiver typed by a LOCAL declaration
		owner.addPet("rosy");
		// the same field, written without `this.`
		owners.recordVisit(ownerId);
		// type-qualified (static) call, reached through a single-type import
		return EntityUtils.render(owner);
	}

	@GetMapping("/owners")
	public String listOwners() {
		// `this.method(...)` — an own method, named through `this`
		return this.showOwner(1);
	}

	public String overloaded(String a) {
		return a;
	}

	public String overloaded(Integer a) {
		return String.valueOf(a);
	}
}
