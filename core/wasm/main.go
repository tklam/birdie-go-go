//go:build js && wasm

// Command wasm is the WebAssembly entry point of the Go core. It is the only
// package that touches syscall/js: it exposes a single global function,
// birdieCoreCall(requestJSON) → responseJSON, then signals readiness by
// calling birdieCoreReady() if the host defined it.
package main

import (
	"syscall/js"

	"birdiegogo/core/rpc"
)

func main() {
	js.Global().Set("birdieCoreCall", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 1 || args[0].Type() != js.TypeString {
			return string(rpc.Handle(nil))
		}
		return string(rpc.Handle([]byte(args[0].String())))
	}))
	if ready := js.Global().Get("birdieCoreReady"); ready.Type() == js.TypeFunction {
		ready.Invoke()
	}
	select {}
}
