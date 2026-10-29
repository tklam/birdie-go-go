// Command birdie-server is the optional update server. It publishes content
// packs (maps, missions, events, …) for clients that are configured to check
// for updates, and keeps cloud saves under sync codes when -saves is set.
// The game is fully playable without it.
//
//	go run ./server/cmd/birdie-server -addr :8080 -packs ./packs -saves ./saves
package main

import (
	"flag"
	"log"
	"net/http"
	"time"

	"birdiegogo/server/internal/saves"
	"birdiegogo/server/internal/updates"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	packs := flag.String("packs", "packs", "directory with manifest.json and pack files")
	origin := flag.String("allow-origin", "*", "CORS origin allowed to fetch updates")
	savesDir := flag.String("saves", "", "directory for cloud saves (empty: cloud saves off)")
	flag.Parse()

	var extra []func(*http.ServeMux)
	if *savesDir != "" {
		extra = append(extra, saves.Store{Dir: *savesDir}.Register)
		log.Printf("birdie-server: cloud saves in %s", *savesDir)
	}

	srv := &http.Server{
		Addr:              *addr,
		Handler:           updates.NewHandler(*packs, *origin, extra...),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("birdie-server: serving updates from %s on %s", *packs, *addr)
	log.Fatal(srv.ListenAndServe())
}
