package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"birdiegogo/core/model"
)

func TestRunWritesPackAndManifest(t *testing.T) {
	dir := t.TempDir()
	bundle := filepath.Join(dir, "base.json")
	b := model.ContentBundle{Game: model.GameInfo{Title: "T", ContentVersion: "0.1.0", StartMap: "world", StartSpawn: "s"}}
	data, _ := json.Marshal(b)
	if err := os.WriteFile(bundle, data, 0o644); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(dir, "packs")
	if err := run(bundle, "base", "1.1.0", "0.1.0", out); err != nil {
		t.Fatal(err)
	}
	if err := run(bundle, "base", "1.2.0", "0.1.0", out); err != nil {
		t.Fatal(err)
	}
	var m model.UpdateManifest
	raw, err := os.ReadFile(filepath.Join(out, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	if len(m.Packs) != 1 || m.Packs[0].Version != "1.2.0" || len(m.Packs[0].SHA256) != 64 || m.Packs[0].URL != "packs/base-1.2.0.pack" {
		t.Fatalf("manifest = %+v", m)
	}
	if _, err := os.Stat(filepath.Join(out, "base-1.2.0.pack")); err != nil {
		t.Fatal(err)
	}
}

func TestRunRejectsBadInput(t *testing.T) {
	dir := t.TempDir()
	bundle := filepath.Join(dir, "base.json")
	if err := os.WriteFile(bundle, []byte(`{"game":{"title":""}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := run(bundle, "base", "1.0.0", "0.1.0", dir); err == nil {
		t.Error("expected invalid content to be rejected")
	}
	if err := run(bundle, "base", "v1", "0.1.0", dir); err == nil {
		t.Error("expected a bad version to be rejected")
	}
}
