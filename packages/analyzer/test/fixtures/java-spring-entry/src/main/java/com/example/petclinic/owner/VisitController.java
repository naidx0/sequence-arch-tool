package com.example.petclinic.owner;

class VisitController {

	// The SAME NAME declared with two different types in one file. Java scopes
	// these per block; the per-file `varTypes` map does not, so the honest
	// answer is no edge at all rather than an edge to whichever declaration
	// happened to be walked first.
	public void first() {
		OwnerRepository target = new OwnerRepository();
		target.recordVisit(1);
	}

	public void second() {
		Owner target = new Owner();
		target.addPet("x");
	}

	public void chained(OwnerRepository repo) {
		// a chained receiver proves nothing about what `loadById(1)` returned
		repo.loadById(1).addPet("x");
	}

	public void ambiguousMethod(OwnerController c) {
		// `overloaded` is declared twice in OwnerController — unique or nothing
		c.overloaded("x");
	}
}
