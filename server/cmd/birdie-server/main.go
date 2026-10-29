// Command birdie-server is the optional update server. It publishes content
// packs (maps, missions, events, …) for clients that are configured to check
// for updates. The game is fully playable without it.
//
//	go run ./server/cmd/birdie-server -addr :8080 -packs ./packs
package main

import (
	"flag"
	"log"
	"net/http"
	"time"

	"birdiegogo/server/internal/updates"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	packs := flag.String("packs", "packs", "directory with manifest.json and pack files")
	origin := flag.String("allow-origin", "*", "CORS origin allowed to fetch updates")
	flag.Parse()

	srv := &http.Server{
		Addr:              *addr,
		Handler:           updates.NewHandler(*packs, *origin),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("birdie-server: serving updates from %s on %s", *packs, *addr)
	log.Fatal(srv.ListenAndServe())
}
