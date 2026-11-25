package iam

import "testing"

func TestCommunityBudget(t *testing.T) {
	items := []communityCost{
		{Category: "materials", Item: "Bahan pelatihan", Reason: "Praktik mitra", Quantity: 3, Price: "75000"},
		{Category: "copies", Item: "Cetak modul", Reason: "Panduan peserta", Quantity: 10, Price: "15000"},
	}
	total, err := communityBudget(items)
	if err != nil || total != "375000" {
		t.Fatalf("total = %q, error = %v", total, err)
	}
	items[1].Item = "Honor pelaksana"
	if _, err := communityBudget(items); err == nil {
		t.Fatal("honor pelaksana accepted")
	}
	items[1].Item = "Cetak modul"
	items[1].Price = "999999999999999"
	if _, err := communityBudget(items); err == nil {
		t.Fatal("out-of-range total accepted")
	}
}
