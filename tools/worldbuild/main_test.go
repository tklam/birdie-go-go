package main

import (
	"encoding/json"
	"testing"
)

func parseWorld(t *testing.T, s string) tiledWorld {
	t.Helper()
	var w tiledWorld
	if err := json.Unmarshal([]byte(s), &w); err != nil {
		t.Fatal(err)
	}
	return w
}

func TestBuildIndex(t *testing.T) {
	tests := []struct {
		name         string
		world        string
		wantW, wantH int
		wantRegions  int
		wantErr      bool
	}{
		{name: "empty world", world: `{"type":"world","maps":[]}`},
		{
			name:  "one exact chunk",
			world: `{"type":"world","maps":[{"fileName":"a.tmj","x":0,"y":0,"width":512,"height":512}]}`,
			wantW: 1, wantH: 1, wantRegions: 1,
		},
		{
			name: "partial chunks round up",
			world: `{"type":"world","maps":[
				{"fileName":"a.tmj","x":0,"y":0,"width":512,"height":512},
				{"fileName":"b.tmj","x":512,"y":0,"width":16,"height":528}]}`,
			wantW: 2, wantH: 2, wantRegions: 2,
		},
		{name: "not a world", world: `{"type":"map"}`, wantErr: true},
		{name: "negative position", world: `{"type":"world","maps":[{"fileName":"a.tmj","x":-16,"y":0,"width":16,"height":16}]}`, wantErr: true},
		{name: "off grid", world: `{"type":"world","maps":[{"fileName":"a.tmj","x":8,"y":0,"width":16,"height":16}]}`, wantErr: true},
		{name: "empty map", world: `{"type":"world","maps":[{"fileName":"a.tmj","x":0,"y":0,"width":0,"height":16}]}`, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			index, err := buildIndex(parseWorld(t, tt.world))
			if (err != nil) != tt.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.wantErr {
				return
			}
			if index.WidthChunks != tt.wantW || index.HeightChunks != tt.wantH {
				t.Errorf("size = %d×%d chunks, want %d×%d", index.WidthChunks, index.HeightChunks, tt.wantW, tt.wantH)
			}
			if len(index.Regions) != tt.wantRegions {
				t.Errorf("regions = %d, want %d", len(index.Regions), tt.wantRegions)
			}
			if index.TileSize != 16 || index.ChunkTiles != 32 {
				t.Errorf("tileSize/chunkTiles = %d/%d", index.TileSize, index.ChunkTiles)
			}
		})
	}
}
