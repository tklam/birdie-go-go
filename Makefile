# Birdie Go Go — see developer_guide.md §3 for what each target does.

GO       ?= go
TINYGO   := $(shell command -v tinygo 2>/dev/null)
HOST     ?= localhost
PUBLIC   := web/public
TYGO     := github.com/gzuidhof/tygo@v0.2.21
STATICCHECK := honnef.co/go/tools/cmd/staticcheck@v0.8.2

.PHONY: dev core content world assets gen test lint bench build server pack clean

dev: core content world web/node_modules
	cd web && npx vite --host $(HOST)

# The Go core as WebAssembly. TinyGo gives a much smaller binary; standard Go
# is the fallback when TinyGo isn't installed.
core:
ifdef TINYGO
	tinygo build -target wasm -no-debug -opt z -o $(PUBLIC)/core.wasm ./core/wasm
	cp "$$(tinygo env TINYGOROOT)/targets/wasm_exec.js" $(PUBLIC)/wasm_exec.js
else
	@echo "core: TinyGo not found, building with standard Go"
	GOOS=js GOARCH=wasm $(GO) build -trimpath -ldflags="-s -w" -o $(PUBLIC)/core.wasm ./core/wasm
	cp "$$($(GO) env GOROOT)/lib/wasm/wasm_exec.js" $(PUBLIC)/wasm_exec.js
endif

content:
	$(GO) run ./tools/contentbuild -content content -out $(PUBLIC)/content/base.json

world:
	$(GO) run ./tools/worldbuild -world content/world/city.world -out $(PUBLIC)/world

assets:
	$(GO) run ./tools/assetgen gen -assets $(PUBLIC)/assets

gen:
	$(GO) run $(TYGO) generate

test: web/node_modules
	$(GO) test ./...
	cd web && npx vitest run

lint: web/node_modules
	test -z "$$(gofmt -l .)" || { gofmt -l .; exit 1; }
	$(GO) vet ./...
	GOOS=js GOARCH=wasm $(GO) vet ./core/wasm
	$(GO) run $(STATICCHECK) ./...
	$(GO) run ./tools/assetgen check -assets $(PUBLIC)/assets
	cd web && npm run lint

bench:
	@echo "bench: the streaming benchmark arrives with world streaming (TODO.md M1)"; exit 1

build: core content world web/node_modules
	cd web && npx tsc --noEmit && npx vite build --outDir ../dist --emptyOutDir

server:
	$(GO) run ./server/cmd/birdie-server -addr :8080 -packs packs

pack:
	@echo "pack: content packs arrive in TODO.md M5"; exit 1

web/node_modules: web/package.json web/package-lock.json
	cd web && npm ci
	@touch web/node_modules

clean:
	rm -rf dist $(PUBLIC)/core.wasm $(PUBLIC)/wasm_exec.js $(PUBLIC)/content $(PUBLIC)/world
